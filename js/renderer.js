// Add voxel noise and convert magnitude to grayscale.
export function createNoise(size, random = Math.random) {
  const noise = new Float32Array(size);
  return fillNoise(noise, random);
}

// Generate Gaussian noise with standard deviation 0.01.
export function fillNoise(noise, random = Math.random) {
  for (let i = 0; i < noise.length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - random())) * 0.01;
    const angle = 2 * Math.PI * random();
    noise[i] = radius * Math.cos(angle);
    if (i + 1 < noise.length) noise[i + 1] = radius * Math.sin(angle);
  }
  return noise;
}

// Scale noisy magnitude to the cached, noise-free maximum of the entire volume.
export function writeGrayscale(signal, noise, magnitude, pixels, noiseFree = false, windowMaximum = 0) {
  let invalid = 0;
  for (let i = 0; i < signal.length; i++) {
    const value = Math.abs(signal[i] + (noiseFree ? 0 : noise[i]));
    if (!Number.isFinite(value)) invalid++;
    magnitude[i] = Number.isFinite(value) ? value : 0;
  }
  const scale = windowMaximum > 0 ? 255 / windowMaximum : 0;
  for (let i = 0; i < signal.length; i++) {
    const offset = i * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = magnitude[i] * scale;
    pixels[offset + 3] = 255;
  }
  return { maximum: windowMaximum, invalid };
}

export function createRenderer(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Your browser does not support Canvas 2D.');
  const image = context.createImageData(width, height);
  const magnitude = new Float32Array(width * height);
  // Retain noise during parameter changes; replace it in-place on slice changes.
  const noise = createNoise(width * height);
  let noiseFree = false;
  return {
    regenerateNoise() { fillNoise(noise); },
    getNoise(index) { return noiseFree ? 0 : noise[index]; },
    getPixel(index) {
      return { noise: noiseFree ? 0 : noise[index], magnitude: magnitude[index], grayscale: image.data[index * 4] };
    },
    render(signal, withoutNoise = false, windowMaximum) {
      noiseFree = withoutNoise;
      const result = writeGrayscale(signal, noise, magnitude, image.data, noiseFree, windowMaximum);
      context.putImageData(image, 0, 0);
      return result;
    },
  };
}
