// Check ROI drawing controls and diagram updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoiController } from '../js/rois.js';
import { renderSequenceDiagram } from '../js/sequence-diagram.js';
import { sequences, defaultParameters } from '../js/sequences.js';
import { traceRegions } from '../js/roi-analysis.js';

// A small DOM harness exercises pointer capture and UI events without a browser.
class Node {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.attributes = {}; this.listeners = new Map(); this.value = '';
    this.classes = new Set(); this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
    this.style = { setProperty() {} };
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  toggleAttribute(key, force) {
    const present = force ?? !(key in this.attributes);
    if (present) this.attributes[key] = ''; else delete this.attributes[key];
    return present;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  fire(name, event = {}) { this.listeners.get(name)?.(event); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 80, height: 80 }; }
  setPointerCapture(pointer) { this.pointer = pointer; }
  hasPointerCapture(pointer) { return this.pointer === pointer; }
  releasePointerCapture() { this.pointer = null; this.fire('lostpointercapture'); }
}

test('ROI selection preserves timing geometry and compression across slider boundaries', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { createElementNS: (_, tag) => new Node(tag) };
    const timingGeometry = svg => svg.children.filter(node =>
      ['diagram-rf', 'diagram-gradient', 'diagram-timing'].includes(node.attributes.class) ||
      (node.attributes.class === 'diagram-gap-mask' && Number(node.attributes.y) < 320)
    ).map(node => node.attributes);
    for (const sequence of Object.values(sequences)) {
      const defaults = defaultParameters(sequence);
      const cases = [defaults, Object.fromEntries(sequence.parameters.map(parameter => [parameter.key, parameter.min]))];
      for (const parameter of sequence.parameters) {
        for (const value of [parameter.min, parameter.max]) cases.push({ ...defaults, [parameter.key]: value });
      }
      const echoPositions = [];
      for (const parameters of cases) {
        const plain = new Node('svg'), withRoi = new Node('svg');
        renderSequenceDiagram(plain, sequence, parameters);
        renderSequenceDiagram(withRoi, sequence, parameters, {
          trace: traceRegions(sequence, parameters, [], true), means: new Map(),
        });
        assert.deepEqual(timingGeometry(plain), timingGeometry(withRoi), `${sequence.shortLabel}: ${JSON.stringify(parameters)}`);
        const echoX = svg => svg.children.find(node => node.attributes.class === 'diagram-echo-marker').attributes.x1;
        assert.equal(echoX(plain), echoX(withRoi));
        assert.ok(Number.isFinite(Number(echoX(plain))));
        if (parameters.TR === defaults.TR && parameters.TE !== defaults.TE) echoPositions.push(echoX(plain));
      }
      assert.equal(new Set(echoPositions).size, 2, 'TE minimum and maximum place the echo at different positions');
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('compressed delay marks stay fixed before the next excitation as TE changes', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { createElementNS: (_, tag) => new Node(tag) };
    for (const sequence of Object.values(sequences)) {
      const parameter = sequence.parameters.find(parameter => parameter.key === 'TE');
      let expectedBreaks, expectedNextPulse;
      const echoes = new Set();
      for (const TR of [5, 20]) {
        for (const TE of [parameter.min, 0.05, 0.1, parameter.max]) {
          const parameters = { ...defaultParameters(sequence), TR, TE };
          for (const withRoi of [false, true]) {
            const svg = new Node('svg');
            renderSequenceDiagram(svg, sequence, parameters, withRoi ? {
              trace: traceRegions(sequence, parameters, [], true), means: new Map(),
            } : null);
            const breaks = svg.children.filter(node => node.attributes.class === 'diagram-gap-mask' && Number(node.attributes.y) < 320).map(node => node.attributes.x);
            const nextPulse = svg.children.filter(node => node.attributes.class === 'diagram-rf').at(-1).attributes.d;
            expectedBreaks ??= breaks;
            expectedNextPulse ??= nextPulse;
            assert.equal(breaks.length, 4);
            assert.deepEqual(breaks, expectedBreaks);
            assert.equal(nextPulse, expectedNextPulse);
            echoes.add(svg.children.find(node => node.attributes.class === 'diagram-echo-marker').attributes.x1);
            assert.ok(Number(breaks[0]) > 750, 'breaks remain at the right end');
          }
        }
      }
      assert.equal(echoes.size, 4, 'echo still moves with TE');
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('three ROIs can be drawn, renamed, redrawn, deleted and restored per slice', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = new Node();
    document.createElement = tag => new Node(tag);
    document.createElementNS = (_, tag) => new Node(tag);
    const elements = Object.fromEntries(['roi-overlay', 'roi-drawing-overlay', 'roi-cancel', 'roi-status',
      'roi-controls', 'roi-list', 'roi-slice-note'].map(id => [id, new Node()]));
    // Match an SVG's initial markup. A .hidden assignment alone cannot clear it.
    elements['roi-overlay'].setAttribute('hidden', '');
    elements['roi-drawing-overlay'].setAttribute('hidden', '');
    const state = { object: 'brain', slice: 50, showRois: true, sequence: 'SE', parameters: { TR: 1, TE: 0.1 },
      noiseFree: false, roiSets: new Map() };
    const maps = { Rho: new Float32Array(16).fill(1), T1: new Float32Array(16).fill(1),
      T2: new Float32Array(16).fill(0.1), T2Star: new Float32Array(16).fill(0.05) };
    const phantom = { width: 4, height: 4, getSlice: () => maps };
    let controller;
    controller = createRoiController({ state, elements, getPhantom: () => phantom, getRenderer: () => ({ getNoise: () => state.noiseFree ? 0 : 0.01 }),
      onHover() {} });
    controller.update();
    assert.equal('hidden' in elements['roi-drawing-overlay'].attributes, false, 'drawing SVG must have its hidden attribute removed');
    const draw = slot => {
      controller.start(slot);
      const hitArea = elements['roi-drawing-overlay'].children.find(node => 'data-roi-hit-area' in node.attributes);
      assert.equal(hitArea.attributes['pointer-events'], 'all', 'empty image area must receive drawing events');
      const pointer = { pointerId: 1, button: 0, isPrimary: true, preventDefault() {} };
      elements['roi-drawing-overlay'].fire('pointerdown', { ...pointer, clientX: 20, clientY: 20 });
      assert.equal(controller.isDrawing, true);
      assert.ok(elements['roi-drawing-overlay'].children.some(node => node.tag === 'circle'), 'pressing immediately displays the trace origin');
      for (const [x, y] of [[60, 20], [60, 60], [20, 60]]) elements['roi-drawing-overlay'].fire('pointermove', { ...pointer, clientX: x, clientY: y });
      elements['roi-drawing-overlay'].fire('pointerup', { ...pointer, clientX: 20, clientY: 20 });
      assert.equal(controller.isDrawing, false);
    };
    for (let slot = 0; slot < 3; slot++) draw(slot);
    const regions = state.roiSets.get('brain:50').regions;
    assert.equal(regions.filter(Boolean).length, 3);
    assert.ok(regions.every(region => region.indices.length === 4));
    const firstRow = elements['roi-list'].children[0];
    const name = firstRow.children.find(child => child.tag === 'input');
    name.value = 'White matter'; name.fire('input');
    assert.equal(regions[0].label, 'White matter');
    assert.equal(elements['roi-list'].children[0], firstRow, 'live updates preserve label input focus');
    draw(0);
    assert.equal(regions[0].label, 'White matter', 'redrawing retains the label');
    controller.start(0);
    document.fire('keydown', { key: 'Escape' });
    assert.equal(regions.filter(Boolean).length, 3, 'cancelling does not erase previous masks');
    state.slice = 51; controller.invalidate(); controller.update();
    assert.equal(state.roiSets.get('brain:51').regions.filter(Boolean).length, 0);
    state.slice = 50; controller.invalidate(); controller.update();
    assert.equal(state.roiSets.get('brain:50').regions.filter(Boolean).length, 3);
    state.sequence = 'GRE'; state.parameters = { TR: 1, TE: 0.1, FA: 90 }; controller.update();
    const originalPlot = controller.getPlot().trace.curves[0].values.slice();
    state.parameters.FA = 30; controller.update();
    assert.notDeepEqual(controller.getPlot().trace.curves[0].values, originalPlot);
    state.parameters.TE = 0.02; controller.update();
    assert.equal(controller.getPlot().trace.sampleTime, 0.020);
    const svg = new Node('svg');
    renderSequenceDiagram(svg, sequences.GRE, state.parameters, controller.getPlot());
    assert.equal(svg.attributes.viewBox, '0 0 900 780');
    const markers = svg.children.filter(node => node.attributes.class === 'roi-image-sample');
    assert.equal(markers.length, 3);
    const samplingLine = svg.children.find(node => node.attributes.class === 'roi-chart-current');
    assert.ok(markers.every(marker => marker.attributes.cx === samplingLine.attributes.x1));
    const deleteButton = elements['roi-list'].children[0].children.find(node => node.attributes['aria-label'] === 'Delete ROI 1');
    deleteButton.fire('click');
    assert.equal(regions.filter(Boolean).length, 2);
    const savedPlot = controller.getPlot();
    state.showRois = false; controller.cancelDrawing();
    assert.equal(controller.getPlot(), savedPlot, 'mobile editor collapse preserves the saved plot object');
    controller.update();
    assert.equal('hidden' in elements['roi-overlay'].attributes, false, 'saved ROI outlines remain visible with the editor collapsed');
    assert.equal(elements['roi-overlay'].children.filter(node => node.tag === 'polygon').length, 2);
    assert.equal('hidden' in elements['roi-drawing-overlay'].attributes, true, 'minimizing hides only the drawing layer');
    controller.start(0);
    assert.equal(elements['roi-drawing-overlay'].children.find(node => 'data-roi-hit-area' in node.attributes).attributes['pointer-events'], 'none', 'collapsed editor cannot start drawing');
    assert.equal(controller.getPlot().trace.curves.length, 2, 'collapsed editor retains saved ROI plots');
    renderSequenceDiagram(svg, sequences.GRE, state.parameters, controller.getPlot());
    assert.equal(svg.children.filter(node => node.attributes.class === 'roi-signal-curve').length, 2);
    const collapsedPlot = controller.getPlot().trace.curves[0].values.slice();
    // Reading the diagram refreshes data even without updating the hidden editor.
    state.parameters.FA = 60;
    assert.notDeepEqual(controller.getPlot().trace.curves[0].values, collapsedPlot, 'collapsed ROI plots follow parameter changes');
    state.parameters.TE = 0.04;
    assert.equal(controller.getPlot().trace.sampleTime, 0.04, 'collapsed plot sampling follows TE immediately');
    const noisyMean = controller.getPlot().means.get(1);
    state.noiseFree = true;
    assert.notEqual(controller.getPlot().means.get(1), noisyMean, 'collapsed plot follows noise settings');
    state.slice = 52; controller.invalidate(); controller.update();
    assert.equal(controller.getPlot(), null, 'a slice without regions uses the standard signal illustration');
    assert.equal('hidden' in elements['roi-overlay'].attributes, true);
    state.slice = 50; controller.invalidate(); controller.update();
    assert.equal(controller.getPlot().trace.curves.length, 2, 'returning to a slice restores its plot while the editor is collapsed');
    assert.equal(elements['roi-overlay'].children.filter(node => node.tag === 'polygon').length, 2);
    state.showRois = true; controller.update();
    assert.equal('hidden' in elements['roi-overlay'].attributes, false);
    const hitArea = elements['roi-drawing-overlay'].children.find(node => 'data-roi-hit-area' in node.attributes);
    assert.equal(hitArea.attributes['pointer-events'], 'none', 'idle overlay lets canvas hover events through');
    assert.equal(regions.filter(Boolean).length, 2);
    renderSequenceDiagram(svg, sequences.GRE, state.parameters, controller.getPlot());
    for (const path of svg.children.filter(node => node.tag === 'path')) {
      assert.ok(!/NaN|undefined|Infinity/.test(path.attributes.d));
    }
    for (const slot of [1, 2]) {
      const button = elements['roi-list'].children[slot].children.find(node => node.attributes['aria-label'] === `Delete ROI ${slot + 1}`);
      button.fire('click');
    }
    assert.equal(controller.getPlot(), null, 'clearing all regions removes the plot independently of editor visibility');
    state.showRois = false; controller.update();
    assert.equal('hidden' in elements['roi-overlay'].attributes, true, 'cleared outlines disappear');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('IR stacks longitudinal above transverse while preserving linear timing and image sampling', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { createElementNS: (_, tag) => new Node(tag) };
    const parameters = { TR: 5, TE: 0.08, TI: 1.2 };
    const plot = { trace: { values: new Float64Array([0, 1.2, 1.28, 1.45]), curves: [{
      region: { slot: 0, color: '#ffbc55', label: 'Test ROI' }, values: new Float64Array([0.8, 0.6, 0.4, 0.1]), signedValues: new Float64Array([-0.8, 0.6, 0.4, 0.1]),
    }] }, means: new Map([[0, 0.4]]), signedMeans: new Map([[0, 0.4]]) };
    const svg = new Node('svg');
    renderSequenceDiagram(svg, sequences.IR, parameters, plot);
    const marker = svg.children.find(node => node.attributes.class === 'roi-image-sample');
    const echoLine = svg.children.find(node => node.attributes.class === 'diagram-echo-marker');
    assert.equal(marker.attributes.cx, echoLine.attributes.x1);
    const curves = svg.children.filter(node => node.attributes.class === 'roi-signal-curve');
    assert.equal(curves.length, 4);
    assert.equal(curves[0].attributes.stroke, curves[1].attributes.stroke);
    assert.equal(curves[0].attributes['stroke-dasharray'], undefined);
    assert.equal(curves[1].attributes['stroke-dasharray'], '0 7');
    assert.equal(curves[1].attributes['stroke-linecap'], 'round');
    const signedMarker = svg.children.find(node => node.attributes.class === 'roi-signed-sample');
    assert.equal(marker.attributes.fill, 'var(--field)', 'magnitude marker has a hollow interior');
    assert.equal(signedMarker.attributes.fill, '#ffbc55', 'signed marker is filled');
    assert.equal(signedMarker.attributes.cx, marker.attributes.cx);
    assert.equal(signedMarker.attributes.cy, marker.attributes.cy);
    assert.ok(marker.attributes.r > signedMarker.attributes.r, 'coincident samples show a hollow ring around the filled dot');
    assert.ok(svg.children.indexOf(marker) < svg.children.indexOf(signedMarker));
    const legends = svg.children.filter(node => node.attributes.class === 'roi-legend-line');
    assert.equal(legends.find(node => node.attributes['data-signal'] === 'signed').attributes['stroke-dasharray'], '0 7');
    assert.equal(legends.find(node => node.attributes['data-signal'] === 'magnitude').attributes['stroke-dasharray'], undefined);
    assert.ok(svg.children.some(node => node.tag === 'text' && /^-0\./.test(node.textContent)));
    const coordinates = component => curves.find(node => node.attributes['data-signal'] === 'signed' && node.attributes['data-component'] === component).attributes.d.match(/[ML] ([\d.]+) ([\d.]+)/g).map(point => point.split(' ').slice(1).map(Number));
    const longitudinal = coordinates('longitudinal');
    const transverse = coordinates('transverse');
    assert.equal(longitudinal.length, 2, 'longitudinal stops at TI');
    assert.equal(transverse.length, 3, 'transverse begins at TI');
    assert.equal(longitudinal[0][0], 110);
    assert.equal(longitudinal.at(-1)[0], transverse[0][0], 'both plots share the excitation time');
    const tiLine = svg.children.find(node => node.attributes.class === 'diagram-ti-marker');
    assert.ok(Math.abs(Number(tiLine.attributes.x1) - transverse[0][0]) < 0.001, 'TI marker aligns with the 90-degree pulse and both plot boundaries');
    assert.equal(tiLine.attributes.x1, tiLine.attributes.x2);
    assert.equal(tiLine.attributes.y1, '103');
    assert.equal(tiLine.attributes.y2, '755', 'TI marker spans sequence tracks and both graphs');
    assert.equal(svg.attributes.viewBox, '0 0 900 935');
    assert.ok(longitudinal.every(point => point[1] >= 405 && point[1] <= 527.5), 'upper plot has half its former 245-unit height');
    assert.ok(transverse.every(point => point[1] >= 632.5 && point[1] <= 755), 'lower plot has half its former 245-unit height');
    assert.ok(Math.max(...longitudinal.map(point => point[1])) < Math.min(...transverse.map(point => point[1])), 'longitudinal graph is above transverse');
    assert.ok(Math.abs((transverse[1][0] - transverse[0][0]) / (longitudinal[1][0] - longitudinal[0][0]) - 0.08 / 1.2) < 1e-4);
    assert.ok(Math.abs(Number(marker.attributes.cy) - transverse[1][1]) < 0.001, 'image mean belongs to transverse graph');
    assert.ok(svg.children.some(node => node.textContent?.includes('Longitudinal magnetization (Mz)')));
    assert.ok(svg.children.some(node => node.textContent?.includes('Transversal magnetization (Mxy)')));
    const axisLabels = svg.children.filter(node => node.attributes.class === 'diagram-text roi-axis-label');
    assert.deepEqual(axisLabels.map(node => node.textContent), ['Longitudinal magnetization (Mz)', 'Transversal magnetization (Mxy)']);
    assert.ok(axisLabels.every(node => node.attributes.transform.startsWith('rotate(-90')));
    assert.ok(!svg.children.some(node => /ROI mean \(a.u.\)|before excitation at TI|after excitation at TI/.test(node.textContent ?? '')));
    for (const sequence of [sequences.SE, sequences.GRE]) {
      const single = new Node('svg');
      renderSequenceDiagram(single, sequence, { ...parameters, FA: 30 }, plot);
      const labels = single.children.filter(node => node.attributes.class === 'diagram-text roi-axis-label');
      assert.equal(labels.length, 1);
      assert.equal(labels[0].textContent, 'Transversal magnetization (Mxy)');
      assert.ok(labels[0].attributes.transform.startsWith('rotate(-90'));
    }

    assert.ok(svg.children.some(node => node.textContent?.includes('Image sampling at t = 1.280 s')));
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('180-degree RF labels sit above the inversion and refocusing pulse peaks', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { createElementNS: (_, tag) => new Node(tag) };
    const svg = new Node('svg');
    renderSequenceDiagram(svg, sequences.IR, { TR: 5, TE: 0.08, TI: 1.2 });
    const labels = svg.children.filter(node => node.tag === 'text' && node.textContent === '180°');
    assert.equal(labels.length, 3);
    assert.ok(labels.every(label => Number(label.attributes.y) <= 101));
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
