/**
 * Gaze Pattern Comparer (DEFAULT) — zone distribution + sequence + focus quality.
 *
 * Upgraded from the original multi-feature comparer with configurable weights.
 */

import type { EyesPatternV2 } from './types';

export interface GazePatternParams {
  weights: Record<'zoneMatch' | 'sequence' | 'focus' | 'stability' | 'engagement', number>;
  enabledMetrics: Record<'zoneMatch' | 'sequence' | 'focus' | 'stability' | 'engagement', boolean>;
}

export const DEFAULT_GAZE_PATTERN_PARAMS: GazePatternParams = {
  weights: { zoneMatch: 0.30, sequence: 0.25, focus: 0.20, stability: 0.15, engagement: 0.10 },
  enabledMetrics: { zoneMatch: true, sequence: true, focus: true, stability: true, engagement: true },
};

let _params: GazePatternParams = { ...DEFAULT_GAZE_PATTERN_PARAMS };

export function setGazePatternParams(params: GazePatternParams | undefined) {
  _params = params ? { ...params } : { ...DEFAULT_GAZE_PATTERN_PARAMS };
}

// ── Helpers ──

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function lcsScore(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 30;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (dp[m][n] / Math.max(m, n)) * 100;
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n, meanB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  return Math.sqrt(denA * denB) > 0 ? num / Math.sqrt(denA * denB) : 0;
}

// ── Main comparison ──

export function compareGazePattern(
  ref: EyesPatternV2,
  learner: EyesPatternV2,
  params?: GazePatternParams,
  options?: { applyQualityPenalty?: boolean },
): {
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
  debug?: Record<string, number>;
} {
  const p = params ?? _params;

  // ── Zone match: compare zone dwell time distributions ──
  let zoneMatchScore = 50;
  if (p.enabledMetrics.zoneMatch) {
    const allZones = new Set([
      ...Object.keys(ref.zoneDwellTimes),
      ...Object.keys(learner.zoneDwellTimes),
    ]);
    const refVec: number[] = [];
    const learnerVec: number[] = [];
    allZones.forEach((zone) => {
      refVec.push(ref.zoneDwellTimes[zone] || 0);
      learnerVec.push(learner.zoneDwellTimes[zone] || 0);
    });
    zoneMatchScore = cosineSimilarity(refVec, learnerVec) * 100;
  }

  // ── Sequence: compare zone transition sequences ──
  let sequenceScore = 50;
  if (p.enabledMetrics.sequence) {
    sequenceScore = lcsScore(ref.zoneSequence, learner.zoneSequence);
  }

  // ── Focus: compare fixation duration ──
  let focusScore = 50;
  if (p.enabledMetrics.focus) {
    if (ref.avgFixationDuration > 0) {
      const diff = Math.abs(ref.avgFixationDuration - learner.avgFixationDuration);
      focusScore = Math.max(0, 100 - (diff / ref.avgFixationDuration) * 100);
    } else {
      focusScore = learner.avgFixationDuration === 0 ? 100 : 50;
    }
  }

  // ── Stability: gaze contour correlation (smooth = stable) ──
  let stabilityScore = 50;
  if (p.enabledMetrics.stability) {
    const corrX = (correlation(ref.gazeContourX, learner.gazeContourX) + 1) / 2 * 100;
    const corrY = (correlation(ref.gazeContourY, learner.gazeContourY) + 1) / 2 * 100;
    stabilityScore = (corrX + corrY) / 2;
  }

  // ── Engagement: primary zone + face presence ──
  let engagementScore = 50;
  if (p.enabledMetrics.engagement) {
    const primaryMatch = ref.primaryZone === learner.primaryZone ? 100 : 40;
    const facePresence = Math.min(100, learner.quality.faceDetectedRatio * 100);
    engagementScore = primaryMatch * 0.6 + facePresence * 0.4;
  }

  // ── Weighted combination ──
  const scores: Record<string, number> = {
    zoneMatch: zoneMatchScore,
    sequence: sequenceScore,
    focus: focusScore,
    stability: stabilityScore,
    engagement: engagementScore,
  };

  let totalWeight = 0, weightedSum = 0;
  for (const key of ['zoneMatch', 'sequence', 'focus', 'stability', 'engagement'] as const) {
    if (p.enabledMetrics[key]) {
      weightedSum += scores[key] * p.weights[key];
      totalWeight += p.weights[key];
    }
  }

  let rawScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

  // Quality penalty for low face detection
  if (options?.applyQualityPenalty !== false) {
    const qualityFactor = Math.max(0.5, learner.quality.faceDetectedRatio);
    rawScore *= qualityFactor;
  }

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const breakdown: Record<string, number> = {};
  for (const key of ['zoneMatch', 'sequence', 'focus', 'stability', 'engagement'] as const) {
    if (p.enabledMetrics[key]) breakdown[key] = Math.round(scores[key]);
  }

  const feedback: string[] = [];
  if (zoneMatchScore < 60) feedback.push('Gaze distribution differs from reference');
  if (sequenceScore < 60) feedback.push('Eye movement pattern is different');
  if (focusScore < 60) feedback.push('Focus duration differs — try steady gaze');
  if (stabilityScore < 60) feedback.push('Gaze stability needs improvement');
  if (engagementScore < 60) feedback.push(`Try focusing more on the "${ref.primaryZone}" zone`);
  if (score >= 80) feedback.push('Excellent eye contact pattern!');

  return { score, breakdown, feedback };
}
