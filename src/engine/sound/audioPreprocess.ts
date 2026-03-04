/**
 * Audio preprocessing: mono mixdown, normalization.
 * Operates on raw Float32Array PCM data.
 */

/**
 * Mix multi-channel audio down to mono.
 */
export function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  const numCh = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < numCh; ch++) {
    const chData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += chData[i];
    }
  }
  const scale = 1 / numCh;
  for (let i = 0; i < length; i++) mono[i] *= scale;
  return mono;
}

/**
 * Peak-normalize audio to [-1, 1].
 */
export function peakNormalize(data: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  if (peak < 1e-6) return data;
  const out = new Float32Array(data.length);
  const scale = 1 / peak;
  for (let i = 0; i < data.length; i++) out[i] = data[i] * scale;
  return out;
}

/**
 * Compute clipping ratio — fraction of samples at or near ±1.
 */
export function clippingRatio(data: Float32Array, threshold = 0.99): number {
  let clipped = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) >= threshold) clipped++;
  }
  return clipped / data.length;
}
