import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createGlobalWindow } from '../js/global-window.js';
import { decodePhantom } from '../js/phantom.js';
import { sequences, defaultParameters } from '../js/sequences.js';
import { writeGrayscale } from '../js/renderer.js';

test('global window shares the same grayscale scale across slices and clips noise', () => {
  const pixels = new Uint8ClampedArray(8);
  const magnitude = new Float32Array(2);
  writeGrayscale(new Float32Array([1, 2]), new Float32Array(2), magnitude, pixels, true, 4);
  assert.equal(pixels[0], 64);
  assert.equal(pixels[4], 128);
  writeGrayscale(new Float32Array([2, 4]), new Float32Array(2), magnitude, pixels, true, 4);
  assert.equal(pixels[0], 128, 'the same signal keeps the same gray level on another slice');
  assert.equal(pixels[4], 255);
  writeGrayscale(new Float32Array([4, 0]), new Float32Array([0.1, 0]), magnitude, pixels, false, 4);
  assert.equal(pixels[0], 255);
  writeGrayscale(new Float32Array(2), new Float32Array(2), magnitude, pixels, true, 0);
  assert.equal(pixels[0], 0);
  writeGrayscale(new Float32Array([2, 4]), new Float32Array(2), magnitude, pixels, true);
  assert.equal(pixels[4], 0, 'initial loading never falls back to slice normalization');
});

test('worker requests coalesce, cache results, and never rescan for slice navigation', () => {
  const messages = [];
  let updates = 0, copies = 0, terminated = false;
  const worker = { postMessage: message => messages.push(message), terminate: () => { terminated = true; } };
  const window = createGlobalWindow({ getVolume() { copies++; return {}; } }, () => updates++, () => worker);
  assert.equal(window.getMaximum('SE', { TR: 1 }), undefined);
  const first = messages[1];
  window.getMaximum('SE', { TR: 2 });
  window.getMaximum('SE', { TR: 3 });
  assert.equal(messages.length, 2, 'slider changes do not build a worker backlog');
  worker.onmessage({ data: { key: first.key, maximum: 0.5 } });
  assert.equal(messages.length, 3);
  assert.equal(messages[2].parameters.TR, 3, 'only the latest queued settings are computed');
  assert.equal(updates, 0, 'obsolete results do not trigger a render');
  worker.onmessage({ data: { key: messages[2].key, maximum: 0.75 } });
  assert.equal(updates, 1);
  assert.equal(window.pending, false);
  for (let slice = 0; slice < 90; slice++) assert.equal(window.getMaximum('SE', { TR: 3 }), 0.75);
  assert.equal(messages.length, 3);
  assert.equal(copies, 1);
  assert.equal(window.getMaximum('SE', { TR: 1 }), 0.5, 'previous settings reuse cached results');
  assert.equal(window.getMaximum('SE', { TR: 4 }), 0.5, 'the previous global scale is retained while computing');
  assert.equal(window.pending, true);
  window.dispose();
  assert.equal(terminated, true);
});

test('global window reports worker failure without using a slice maximum', () => {
  const worker = { postMessage() {}, terminate() {} };
  let updates = 0;
  const window = createGlobalWindow({ getVolume: () => ({}) }, () => updates++, () => worker);
  window.getMaximum('SE', {});
  worker.onerror();
  assert.equal(window.failed, true);
  assert.equal(window.pending, false);
  assert.equal(window.getMaximum('SE', {}), undefined);
  assert.equal(updates, 1);
  const unavailable = createGlobalWindow({}, () => {}, () => { throw new Error('unavailable'); });
  assert.equal(unavailable.getMaximum('SE', {}), undefined);
  assert.equal(unavailable.failed, true);
});

test('global maximum cache is bounded during sustained parameter changes', () => {
  let latest, requests = 0;
  const worker = { postMessage(message) { latest = message; requests++; }, terminate() {} };
  const window = createGlobalWindow({ getVolume: () => ({}) }, () => {}, () => worker);
  for (let TR = 1; TR <= 65; TR++) {
    window.getMaximum('SE', { TR });
    worker.onmessage({ data: { key: latest.key, maximum: TR } });
  }
  const previous = requests;
  assert.equal(window.getMaximum('SE', { TR: 65 }), 65);
  assert.equal(requests, previous);
  window.getMaximum('SE', { TR: 1 });
  assert.equal(requests, previous + 1, 'the oldest result is evicted');
  window.dispose();
});

test('background worker maximum matches every real phantom voxel for all sequences', async () => {
  const metadata = JSON.parse(readFileSync(new URL('../data/phantom.json', import.meta.url)));
  const binary = readFileSync(new URL('../data/phantom.bin', import.meta.url));
  const phantom = decodePhantom(metadata, binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
  // Bridge the browser worker entry point to Node's worker API for verification.
  const entry = new URL('../js/global-window-worker.js', import.meta.url).href;
  const worker = new Worker(`const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: data => parentPort.postMessage(data) };
    import(${JSON.stringify(entry)}).then(() => parentPort.on('message', data => self.onmessage({ data })));`, { eval: true });
  try {
    worker.postMessage({ volume: phantom.getVolume() });
    const output = new Float32Array(phantom.width * phantom.height);
    for (const [key, sequence] of Object.entries(sequences)) {
      const parameters = defaultParameters(sequence);
      const result = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
      worker.postMessage({ key, sequence: key, parameters });
      let expected = 0;
      for (let slice = 0; slice < phantom.slices; slice++) {
        sequence.simulate(phantom.getSlice(slice), parameters, output);
        for (const signal of output) if (Number.isFinite(signal)) expected = Math.max(expected, Math.abs(signal));
      }
      assert.deepEqual(await result, { key, maximum: expected });
    }
  } finally { await worker.terminate(); }
});
