// Check sequence events and shared timeline coordinates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sequences, defaultParameters } from '../js/sequences.js';
import { createTimeAxis } from '../js/sequence-diagram.js';

test('SE refocusing occurs at TE/2 and IR timing begins at the inversion pulse', () => {
  const se = sequences.SE.diagram({ TR: 4, TE: 0.02 });
  assert.equal(se.excitation, 0);
  assert.equal(se.echo, 0.02);
  assert.deepEqual(se.rf.map(pulse => [pulse.time, pulse.angle]), [[0, 90], [0.01, 180], [4, 90]]);
  const ir = sequences.IR.diagram({ TR: 5, TE: 0.08, TI: 1.2 });
  assert.equal(ir.excitation, 1.2);
  assert.equal(ir.echo, 1.28);
  assert.deepEqual(ir.rf.map(pulse => pulse.time), [0, 1.2, 1.24, 5]);
  assert.equal(ir.warnings.length, 0);
});

test('GRE uses the selected flip angle and no RF refocusing pulse', () => {
  const gre = sequences.GRE.diagram({ TR: 0.5, TE: 0.02, FA: 30 });
  assert.equal(gre.echo, 0.02);
  assert.deepEqual(gre.rf.map(pulse => [pulse.time, pulse.angle]), [[0, 30], [0.5, 30]]);
});

test('axis preserves event order and finite coordinates at parameter boundaries', () => {
  for (const sequence of Object.values(sequences)) {
    const cases = [defaultParameters(sequence)];
    for (const parameter of sequence.parameters) {
      for (const value of [parameter.min, parameter.max]) cases.push({ ...defaultParameters(sequence), [parameter.key]: value });
    }
    cases.push(Object.fromEntries(sequence.parameters.map(parameter => [parameter.key, parameter.min])));
    for (const parameters of cases) {
      const model = sequence.diagram(parameters);
      const axis = createTimeAxis(model);
      const times = [...new Set([0, model.echo, model.repetition, ...model.rf.map(pulse => pulse.time)])].sort((a, b) => a - b);
      const positions = times.map(time => axis.x(time));
      assert.ok(positions.every(value => Number.isFinite(value) && value >= 110 && value <= 850));
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    }
  }
});

test('long delays are marked as compressed and impossible timing is explained', () => {
  const model = sequences.SE.diagram({ TR: 20, TE: 0.005 });
  assert.ok(createTimeAxis(model).segments.some(segment => segment.compressed));
  assert.ok(sequences.SE.diagram({ TR: 0, TE: 0.1 }).warnings.length > 0);
  assert.equal(sequences.IR.diagram({ TR: 0, TE: 0.1, TI: 0 }).warnings.length, 2);
});

test('illustrative gradients balance slice rephasing and the readout moment at the echo', () => {
  const area = gradient => gradient.amplitude * (gradient.end - gradient.start - gradient.ramp);
  for (const sequence of Object.values(sequences)) {
    const params = defaultParameters(sequence);
    const model = sequence.diagram(params);
    const slice = model.gradients.filter(gradient => gradient.track === 'slice');
    assert.ok(Math.abs(area(slice.at(-1)) + area(slice[0]) / 2) < 1e-12);
    const [prephaser, readout] = model.gradients.filter(gradient => gradient.track === 'read');
    const prephaserAtEcho = model.kind === 'GRE' ? area(prephaser) : -area(prephaser);
    assert.ok(Math.abs(prephaserAtEcho + area(readout) / 2) < 1e-12);
    assert.ok(Math.abs((readout.start + readout.end) / 2 - model.echo) < 1e-12);
    const minimumTE = sequence.parameters.find(parameter => parameter.key === 'TE').min;
    const shortest = sequence.diagram({ ...params, TE: minimumTE });
    const [shortPrephaser, shortReadout] = shortest.gradients.filter(gradient => gradient.track === 'read');
    assert.ok(shortPrephaser.end <= shortReadout.start + 1e-12);
    const refocusing = shortest.rf.find(pulse => pulse.label === 'Refocusing');
    if (refocusing) assert.ok(shortPrephaser.end < refocusing.time - refocusing.duration / 2);
  }
});

test('finite RF pulse widths share the uncompressed time scale before and after the cycle break', () => {
  const widths = [];
  for (const TI of [0, 1.2, 4.5]) {
    const model = sequences.IR.diagram({ TR: 10, TE: 0.08, TI });
    model.signalStart = 0;
    model.signalEnd = TI + 0.25;
    const axis = createTimeAxis(model);
    const width = pulse => axis.x(pulse.time + pulse.duration / 2) - axis.x(pulse.time - pulse.duration / 2);
    const excitation = model.rf.find(pulse => pulse.label === 'Excitation');
    const next = model.rf.at(-1);
    assert.ok(Math.abs(width(next) - width(excitation)) < 1e-9);
    assert.ok(Math.abs(axis.x(next.time) - 832) < 1e-9);
    widths.push(width(excitation));
  }
  assert.ok(widths[0] > widths[1] && widths[1] > widths[2], 'the same RF duration gets narrower as the visible time window grows');
});
