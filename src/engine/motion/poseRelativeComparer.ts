/**
 * Pose Relative Comparer — rotation-invariant comparison using torso-relative angles.
 *
 * Best for when camera angle differs between reference and learner.
 * Uses relative angles from featureExtractor (angles relative to torso axis).
 */

import type { MotionPatternV2, MotionFrameV2 } from './types';
import { CONTOUR_LENGTH, LIMB_PAIRS } from './types';

export interface PoseRelativeParams {
  weights: Record<'upperBody' | 'lowerBody' | 'symmetry' | 'dynamics', number>;
  enabledMetrics: Record<'upperBody' | 'lowerBody' | 'symmetry' | 'dynamics', boolean>;
}

export const DEFAULT_POSE_RELATIVE_PARAMS: PoseRelativeParams = {
  weights: { upperBody: 0.35, lowerBody: 0.25, symmetry: 0.20, dynamics: 0.20 },
  enabledMetrics: { upperBody: true, lowerBody: true, symmetry: true, dynamics: true },
};

let _params: PoseRelativeParams = { ...DEFAULT_POSE_RELATIVE_PARAMS };

export function setPoseRelativeParams(params: PoseRelativeParams | undefined) {
  _params = params ? { ...params } : { ...DEFAULT_POSE_RELATIVE_PARAMS };
}

// ── Helpers ──

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
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

function meanAbsDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.abs(a[i] - b[i]);
  return total / n;
}

/**
 * Build relative angle contours from frames.
 * Returns array of contours, one per limb pair (10 total).
 */
function buildRelativeAngleContours(
  frames: MotionFrameV2[],
): number[][] {
  const limbCount = LIMB_PAIRS.length;
  const contours: number[][] = Array.from({ length: limbCount }, () => []);

  for (const f of frames) {
    if (f.relativeAngles.length >= limbCount) {
      for (let j = 0; j < limbCount; j++) {
        contours[j].push(f.relativeAngles[j]);
      }
    }
  }

  return contours;
}

// Limb indices in LIMB_PAIRS:
// 0-3: arms (left upper, left forearm, right upper, right forearm)
// 4-7: legs (left thigh, left shin, right thigh, right shin)
// 8-9: torso (left, right)
const UPPER_BODY_INDICES = [0, 1, 2, 3];
const LOWER_BODY_INDICES = [4, 5, 6, 7];
const LEFT_INDICES = [0, 1, 4, 5];
const RIGHT_INDICES = [2, 3, 6, 7];

// ── Main comparison ──

/**
 * Compare using relative angle contours.
 * Requires _v2 frames to be available for building contours.
 * Falls back to pattern-level comparison when frames aren't available.
 */
export function comparePoseRelative(
  ref: MotionPatternV2,
  learner: MotionPatternV2,
  params?: PoseRelativeParams,
  options?: {
    applyQualityPenalty?: boolean;
    refFrames?: MotionFrameV2[];
    learnerFrames?: MotionFrameV2[];
  },
): {
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
  debug?: Record<string, number>;
} {
  const p = params ?? _params;

  // Build relative angle contours from pattern's angle contours as fallback
  // When frames are available, use their relativeAngles directly
  let refContours: number[][] = [];
  let learnerContours: number[][] = [];

  if (options?.refFrames && options?.learnerFrames) {
    refContours = buildRelativeAngleContours(options.refFrames);
    learnerContours = buildRelativeAngleContours(options.learnerFrames);
  }

  const hasContours = refContours.length > 0 && learnerContours.length > 0;

  // ── Upper body score ──
  let upperBodyScore = 50;
  if (p.enabledMetrics.upperBody) {
    if (hasContours) {
      const scores: number[] = [];
      for (const idx of UPPER_BODY_INDICES) {
        if (refContours[idx]?.length > 0 && learnerContours[idx]?.length > 0) {
          const diff = meanAbsDiff(refContours[idx], learnerContours[idx]);
          scores.push(Math.max(0, 100 - diff * 200)); // diff is 0-0.5 normalized
        }
      }
      upperBodyScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 50;
    } else {
      // Fallback: use joint angle contours
      const armJoints = ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'];
      const scores: number[] = [];
      for (const joint of armJoints) {
        const r = ref.angleContours[joint];
        const l = learner.angleContours[joint];
        if (r && l) {
          const corr = (correlation(r, l) + 1) / 2 * 100;
          scores.push(corr);
        }
      }
      upperBodyScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 50;
    }
  }

  // ── Lower body score ──
  let lowerBodyScore = 50;
  if (p.enabledMetrics.lowerBody) {
    if (hasContours) {
      const scores: number[] = [];
      for (const idx of LOWER_BODY_INDICES) {
        if (refContours[idx]?.length > 0 && learnerContours[idx]?.length > 0) {
          const diff = meanAbsDiff(refContours[idx], learnerContours[idx]);
          scores.push(Math.max(0, 100 - diff * 200));
        }
      }
      lowerBodyScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 50;
    } else {
      const legJoints = ['leftKnee', 'rightKnee', 'leftHip', 'rightHip'];
      const scores: number[] = [];
      for (const joint of legJoints) {
        const r = ref.angleContours[joint];
        const l = learner.angleContours[joint];
        if (r && l) {
          scores.push((correlation(r, l) + 1) / 2 * 100);
        }
      }
      lowerBodyScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 50;
    }
  }

  // ── Symmetry score ──
  let symmetryScore = 50;
  if (p.enabledMetrics.symmetry && hasContours) {
    // Compare left-right balance for both ref and learner
    const refSymm = computeSymmetry(refContours);
    const learnerSymm = computeSymmetry(learnerContours);
    symmetryScore = Math.max(0, 100 - Math.abs(refSymm - learnerSymm) * 200);
  } else if (p.enabledMetrics.symmetry) {
    // Fallback: compare left vs right joint angle similarity
    const leftRight = [
      ['leftElbow', 'rightElbow'],
      ['leftShoulder', 'rightShoulder'],
      ['leftKnee', 'rightKnee'],
      ['leftHip', 'rightHip'],
    ];
    const scores: number[] = [];
    for (const [l, r] of leftRight) {
      const refL = ref.angleContours[l];
      const refR = ref.angleContours[r];
      const lrnL = learner.angleContours[l];
      const lrnR = learner.angleContours[r];
      if (refL && refR && lrnL && lrnR) {
        const refBalance = meanAbsDiff(refL, refR);
        const lrnBalance = meanAbsDiff(lrnL, lrnR);
        scores.push(Math.max(0, 100 - Math.abs(refBalance - lrnBalance) * 500));
      }
    }
    symmetryScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 50;
  }

  // ── Dynamics score ──
  let dynamicsScore = 50;
  if (p.enabledMetrics.dynamics) {
    const velCorr = (correlation(ref.velocityContour, learner.velocityContour) + 1) / 2 * 100;
    // Compare gesture sequence similarity
    const seqSim = lcsScore(ref.gestureSequence, learner.gestureSequence);
    dynamicsScore = velCorr * 0.5 + seqSim * 0.5;
  }

  // ── Weighted combination ──
  const scores: Record<string, number> = {
    upperBody: upperBodyScore,
    lowerBody: lowerBodyScore,
    symmetry: symmetryScore,
    dynamics: dynamicsScore,
  };

  let totalWeight = 0, weightedSum = 0;
  for (const key of ['upperBody', 'lowerBody', 'symmetry', 'dynamics'] as const) {
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
  for (const key of ['upperBody', 'lowerBody', 'symmetry', 'dynamics'] as const) {
    if (p.enabledMetrics[key]) breakdown[key] = Math.round(scores[key]);
  }

  const feedback: string[] = [];
  if (upperBodyScore < 60) feedback.push('Upper body positioning differs from reference');
  if (lowerBodyScore < 60) feedback.push('Lower body movement needs adjustment');
  if (symmetryScore < 60) feedback.push('Left-right balance differs from reference');
  if (dynamicsScore < 60) feedback.push('Movement timing and flow need work');
  if (score >= 80) feedback.push('Excellent rotation-invariant pose match!');

  return { score, breakdown, feedback };
}

// ── Utility ──

function computeSymmetry(contours: number[][]): number {
  // Average difference between left and right limbs
  let total = 0, count = 0;
  for (let i = 0; i < LEFT_INDICES.length; i++) {
    const l = contours[LEFT_INDICES[i]];
    const r = contours[RIGHT_INDICES[i]];
    if (l?.length > 0 && r?.length > 0) {
      total += meanAbsDiff(l, r);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
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
