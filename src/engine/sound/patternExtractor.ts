/**
 * Pattern extraction: converts raw frames + VAD output into a normalized SoundPatternV2.
 * Handles pitch normalization (semitone), energy normalization, rhythm metrics.
 *
 * V2.1: Voiced-only interpolation for pitch contours (fixes zero-fill melody corruption).
 *       Spectral contour extraction (centroid, rolloff) for timbre comparison.
 */

import type { SoundFrameV2, SoundPatternV2, PauseEvent } from './types';
import { CONTOUR_LENGTH, FRAME_HOP_S } from './types';
import { estimateNoiseFloor, classifyVoicing, extractSpeechSegments, extractPauses } from './vad';

/**
 * Maximum gap (in frames) to interpolate through.
 * Gaps shorter than this are consonants/breaths — interpolate to preserve melody.
 * Gaps >= this are pauses — treat as boundaries.
 * 8 frames × 20ms = 160ms.
 */
const MAX_INTERPOLATION_GAP = 8;

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

  // ── Pitch: voiced-only interpolated contour ──
  const voicedPitches = frames.filter(f => f.voiced && f.pitchHz !== null).map(f => f.pitchHz!);
  const medianPitch = voicedPitches.length > 0 ? median(voicedPitches) : 200;

  // Build semitone values for voiced frames, null for unvoiced
  const semitonesRaw: (number | null)[] = frames.map(f => {
    if (f.voiced && f.pitchHz !== null && f.pitchHz >= 60 && f.pitchHz <= 500) {
      return 12 * Math.log2(f.pitchHz / medianPitch);
    }
    return null;
  });

  // Voiced-only interpolated contour (the actual melody line)
  const interpolatedPitch = interpolateVoiced(semitonesRaw, MAX_INTERPOLATION_GAP);
  const smoothedVoiced = medianSmooth(interpolatedPitch, 5);
  const pitchContourVoiced = resample(smoothedVoiced, CONTOUR_LENGTH);

  // Voiced pitch slope (first derivative)
  const pitchSlopeVoiced = computeSlope(pitchContourVoiced);

  // Legacy contour (zero-fill, for backward compatibility)
  const pitchSemitonesLegacy = semitonesRaw.map(v => v ?? 0);
  const smoothedLegacy = medianSmooth(pitchSemitonesLegacy, 5);
  const pitchContourNorm = resample(smoothedLegacy, CONTOUR_LENGTH);
  const pitchSlope = computeSlope(pitchContourNorm);

  // ── Energy contour (z-normalized log energy) ──
  const energies = frames.map(f => f.energyDb > -100 ? f.energyDb : -60);
  const zNormEnergy = zNormalize(energies);
  const energyContourNorm = resample(zNormEnergy, CONTOUR_LENGTH);

  // ── Spectral contours (voiced-only, z-normalized) ──
  const centroidRaw: (number | null)[] = frames.map((f, i) =>
    voicedFlags[i] ? f.centroid : null
  );
  const rolloffRaw: (number | null)[] = frames.map((f, i) =>
    voicedFlags[i] ? f.rolloff : null
  );

  const centroidInterp = interpolateVoiced(centroidRaw, MAX_INTERPOLATION_GAP);
  const rolloffInterp = interpolateVoiced(rolloffRaw, MAX_INTERPOLATION_GAP);

  const spectralCentroidContour = resample(zNormalize(centroidInterp), CONTOUR_LENGTH);
  const spectralRolloffContour = resample(zNormalize(rolloffInterp), CONTOUR_LENGTH);

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
    pitchContourVoiced,
    pitchSlopeVoiced,
    energyContourNorm,
    spectralCentroidContour,
    spectralRolloffContour,
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

// ── Voiced-only interpolation ──

/**
 * Extract voiced-only values and interpolate through short gaps.
 * - Gaps < maxGap frames: linear interpolation (consonants/breaths)
 * - Gaps >= maxGap frames: pause boundary, don't interpolate
 * Returns a contour of only the voiced+interpolated segments concatenated.
 */
function interpolateVoiced(values: (number | null)[], maxGap: number): number[] {
  if (values.length === 0) return [];

  // Find contiguous voiced regions and their gaps
  const filled: number[] = new Array(values.length).fill(0);
  const isVoiced: boolean[] = values.map(v => v !== null);

  // Copy voiced values
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) filled[i] = values[i]!;
  }

  // Interpolate through short gaps between voiced regions
  let i = 0;
  while (i < values.length) {
    if (isVoiced[i]) {
      i++;
      continue;
    }

    // Found start of a gap — find its end
    const gapStart = i;
    while (i < values.length && !isVoiced[i]) i++;
    const gapEnd = i; // first voiced frame after gap (or end of array)
    const gapLen = gapEnd - gapStart;

    // Only interpolate short gaps that have voiced frames on both sides
    if (gapLen < maxGap && gapStart > 0 && gapEnd < values.length && isVoiced[gapStart - 1] && isVoiced[gapEnd]) {
      const startVal = filled[gapStart - 1];
      const endVal = filled[gapEnd];
      for (let j = 0; j < gapLen; j++) {
        const t = (j + 1) / (gapLen + 1);
        filled[gapStart + j] = startVal + (endVal - startVal) * t;
      }
      // Mark as interpolated (treated as voiced for extraction)
      for (let j = gapStart; j < gapEnd; j++) {
        isVoiced[j] = true;
      }
    }
  }

  // Extract only voiced (including interpolated) segments
  const result: number[] = [];
  for (let j = 0; j < filled.length; j++) {
    if (isVoiced[j]) result.push(filled[j]);
  }

  // If too few voiced frames, fall back to returning all filled values
  if (result.length < 10) {
    return filled;
  }

  return result;
}

// ── Helpers ──

function emptyPattern(duration: number): SoundPatternV2 {
  return {
    duration,
    pitchContourNorm: new Array(CONTOUR_LENGTH).fill(0),
    pitchSlope: new Array(CONTOUR_LENGTH).fill(0),
    pitchContourVoiced: new Array(CONTOUR_LENGTH).fill(0),
    pitchSlopeVoiced: new Array(CONTOUR_LENGTH).fill(0),
    energyContourNorm: new Array(CONTOUR_LENGTH).fill(0),
    spectralCentroidContour: new Array(CONTOUR_LENGTH).fill(0),
    spectralRolloffContour: new Array(CONTOUR_LENGTH).fill(0),
    onsetTimes: [],
    pausePattern: [],
    speechRate: 0,
    avgIOI: 0,
    regularity: 0,
    voicedRatio: 0,
    quality: { snrLike: 0, clippingRatio: 0, confidence: 0 },
  };
}

function computeSlope(contour: number[]): number[] {
  const slope = new Array(contour.length);
  slope[0] = 0;
  for (let i = 1; i < contour.length; i++) {
    slope[i] = contour[i] - contour[i - 1];
  }
  return slope;
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
  if (arr.length === 0) return [];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  if (std < 1e-8) return arr.map(() => 0);
  return arr.map(v => (v - mean) / std);
}

function detectOnsets(frames: SoundFrameV2[]): number[] {
  const REFRACTORY = 0.08; // 80ms minimum between onsets
  const fluxValues = frames.map(f => f.flux);
  const mean = fluxValues.reduce((a, b) => a + b, 0) / (fluxValues.length || 1);
  const std = Math.sqrt(fluxValues.reduce((s, v) => s + (v - mean) ** 2, 0) / (fluxValues.length || 1));
  const threshold = Math.max(mean + std * 0.8, mean * 1.4, 0.002);

  const onsets: number[] = [];
  let lastOnset = -Infinity;

  for (let i = 1; i < frames.length - 1; i++) {
    const curr = fluxValues[i];
    if (curr < threshold) continue;

    // Require local peak + minimal prominence to reduce noisy triggers
    if (curr < fluxValues[i - 1] || curr < fluxValues[i + 1]) continue;
    const prominence = curr - Math.max(fluxValues[i - 1], fluxValues[i + 1]);
    if (prominence < Math.max(std * 0.1, 0.0005)) continue;

    if (frames[i].t - lastOnset >= REFRACTORY) {
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
