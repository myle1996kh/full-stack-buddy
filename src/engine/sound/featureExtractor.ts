/**
 * Frame-level feature extraction: pitch (ACF/MPM-lite), energy, spectral features, flux.
 * Pure computation — no Web Audio dependency for offline use.
 */

import type { SoundFrameV2 } from './types';

/**
 * Extract a single frame's features from a windowed PCM segment.
 */
export function extractFrameFeatures(
  segment: Float32Array,
  sampleRate: number,
  t: number,
  prevMagnitudes: Float32Array | null,
): { frame: SoundFrameV2; magnitudes: Float32Array } {
  const rms = computeRMS(segment);
  const energyDb = rms > 1e-8 ? 20 * Math.log10(rms) : -100;

  const { pitch: pitchHz, confidence: pitchConf } = detectPitchMPMLite(segment, sampleRate);
  const voiced = pitchConf >= 0.6 && pitchHz !== null && pitchHz >= 60 && pitchHz <= 500;

  // Spectral features via real FFT approximation
  const magnitudes = computeMagnitudeSpectrum(segment);
  const centroid = spectralCentroid(magnitudes, sampleRate, segment.length);
  const zcr = zeroCrossingRate(segment);
  const rolloff = spectralRolloff(magnitudes, sampleRate, segment.length, 0.85);
  const flux = prevMagnitudes ? spectralFlux(magnitudes, prevMagnitudes) : 0;

  return {
    frame: {
      t,
      pitchHz: voiced ? pitchHz : null,
      pitchConf,
      energyDb,
      centroid,
      zcr,
      rolloff,
      flux,
      voiced,
    },
    magnitudes,
  };
}

/**
 * Extract all frames from a full mono PCM signal.
 */
export function extractAllFrames(
  data: Float32Array,
  sampleRate: number,
  hopSamples: number,
  windowSamples: number,
): SoundFrameV2[] {
  const frames: SoundFrameV2[] = [];
  let prevMag: Float32Array | null = null;
  const totalHops = Math.floor((data.length - windowSamples) / hopSamples);

  for (let i = 0; i <= totalHops; i++) {
    const start = i * hopSamples;
    const end = start + windowSamples;
    const segment = data.subarray(start, end);
    const t = start / sampleRate;

    const { frame, magnitudes } = extractFrameFeatures(segment, sampleRate, t, prevMag);
    frames.push(frame);
    prevMag = magnitudes;
  }

  return frames;
}

// ── Core DSP Functions ──

function computeRMS(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

/**
 * Simplified MPM-like pitch detector using ACF with peak picking.
 * Returns pitch in Hz and a confidence score 0..1.
 */
function detectPitchMPMLite(
  data: Float32Array,
  sampleRate: number,
): { pitch: number | null; confidence: number } {
  const size = data.length;

  // Check energy
  let rms = 0;
  for (let i = 0; i < size; i++) rms += data[i] * data[i];
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return { pitch: null, confidence: 0 };

  // Normalized Square Difference Function (NSDF)
  const minLag = Math.floor(sampleRate / 500); // 500Hz max
  const maxLag = Math.min(Math.floor(sampleRate / 60), size - 1); // 60Hz min

  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, den = 0;
    for (let i = 0; i < size - lag; i++) {
      num += data[i] * data[i + lag];
      den += data[i] * data[i] + data[i + lag] * data[i + lag];
    }
    nsdf[lag] = den > 0 ? 2 * num / den : 0;
  }

  // Find first positive peak above threshold
  let bestLag = 0;
  let bestVal = 0;
  let positive = false;

  for (let lag = minLag; lag <= maxLag; lag++) {
    if (nsdf[lag] > 0) positive = true;
    if (positive && nsdf[lag] > bestVal) {
      bestVal = nsdf[lag];
      bestLag = lag;
    }
    // After first zero-crossing after a peak, check if good enough
    if (positive && nsdf[lag] < 0 && bestVal > 0.3) break;
  }

  if (bestLag === 0 || bestVal < 0.2) return { pitch: null, confidence: 0 };

  // Parabolic interpolation for sub-sample accuracy
  const refined = parabolicInterpolation(nsdf, bestLag, minLag, maxLag);

  return {
    pitch: sampleRate / refined,
    confidence: Math.min(1, bestVal),
  };
}

function parabolicInterpolation(
  data: Float32Array,
  peak: number,
  minIdx: number,
  maxIdx: number,
): number {
  if (peak <= minIdx || peak >= maxIdx) return peak;
  const a = data[peak - 1];
  const b = data[peak];
  const c = data[peak + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c));
  if (!isFinite(shift)) return peak;
  return peak + Math.max(-1, Math.min(1, shift));
}

function computeMagnitudeSpectrum(data: Float32Array): Float32Array {
  // Simple DFT magnitude for the first N/2 bins
  // For performance, we only compute bins we need
  const N = data.length;
  const halfN = Math.floor(N / 2);
  const mags = new Float32Array(halfN);

  for (let k = 0; k < halfN; k++) {
    let re = 0, im = 0;
    // Downsample computation: skip every 4th sample for speed on large windows
    const step = N > 1024 ? 2 : 1;
    for (let n = 0; n < N; n += step) {
      const angle = (2 * Math.PI * k * n) / N;
      re += data[n] * Math.cos(angle);
      im -= data[n] * Math.sin(angle);
    }
    mags[k] = Math.sqrt(re * re + im * im) / (N / step);
  }

  return mags;
}

function spectralCentroid(magnitudes: Float32Array, sampleRate: number, windowSize: number): number {
  let weightedSum = 0, totalMag = 0;
  const binWidth = sampleRate / windowSize;
  for (let i = 0; i < magnitudes.length; i++) {
    weightedSum += magnitudes[i] * i * binWidth;
    totalMag += magnitudes[i];
  }
  return totalMag > 0 ? Math.round(weightedSum / totalMag) : 0;
}

function zeroCrossingRate(data: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < data.length; i++) {
    if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) {
      crossings++;
    }
  }
  return crossings / data.length;
}

function spectralRolloff(magnitudes: Float32Array, sampleRate: number, windowSize: number, ratio: number): number {
  let total = 0;
  for (let i = 0; i < magnitudes.length; i++) total += magnitudes[i];
  const threshold = total * ratio;
  let cum = 0;
  const binWidth = sampleRate / windowSize;
  for (let i = 0; i < magnitudes.length; i++) {
    cum += magnitudes[i];
    if (cum >= threshold) return Math.round(i * binWidth);
  }
  return Math.round(magnitudes.length * binWidth);
}

function spectralFlux(current: Float32Array, previous: Float32Array): number {
  let flux = 0;
  const len = Math.min(current.length, previous.length);
  for (let i = 0; i < len; i++) {
    const diff = current[i] - previous[i];
    if (diff > 0) flux += diff;
  }
  return flux;
}
