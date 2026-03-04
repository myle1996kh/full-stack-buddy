/**
 * Style comparer V2: cross-language prosodic similarity using DTW + Pearson correlation.
 * Fully deterministic — no randomness.
 * Supports dynamic metric weights and toggling.
 *
 * Key discrimination mechanisms:
 * - DTW with steeper penalty curve (exp coefficient 1.5)
 * - Pearson correlation for contour shape matching
 * - Combined DTW×Correlation for each contour comparison
 * - Stricter rhythm/pause alignment
 */

import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';

// Default weights
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
 */
export function compareSoundStyle(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
  customWeights?: MetricWeights,
): SoundCompareResultV2 {
  const rawScores = {
    intonation: computeIntonation(ref, usr),
    rhythmPause: computeRhythmPause(ref, usr),
    energy: computeEnergy(ref, usr),
    timbre: computeTimbre(ref, usr),
  };

  const metrics: MetricWeights = customWeights ?? {
    intonation: { enabled: true, weight: DEFAULT_WEIGHTS.intonation },
    rhythmPause: { enabled: true, weight: DEFAULT_WEIGHTS.rhythmPause },
    energy: { enabled: true, weight: DEFAULT_WEIGHTS.energy },
    timbre: { enabled: true, weight: DEFAULT_WEIGHTS.timbre },
  };

  const normWeights = normalizeWeights(metrics);
  const enabledKeys = Object.keys(normWeights);

  const refQuality = evaluateQuality(ref);
  const usrQuality = evaluateQuality(usr);
  const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

  // Score = weighted average of enabled sub-scores
  let base = 0;
  for (const key of enabledKeys) {
    base += rawScores[key as keyof typeof rawScores] * normWeights[key];
  }

  // Discrimination calibration: low core prosody dimensions should cap the final score.
  const coreKeys = enabledKeys.filter((k) => k === 'intonation' || k === 'rhythmPause' || k === 'energy');
  const coreMin = coreKeys.length > 0
    ? Math.min(...coreKeys.map((k) => rawScores[k as keyof typeof rawScores]))
    : 1;
  const discriminationFactor = 0.55 + 0.45 * coreMin;

  const score = Math.round(Math.max(0, Math.min(100, base * discriminationFactor * 100)));

  const breakdown: Record<string, number> = {};
  for (const key of enabledKeys) {
    breakdown[key] = Math.round(rawScores[key as keyof typeof rawScores] * 100);
  }

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
  // Combine DTW distance + Pearson correlation for robust shape matching
  const contourSim = contourSimilarity(ref.pitchContourNorm, usr.pitchContourNorm);
  const slopeSim = contourSimilarity(ref.pitchSlope, usr.pitchSlope);
  return contourSim * 0.6 + slopeSim * 0.4;
}

function computeEnergy(ref: SoundPatternV2, usr: SoundPatternV2): number {
  return contourSimilarity(ref.energyContourNorm, usr.energyContourNorm);
}

function computeRhythmPause(ref: SoundPatternV2, usr: SoundPatternV2): number {
  // Unknown rhythm cues should not boost score; use conservative neutral defaults.
  const speechRateKnown = ref.speechRate > 0.2 && usr.speechRate > 0.2;
  const speechRateSim = speechRateKnown
    ? strictRatioSimilarity(ref.speechRate, usr.speechRate)
    : 0.45;

  const regularityKnown = ref.regularity > 0.05 || usr.regularity > 0.05;
  const regularitySim = regularityKnown
    ? Math.max(0, 1 - Math.abs(ref.regularity - usr.regularity) * 2)
    : 0.45;

  const ioiKnown = ref.avgIOI > 0 && usr.avgIOI > 0;
  const ioiSim = ioiKnown
    ? strictRatioSimilarity(ref.avgIOI, usr.avgIOI)
    : 0.45;

  const pauseSim = comparePauses(ref, usr);
  return speechRateSim * 0.3 + regularitySim * 0.2 + ioiSim * 0.25 + pauseSim * 0.25;
}

function computeTimbre(ref: SoundPatternV2, usr: SoundPatternV2): number {
  // Multi-factor timbre: voiced ratio + energy variance similarity + pitch range similarity
  const voicedSim = Math.max(0, 1 - Math.abs(ref.voicedRatio - usr.voicedRatio) * 3);

  // Pitch range similarity (using pitch contour variance as proxy)
  const refPitchVar = variance(ref.pitchContourNorm);
  const usrPitchVar = variance(usr.pitchContourNorm);
  const pitchRangeSim = strictRatioSimilarity(
    Math.sqrt(refPitchVar) + 0.01,
    Math.sqrt(usrPitchVar) + 0.01,
  );

  // Energy dynamics similarity (variance of energy contour)
  const refEnergyVar = variance(ref.energyContourNorm);
  const usrEnergyVar = variance(usr.energyContourNorm);
  const energyDynSim = strictRatioSimilarity(
    Math.sqrt(refEnergyVar) + 0.01,
    Math.sqrt(usrEnergyVar) + 0.01,
  );

  return voicedSim * 0.3 + pitchRangeSim * 0.35 + energyDynSim * 0.35;
}

// ── Contour Similarity (DTW × Pearson) ──

/**
 * Combined similarity using both DTW distance and Pearson correlation.
 * DTW captures temporal alignment tolerance.
 * Pearson captures overall shape agreement.
 * Final = geometric mean for strong discrimination.
 */
function contourSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const aStable = stabilizeContour(a);
  const bStable = stabilizeContour(b);

  const dtwSim = dtwToSimilarity(aStable, bStable);
  const pearson = pearsonCorrelation(aStable, bStable);
  // Convert Pearson (-1..1) to similarity (0..1): only positive correlation counts
  const pearsonSim = Math.max(0, pearson);

  // Geometric mean: both must be high for a high score
  // This strongly penalizes when either metric is low
  return Math.sqrt(dtwSim * pearsonSim);
}

// ── DTW ──

function dtwToSimilarity(a: number[], b: number[]): number {
  const n = a.length;
  const m = b.length;
  const bandWidth = Math.max(10, Math.floor(Math.max(n, m) * 0.15));

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

  // Steeper decay: coefficient 1.5 (was 0.7)
  // dist=0 → 1.0, dist=0.5 → 0.47, dist=1.0 → 0.22, dist=2.0 → 0.05
  const similarity = Math.exp(-avgDist * 1.5);
  return Math.max(0, Math.min(1, similarity));
}

// ── Pearson Correlation ──

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-10) {
    // Flat/near-flat contours: treat near-identical as perfect, otherwise unknown mismatch.
    const mae = meanAbsoluteError(a, b);
    return mae < 1e-3 ? 1 : 0;
  }
  return cov / denom;
}

// ── Pause Alignment ──

function comparePauses(ref: SoundPatternV2, usr: SoundPatternV2): number {
  const refPauses = ref.pausePattern;
  const usrPauses = usr.pausePattern;

  if (refPauses.length === 0 && usrPauses.length === 0) return 1;
  if (refPauses.length === 0 || usrPauses.length === 0) return 0.2;

  const refNorm = refPauses.map(p => ({ pos: p.pos / (ref.duration || 1), dur: p.dur }));
  const usrNorm = usrPauses.map(p => ({ pos: p.pos / (usr.duration || 1), dur: p.dur }));

  const tolerance = 0.08; // Stricter: 8% position tolerance (was 10%)
  let matched = 0;
  let durSim = 0;
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
      // Also compare pause duration
      durSim += strictRatioSimilarity(rp.dur, usrNorm[bestIdx].dur);
      used.add(bestIdx);
    }
  }

  const maxPauses = Math.max(refNorm.length, usrNorm.length);
  const positionSim = matched / maxPauses;
  const avgDurSim = matched > 0 ? durSim / matched : 0;
  const countPenalty = strictRatioSimilarity(refPauses.length, usrPauses.length);

  return positionSim * 0.5 + avgDurSim * 0.2 + countPenalty * 0.3;
}

// ── Helpers ──

/**
 * Stricter ratio similarity using quadratic falloff.
 * ratio=1 → 1.0, ratio=0.5 → 0.25, ratio=0.33 → 0.11
 */
function strictRatioSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  if (a === 0 || b === 0) return 0;
  const ratio = Math.min(a, b) / Math.max(a, b);
  return ratio * ratio; // Quadratic: penalizes differences more
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
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
    if (scores.intonation < 0.3) feedback.push('Intonation pattern is very different — the pitch rise/fall shape doesn\'t match');
    else if (scores.intonation < 0.5) feedback.push('Intonation partially matches — focus on mimicking the melody of speech');
  }
  if (enabledKeys.includes('rhythmPause')) {
    if (scores.rhythmPause < 0.3) feedback.push('Rhythm and pause timing are very different');
    else if (scores.rhythmPause < 0.5) feedback.push('Timing needs work — match the pause placement and speaking speed');
  }
  if (enabledKeys.includes('energy')) {
    if (scores.energy < 0.3) feedback.push('Volume/emphasis pattern is very different from reference');
    else if (scores.energy < 0.5) feedback.push('Try matching the loud/soft dynamics more closely');
  }
  if (enabledKeys.includes('timbre')) {
    if (scores.timbre < 0.3) feedback.push('Vocal character differs significantly — try matching the expressiveness level');
    else if (scores.timbre < 0.5) feedback.push('Vocal dynamics partially match');
  }

  const avg = enabledKeys.reduce((s, k) => s + scores[k], 0) / (enabledKeys.length || 1);
  if (avg >= 0.8) feedback.push('Excellent prosodic match! Very similar speaking style.');
  else if (avg >= 0.65) feedback.push('Good style similarity overall.');
  else if (avg >= 0.5) feedback.push('Moderate similarity — keep practicing the style.');

  return feedback;
}
