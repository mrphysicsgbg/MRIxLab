// Draw sequence timing and ROI curves on one shared axis.
import { signalDuration } from './sequences.js';

const NS = 'http://www.w3.org/2000/svg';
const LEFT = 110;
const RIGHT = 850;
const COMPRESSED_DELAY_WIDTH = 80;
const CYCLE_END_PADDING = 18;

// Long TI/TR delays are explicitly broken so millisecond-scale events stay visible.
export function createTimeAxis(model) {
  const maximum = Math.max(model.echo, model.repetition, model.signalEnd ?? 0, ...model.rf.map(pulse => pulse.time));
  const end = maximum + Math.max(model.TE * 0.25, 0.001);
  const times = [...new Set([0, end, model.echo, ...(model.signalEnd === undefined ? [] : [model.signalEnd]), ...model.rf.map(pulse => pulse.time)])].sort((a, b) => a - b);
  const cap = Math.max(model.TE * 2, 0.02);
  const segments = times.slice(1).map((time, i) => {
    const duration = time - times[i];
    const inSignalWindow = model.signalEnd !== undefined && times[i] >= (model.signalStart ?? model.excitation) && time <= model.signalEnd;
    const compressed = duration > cap * 1.5 && !inSignalWindow;
    return { start: times[i], end: time, compressed, weight: compressed ? cap * 0.6 : duration };
  });
  // Reserve a fixed strip for a compressed delay before the next cycle and
  // fixed padding after it. This anchors both the break and next RF pulse
  // while the earlier events scale with the selected timing parameters.
  const delayIndex = segments.findIndex(segment => segment.compressed && segment.end === model.repetition);
  const fixedTail = delayIndex >= 0 && delayIndex === segments.length - 2;
  const flexibleSegments = fixedTail ? segments.slice(0, delayIndex) : segments;
  const weight = flexibleSegments.reduce((sum, segment) => sum + segment.weight, 0);
  const flexibleWidth = RIGHT - LEFT - (fixedTail ? COMPRESSED_DELAY_WIDTH + CYCLE_END_PADDING : 0);
  let position = LEFT;
  for (const [index, segment] of segments.entries()) {
    segment.left = position;
    position += fixedTail && index >= delayIndex
      ? (index === delayIndex ? COMPRESSED_DELAY_WIDTH : CYCLE_END_PADDING)
      : segment.weight / weight * flexibleWidth;
    segment.right = position;
  }
  return {
    segments,
    x(time) {
      if (time <= 0) return LEFT;
      const segment = segments.find(item => time <= item.end) ?? segments.at(-1);
      return segment.left + (time - segment.start) / (segment.end - segment.start) * (segment.right - segment.left);
    },
  };
}

function node(tag, attributes = {}, content) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (content !== undefined) element.textContent = content;
  return element;
}

export function renderSequenceDiagram(svg, sequence, parameters, roiPlot = null) {
  svg.replaceChildren();
  if (!sequence.diagram) {
    svg.append(node('text', { x: 20, y: 40 }, 'Diagram not available for this sequence.'));
    return [];
  }
  const model = sequence.diagram(parameters);
  // Keep timing coordinates and compression independent of ROI selection.
  model.signalStart = 0;
  model.signalEnd = model.excitation + signalDuration(sequence, parameters);
  const axis = createTimeAxis(model);
  svg.setAttribute('viewBox', roiPlot ? (model.kind === 'IR' ? '0 0 900 935' : '0 0 900 780') : '0 0 900 430');
  svg.setAttribute('aria-label', `${sequence.label}: TR ${parameters.TR} seconds, TE ${parameters.TE} seconds${model.kind === 'IR' ? `, TI ${parameters.TI} seconds` : ''}${model.kind === 'GRE' ? `, flip angle ${parameters.FA} degrees` : ''}. Simplified sequence diagram.`);
  svg.append(node('title', {}, `${sequence.label} pulse sequence`));
  const line = (x1, y1, x2, y2, className = 'diagram-baseline') => svg.append(node('line', { x1, y1, x2, y2, class: className }));
  const text = (x, y, content, className = 'diagram-text', anchor = 'middle') => svg.append(node('text', { x, y, class: className, 'text-anchor': anchor }, content));
  const path = (d, className) => svg.append(node('path', { d, class: className }));
  const duration = (start, end, y, label) => {
    const a = axis.x(start), b = axis.x(end);
    line(a, y, b, y, 'diagram-timing');
    line(a, y - 4, a, y + 4, 'diagram-timing');
    line(b, y - 4, b, y + 4, 'diagram-timing');
    text((a + b) / 2, y - 7, label);
  };
  duration(0, model.repetition, 27, `TR = ${parameters.TR.toFixed(3)} s`);
  if (model.kind === 'IR') duration(0, model.excitation, 56, `TI = ${parameters.TI.toFixed(3)} s`);
  duration(model.excitation, model.echo, 85, `TE = ${parameters.TE.toFixed(3)} s`);
  const stacked = roiPlot && model.kind === 'IR';
  const signalBottom = stacked ? 755 : 650;
  const tracks = [['RF', 150], ['G slice', 210], ['G phase', 265], ['G read', 320], ...(stacked ? [['Mz', 527.5], ['Mxy', signalBottom]] : [['Signal', roiPlot ? 650 : 375]])];
  for (const [label, y] of tracks) {
    line(LEFT - 18, y, RIGHT, y);
    if (!roiPlot || y <= 320) text(18, y + 4, label, 'diagram-text', 'start');
  }
  line(axis.x(model.echo), 103, axis.x(model.echo), roiPlot ? signalBottom : 397, 'diagram-echo-marker');
  if (model.kind === 'IR') {
    line(axis.x(model.excitation), 103, axis.x(model.excitation), roiPlot ? signalBottom : 397, 'diagram-ti-marker');
  }
  for (const pulse of model.rf) {
    const x = axis.x(pulse.time);
    const height = pulse.angle / 180 * 40;
    path(`M ${x - 6} 150 Q ${x} ${150 - height * 2} ${x + 6} 150`, 'diagram-rf');
    // The tallest (180°) pulse peaks at y=110; keep its text above the peak.
    const labelY = 150 - height - 9;
    text(x, labelY, `${pulse.angle.toFixed(pulse.angle % 1 ? 1 : 0)}°`, 'diagram-rf-label');
    if (pulse.label === 'Next cycle') text(x, 169, 'Next', 'diagram-text');
  }
  const lobe = (a, b, y, height, className) => {
    const start = Math.min(a, b), end = Math.max(a, b);
    const ramp = Math.min(5, (end - start) / 4);
    path(`M ${start} ${y} L ${start + ramp} ${y - height} L ${end - ramp} ${y - height} L ${end} ${y}`, className);
  };
  for (const pulse of model.rf.filter(item => item.label !== 'Next cycle' && item.label !== 'Inversion')) {
    const x = axis.x(pulse.time);
    lobe(x - 8, x + 8, 210, 23, 'diagram-gradient');
  }
  const excitationX = axis.x(model.excitation);
  const echoX = axis.x(model.echo);
  const phaseX = excitationX + (echoX - excitationX) * 0.2;
  lobe(phaseX - 7, phaseX + 7, 265, 20, 'diagram-gradient');
  // A dephasing lobe followed by readout illustrates GRE gradient reversal.
  lobe(phaseX - 8, phaseX + 8, 320, model.kind === 'GRE' ? -23 : 23, 'diagram-gradient');
  lobe(echoX - 22, echoX + 22, 320, 23, 'diagram-gradient');
  if (roiPlot) {
    const { trace, means, signedMeans = new Map() } = roiPlot;
    const signed = model.kind === 'IR';
    const finite = trace.curves.flatMap(curve => Array.from(signed ? [...curve.values, ...curve.signedValues] : curve.values).filter(Number.isFinite));
    finite.push(...Array.from(means.values()).filter(Number.isFinite));
    const maximum = Math.max(0.001, ...finite) * 1.08;
    const minimum = signed ? Math.min(-0.001, ...finite) * 1.08 : 0;
    // Keep both plots on the timing diagram's linear time axis and amplitude
    // scale. Include TI in both: longitudinal recovery ends where excitation
    // transfers it to the initial transverse signal.
    const charts = signed ? [
      { component: 'longitudinal', bottom: 527.5, label: 'Longitudinal magnetization (Mz)', includes: time => time <= model.excitation },
      { component: 'transverse', bottom: 755, label: 'Transversal magnetization (Mxy)', includes: time => time >= model.excitation },
    ] : [{ component: 'transverse', bottom: 650, label: 'Transversal magnetization (Mxy)', includes: () => true }];
    const plotHeight = signed ? 122.5 : 245;
    for (const chart of charts) {
      const y = value => chart.bottom - (value - minimum) / (maximum - minimum) * plotHeight;
      chart.y = y;
      const labelY = chart.bottom - plotHeight / 2;
      svg.append(node('text', { x: 22, y: labelY, class: 'diagram-text roi-axis-label',
        'text-anchor': 'middle', transform: `rotate(-90 22 ${labelY})`,
        'data-component': chart.component }, chart.label));
      for (let i = 0; i <= 4; i++) {
        const value = minimum + (maximum - minimum) * i / 4;
        line(LEFT, y(value), RIGHT, y(value), 'roi-chart-grid');
        text(LEFT - 9, y(value) + 4, value.toFixed(3), 'diagram-text', 'end');
        const time = trace.values.at(-1) * i / 4;
        text(axis.x(time), chart.bottom + 26, time.toFixed(3));
      }
      line(LEFT, y(0), RIGHT, y(0), 'diagram-baseline');
      text((axis.x(0) + axis.x(model.signalEnd)) / 2, chart.bottom + 49, signed ? 'Time from inversion (s)' : 'Time after excitation (s)');
    }
    const y = charts.at(-1).y;
    for (const [index, curve] of trace.curves.entries()) {
      const drawCurve = (values, magnitude, chart) => {
        let d = '', open = false;
        values.forEach((value, i) => {
          if (!chart.includes(trace.values[i]) || !Number.isFinite(value)) { open = false; return; }
          d += `${open ? 'L' : 'M'} ${axis.x(trace.values[i]).toFixed(3)} ${chart.y(value).toFixed(3)} `;
          open = true;
        });
        svg.append(node('path', { d, class: 'roi-signal-curve', stroke: curve.region.color,
          ...(signed && !magnitude ? { 'stroke-dasharray': '0 7', 'stroke-linecap': 'round' } : {}),
          'data-signal': magnitude ? 'magnitude' : 'signed', 'data-component': chart.component, 'data-roi': curve.region.slot }));
      };
      for (const chart of charts) {
        drawCurve(curve.values, true, chart);
        if (signed) drawCurve(curve.signedValues, false, chart);
      }
      const mean = means.get(curve.region.slot);
      const signedMean = signedMeans.get(curve.region.slot);
      // Draw a larger hollow ring first, then the signed dot. Both remain
      // distinguishable when positive signed and magnitude means coincide.
      if (Number.isFinite(mean)) svg.append(node('circle', { cx: axis.x(model.echo), cy: y(mean), r: signed ? 6 : 5,
        fill: signed ? 'var(--field)' : curve.region.color,
        ...(signed ? { stroke: curve.region.color, 'stroke-width': 2 } : {}),
        class: 'roi-image-sample', 'data-signal': 'magnitude', 'data-roi': curve.region.slot }));
      if (signed && Number.isFinite(signedMean)) svg.append(node('circle', { cx: axis.x(model.echo), cy: y(signedMean), r: 3.5,
        fill: curve.region.color, class: 'roi-signed-sample', 'data-signal': 'signed', 'data-roi': curve.region.slot }));
      const legendX = LEFT + index * 240;
      // Match each legend sample to its curve and sampling marker.
      if (signed) {
        text(legendX, signalBottom + 103, `${curve.region.slot + 1}: ${curve.region.label.slice(0, 24)}`, 'diagram-text', 'start');
        for (const magnitude of [false, true]) {
          const legendY = signalBottom + (magnitude ? 152 : 126);
          svg.append(node('line', { x1: legendX, x2: legendX + 36, y1: legendY, y2: legendY,
            stroke: curve.region.color, 'stroke-width': 2.5, class: 'roi-legend-line',
            'data-signal': magnitude ? 'magnitude' : 'signed', 'data-roi': curve.region.slot,
            ...(!magnitude ? { 'stroke-dasharray': '0 7', 'stroke-linecap': 'round' } : {}) }));
          svg.append(node('circle', { cx: legendX + 18, cy: legendY, r: 4,
            fill: magnitude ? 'var(--field)' : curve.region.color, stroke: curve.region.color,
            'stroke-width': 2, class: 'roi-legend-marker', 'data-signal': magnitude ? 'magnitude' : 'signed' }));
          text(legendX + 45, legendY + 4, magnitude ? 'Magnitude' : 'Signed + noise', 'diagram-text', 'start');
        }
      } else {
        svg.append(node('line', { x1: legendX, x2: legendX + 18, y1: 749, y2: 749, stroke: curve.region.color, 'stroke-width': 3 }));
        text(legendX + 25, 753, `${curve.region.slot + 1}: ${curve.region.label.slice(0, 24)}`, 'diagram-text', 'start');
      }
    }
    svg.append(node('line', { x1: axis.x(model.echo), x2: axis.x(model.echo), y1: signalBottom - plotHeight - 5, y2: signalBottom, class: 'roi-chart-current' }));
    text(450, signalBottom + 74, signed ? `Image sampling at t = ${model.echo.toFixed(3)} s (TI + TE) · hollow: magnitude · filled: signed` : `Image sampling at TE = ${parameters.TE.toFixed(3)} s · Colored dots are the image ROI means`);
    if (!trace.curves.length) text(450, 520, 'Draw regions on the image to see their signal curves.');
  } else {
  // Generic normalized envelope when no ROI analysis is active.
  const amplitude = model.kind === 'GRE' ? Math.abs(Math.sin(parameters.FA * Math.PI / 180)) : 1;
  let echoPath = '';
  for (let i = 0; i <= 80; i++) {
    const offset = (i - 40) / 40;
    const x = echoX + offset * 27;
    const y = 375 - amplitude * 27 * Math.exp(-4 * offset * offset) * Math.cos(offset * 8 * Math.PI);
    echoPath += `${i === 0 ? 'M' : 'L'} ${x} ${y} `;
  }
  path(echoPath, 'diagram-signal');
  text(echoX, 410, `Echo at ${model.echo.toFixed(3)} s`);
  }
  for (const segment of axis.segments.filter(item => item.compressed)) {
    const x = (segment.left + segment.right) / 2;
    for (const [, y] of tracks) {
      svg.append(node('rect', { x: x - 9, y: y - 5, width: 18, height: 10, class: 'diagram-gap-mask' }));
      path(`M ${x - 7} ${y + 4} l 5 -8 M ${x + 1} ${y + 4} l 5 -8`, 'diagram-break');
    }
    text(x, roiPlot ? signalBottom + 26 : 410, '⋯');
  }
  return [...model.warnings, ...(roiPlot ? [model.kind === 'IR' ? 'The upper plot shows Longitudinal magnetization before TI; the lower plot shows Transversal magnetization after TI. The dotted vertical line marks the 90° excitation at TI. Longitudinal recovery is not a measured transverse signal. After TI they use the reference image equation with fixed voxel noise; magnitude is averaged per voxel. Sampling is at TI + TE.' : 'ROI curves show the reference equations’ transverse evolution after excitation, with fixed voxel noise. The dots at TE match the image before grayscale normalization.'] : []), ...(axis.segments.some(item => item.compressed)
    ? ['Long delays are compressed at the // marks; use the labeled times for exact intervals.'] : [])];
}
