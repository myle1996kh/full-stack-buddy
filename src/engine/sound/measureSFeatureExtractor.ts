import type { MeasureSAcousticFeatures } from './types';

const FRAME_LENGTH = 2048;
const HOP_LENGTH = 512;
const TOP_DB = 30;
const MIN_BPM = 30;
const MAX_BPM = 300;
const EPS = 1e-10;

export function extractMeasureSAcousticFeatures(
  mono: Float32Array,
  sampleRate: number,
  duration: number,
): MeasureSAcousticFeatures {
  if (mono.length === 0 || sampleRate <= 0) {
    return emptyFeatures(duration);
  }

  const rmsFrames = computeRmsFrames(mono, FRAME_LENGTH, HOP_LENGTH);
  const avgRms = round5(mean(rmsFrames));
  const maxRms = round5(max(rmsFrames));
  const nSegments = countNonSilentSegments(rmsFrames, TOP_DB);

  const onsetEnvelope = computeOnsetEnvelope(mono, sampleRate, FRAME_LENGTH, HOP_LENGTH);
  const { tempoBpm, beatConfidence, onsetCount } = estimateTempo(onsetEnvelope, sampleRate, HOP_LENGTH);

  const safeAvg = Math.max(avgRms, EPS);
  return {
    duration: round2(duration),
    tempoBpm: round1(tempoBpm),
    avgRms,
    maxRms,
    nSegments,
    onsetCount,
    beatConfidence: round3(beatConfidence),
    maxAvgRatio: round3(maxRms / safeAvg),
    flatness: round3(avgRms > EPS ? 1 - Math.min(1, (maxRms - avgRms) / safeAvg) : 1),
  };
}

function emptyFeatures(duration: number): MeasureSAcousticFeatures {
  return {
    duration: round2(duration),
    tempoBpm: 0,
    avgRms: 0,
    maxRms: 0,
    nSegments: 0,
    onsetCount: 0,
    beatConfidence: 0,
    maxAvgRatio: 0,
    flatness: 1,
  };
}

function computeRmsFrames(data: Float32Array, frameLength: number, hopLength: number): number[] {
  const padded = padCenter(data, Math.floor(frameLength / 2));
  const totalFrames = Math.max(1, 1 + Math.floor((padded.length - frameLength) / hopLength));
  const rms: number[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const start = i * hopLength;
    const end = start + frameLength;
    const frame = padded.subarray(start, end);
    rms.push(computeRms(frame));
  }

  return rms;
}

function countNonSilentSegments(rmsFrames: number[], topDb: number): number {
  if (rmsFrames.length === 0) return 0;
  const ref = Math.max(max(rmsFrames), EPS);
  const nonSilent = rmsFrames.map((r) => 20 * Math.log10(Math.max(r, EPS) / ref) > -topDb);

  let count = 0;
  let active = false;
  for (const flag of nonSilent) {
    if (flag && !active) {
      count += 1;
      active = true;
    } else if (!flag) {
      active = false;
    }
  }
  return count;
}

function computeOnsetEnvelope(
  data: Float32Array,
  sampleRate: number,
  frameLength: number,
  hopLength: number,
): number[] {
  const padded = padCenter(data, Math.floor(frameLength / 2));
  const totalFrames = Math.max(1, 1 + Math.floor((padded.length - frameLength) / hopLength));
  const window = hann(frameLength);
  const envelope: number[] = [];
  let prev: Float32Array | null = null;

  for (let i = 0; i < totalFrames; i++) {
    const start = i * hopLength;
    const frame = multiplyWindow(padded.subarray(start, start + frameLength), window);
    const mag = magnitudeSpectrum(frame);

    if (!prev) {
      envelope.push(0);
    } else {
      let flux = 0;
      const len = Math.min(mag.length, prev.length);
      for (let k = 1; k < len; k++) {
        const diff = Math.log1p(mag[k]) - Math.log1p(prev[k]);
        if (diff > 0) flux += diff;
      }
      envelope.push(flux);
    }

    prev = mag;
  }

  const smoothed = movingAverage(envelope, 4);
  const localMean = movingAverage(smoothed, 16);
  const normalized = smoothed.map((v, i) => Math.max(0, v - localMean[i]));
  const peak = max(normalized);
  if (peak <= EPS) return normalized;
  return normalized.map((v) => v / peak);
}

function estimateTempo(onsetEnvelope: number[], sampleRate: number, hopLength: number) {
  const framesPerSecond = sampleRate / hopLength;
  const peaks = detectPeaks(onsetEnvelope, Math.max(1, Math.round(0.08 * framesPerSecond)));

  if (onsetEnvelope.length < 4) {
    return { tempoBpm: 0, beatConfidence: 0, onsetCount: peaks.length };
  }

  const acf = autocorrelate(onsetEnvelope);
  const minLag = Math.max(1, Math.round((60 * framesPerSecond) / MAX_BPM));
  const maxLag = Math.min(acf.length - 1, Math.round((60 * framesPerSecond) / MIN_BPM));

  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * framesPerSecond) / lag;
    let score = acf[lag];
    if (lag * 2 < acf.length) score += acf[lag * 2] * 0.5;
    if (lag * 3 < acf.length) score += acf[lag * 3] * 0.25;
    score *= tempoPrior(bpm);

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let tempoBpm = bestLag > 0 ? (60 * framesPerSecond) / bestLag : 0;

  if (peaks.length >= 2) {
    const peakIntervals = diff(peaks).filter((v) => v > 0);
    if (peakIntervals.length > 0) {
      const medianLag = median(peakIntervals);
      const peakTempo = (60 * framesPerSecond) / medianLag;
      const candidates = [peakTempo / 2, peakTempo, peakTempo * 2].filter((bpm) => bpm >= MIN_BPM && bpm <= MAX_BPM);
      for (const candidate of candidates) {
        const lag = Math.round((60 * framesPerSecond) / candidate);
        if (lag < minLag || lag > maxLag) continue;
        const candidateScore = (acf[lag] ?? 0) + (lag * 2 < acf.length ? acf[lag * 2] * 0.5 : 0);
        if (candidateScore > bestScore * 0.97) {
          tempoBpm = candidate;
          bestScore = candidateScore;
        }
      }
    }
  }

  const maxAcf = max(acf.slice(minLag, maxLag + 1));
  const beatConfidence = maxAcf > EPS && Number.isFinite(bestScore)
    ? clamp(bestScore / (maxAcf + EPS), 0, 1)
    : 0;

  return {
    tempoBpm: clamp(tempoBpm, 0, MAX_BPM),
    beatConfidence,
    onsetCount: peaks.length,
  };
}

function detectPeaks(values: number[], refractoryFrames: number): number[] {
  if (values.length === 0) return [];
  const meanVal = mean(values);
  const stdVal = std(values);
  const threshold = Math.max(meanVal + stdVal * 0.5, max(values) * 0.25, 0.05);

  const peaks: number[] = [];
  let lastPeak = -Infinity;
  for (let i = 1; i < values.length - 1; i++) {
    const curr = values[i];
    if (curr < threshold) continue;
    if (curr < values[i - 1] || curr < values[i + 1]) continue;
    if (i - lastPeak < refractoryFrames) continue;
    peaks.push(i);
    lastPeak = i;
  }
  return peaks;
}

function autocorrelate(values: number[]): number[] {
  const centered = values.map((v) => v - mean(values));
  const acf = new Array(centered.length).fill(0);
  for (let lag = 0; lag < centered.length; lag++) {
    let sum = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      sum += centered[i] * centered[i + lag];
    }
    acf[lag] = sum;
  }
  return acf;
}

function tempoPrior(bpm: number): number {
  const spread = 1.4;
  const logDistance = Math.log2(Math.max(bpm, EPS) / 120);
  return 0.7 + 0.3 * Math.exp(-(logDistance * logDistance) / (2 * spread * spread));
}

function padCenter(data: Float32Array, pad: number): Float32Array {
  const out = new Float32Array(data.length + pad * 2);
  out.set(data, pad);
  return out;
}

function hann(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
  }
  return out;
}

function multiplyWindow(frame: Float32Array, window: Float32Array): Float32Array {
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] * window[i];
  return out;
}

function magnitudeSpectrum(data: Float32Array): Float32Array {
  const N = data.length;
  const halfN = Math.floor(N / 2);
  const mags = new Float32Array(halfN);

  for (let k = 0; k < halfN; k++) {
    let re = 0;
    let im = 0;
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

function movingAverage(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      sum += values[j];
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  });
}

function computeRms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, data.length));
}

function diff(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(values[i] - values[i - 1]);
  return out;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / values.length);
}

function max(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((best, v) => (v > best ? v : best), -Infinity);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(value: number, min: number, maxValue: number): number {
  return Math.max(min, Math.min(maxValue, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}
