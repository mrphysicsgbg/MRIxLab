// Check signal equations, phantom decoding, and image rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sequences, defaultParameters } from '../js/sequences.js';
import { decodePhantom } from '../js/phantom.js';
import { createNoise, createRenderer, writeGrayscale } from '../js/renderer.js';
import { pixelAt } from '../js/pixel.js';

test('zero maps use the reference fallback and IR keeps negative raw signal', () => {
  const slice = { Rho: new Float32Array([1]), T1: new Float32Array([0]), T2: new Float32Array([0]), T2Star: new Float32Array([0]) };
  const output = new Float32Array(1);
  sequences.SE.simulate(slice, { TR: 1, TE: 0.1 }, output);
  assert.ok(Math.abs(output[0] - Math.exp(-0.1) * (1 - Math.exp(-1))) < 1e-7);
  sequences.IR.simulate(slice, { TR: 1, TE: 0.1, TI: 0 }, output);
  assert.ok(output[0] < 0);
  sequences.GRE.simulate(slice, { TR: 0, TE: 0.1, FA: 0 }, output);
  assert.ok(Number.isNaN(output[0]));
  assert.equal(slice.T1[0], 0, 'fallback never mutates the phantom');
});

test('sequence defaults are independent, and buffer mismatches fail', () => {
  const first = defaultParameters(sequences.SE);
  first.TR = 9;
  assert.equal(defaultParameters(sequences.SE).TR, 1);
  assert.deepEqual(Object.keys(defaultParameters(sequences.IR)), ['TR', 'TE', 'TI']);
  assert.deepEqual(Object.keys(defaultParameters(sequences.GRE)), ['TR', 'TE', 'FA']);
  assert.throws(() => sequences.SE.simulate({ Rho: new Float32Array(2) }, first, new Float32Array(1)));
});

test('real phantom slices are cached views with valid boundaries', () => {
  const metadata = JSON.parse(readFileSync(new URL('../data/phantom.json', import.meta.url)));
  const buffer = readFileSync(new URL('../data/phantom.bin', import.meta.url));
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const phantom = decodePhantom(metadata, data);
  assert.equal(phantom.width, 90);
  assert.equal(phantom.height, 108);
  assert.equal(phantom.slices, 90);
  assert.equal(phantom.getSlice(50), phantom.getSlice(50));
  assert.equal(phantom.getSlice(89).Rho.buffer, data);
  assert.throws(() => phantom.getSlice(-1), RangeError);
  assert.throws(() => phantom.getSlice(90), RangeError);
  assert.throws(() => phantom.getSlice(0.5), RangeError);
  assert.throws(() => decodePhantom(metadata, new ArrayBuffer(4)), /Invalid Rho/);
});

test('rendering adds fixed noise before magnitude and uses the supplied volume maximum', () => {
  const signal = new Float32Array([-2, 1, 0, NaN]);
  const noise = new Float32Array([0.5, 0, 0.5, 0]);
  const magnitude = new Float32Array(4);
  const pixels = new Uint8ClampedArray(16);
  assert.deepEqual(writeGrayscale(signal, noise, magnitude, pixels, false, 1.5), { maximum: 1.5, invalid: 1 });
  assert.deepEqual([...pixels], [255, 255, 255, 255, 170, 170, 170, 255, 85, 85, 85, 255, 0, 0, 0, 255]);
  const original = pixels.slice();
  writeGrayscale(signal, noise, magnitude, pixels, false, 1.5);
  assert.deepEqual(pixels, original);
  signal.fill(0); noise.fill(0);
  assert.equal(writeGrayscale(signal, noise, magnitude, pixels).maximum, 0);
  assert.equal(pixels[0], 0);
});

test('Gaussian noise has the reference standard deviation', () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const noise = createNoise(100000, random);
  const mean = noise.reduce((a, b) => a + b, 0) / noise.length;
  const deviation = Math.sqrt(noise.reduce((a, b) => a + (b - mean) ** 2, 0) / noise.length);
  assert.ok(Math.abs(mean) < 0.0001);
  assert.ok(Math.abs(deviation - 0.01) < 0.0001);
});

test('pixel coordinates match scaled canvas rows and columns at boundaries', () => {
  const bounds = { left: 100, top: 50, width: 270, height: 324 };
  assert.deepEqual(pixelAt(100, 50, bounds, 90, 108), { column: 0, row: 0, index: 0 });
  assert.deepEqual(pixelAt(235, 212, bounds, 90, 108), { column: 45, row: 54, index: 4905 });
  assert.deepEqual(pixelAt(369.9, 373.9, bounds, 90, 108), { column: 89, row: 107, index: 9719 });
  assert.equal(pixelAt(370, 100, bounds, 90, 108), null);
  assert.equal(pixelAt(150, 374, bounds, 90, 108), null);
  assert.equal(pixelAt(99, 50, bounds, 90, 108), null);
  assert.equal(pixelAt(100, 50, { ...bounds, width: 0 }, 90, 108), null);
});

test('renderer retains noise on render, regenerates explicitly, and exposes actual displayed values', () => {
  let allocations = 0;
  let displayed;
  const context = {
    createImageData(width, height) { allocations++; return { data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(image) { displayed = image; },
  };
  const canvas = { getContext: () => context };
  const renderer = createRenderer(canvas, 2, 2);
  const signal = new Float32Array([-1, 0.4, 0, 2]);
  renderer.render(signal, false, 2);
  const initial = renderer.getPixel(0);
  signal[0] = -0.5;
  renderer.render(signal, false, 2);
  assert.equal(renderer.getPixel(0).noise, initial.noise);
  renderer.render(signal, true, 2);
  assert.equal(renderer.getPixel(0).noise, 0);
  assert.equal(renderer.getPixel(0).magnitude, 0.5, 'noise-free magnitude retains negative raw signal magnitude');
  assert.equal(renderer.getPixel(2).magnitude, 0, 'zero raw signal has no background noise');
  assert.equal(renderer.getPixel(2).grayscale, 0);
  renderer.render(signal, false, 2);
  assert.equal(renderer.getPixel(0).noise, initial.noise, 'switching noise back on retains its realization');
  renderer.regenerateNoise();
  renderer.render(signal, false, 2);
  const pixel = renderer.getPixel(0);
  assert.notEqual(pixel.noise, initial.noise);
  assert.ok(Math.abs(pixel.magnitude - Math.abs(signal[0] + pixel.noise)) < 1e-7);
  assert.equal(pixel.grayscale, displayed.data[0]);
  assert.equal(allocations, 1, 'ImageData is reused after noise regeneration');
});
