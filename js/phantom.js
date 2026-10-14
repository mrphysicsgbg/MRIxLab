// Load the phantom maps and expose individual slices.
const MAP_NAMES = ['Rho', 'T1', 'T2', 'T2Star'];

// Extend this catalog with converted datasets to add simulation objects.
export const simulationObjects = {
  brain: {
    label: 'Digital brain phantom',
    metadataUrl: new URL('../data/phantom.json', import.meta.url),
  },
};

// Validate the file layout before creating map views.
export function decodePhantom(metadata, buffer) {
  const { width, height, slices, maps } = metadata;
  if (metadata.version !== 1 || metadata.dtype !== 'float32-le' || metadata.layout !== 'slice-row-column') {
    throw new Error('Unsupported phantom format.');
  }
  if (![width, height, slices].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('Invalid phantom dimensions.');
  }
  const count = width * height * slices;
  const volume = {};
  for (const name of MAP_NAMES) {
    const offset = maps[name]?.byteOffset;
    if (!Number.isInteger(offset) || offset < 0 || offset % 4 || offset + count * 4 > buffer.byteLength) {
      throw new Error(`Invalid ${name} map.`);
    }
    // Files are little-endian. Swap only on an unusual big-endian host.
    const values = new Float32Array(buffer, offset, count);
    if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) {
      const view = new DataView(buffer);
      for (let i = 0; i < count; i++) values[i] = view.getFloat32(offset + i * 4, true);
    }
    volume[name] = values;
  }
  const sliceSize = width * height;
  // Cache tiny views: all changes use the already decoded volume with no copying.
  const sliceViews = Array.from({ length: slices }, (_, index) => Object.fromEntries(
    MAP_NAMES.map(name => [name, volume[name].subarray(index * sliceSize, (index + 1) * sliceSize)])
  ));
  return {
    width, height, slices, metadata,
    getVolume() { return volume; },
    getSlice(index) {
      if (!Number.isInteger(index) || index < 0 || index >= slices) throw new RangeError('Slice out of range.');
      return sliceViews[index];
    },
  };
}

export async function loadPhantom(objectId = 'brain') {
  const object = simulationObjects[objectId];
  if (!object) throw new Error('Unknown simulation object.');
  const metadataUrl = object.metadataUrl;
  const response = await fetch(metadataUrl);
  if (!response.ok) throw new Error(`Phantom metadata could not be loaded (${response.status}).`);
  const metadata = await response.json();
  const binary = await fetch(new URL(metadata.file, metadataUrl));
  if (!binary.ok) throw new Error(`Phantom could not be loaded (${binary.status}).`);
  return decodePhantom(metadata, await binary.arrayBuffer());
}
