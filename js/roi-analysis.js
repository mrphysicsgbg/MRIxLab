import { signalDuration } from './sequences.js';

// Pixel centers determine membership in a closed freehand polygon.
export function rasterizePolygon(points, width, height) {
  if (points.length < 3) return new Uint32Array();
  const columns = points.map(point => point.x);
  const rows = points.map(point => point.y);
  const minX = Math.max(0, Math.floor(Math.min(...columns)));
  const maxX = Math.min(width - 1, Math.floor(Math.max(...columns)));
  const minY = Math.max(0, Math.floor(Math.min(...rows)));
  const maxY = Math.min(height - 1, Math.floor(Math.max(...rows)));
  const indices = [];
  for (let row = minY; row <= maxY; row++) {
    for (let column = minX; column <= maxX; column++) {
      const x = column + 0.5, y = row + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) indices.push(row * width + column);
    }
  }
  return Uint32Array.from(indices);
}

export function sampleRegion(slice, indices) {
  return Object.fromEntries(Object.entries(slice).map(([key, map]) => [key, Float32Array.from(indices, index => map[index])]));
}

// Average voxel magnitudes after adding noise.
export function meanMagnitude(signal, noise, noiseFree = false) {
  if (!signal.length) return NaN;
  let sum = 0;
  for (let i = 0; i < signal.length; i++) {
    const value = Math.abs(signal[i] + (noiseFree ? 0 : noise[i]));
    if (!Number.isFinite(value)) return NaN;
    sum += value;
  }
  return sum / signal.length;
}

export function meanSigned(signal, noise, noiseFree = false) {
  if (!signal.length) return NaN;
  return signal.reduce((sum, value, i) => sum + value + (noiseFree ? 0 : noise[i]), 0) / signal.length;
}

// IR uses a fixed 90-degree excitation: Mz drops to zero at TI and recovers
// toward rho, while Mxy is zero before TI and then follows the image equation.
export function traceRegions(sequence, parameters, regions, noiseFree, samples = 121) {
  const inversion = sequence.shortLabel === 'IR';
  const excitation = inversion ? parameters.TI : 0;
  const end = signalDuration(sequence, parameters);
  const values = Float64Array.from([...new Set([
    ...(inversion ? Array.from({ length: samples }, (_, i) => i / (samples - 1) * excitation) : []),
    ...Array.from({ length: samples }, (_, i) => excitation + i / (samples - 1) * end), excitation + parameters.TE,
  ])].sort((a, b) => a - b));
  const params = { ...parameters };
  const curves = regions.map(region => ({ region, values: new Float64Array(values.length), signedValues: new Float64Array(values.length),
    ...(inversion ? { longitudinalValues: new Float64Array(values.length), signedLongitudinalValues: new Float64Array(values.length) } : {}),
  }));
  for (let i = 0; i < values.length; i++) {
    params.TE = values[i] - excitation;
    for (const curve of curves) {
      const { maps, buffer } = curve.region;
      if (inversion) {
        for (let j = 0; j < buffer.length; j++) {
          const t1 = maps.T1[j] === 0 ? 1 : maps.T1[j];
          buffer[j] = values[i] < excitation
            ? maps.Rho[j] * (1 - (2 - Math.exp(-(parameters.TR - excitation) / t1)) * Math.exp(-values[i] / t1))
            : maps.Rho[j] * (1 - Math.exp(-(values[i] - excitation) / t1));
        }
        // Mz is a magnetization model, not a noisy receive-channel measurement.
        curve.longitudinalValues[i] = meanMagnitude(buffer, curve.region.noise, true);
        curve.signedLongitudinalValues[i] = meanSigned(buffer, curve.region.noise, true);
        if (values[i] === excitation) {
          sequence.simulate(maps, { ...parameters, TE: 0 }, buffer);
          curve.longitudinalBeforeExcitation = {
            magnitude: meanMagnitude(buffer, curve.region.noise, true),
            signed: meanSigned(buffer, curve.region.noise, true),
          };
        }
      }
      if (values[i] < excitation) {
        curve.values[i] = curve.signedValues[i] = 0;
        continue;
      }
      sequence.simulate(maps, params, buffer);
      curve.values[i] = meanMagnitude(curve.region.buffer, curve.region.noise, noiseFree);
      curve.signedValues[i] = meanSigned(curve.region.buffer, curve.region.noise, noiseFree);
    }
  }
  return { values, curves, timeOrigin: inversion ? 'inversion' : 'excitation', sampleTime: excitation + parameters.TE };
}
