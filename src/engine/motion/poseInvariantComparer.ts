/**
 * Pose Invariant Comparer — most robust comparison using multi-feature invariants.
 *
 * Handles: scale + rotation + body size differences.
 * From my-pose's INVARIANT_FEATURES approach: limb ratios + relative angles + topology.
 */

import type { MotionPatternV2 } from './types';

export interface PoseInvariantParams {
  weights: Record<'proportions' | 'angles' | 'topology' | 'dynamics', number>;
  enabledMetrics: Record<'proportions' | 'angles' | 'topology' | 'dynamics', boolean>;
}

export const DEFAULT_POSE_INVARIANT_PARAMS: PoseInvariantParams = {
  weights: { proportions: 0.25, angles: 0.30, topology: 0.20, dynamics: 0.25 },
  enabledMetrics: { proportions: true, angles: true, topology: true, dynamics: true },
};

let _params: PoseInvariantParams = { ...DEFAULT_POSE_INVARIANT_PARAMS };

export function setPoseInvariantParams(params: PoseInvariantParams | undefined) {
  _params = params ? { ...params } : { ...DEFAULT_POSE_INVARIANT_PARAMS };
}

// ── Helpers ──

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
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

// ── Main comparison ──

export function comparePoseInvariant(
  ref: MotionPatternV2,
  learner: MotionPatternV2,
  params?: PoseInvariantParams,
  options?: { applyQualityPenalty?: boolean },
): {
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
  debug?: Record<string, number>;
} {
  const p = params ?? _params;

  // ── Proportions: compare limb length ratios (scale-invariant) ──
  let proportionsScore = 50;
  if (p.enabledMetrics.proportions) {
    if (ref.limbRatios.length > 0 && learner.limbRatios.length > 0) {
      const sim = cosineSimilarity(ref.limbRatios, learner.limbRatios);
      // Boost: ratios are naturally similar, use power curve
      proportionsScore = Math.pow(Math.max(0, sim), 2) * 100;
    }
  }

  // ── Angles: compare per-joint angle contours (correlation) ──
  let anglesScore = 50;
  if (p.enabledMetrics.angles) {
    const jointCorrelations: number[] = [];
    for (const joint of Object.keys(ref.angleContours)) {
      const r = ref.angleContours[joint];
      const l = learner.angleContours[joint];
      if (r && l) {
        const corr = (correlation(r, l) + 1) / 2; // 0-1
        jointCorrelations.push(corr * 100);
      }
    }
    anglesScore = jointCorrelations.length > 0
      ? jointCorrelations.reduce((a, b) => a + b, 0) / jointCorrelations.length
      : 50;
  }

  // ── Topology: compare spatial relationships (pose distribution + segment patterns) ──
  let topologyScore = 50;
  if (p.enabledMetrics.topology) {
    // Pose distribution similarity
    const refDist = Object.values(ref.poseDistribution);
    const learnerDist = Object.values(learner.poseDistribution);
    const distSim = cosineSimilarity(refDist, learnerDist) * 100;

    // Segment count similarity
    const refSegCount = ref.segments.length;
    const learnerSegCount = learner.segments.length;
    const countSim = refSegCount > 0
      ? Math.max(0, 100 - Math.abs(refSegCount - learnerSegCount) / Math.max(refSegCount, learnerSegCount) * 100)
      : learnerSegCount === 0 ? 100 : 30;

    topologyScore = distSim * 0.6 + countSim * 0.4;
  }

  // ── Dynamics: movement patterns + gesture sequence ──
  let dynamicsScore = 50;
  if (p.enabledMetrics.dynamics) {
    // Velocity contour correlation
    const velCorr = (correlation(ref.velocityContour, learner.velocityContour) + 1) / 2 * 100;

    // Gesture sequence matching (LCS)
    const seqScore = lcsScore(ref.gestureSequence, learner.gestureSequence);

    // Average velocity similarity
    const velSim = ref.avgVelocity > 0
      ? Math.max(0, 100 - Math.abs(ref.avgVelocity - learner.avgVelocity) / Math.max(ref.avgVelocity, 0.01) * 100)
      : learner.avgVelocity === 0 ? 100 : 50;

    dynamicsScore = velCorr * 0.4 + seqScore * 0.3 + velSim * 0.3;
  }

  // ── Weighted combination ──
  const scores: Record<string, number> = {
    proportions: proportionsScore,
    angles: anglesScore,
    topology: topologyScore,
    dynamics: dynamicsScore,
  };

  let totalWeight = 0, weightedSum = 0;
  for (const key of ['proportions', 'angles', 'topology', 'dynamics'] as const) {
    if (p.enabledMetrics[key]) {
      weightedSum += scores[key] * p.weights[key];
      totalWeight += p.weights[key];
    }
  }

  let rawScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

  if (options?.applyQualityPenalty !== false) {
    const qualityFactor = Math.max(0.5, 1 - learner.quality.missingFrameRatio);
    rawScore *= qualityFactor;
  }

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const breakdown: Record<string, number> = {};
  for (const key of ['proportions', 'angles', 'topology', 'dynamics'] as const) {
    if (p.enabledMetrics[key]) breakdown[key] = Math.round(scores[key]);
  }

  const feedback: string[] = [];
  if (proportionsScore < 60) feedback.push('Body proportions differ — try adjusting your stance');
  if (anglesScore < 60) feedback.push('Joint angles need improvement');
  if (topologyScore < 60) feedback.push('Overall pose structure differs from reference');
  if (dynamicsScore < 60) feedback.push('Movement pattern and timing need adjustment');
  if (score >= 80) feedback.push('Excellent invariant match — great form regardless of camera!');

  return { score, breakdown, feedback };
}
