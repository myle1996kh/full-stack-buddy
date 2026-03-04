/**
 * Pattern extraction: converts raw frames + VAD output into a normalized SoundPatternV2.
 * Handles pitch normalization (semitone), energy normalization, rhythm metrics.
 */

import type { SoundFrameV2, SoundPatternV2, PauseEvent } from './types';
import { CONTOUR_LENGTH, FRAME_HOP_S } from './types';
import { estimateNoiseFloor, classifyVoicing, extractSpeechSegments, extractPauses } from './vad';

/**
 * Extract a full SoundPatternV2 from raw frames.
 */
export function extractSoundPattern(frames: SoundFrameV2[], duration: number): SoundPatternV2 {
  if (frames.length === 0) {
    return emptyPattern(duration);
  }

  const noiseFloor = estimateNoiseFloor(frames);
  const voicedFlags = classifyVoicing(frames, noiseFloor);
  const segments = extractSpeechSegments(voicedFlags);
  const pauses = extractPauses(voicedFlags);

  // ── Pitch contour (semitone, normalized to speaker median) ──
  const voicedPitches = frames.filter(f => f.voiced && f.pitchHz !== null).map(f => f.pitchHz!);
  const medianPitch = voicedPitches.length > 0 ? median(voicedPitches) : 200;

  // Convert to semitones relative to speaker median, filter outliers, smooth
  const pitchSemitones: number[] = [];
  for (const f of frames) {
    if (f.voiced && f.pitchHz !== null && f.pitchHz >= 60 && f.pitchHz <= 500) {
      pitchSemitones.push(12 * Math.log2(f.pitchHz / medianPitch));
    } else {
      pitchSemitones.push(0); // silence placeholder
    }
  }
  const smoothedPitch = medianSmooth(pitchSemitones, 5);
  const pitchContourNorm = resample(smoothedPitch, CONTOUR_LENGTH);

  // Pitch slope (first derivative)
  const pitchSlope = new Array(pitchContourNorm.length);
  pitchSlope[0] = 0;
  for (let i = 1; i < pitchContourNorm.length; i++) {
    pitchSlope[i] = pitchContourNorm[i] - pitchContourNorm[i - 1];
  }

  // ── Energy contour (z-normalized log energy) ──
  const energies = frames.map(f => f.energyDb > -100 ? f.energyDb : -60);
  const zNormEnergy = zNormalize(energies);
  const energyContourNorm = resample(zNormEnergy, CONTOUR_LENGTH);

  // ── Onsets from spectral flux peaks ──
  const onsetTimes = detectOnsets(frames);

  // ── Rhythm metrics ──
  const iois = computeIOIs(onsetTimes);
  const avgIOI = iois.length > 0 ? iois.reduce((a, b) => a + b, 0) / iois.length * 1000 : 0;
  const regularity = iois.length > 1 ? computeRegularity(iois) : 0;

  // Speech rate (estimated from onset count / speech duration)
  const speechDur = segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
  const speechRate = speechDur > 0 ? onsetTimes.length / speechDur : 0;

  // Voiced ratio
  const voicedCount = voicedFlags.filter(v => v).length;
  const voicedRatio = frames.length > 0 ? voicedCount / frames.length : 0;

  // ── Quality metrics ──
  const snrLike = computeSNRLike(frames, noiseFloor);
  const clippingRatio = 0; // computed at preprocess stage, placeholder
  const avgConf = voicedPitches.length > 0
    ? frames.filter(f => f.voiced).reduce((s, f) => s + f.pitchConf, 0) / voicedPitches.length
    : 0;

  return {
    duration,
    pitchContourNorm,
    pitchSlope,
    energyContourNorm,
    onsetTimes,
    pausePattern: pauses,
    speechRate,
    avgIOI,
    regularity,
    voicedRatio,
    quality: {
      snrLike,
      clippingRatio,
      confidence: avgConf,
    },
  };
}

// ── Helpers ──

function emptyPattern(duration: number): SoundPatternV2 {
  return {
    duration,
    pitchContourNorm: new Array(CONTOUR_LENGTH).fill(0),
    pitchSlope: new Array(CONTOUR_LENGTH).fill(0),
    energyContourNorm: new Array(CONTOUR_LENGTH).fill(0),
    onsetTimes: [],
    pausePattern: [],
    speechRate: 0,
    avgIOI: 0,
    regularity: 0,
    voicedRatio: 0,
    quality: { snrLike: 0, clippingRatio: 0, confidence: 0 },
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianSmooth(data: number[], windowSize: number): number[] {
  const half = Math.floor(windowSize / 2);
  return data.map((_, i) => {
    const window: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
      window.push(data[j]);
    }
    return median(window);
  });
}

export function resample(arr: number[], targetLen: number): number[] {
  if (arr.length === 0) return new Array(targetLen).fill(0);
  if (arr.length === targetLen) return [...arr];
  if (arr.length === 1) return new Array(targetLen).fill(arr[0]);
  const result: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const pos = (i / (targetLen - 1)) * (arr.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, arr.length - 1);
    const frac = pos - lo;
    result.push(arr[lo] * (1 - frac) + arr[hi] * frac);
  }
  return result;
}

function zNormalize(arr: number[]): number[] {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  if (std < 1e-8) return arr.map(() => 0);
  return arr.map(v => (v - mean) / std);
}

function detectOnsets(frames: SoundFrameV2[]): number[] {
  const REFRACTORY = 0.08; // 80ms minimum between onsets
  const fluxValues = frames.map(f => f.flux);
  const mean = fluxValues.reduce((a, b) => a + b, 0) / (fluxValues.length || 1);
  const threshold = mean * 1.8;

  const onsets: number[] = [];
  let lastOnset = -Infinity;

  for (let i = 0; i < frames.length; i++) {
    if (frames[i].flux > threshold && frames[i].flux > 0.001 && frames[i].t - lastOnset >= REFRACTORY) {
      onsets.push(frames[i].t);
      lastOnset = frames[i].t;
    }
  }

  return onsets;
}

function computeIOIs(onsets: number[]): number[] {
  if (onsets.length < 2) return [];
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    iois.push(onsets[i] - onsets[i - 1]);
  }
  return iois;
}

function computeRegularity(iois: number[]): number {
  if (iois.length < 2) return 0;
  const mean = iois.reduce((a, b) => a + b, 0) / iois.length;
  if (mean < 1e-8) return 0;
  const cv = Math.sqrt(iois.reduce((s, v) => s + (v - mean) ** 2, 0) / iois.length) / mean;
  // Lower CV = more regular. Map CV to 0..1 (CV=0 -> 1, CV>=1 -> 0)
  return Math.max(0, Math.min(1, 1 - cv));
}

function computeSNRLike(frames: SoundFrameV2[], noiseFloor: number): number {
  const voicedEnergies = frames.filter(f => f.voiced).map(f => f.energyDb);
  if (voicedEnergies.length === 0) return 0;
  const avgSignal = voicedEnergies.reduce((a, b) => a + b, 0) / voicedEnergies.length;
  return Math.max(0, avgSignal - noiseFloor);
}
