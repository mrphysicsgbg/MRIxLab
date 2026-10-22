// Connect controls, image rendering, and optional panels.
import { sequences, defaultParameters } from './sequences.js';
import { loadPhantom, simulationObjects } from './phantom.js';
import { createRenderer } from './renderer.js';
import { pixelAt } from './pixel.js';
import { renderLatex } from './math.js';
import { renderSequenceDiagram } from './sequence-diagram.js';
import { createRoiController } from './rois.js';
import { createGlobalWindow } from './global-window.js';

const state = { object: 'brain', sequence: 'SE', slice: 50, parameters: defaultParameters(sequences.SE), darkMode: true, showEquations: false, showDiagram: false, noiseFree: false,
  showRois: false, stackImage: false, roiSets: new Map() };
const elements = Object.fromEntries(['object', 'image-object', 'sequence', 'parameters', 'slice', 'slice-value', 'sequence-description',
  'simulation-controls', 'mri-image', 'image-sequence', 'image-slice', 'status', 'loading', 'load-message',
  'retry', 'reset', 'dark-mode', 'show-equations', 'noise-free', 'equations-panel', 'lab', 'image-stage',
  'equation-sequence', 'signal-equation', 'display-equation', 'pixel-position', 'pixel-signal', 'pixel-magnitude',
  'pixel-noise', 'pixel-gray', 'pixel-rho', 'pixel-t1', 'pixel-t2', 'pixel-t2star',
  'show-diagram', 'diagram-panel', 'diagram-number', 'diagram-sequence', 'sequence-diagram', 'diagram-notes', 'diagram-signal-description',
  'define-rois', 'roi-panel', 'roi-overlay', 'roi-drawing-overlay', 'image-plane', 'roi-list', 'roi-controls', 'roi-cancel',
  'roi-slice-note', 'roi-status', 'equation-number', 'simulation-view', 'mobile-equations-panel',
  'mobile-diagram-panel', 'mobile-roi-panel', 'mobile-panel-content', 'mobile-roi-dock', 'mobile-noise-free', 'image-layout-toggle', 'image-panel'].map(id => [id, document.getElementById(id)]));
let phantom;
const loadedObjects = new Map();
let signal;
let renderer;
let pendingFrame = null;
let hoveredPixel = null;
let roiController;
let globalWindow;

// Move the existing controls so reading and keyboard order follow the phone layout.
const phoneLayout = window.matchMedia('(max-width: 620px)');
const controls = document.querySelector('.controls');
const controlPanels = document.querySelector('.control-panels');
const viewerContent = document.querySelector('.viewer-content');
const viewerHeading = document.querySelector('.viewer-header h2');
const viewerIndex = document.querySelector('.viewer-header .section-index');
const desktopViewerTitle = viewerHeading.textContent;
const expandablePanels = [
  ['showDiagram', 'diagram-panel', 'mobile-diagram-panel'],
  ['showEquations', 'equations-panel', 'mobile-equations-panel'],
  ['showRois', 'roi-panel', 'mobile-roi-panel'],
];
function updatePhoneLayout() {
  if (phoneLayout.matches) {
    viewerContent.insertBefore(controls, document.querySelector('.image-details'));
    for (const [, panel] of expandablePanels) elements['mobile-panel-content'].append(elements[panel]);
    controls.append(elements.status);
  } else {
    controlPanels.prepend(controls);
    controlPanels.append(elements['roi-panel']);
    elements.lab.append(elements['equations-panel'], elements['diagram-panel']);
    document.querySelector('.image-details').insertBefore(elements.status, document.querySelector('.pixel-inspector'));
  }
  viewerHeading.textContent = phoneLayout.matches ? 'Simulation & parameters' : desktopViewerTitle;
  viewerIndex.textContent = phoneLayout.matches ? '01–02' : '02';
  updateViewOptions();
}
phoneLayout.addEventListener('change', updatePhoneLayout);
elements['image-layout-toggle'].addEventListener('click', () => {
  state.stackImage = !state.stackImage;
  updateViewOptions();
  elements['image-layout-toggle'].focus({ preventScroll: true });
});
updatePhoneLayout();

function updatePixelReadout() {
  const keys = ['signal', 'magnitude', 'noise', 'gray', 'rho', 't1', 't2', 't2star'];
  if (!hoveredPixel || !phantom) {
    elements['pixel-position'].textContent = 'Hover over the image';
    for (const key of keys) elements[`pixel-${key}`].textContent = '—';
    return;
  }
  const { column, row, index } = hoveredPixel;
  const slice = phantom.getSlice(state.slice);
  const pixel = renderer.getPixel(index);
  const values = [signal[index], pixel.magnitude, pixel.noise, pixel.grayscale,
    slice.Rho[index], slice.T1[index], slice.T2[index], slice.T2Star[index]];
  elements['pixel-position'].textContent = `Row ${row} · Column ${column} · Slice ${state.slice}`;
  keys.forEach((key, i) => {
    elements[`pixel-${key}`].textContent = !Number.isFinite(values[i]) ? 'Undefined'
      : key === 'gray' ? String(values[i]) : values[i].toPrecision(6);
  });
}

function hoverPixel(event, leave = false) {
  if (!phantom || phoneLayout.matches) return;
  hoveredPixel = leave ? null : pixelAt(event.clientX, event.clientY, elements['mri-image'].getBoundingClientRect(), phantom.width, phantom.height);
  updatePixelReadout();
}
elements['mri-image'].addEventListener('pointermove', hoverPixel);
elements['mri-image'].addEventListener('pointerleave', () => { hoveredPixel = null; updatePixelReadout(); });

// Show selected panels and keep their numbering consistent.
function updateRoiDisplayState() {
  const hasRegions = [...state.roiSets.values()].some(set => set.regions.some(Boolean));
  elements.lab.classList.toggle('has-defined-rois', hasRegions);
}

function updateViewOptions() {
  updateRoiDisplayState();
  const stackImage = state.stackImage && !phoneLayout.matches;
  const viewer = elements['image-panel'];
  elements.lab.classList.toggle('image-stacked', stackImage);
  if (stackImage) {
    if (viewer.nextElementSibling !== controls) controls.before(viewer);
  } else if (viewer.parentElement !== elements.lab) {
    controlPanels.after(viewer);
  }
  const layoutAction = stackImage ? 'Move image beside sequence parameters' : 'Move image above sequence parameters';
  const viewerSectionHeading = viewerHeading.parentElement;
  if (stackImage) {
    if (elements['image-layout-toggle'].parentElement === viewerSectionHeading) viewerSectionHeading.after(elements['image-layout-toggle']);
  } else if (elements['image-layout-toggle'].parentElement !== viewerSectionHeading) {
    viewerSectionHeading.prepend(elements['image-layout-toggle']);
  }
  elements['image-layout-toggle'].textContent = stackImage ? '>' : '<';
  elements['image-layout-toggle'].setAttribute('aria-pressed', String(stackImage));
  elements['image-layout-toggle'].setAttribute('aria-label', layoutAction);
  elements['image-layout-toggle'].title = layoutAction;
  const darkMode = phoneLayout.matches || state.darkMode;
  document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = darkMode ? '#151c1b' : '#f5f4ef';
  elements['dark-mode'].checked = state.darkMode;
  elements['show-equations'].checked = state.showEquations;
  elements['equations-panel'].hidden = !state.showEquations;
  elements.lab.classList.toggle('with-equations', state.showEquations);
  elements['show-diagram'].checked = state.showDiagram;
  elements['diagram-panel'].hidden = !state.showDiagram;
  elements.lab.classList.toggle('with-diagram', state.showDiagram);
  elements.lab.closest('main').classList.toggle('with-diagram', state.showDiagram);
  elements['define-rois'].checked = state.showRois;
  elements['roi-panel'].hidden = !state.showRois;
  elements.lab.classList.toggle('with-rois', state.showRois);
  elements.lab.closest('main').classList.toggle('with-rois', state.showRois);
  elements['equation-number'].textContent = state.showRois ? '04' : '03';
  elements['diagram-number'].textContent = String(3 + Number(state.showEquations) + Number(state.showRois)).padStart(2, '0');
  for (const [key, , disclosure] of expandablePanels) elements[disclosure].open = state[key];
  // ROI editing occupies the bottom dock instead of reducing the drawing area.
  if (phoneLayout.matches) {
    const roiParent = state.showRois ? elements['mobile-roi-dock'] : elements['mobile-panel-content'];
    if (elements['roi-panel'].parentElement !== roiParent) roiParent.append(elements['roi-panel']);
    const statusParent = state.showRois ? elements['mobile-roi-dock'] : controls;
    if (elements.status.parentElement !== statusParent) statusParent.append(elements.status);
  }
  const expandedCount = expandablePanels.filter(([key]) => key !== 'showRois' && state[key]).length;
  elements.lab.dataset.expandedPanels = String(expandedCount);
}
// Use dark mode unless the user saved a light-mode preference.
try { state.darkMode = localStorage.getItem('mrilab-dark-mode') !== 'false'; } catch { /* Storage is optional. */ }
elements['dark-mode'].addEventListener('change', () => {
  state.darkMode = elements['dark-mode'].checked;
  updateViewOptions();
  try { localStorage.setItem('mrilab-dark-mode', String(state.darkMode)); } catch { /* Storage is optional. */ }
});
for (const [key, , disclosure] of expandablePanels) {
  elements[disclosure].addEventListener('toggle', () => {
    if (!phoneLayout.matches || state[key] === elements[disclosure].open) return;
    state[key] = elements[disclosure].open;
    if (key === 'showRois') {
      if (state.showRois) {
        state.showDiagram = false;
        roiController?.update();
      } else {
        // Collapse only the editor. Retain the saved overlay and plot data.
        roiController?.cancelDrawing();
      }
    }
    updateViewOptions();
    updateEquations();
    updateDiagram();
  });
}
elements['show-equations'].addEventListener('change', () => {
  state.showEquations = elements['show-equations'].checked;
  updateViewOptions();
  updateEquations();
});
elements['show-diagram'].addEventListener('change', () => {
  state.showDiagram = elements['show-diagram'].checked;
  updateViewOptions();
  updateDiagram();
});
elements['define-rois'].addEventListener('change', () => {
  state.showRois = elements['define-rois'].checked;
  updateViewOptions();
  roiController.update();
  updateDiagram();
  if (state.showRois && phantom) roiController.start(0);
});
updateViewOptions();
elements['noise-free'].checked = state.noiseFree;
function setNoiseFree(value) {
  state.noiseFree = value;
  elements['noise-free'].checked = value;
  elements['mobile-noise-free'].setAttribute('aria-pressed', String(value));
  updateEquations();
  scheduleRender();
}
elements['noise-free'].addEventListener('change', () => setNoiseFree(elements['noise-free'].checked));
elements['mobile-noise-free'].addEventListener('click', () => setNoiseFree(!state.noiseFree));

function updateRange(input) {
  const progress = 100 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty('--progress', `${progress}%`);
}

function formatValue(parameter, value) {
  return `${value.toFixed(3)} ${parameter.unit}`;
}

function updateEquations() {
  const sequence = sequences[state.sequence];
  elements['equation-sequence'].textContent = sequence.label;
  if (!state.showEquations) return;
  renderLatex(elements['signal-equation'], sequence.equation ?? String.raw`\text{Equation not provided.}`);
  const magnitude = state.noiseFree ? String.raw`\lvert S \rvert \quad (n=0)` : String.raw`\lvert S+n \rvert`;
  const maximum = String.raw`\max_{\mathrm{volume}}\lvert S\rvert`;
  renderLatex(elements['display-equation'], String.raw`\begin{aligned} M &= ${magnitude} \\ \mathrm{Gray} &= \min\left(255,255\,\frac{M}{${maximum}}\right) \end{aligned}`);
}

function updateDiagram() {
  updateRoiDisplayState();
  if (!state.showDiagram) return;
  const sequence = sequences[state.sequence];
  const roiPlot = roiController?.getPlot();
  elements['diagram-sequence'].textContent = sequence.label;
  elements['diagram-notes'].textContent = renderSequenceDiagram(elements['sequence-diagram'], sequence, state.parameters,
    roiPlot).join(' ');
  elements['diagram-signal-description'].textContent = roiPlot
    ? (state.sequence === 'IR' ? 'The upper ROI graph shows longitudinal magnetization: inversion recovery, a drop to zero at the 90° excitation, then T1 recovery toward equilibrium. The lower graph shows transverse magnetization: zero before excitation, then a jump followed by decay. The dotted vertical line marks the 90° pulse at TI. Both share the time axis starting at inversion (t = 0). Solid: mean magnitude. Dotted: signed mean. Receiver noise applies only to the transverse signal. Image sampling occurs at TI + TE.' : 'RF heights indicate flip angle. Gradients and pulse widths are schematic. The enlarged signal track shows ROI mean magnitude; time starts at excitation, and image sampling is marked at TE.')
    : 'RF heights indicate flip angle. Waveform widths are enlarged for visibility and scale smoothly with the time axis; durations and gradient amplitudes are schematic. The signal is a normalized magnitude echo within the readout window, independent of the image and noise.';
}

function createParameterControls() {
  const sequence = sequences[state.sequence];
  updateEquations();
  elements['sequence-description'].textContent = sequence.description ?? '';
  elements.parameters.replaceChildren();
  const parameterControls = new Map();
  function syncParameterControls() {
    for (const parameter of sequence.parameters) {
      const { input, output, endpoints } = parameterControls.get(parameter.key);
      // Keep TI on its slider step grid and strictly below TR - TE.
      // Round the step count so floating-point noise cannot include equality.
      const max = parameter.key === 'TI'
        ? Math.min(parameter.max, Number(((Math.ceil(Number(((state.parameters.TR - state.parameters.TE) / parameter.step).toFixed(8))) - 1) * parameter.step).toFixed(4)))
        : parameter.max;
      input.max = max;
      input.value = Math.min(state.parameters[parameter.key], max);
      state.parameters[parameter.key] = Number(input.value);
      output.textContent = formatValue(parameter, state.parameters[parameter.key]);
      endpoints.lastElementChild.textContent = `${max} ${parameter.unit}`;
      updateRange(input);
    }
  }
  for (const parameter of sequence.parameters) {
    const wrapper = document.createElement('div');
    wrapper.className = 'parameter';
    const heading = document.createElement('div');
    heading.className = 'control-heading';
    const label = document.createElement('label');
    label.htmlFor = `parameter-${parameter.key}`;
    label.textContent = parameter.key;
    const name = document.createElement('span');
    name.className = 'parameter-name';
    name.textContent = parameter.label;
    label.append(name);
    const output = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.id = label.htmlFor;
    output.htmlFor = input.id;
    Object.assign(input, { min: parameter.min, max: parameter.max, step: parameter.step, value: state.parameters[parameter.key] });
    output.textContent = formatValue(parameter, state.parameters[parameter.key]);
    input.addEventListener('input', () => {
      state.parameters[parameter.key] = Number(input.value);
      syncParameterControls();
      scheduleRender();
    });
    const endpoints = document.createElement('div');
    endpoints.className = 'range-endpoints';
    for (const value of [parameter.min, parameter.max]) {
      const span = document.createElement('span');
      span.textContent = `${value} ${parameter.unit}`;
      endpoints.append(span);
    }
    heading.append(label, output);
    wrapper.append(heading, input, endpoints);
    elements.parameters.append(wrapper);
    parameterControls.set(parameter.key, { input, output, endpoints });
  }
  syncParameterControls();
}

function render() {
  if (!phantom) { updateDiagram(); return; }
  const sequence = sequences[state.sequence];
  sequence.simulate(phantom.getSlice(state.slice), state.parameters, signal);
  const windowMaximum = globalWindow.getMaximum(state.sequence, state.parameters);
  const { invalid } = renderer.render(signal, state.noiseFree, windowMaximum);
  elements['image-sequence'].textContent = sequence.label.toUpperCase();
  elements['image-slice'].textContent = `SLICE ${state.slice}`;
  elements['mri-image'].setAttribute('aria-label', `${sequence.label} MRI image of ${simulationObjects[state.object].label}, slice ${state.slice} of ${phantom.slices - 1}`);
  elements.status.textContent = invalid
    ? 'Signal is undefined at this parameter combination. Adjust TR or flip angle to continue.'
    : '';
  if (globalWindow.failed) elements.status.textContent = 'Global window could not be calculated. Reload to try again.';
  else if (globalWindow.pending) elements.status.textContent += `${elements.status.textContent ? ' · ' : ''}Updating global window…`;
  updatePixelReadout();
  roiController?.update(false);
  updateDiagram();
}

// Combine rapid control changes into one frame.
function scheduleRender() {
  if (pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => { pendingFrame = null; render(); });
}

function updateSliceControl() {
  elements.slice.value = state.slice;
  elements['slice-value'].textContent = `${state.slice} / ${phantom ? phantom.slices - 1 : '—'}`;
  updateRange(elements.slice);
}

// Keep the slider, noise, and ROI context in sync.
function changeSlice(index) {
  if (!phantom) return;
  const nextSlice = Math.max(0, Math.min(phantom.slices - 1, index));
  if (nextSlice === state.slice) return;
  roiController?.cancelDrawing();
  state.slice = nextSlice;
  renderer.regenerateNoise();
  roiController?.invalidate();
  updateSliceControl();
  scheduleRender();
}

let wheelDelta = 0;
let lastWheelTime = 0;
elements['image-stage'].addEventListener('wheel', event => {
  // Leave browser zoom gestures and horizontal scrolling intact.
  if (!phantom || event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  event.preventDefault();
  if (roiController?.isDrawing) return;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements['image-stage'].clientHeight : 1;
  const delta = event.deltaY * scale;
  const now = performance.now();
  if (now - lastWheelTime > 200 || Math.sign(delta) !== Math.sign(wheelDelta)) wheelDelta = 0;
  lastWheelTime = now;
  wheelDelta += delta;
  // Accumulate small trackpad events instead of advancing a slice on every pixel.
  const steps = Math.trunc(wheelDelta / 40);
  if (steps !== 0) {
    wheelDelta -= steps * 40;
    changeSlice(state.slice + steps);
  }
}, { passive: false });
elements['image-stage'].addEventListener('pointerleave', () => { wheelDelta = 0; });

for (const [key, object] of Object.entries(simulationObjects)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = object.label;
  elements.object.append(option);
}
elements.object.value = state.object;
elements.object.addEventListener('change', () => {
  state.object = elements.object.value;
  initialize();
});

for (const [key, sequence] of Object.entries(sequences)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = sequence.label;
  elements.sequence.append(option);
}
elements.sequence.value = state.sequence;
elements.sequence.addEventListener('change', () => {
  state.sequence = elements.sequence.value;
  state.parameters = defaultParameters(sequences[state.sequence]);
  createParameterControls();
  scheduleRender();
});
elements.slice.addEventListener('input', () => {
  wheelDelta = 0;
  changeSlice(Number(elements.slice.value));
});
elements.reset.addEventListener('click', () => {
  state.parameters = defaultParameters(sequences[state.sequence]);
  createParameterControls();
  scheduleRender();
});
elements.retry.addEventListener('click', initialize);
roiController = createRoiController({ state, elements, getPhantom: () => phantom, getRenderer: () => renderer,
  onHover: hoverPixel, onPlot: updateDiagram });
createParameterControls();
updateSliceControl();

async function initialize() {
  globalWindow?.dispose();
  elements.object.disabled = true;
  elements['simulation-controls'].disabled = true;
  elements['mri-image'].hidden = true;
  elements['image-plane'].hidden = true;
  roiController.cancelDrawing();
  elements.loading.hidden = false;
  phantom = undefined;
  roiController.invalidate();
  roiController.update();
  hoveredPixel = null;
  updatePixelReadout();
  elements.retry.hidden = true;
  elements.loading.classList.remove('error');
  elements['load-message'].textContent = `Loading ${simulationObjects[state.object].label.toLowerCase()}…`;
  try {
    phantom = loadedObjects.get(state.object) ?? await loadPhantom(state.object);
    loadedObjects.set(state.object, phantom);
    state.slice = Math.min(state.slice, phantom.slices - 1);
    signal = new Float32Array(phantom.width * phantom.height);
    renderer = createRenderer(elements['mri-image'], phantom.width, phantom.height);
    globalWindow = createGlobalWindow(phantom, scheduleRender);
    roiController.invalidate();
    elements.slice.max = phantom.slices - 1;
    elements['image-object'].textContent = simulationObjects[state.object].label.toUpperCase();
    updateSliceControl();
    render();
    elements.loading.hidden = true;
    elements['mri-image'].hidden = false;
    elements['image-plane'].hidden = false;
    elements['simulation-controls'].disabled = false;
  } catch (error) {
    elements.loading.classList.add('error');
    phantom = undefined;
    elements['load-message'].textContent = 'The simulation object could not be loaded.';
    elements.status.textContent = `${error.message} Serve this folder with a static HTTP server and try again.`;
    elements.retry.hidden = false;
  } finally {
    elements.object.disabled = false;
  }
}
initialize();
