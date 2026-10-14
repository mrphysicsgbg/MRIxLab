import { sequences } from './sequences.js';

let volume;
let signal;
self.onmessage = ({ data }) => {
  if (data.volume) {
    volume = data.volume;
    signal = new Float32Array(volume.Rho.length);
    return;
  }
  sequences[data.sequence].simulate(volume, data.parameters, signal);
  let maximum = 0;
  for (const value of signal) {
    if (Number.isFinite(value)) maximum = Math.max(maximum, Math.abs(value));
  }
  self.postMessage({ key: data.key, maximum });
};
