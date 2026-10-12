// Check ROI masks and temporal signals against the image model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rasterizePolygon, sampleRegion, meanMagnitude, meanSigned, traceRegions } from '../js/roi-analysis.js';
import { sequences, defaultParameters } from '../js/sequences.js';
import { decodePhantom } from '../js/phantom.js';

test('closed polygons select pixel centers in row-major orientation', () => {
  const rectangle = [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }];
  assert.deepEqual([...rasterizePolygon(rectangle, 4, 4)], [5, 6, 9, 10]);
  assert.deepEqual([...rasterizePolygon([...rectangle].reverse(), 4, 4)], [5, 6, 9, 10]);
  assert.equal(rasterizePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 4, 4).length, 0);
  const all = [{ x: -5, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 10 }, { x: -5, y: 10 }];
  assert.deepEqual([...rasterizePolygon(all, 4, 4)], Array.from({ length: 16 }, (_, i) => i));
  const triangle = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }];
  assert.deepEqual([...rasterizePolygon(triangle, 4, 4)], [0, 1, 2, 4, 5, 8]);
});

test('ROI mean takes magnitude after adding fixed noise, and preserves undefined results', () => {
  const signal = new Float32Array([-2, 1]);
  const noise = new Float32Array([0.5, 0.5]);
  assert.equal(meanMagnitude(signal, noise), 1.5);
  assert.equal(meanMagnitude(signal, noise, true), 1.5);
  assert.equal(meanMagnitude(new Float32Array([-2]), new Float32Array([0.5]), true), 2);
  assert.ok(Number.isNaN(meanMagnitude(new Float32Array([NaN]), noise)));
  assert.ok(Number.isNaN(meanMagnitude(new Float32Array(), new Float32Array())));
});

test('temporal traces and TE samples match independent full-slice simulation on the real phantom', () => {
  const metadata = JSON.parse(readFileSync(new URL('../data/phantom.json', import.meta.url)));
  const buffer = readFileSync(new URL('../data/phantom.bin', import.meta.url));
  const phantom = decodePhantom(metadata, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const slice = phantom.getSlice(50);
  const polygons = [
    [{ x: 30, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 40 }, { x: 30, y: 40 }],
    [{ x: 45, y: 65 }, { x: 55, y: 65 }, { x: 55, y: 75 }, { x: 45, y: 75 }],
  ];
  const regions = polygons.map(points => {
    const indices = rasterizePolygon(points, phantom.width, phantom.height);
    return { indices, maps: sampleRegion(slice, indices), noise: new Float32Array(indices.length).fill(0.01), buffer: new Float32Array(indices.length) };
  });
  const fullSignal = new Float32Array(phantom.width * phantom.height);
  for (const sequence of Object.values(sequences)) {
    const cases = [defaultParameters(sequence)];
    for (const parameter of sequence.parameters) {
      for (const value of [parameter.min, parameter.max]) cases.push({ ...defaultParameters(sequence), [parameter.key]: value });
    }
    for (const params of cases) {
      const original = { ...params };
      for (const noiseFree of [false, true]) {
        const trace = traceRegions(sequence, params, regions, noiseFree, 5);
        const excitation = sequence.shortLabel === 'IR' ? params.TI : 0;
        assert.ok(trace.values.includes(excitation + params.TE), 'Image time must be sampled exactly, not interpolated');
        assert.equal(trace.values[0], 0);
        assert.equal(trace.values.at(-1), excitation + 0.25);
        trace.values.forEach((value, i) => {
          if (value < excitation) return;
          sequence.simulate(slice, { ...params, TE: value - excitation }, fullSignal);
          for (const curve of trace.curves) {
            const expected = curve.region.indices.reduce((sum, index) => sum + Math.abs(fullSignal[index] + (noiseFree ? 0 : curve.region.noise[0])), 0) / curve.region.indices.length;
            assert.ok(Math.abs(curve.values[i] - expected) < 1e-12 || (Number.isNaN(curve.values[i]) && Number.isNaN(expected)));
            const signed = curve.region.indices.reduce((sum, index) => sum + fullSignal[index] + (noiseFree ? 0 : curve.region.noise[0]), 0) / curve.region.indices.length;
            assert.ok(Math.abs(curve.signedValues[i] - signed) < 1e-12 || (Number.isNaN(curve.signedValues[i]) && Number.isNaN(signed)));
          }
        });
      }
      assert.deepEqual(params, original, 'plotting never changes UI parameters');
    }
  }
});


test('IR separates longitudinal recovery from transverse signal at the 90-degree excitation', () => {
  const maps = { Rho: new Float32Array([1, 0.8]), T1: new Float32Array([1, 0]),
    T2: new Float32Array([0.1, 0.2]), T2Star: new Float32Array([0.08, 0.1]) };
  const region = { maps, noise: new Float32Array([0.01, -0.02]), buffer: new Float32Array(2) };
  const params = { TR: 5, TI: 0.2, TE: 0.08 };
  for (const noiseFree of [false, true]) {
    const trace = traceRegions(sequences.IR, params, [region], noiseFree, 5);
    assert.equal(trace.timeOrigin, 'inversion');
    assert.equal(trace.sampleTime, params.TI + params.TE);
    trace.values.forEach((time, i) => {
      const expected = new Float32Array(2);
      if (time <= params.TI) {
        for (let j = 0; j < 2; j++) {
          const t1 = maps.T1[j] || 1;
          expected[j] = maps.Rho[j] * (1 - (2 - Math.exp(-(params.TR - params.TI) / t1)) * Math.exp(-time / t1));
        }
      }
      const curve = trace.curves[0];
      if (time === params.TI) {
        assert.ok(Math.abs(curve.longitudinalBeforeExcitation.signed - meanSigned(expected, region.noise, true)) < 1e-7);
        assert.ok(Math.abs(curve.longitudinalBeforeExcitation.magnitude - meanMagnitude(expected, region.noise, true)) < 1e-7);
      }
      if (time >= params.TI) {
        for (let j = 0; j < 2; j++) expected[j] = maps.Rho[j] * (1 - Math.exp(-(time - params.TI) / (maps.T1[j] || 1)));
      }
      assert.ok(Math.abs(curve.signedLongitudinalValues[i] - meanSigned(expected, region.noise, true)) < 1e-7);
      assert.ok(Math.abs(curve.longitudinalValues[i] - meanMagnitude(expected, region.noise, true)) < 1e-7);
      if (time < params.TI) {
        assert.equal(curve.values[i], 0);
        assert.equal(curve.signedValues[i], 0);
      } else {
        sequences.IR.simulate(maps, { ...params, TE: time - params.TI }, expected);
        assert.ok(Math.abs(curve.signedValues[i] - meanSigned(expected, region.noise, noiseFree)) < 1e-7);
        assert.ok(Math.abs(curve.values[i] - meanMagnitude(expected, region.noise, noiseFree)) < 1e-7);
      }
    });
    const curve = trace.curves[0];
    assert.ok(curve.signedLongitudinalValues[0] < 0);
    assert.ok(curve.longitudinalValues[0] > 0);
    const excitationIndex = trace.values.indexOf(params.TI);
    assert.equal(curve.signedLongitudinalValues[excitationIndex], 0);
    assert.equal(curve.longitudinalValues[excitationIndex], 0);
    assert.ok(curve.signedLongitudinalValues.at(-1) > 0);
  }
});

test('post-excitation longitudinal recovery approaches equilibrium and handles TI=0', () => {
  const maps = { Rho: new Float32Array([1]), T1: new Float32Array([0.1]),
    T2: new Float32Array([0.1]), T2Star: new Float32Array([0.08]) };
  const region = { maps, noise: new Float32Array([0.2]), buffer: new Float32Array(1) };
  const trace = traceRegions(sequences.IR, { TR: 5, TI: 0, TE: 1 }, [region], false, 5);
  const mz = trace.curves[0].signedLongitudinalValues;
  assert.equal(mz[0], 0, '90-degree excitation leaves zero longitudinal magnetization even with receiver noise');
  assert.ok(mz.every((value, i) => i === 0 || value >= mz[i - 1]));
  assert.ok(Math.abs(mz.at(-1) - 1) < 0.0001);
});
