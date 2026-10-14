// Signal stays signed here. Magnitude, noise and windowing belong to the renderer.
const TR = { key: 'TR', label: 'Repetition time', unit: 's', value: 1, min: 0, max: 10, step: 0.1 };
const TE = { key: 'TE', label: 'Echo time', unit: 's', value: 0.1, min: 0.005, max: 0.2, step: 0.001 };

// Share the displayed signal duration between the timing diagram and ROI traces.
export function signalDuration(sequence, parameters) {
  return Math.max((sequence.parameters.find(parameter => parameter.key === 'TE')?.max ?? 0.2) * 1.25, parameters.TE);
}

// Place RF events relative to inversion, excitation, and echo.
function echoDiagram({ TR, TE, TI = 0, FA = 90 }, kind) {
  const inversion = kind === 'IR';
  const excitation = inversion ? TI : 0;
  const echo = excitation + TE;
  const rf = [
    ...(inversion ? [{ time: 0, angle: 180, label: 'Inversion' }] : []),
    { time: excitation, angle: kind === 'GRE' ? FA : 90, label: 'Excitation' },
    ...(kind !== 'GRE' ? [{ time: excitation + TE / 2, angle: 180, label: 'Refocusing' }] : []),
    { time: TR, angle: inversion ? 180 : kind === 'GRE' ? FA : 90, label: 'Next cycle' },
  ].map(pulse => ({ ...pulse, duration: 0.0004 }));
  // Illustrative durations in seconds, independent of TE/TI and display scale.
  // Equal RF durations make normalized pulse area proportional to flip angle.
  const readout = { start: echo - 0.0004, end: echo + 0.0004, ramp: 0.0002 };
  const gradients = [
    ...rf.filter(pulse => ['Excitation', 'Refocusing'].includes(pulse.label)).map(pulse => ({
      track: 'slice', start: pulse.time - 0.0004, end: pulse.time + 0.0004, ramp: 0.0002, amplitude: 1,
    })),
    // Rephase half the slice-select area accumulated after excitation center.
    { track: 'slice', start: excitation + 0.0004, end: excitation + 0.0008, ramp: 0.0001, amplitude: -1 },
    { track: 'phase', start: excitation + 0.0002, end: excitation + 0.0006, ramp: 0.0001, amplitude: 1 },
    // Half the readout area: GRE uses opposite polarity; the SE/IR 180-degree
    // pulse reverses the accumulated phase, so their prephaser has the same sign.
    { track: 'read', start: excitation + 0.0002, end: excitation + 0.0006, ramp: 0.0001, amplitude: kind === 'GRE' ? -1 : 1 },
    { track: 'read', ...readout, amplitude: 1 },
  ];
  return { kind, excitation, echo, repetition: TR, rf, gradients, readout, TE, TI,
    warnings: [
      ...(TR <= echo ? ['The echo reaches or exceeds the next cycle. Increase TR for a realizable timing order.'] : []),
      ...(inversion && TI === 0 ? ['At TI = 0 the inversion and excitation pulses coincide.'] : []),
      ...(TR > echo && TR - echo < 0.0006 ? ['The readout overlaps the next RF pulse with the illustrative pulse durations. Increase TR.'] : []),
      ...(inversion && TI > 0 && TI < 0.0004 ? ['Inversion and excitation RF pulses overlap with the illustrative pulse durations. Increase TI.'] : []),
    ],
  };
}

// Evaluate the original signal equations without display normalization.
function simulate(slice, parameters, output, model) {
  if (output.length !== slice.Rho.length) throw new Error('Signal buffer has the wrong size.');
  const { TR, TE, TI, FA } = parameters;
  const angle = FA * Math.PI / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const transverse = model === 'GRE' ? slice.T2Star : slice.T2;
  for (let i = 0; i < output.length; i++) {
    const t1 = slice.T1[i] === 0 ? 1 : slice.T1[i];
    const t2 = transverse[i] === 0 ? 1 : transverse[i];
    const recovery = Math.exp(-TR / t1);
    const decay = Math.exp(-TE / t2);
    if (model === 'SE') output[i] = slice.Rho[i] * decay * (1 - recovery);
    if (model === 'IR') output[i] = slice.Rho[i] * (1 - 2 * Math.exp(-TI / t1) + recovery) * decay;
    if (model === 'GRE') {
      // Preserve the reference's NaN at the singular TR=0, FA=0 combination.
      output[i] = slice.Rho[i] * (sin * decay * (1 - recovery) / (1 - cos * recovery));
    }
  }
  return output;
}

export const sequences = {
  SE: {
    label: 'Spin Echo', shortLabel: 'SE',
    equation: String.raw`S_{\mathrm{SE}} = \rho\,e^{-\mathrm{TE}/T_2}\left(1-e^{-\mathrm{TR}/T_1}\right)`,
    description: 'Explore how repetition and echo times shape T1 and T2 contrast.',
    parameters: [TR, TE],
    diagram: params => echoDiagram(params, 'SE'),
    simulate: (slice, params, out) => simulate(slice, params, out, 'SE'),
  },
  IR: {
    label: 'Inversion Recovery', shortLabel: 'IR',
    equation: String.raw`S_{\mathrm{IR}} = \rho\left(1-2e^{-\mathrm{TI}/T_1}+e^{-\mathrm{TR}/T_1}\right)e^{-\mathrm{TE}/T_2}`,
    description: 'Use inversion time to explore signal recovery and tissue suppression.',
    // Leave a positive inversion interval even at the maximum echo time.
    parameters: [{ ...TR, min: Number((TE.max + TR.step).toFixed(3)) }, TE, { key: 'TI', label: 'Inversion time', unit: 's', value: 0, min: 0, max: 4.5, step: 0.0225 }],
    diagram: params => echoDiagram(params, 'IR'),
    simulate: (slice, params, out) => simulate(slice, params, out, 'IR'),
  },
  GRE: {
    label: 'Gradient Echo', shortLabel: 'GRE',
    equation: String.raw`S_{\mathrm{GRE}} = \rho\,\frac{\sin(\alpha)\,e^{-\mathrm{TE}/T_2^{*}}\left(1-e^{-\mathrm{TR}/T_1}\right)}{1-\cos(\alpha)\,e^{-\mathrm{TR}/T_1}}`,
    description: 'Explore the effect of flip angle and T2* decay on image contrast.',
    parameters: [TR, { ...TE, min: 0.001 }, { key: 'FA', label: 'Flip angle', unit: '°', value: 90, min: 0, max: 90, step: 0.45 }],
    diagram: params => echoDiagram(params, 'GRE'),
    simulate: (slice, params, out) => simulate(slice, params, out, 'GRE'),
  },
};

export function defaultParameters(sequence) {
  return Object.fromEntries(sequence.parameters.map(parameter => [parameter.key, parameter.value]));
}
