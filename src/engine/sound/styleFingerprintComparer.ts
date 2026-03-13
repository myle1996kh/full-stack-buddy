/**
 * Style Fingerprint Comparer: compare SPEAKING STYLE, not specific melody.
 *
 * Core insight: "copy the style" means copying the CHARACTER of how someone speaks,
 * not the exact pitch contour. A Thai speaker and English learner will have completely
 * different contours — but can have the SAME style (energetic, dramatic, punchy, calm...).
 *
 * Approach: extract a statistical "style fingerprint" from each recording,
 * then compare the fingerprints with simple similarity metrics.
 * No DTW, no time-series alignment — just distribution comparison.
 *
 * Fully deterministic.
 */

import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';

export interface FingerprintParams {
  weights: {
    melody: number;
    energy: number;
    rhythm: number;
    voice: number;
  };
  enabledMetrics?: {
    melody: boolean;
    energy: boolean;
    rhythm: boolean;
    voice: boolean;
  };
}

export interface FingerprintCompareOptions {
  applyQualityPenalty?: boolean;
}

export const DEFAULT_FINGERPRINT_PARAMS: FingerprintParams = {
  weights: {
    melody: 0.30,
    energy: 0.25,
    rhythm: 0.25,
    voice: 0.20,
  },
  enabledMetrics: {
    melody: true,
    energy: true,
    rhythm: true,
    voice: true,
  },
};

// ── Style Fingerprint ──

export interface StyleFingerprint {
  // Melody character
  pitchRange: number;          // semitone span (max - min) — how expressive
  pitchVariability: number;    // std dev of pitch — monotone vs dynamic
  pitchDirectionBias: number;  // ratio of rising frames — upward vs downward tendency

  // Energy character
  energyRange: number;         // dB span — soft-spoken vs punchy
  energyVariability: number;   // std dev — even vs contrasty
  energyPeakRatio: number;     // ratio of high-energy frames — how often they punch

  // Rhythm character
  speechRate: number;          // syllables/sec — fast vs slow
  rhythmRegularity: number;    // 0..1 — metronomic vs free-form
  pauseRate: number;           // pauses per second of speech
  avgPauseDuration: number;    // seconds — quick breaths vs dramatic pauses

  // Voice character
  brightness: number;          // mean spectral centroid (z-normalized)
  warmth: number;              // mean spectral rolloff (z-normalized)
  voicedRatio: number;         // how much actual voice vs silence
}

/**
 * Extract a style fingerprint from a SoundPatternV2.
 * All features are statistical summaries, not time-dependent.
 */
export function extractFingerprint(pattern: SoundPatternV2): StyleFingerprint {
  const pitch = pattern.pitchContourVoiced?.length > 0
    ? pattern.pitchContourVoiced
    : pattern.pitchContourNorm;

  const energy = pattern.energyContourNorm;
  const centroid = pattern.spectralCentroidContour ?? [];
  const rolloff = pattern.spectralRolloffContour ?? [];

  // Melody character
  const pitchRange = arrRange(pitch);
  const pitchVariability = stdDev(pitch);

  // Pitch direction: what % of frames are rising?
  const slope = pattern.pitchSlopeVoiced?.length > 0
    ? pattern.pitchSlopeVoiced
    : pattern.pitchSlope;
  const risingFrames = slope.filter(s => s > 0.01).length;
  const totalNonFlat = slope.filter(s => Math.abs(s) > 0.01).length;
  const pitchDirectionBias = totalNonFlat > 0 ? risingFrames / totalNonFlat : 0.5;

  // Energy character
  const energyRange = arrRange(energy);
  const energyVariability = stdDev(energy);
  const energyMean = mean(energy);
  const energyPeakRatio = energy.length > 0
    ? energy.filter(e => e > energyMean + 0.5 * energyVariability).length / energy.length
    : 0;

  // Rhythm character
  const pauseRate = pattern.duration > 0
    ? pattern.pausePattern.length / pattern.duration
    : 0;
  const avgPauseDuration = pattern.pausePattern.length > 0
    ? pattern.pausePattern.reduce((s, p) => s + p.dur, 0) / pattern.pausePattern.length
    : 0;

  // Voice character (distribution-based, robust to zero-mean normalized contours)
  const brightness = percentile(centroid, 90) - percentile(centroid, 50); // upper-tail prominence
  const warmth = percentile(rolloff, 50) - percentile(rolloff, 10);      // lower-tail prominence

  return {
    pitchRange,
    pitchVariability,
    pitchDirectionBias,
    energyRange,
    energyVariability,
    energyPeakRatio,
    speechRate: pattern.speechRate,
    rhythmRegularity: pattern.regularity,
    pauseRate,
    avgPauseDuration,
    brightness,
    warmth,
    voicedRatio: pattern.voicedRatio,
  };
}

// ── Comparison ──

/**
 * Compare two style fingerprints.
 * Returns 0..100 similarity score + breakdown + feedback.
 */
export function compareStyleFingerprints(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
  params: FingerprintParams = DEFAULT_FINGERPRINT_PARAMS,
  options?: FingerprintCompareOptions,
): SoundCompareResultV2 {
  const refFP = extractFingerprint(ref);
  const usrFP = extractFingerprint(usr);

  const refQuality = evaluateQuality(ref);
  const usrQuality = evaluateQuality(usr);
  const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

  // ── Sub-scores ──

  // MELODY: how similarly expressive is the voice?
  const pitchRangeSim = ratioSim(refFP.pitchRange + 0.1, usrFP.pitchRange + 0.1);
  const pitchVarSim = ratioSim(refFP.pitchVariability + 0.01, usrFP.pitchVariability + 0.01);
  const pitchDirSim = 1 - Math.abs(refFP.pitchDirectionBias - usrFP.pitchDirectionBias);
  const melodySim = pitchRangeSim * 0.35 + pitchVarSim * 0.40 + pitchDirSim * 0.25;

  // ENERGY: how similarly punchy / soft is the delivery?
  const energyRangeSim = ratioSim(refFP.energyRange + 0.1, usrFP.energyRange + 0.1);
  const energyVarSim = ratioSim(refFP.energyVariability + 0.01, usrFP.energyVariability + 0.01);
  const energyPeakSim = 1 - Math.abs(refFP.energyPeakRatio - usrFP.energyPeakRatio);
  const energySim = energyRangeSim * 0.30 + energyVarSim * 0.40 + energyPeakSim * 0.30;

  // RHYTHM: how similarly paced and structured?
  const speedSim = ratioSim(refFP.speechRate + 0.1, usrFP.speechRate + 0.1);
  const regularitySim = 1 - Math.abs(refFP.rhythmRegularity - usrFP.rhythmRegularity);
  const pauseRateSim = ratioSim(refFP.pauseRate + 0.01, usrFP.pauseRate + 0.01);
  const pauseDurSim = ratioSim(refFP.avgPauseDuration + 0.01, usrFP.avgPauseDuration + 0.01);
  const rhythmSim = speedSim * 0.30 + regularitySim * 0.25 + pauseRateSim * 0.25 + pauseDurSim * 0.20;

  // VOICE: how similar is the vocal character?
  const brightSim = ratioSim(refFP.brightness + 0.05, usrFP.brightness + 0.05);
  const warmSim = ratioSim(refFP.warmth + 0.05, usrFP.warmth + 0.05);
  const voicedSim = 1 - Math.abs(refFP.voicedRatio - usrFP.voicedRatio) * 2;
  const voiceSim = Math.max(0, brightSim * 0.35 + warmSim * 0.35 + voicedSim * 0.30);

  // ── Weighted total ──
  // Melody + Energy = the "feel", Rhythm = the "groove", Voice = the "color"
  const rawScores = {
    melody: melodySim,
    energy: energySim,
    rhythm: rhythmSim,
    voice: voiceSim,
  };
  const enabled = params.enabledMetrics ?? DEFAULT_FINGERPRINT_PARAMS.enabledMetrics!;
  const weights = normalizeEnabledWeights(params.weights, enabled);
  const enabledKeys = Object.keys(weights) as Array<keyof typeof rawScores>;

  const raw = enabledKeys.reduce((sum, key) => sum + rawScores[key] * weights[key], 0);

  const applyQualityPenalty = options?.applyQualityPenalty ?? false;
  const rawScore = Math.max(0, Math.min(100, raw * 100));
  const finalScore = applyQualityPenalty ? rawScore * qualityFactor : rawScore;

  // Final score = weighted average with optional quality scaling
  const coreMin = Math.min(melodySim, energySim, rhythmSim); // keep as diagnostic only
  const score = Math.round(Math.max(0, Math.min(100, finalScore)));

  const breakdownKeyMap: Record<keyof typeof rawScores, string> = {
    melody: 'intonation',
    rhythm: 'rhythmPause',
    energy: 'energy',
    voice: 'timbre',
  };
  const breakdown = Object.fromEntries(
    enabledKeys.map((key) => [breakdownKeyMap[key], Math.round(rawScores[key] * 100)]),
  );

  const feedback = buildFeedback(rawScores, enabledKeys, usrQuality.warnings);

  return {
    score,
    breakdown,
    qualityFactor: round3(qualityFactor),
    feedback,
    debug: {
      // Weights
      w_melody: round3(weights.melody ?? 0),
      w_energy: round3(weights.energy ?? 0),
      w_rhythm: round3(weights.rhythm ?? 0),
      w_voice: round3(weights.voice ?? 0),
      enabled_melody: enabled.melody ? 1 : 0,
      enabled_energy: enabled.energy ? 1 : 0,
      enabled_rhythm: enabled.rhythm ? 1 : 0,
      enabled_voice: enabled.voice ? 1 : 0,
      // Overall
      rawWeightedAvg: round3(raw),
      rawScore: round3(rawScore),
      finalScore: round3(finalScore),
      applyQualityPenalty: applyQualityPenalty ? 1 : 0,
      coreMin: round3(coreMin),
      qualityFactor: round3(qualityFactor),
      // Melody detail
      pitchRangeSim: round3(pitchRangeSim),
      pitchVarSim: round3(pitchVarSim),
      pitchDirSim: round3(pitchDirSim),
      ref_pitchRange: round3(refFP.pitchRange),
      usr_pitchRange: round3(usrFP.pitchRange),
      ref_pitchVar: round3(refFP.pitchVariability),
      usr_pitchVar: round3(usrFP.pitchVariability),
      // Energy detail
      energyRangeSim: round3(energyRangeSim),
      energyVarSim: round3(energyVarSim),
      energyPeakSim: round3(energyPeakSim),
      ref_energyRange: round3(refFP.energyRange),
      usr_energyRange: round3(usrFP.energyRange),
      // Rhythm detail
      speedSim: round3(speedSim),
      regularitySim: round3(regularitySim),
      pauseRateSim: round3(pauseRateSim),
      pauseDurSim: round3(pauseDurSim),
      ref_speechRate: round3(refFP.speechRate),
      usr_speechRate: round3(usrFP.speechRate),
      ref_pauseRate: round3(refFP.pauseRate),
      usr_pauseRate: round3(usrFP.pauseRate),
      // Voice detail
      brightSim: round3(brightSim),
      warmSim: round3(warmSim),
      voicedSim: round3(Math.max(0, voicedSim)),
    },
  };
}

// ── Math Helpers ──

/** Ratio similarity: 1.0 when equal, falls off quadratically */
function ratioSim(a: number, b: number): number {
  if (a <= 0 && b <= 0) return 1;
  if (a <= 0 || b <= 0) return 0;
  const ratio = Math.min(a, b) / Math.max(a, b);
  return ratio * ratio;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function arrRange(arr: number[]): number {
  if (arr.length === 0) return 0;
  let min = Infinity, max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function normalizeEnabledWeights(
  weights: FingerprintParams['weights'],
  enabled: NonNullable<FingerprintParams['enabledMetrics']>,
): Record<keyof FingerprintParams['weights'], number> {
  const entries = Object.entries(weights)
    .filter(([k]) => enabled[k as keyof FingerprintParams['weights']]) as Array<[keyof FingerprintParams['weights'], number]>;

  const activeEntries = entries.length > 0
    ? entries
    : (Object.entries(weights) as Array<[keyof FingerprintParams['weights'], number]>);

  const total = activeEntries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) {
    const uniform = 1 / activeEntries.length;
    return Object.fromEntries(activeEntries.map(([k]) => [k, uniform])) as Record<keyof FingerprintParams['weights'], number>;
  }

  return Object.fromEntries(activeEntries.map(([k, v]) => [k, v / total])) as Record<keyof FingerprintParams['weights'], number>;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function buildFeedback(
  scores: Record<'melody' | 'energy' | 'rhythm' | 'voice', number>,
  enabledKeys: Array<'melody' | 'energy' | 'rhythm' | 'voice'>,
  qualityWarnings: string[],
): string[] {
  const fb: string[] = [...qualityWarnings];

  if (enabledKeys.includes('melody')) {
    const melody = scores.melody;
    if (melody < 0.3) fb.push('Expressiveness is very different — try matching how dramatic or calm the voice is');
    else if (melody < 0.5) fb.push('Pitch expression partially matches — focus on how wide the voice moves up and down');
  }

  if (enabledKeys.includes('energy')) {
    const energy = scores.energy;
    if (energy < 0.3) fb.push('Energy delivery is very different — match the loud/soft contrast');
    else if (energy < 0.5) fb.push('Energy partially matches — try punching the same emphasis points');
  }

  if (enabledKeys.includes('rhythm')) {
    const rhythm = scores.rhythm;
    if (rhythm < 0.3) fb.push('Speaking pace and pausing are very different');
    else if (rhythm < 0.5) fb.push('Rhythm needs work — try matching the speed and pause pattern');
  }

  if (enabledKeys.includes('voice')) {
    const voice = scores.voice;
    if (voice < 0.3) fb.push('Voice character differs significantly');
    else if (voice < 0.5) fb.push('Voice color partially matches');
  }

  const avg = enabledKeys.length > 0
    ? enabledKeys.reduce((s, k) => s + scores[k], 0) / enabledKeys.length
    : 0;
  if (avg >= 0.8) fb.push('Excellent style match! You sound very similar.');
  else if (avg >= 0.65) fb.push('Good style similarity — the feel is close.');
  else if (avg >= 0.5) fb.push('Moderate match — keep practicing the style.');

  return fb;
}
