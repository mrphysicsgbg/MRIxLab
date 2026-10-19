import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPhantom, simulationObjects } from '../js/phantom.js';
import { sequences, defaultParameters } from '../js/sequences.js';

test('both catalog objects load their real assets and simulate boundary and interior slices', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url.href);
    return new Response(readFileSync(url));
  });
  for (const [id, width, height, slices] of [
    ['brain', 90, 108, 90], ['brain-high-resolution', 180, 216, 180],
  ]) {
    const phantom = await loadPhantom(id);
    assert.deepEqual([phantom.width, phantom.height, phantom.slices], [width, height, slices]);
    assert.equal(phantom.getSlice(slices - 1).Rho.buffer, phantom.getVolume().Rho.buffer);
    assert.throws(() => phantom.getSlice(slices), RangeError);
    if (id === 'brain-high-resolution') {
      // Independent MATLAB samples catch row/column/slice swaps and unit changes.
      for (const [row, column, slice, values] of [
        [80, 70, 100, [0.65, 0.6, 0.08, 0.04]],
        [100, 100, 90, [0.8, 0.95, 0.1, 0.05]],
        [108, 90, 100, [1, 4.5, 2.2, 1.1]],
      ]) {
        assert.deepEqual(['Rho', 'T1', 'T2', 'T2Star'].map(name =>
          phantom.getSlice(slice)[name][row * width + column]), values.map(Math.fround));
      }
    }
    const output = new Float32Array(width * height);
    for (const sequence of Object.values(sequences)) {
      for (const slice of [0, Math.floor(slices / 2), slices - 1]) {
        sequence.simulate(phantom.getSlice(slice), defaultParameters(sequence), output);
        assert.ok(output.every(Number.isFinite));
        if (slice === Math.floor(slices / 2)) assert.ok(output.some(value => value !== 0));
      }
    }
  }
  assert.deepEqual(requests, Object.values(simulationObjects).flatMap(object => {
    const metadata = JSON.parse(readFileSync(object.metadataUrl));
    return [object.metadataUrl.href, new URL(metadata.file, object.metadataUrl).href];
  }));
});

test('phantom loading reports unknown objects, HTTP errors and unsupported compression', async t => {
  await assert.rejects(loadPhantom('missing'), /Unknown simulation object/);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(loadPhantom(), /metadata.*404/);
  globalThis.fetch = async () => Response.json({ compression: 'zip' });
  await assert.rejects(loadPhantom(), /Unsupported phantom compression/);
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1
    ? Response.json({ file: 'missing.bin' }) : new Response('', { status: 404 });
  await assert.rejects(loadPhantom(), /Phantom could not be loaded.*404/);
});

test('compressed phantom reports missing browser decompression support before fetching the volume', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ compression: 'gzip' }));
  const original = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    await assert.rejects(loadPhantom('brain-high-resolution'), /browser with gzip decompression support/);
  } finally {
    globalThis.DecompressionStream = original;
  }
});
