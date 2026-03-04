/**
 * Style comparer: cross-language prosodic similarity using DTW.
 * Compares intonation, energy, rhythm/pause, and timbre patterns.
 * Fully deterministic — no randomness.
 * Supports dynamic metric weights and toggling.
 */

import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';

// Default weights (used when no custom weights provided)
const DEFAULT_WEIGHTS = {
  intonation: 0.10,
  rhythmPause: 0.30,
  energy: 0.30,
  timbre: 0.30,
};

export interface MetricWeightInput {
  enabled: boolean;
  weight: number;
}

export type MetricWeights = Record<'intonation' | 'rhythmPause' | 'energy' | 'timbre', MetricWeightInput>;

/**
 * Normalize weights so enabled metrics sum to 1.0.
 */
function normalizeWeights(metrics: MetricWeights): Record<string, number> {
  const entries = Object.entries(metrics).filter(([, v]) => v.enabled);
  const totalWeight = entries.reduce((s, [, v]) => s + v.weight, 0);
  if (totalWeight === 0) return {};
  const result: Record<string, number> = {};
  for (const [key, val] of entries) {
    result[key] = val.weight / totalWeight;
  }
  return result;
}

/**
 * Compare two sound patterns for cross-language style similarity.
 * Accepts optional dynamic metric weights.
 */
export function compareSoundStyle(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
  customWeights?: MetricWeights,
): SoundCompareResultV2 {
  // ── Compute raw sub-scores ──
  const rawScores = {
    intonation: computeIntonation(ref, usr),
    rhythmPause: computeRhythmPause(ref, usr),
    energy: computeEnergy(ref, usr),
    timbre: computeTimbre(ref, usr),
  };

  // ── Determine which metrics are enabled and their normalized weights ──
  const metrics: MetricWeights = customWeights ?? {
    intonation: { enabled: true, weight: DEFAULT_WEIGHTS.intonation },
    rhythmPause: { enabled: true, weight: DEFAULT_WEIGHTS.rhythmPause },
    energy: { enabled: true, weight: DEFAULT_WEIGHTS.energy },
    timbre: { enabled: true, weight: DEFAULT_WEIGHTS.timbre },
  };

  const normWeights = normalizeWeights(metrics);
  const enabledKeys = Object.keys(normWeights);

  // ── Quality factor ──
  const refQuality = evaluateQuality(ref);
  const usrQuality = evaluateQuality(usr);
  const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

  // ── Score fusion (only enabled metrics) ──
  // Score = weighted average of sub-scores (no quality penalty on main score)
  // Quality factor is reported separately for transparency
  let base = 0;
  for (const key of enabledKeys) {
    base += rawScores[key as keyof typeof rawScores] * normWeights[key];
  }
  const score = Math.round(Math.max(0, Math.min(100, base * 100)));

  // ── Build breakdown (only enabled metrics) ──
  const breakdown: Record<string, number> = {};
  for (const key of enabledKeys) {
    breakdown[key] = Math.round(rawScores[key as keyof typeof rawScores] * 100);
  }

  // ── Feedback ──
  const feedback = generateFeedback(rawScores, enabledKeys, qualityFactor, usrQuality.warnings);

  return {
    score,
    breakdown: breakdown as any,
    qualityFactor: Math.round(qualityFactor * 100) / 100,
    feedback,
    debug: {
      ...Object.fromEntries(enabledKeys.map(k => [`w_${k}`, normWeights[k]])),
    },
  };
}

// ── Sub-score computation ──

function computeIntonation(ref: SoundPatternV2, usr: SoundPatternV2): number {
  const pitchContourSim = dtwSimilarity(ref.pitchContourNorm, usr.pitchContourNorm);
  const pitchSlopeSim = dtwSimilarity(ref.pitchSlope, usr.pitchSlope);
  return pitchContourSim * 0.6 + pitchSlopeSim * 0.4;
}

function computeEnergy(ref: SoundPatternV2, usr: SoundPatternV2): number {
  return dtwSimilarity(ref.energyContourNorm, usr.energyContourNorm);
}

function computeRhythmPause(ref: SoundPatternV2, usr: SoundPatternV2): number {
  const speechRateSim = ratioSimilarity(ref.speechRate, usr.speechRate);
  const regularitySim = 1 - Math.abs(ref.regularity - usr.regularity);
  const ioiSim = ref.avgIOI > 0 && usr.avgIOI > 0
    ? ratioSimilarity(ref.avgIOI, usr.avgIOI)
    : 0.5;
  const pauseSim = comparePauses(ref, usr);
  return speechRateSim * 0.3 + regularitySim * 0.2 + ioiSim * 0.25 + pauseSim * 0.25;
}

function computeTimbre(ref: SoundPatternV2, usr: SoundPatternV2): number {
  return 1 - Math.abs(ref.voicedRatio - usr.voicedRatio);
}

// ── DTW (Dynamic Time Warping) ──

function dtwSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const n = a.length;
  const m = b.length;
  const bandWidth = Math.max(10, Math.floor(Math.max(n, m) * 0.2));

  let prev = new Float64Array(m + 1).fill(Infinity);
  let curr = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr.fill(Infinity);
    const jStart = Math.max(1, i - bandWidth);
    const jEnd = Math.min(m, i + bandWidth);

    for (let j = jStart; j <= jEnd; j++) {
      const cost = (a[i - 1] - b[j - 1]) ** 2;
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }

    [prev, curr] = [curr, prev];
  }

  const dtwDist = prev[m];
  if (!isFinite(dtwDist)) return 0;

  const pathLen = Math.max(n, m);
  const avgDist = Math.sqrt(dtwDist / pathLen);
  const similarity = Math.exp(-avgDist * 0.7);
  return Math.max(0, Math.min(1, similarity));
}

// ── Pause Alignment ──

function comparePauses(ref: SoundPatternV2, usr: SoundPatternV2): number {
  const refPauses = ref.pausePattern;
  const usrPauses = usr.pausePattern;

  if (refPauses.length === 0 && usrPauses.length === 0) return 1;
  if (refPauses.length === 0 || usrPauses.length === 0) return 0.3;

  const refNorm = refPauses.map(p => ({ pos: p.pos / (ref.duration || 1), dur: p.dur }));
  const usrNorm = usrPauses.map(p => ({ pos: p.pos / (usr.duration || 1), dur: p.dur }));

  const tolerance = 0.1;
  let matched = 0;
  const used = new Set<number>();

  for (const rp of refNorm) {
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < usrNorm.length; j++) {
      if (used.has(j)) continue;
      const dist = Math.abs(rp.pos - usrNorm[j].pos);
      if (dist < bestDist) { bestDist = dist; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestDist <= tolerance) {
      matched++;
      used.add(bestIdx);
    }
  }

  const countSim = matched / Math.max(refNorm.length, usrNorm.length);
  const countRatio = ratioSimilarity(refPauses.length, usrPauses.length);
  return countSim * 0.7 + countRatio * 0.3;
}

// ── Helpers ──

function ratioSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  if (a === 0 || b === 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

function generateFeedback(
  scores: Record<string, number>,
  enabledKeys: string[],
  qualityFactor: number,
  qualityWarnings: string[],
): string[] {
  const feedback: string[] = [];
  feedback.push(...qualityWarnings);

  if (enabledKeys.includes('intonation')) {
    if (scores.intonation < 0.4) feedback.push('Intonation pattern differs significantly — try matching the pitch rise/fall pattern');
    else if (scores.intonation < 0.6) feedback.push('Intonation partially matches — focus on key pitch movements');
  }
  if (enabledKeys.includes('rhythmPause')) {
    if (scores.rhythmPause < 0.4) feedback.push('Rhythm and pause timing are very different from reference');
    else if (scores.rhythmPause < 0.6) feedback.push('Timing needs work — pay attention to pause placement and speech rate');
  }
  if (enabledKeys.includes('energy')) {
    if (scores.energy < 0.4) feedback.push('Energy/volume dynamics differ — match the emphasis patterns');
    else if (scores.energy < 0.6) feedback.push('Volume dynamics partially match — try more expressive delivery');
  }
  if (enabledKeys.includes('timbre')) {
    if (scores.timbre < 0.4) feedback.push('Vocal quality differs — try a similar tone');
  }

  const avg = enabledKeys.reduce((s, k) => s + scores[k], 0) / (enabledKeys.length || 1);
  if (avg >= 0.8) feedback.push('Excellent prosodic match! Great style similarity.');
  else if (avg >= 0.7) feedback.push('Good overall style match.');

  return feedback;
}
