/**
 * Pose Angles Comparer (DEFAULT) — joint angle similarity with temporal alignment.
 *
 * Reuses poseComparer.ts logic, wired into module comparer format.
 * Compares per-joint angle contours + timing + overall pose distribution.
 */

import type { MotionPatternV2 } from './types';
import { CONTOUR_LENGTH, JOINT_NAMES } from './types';

export interface PoseAnglesParams {
  weights: Record<'arms' | 'legs' | 'torso' | 'timing', number>;
  enabledMetrics: Record<'arms' | 'legs' | 'torso' | 'timing', boolean>;
  powerCurve: number; // 1.0 - 2.0 (discriminability boost)
}

export const DEFAULT_POSE_ANGLES_PARAMS: PoseAnglesParams = {
  weights: { arms: 0.30, legs: 0.25, torso: 0.20, timing: 0.25 },
  enabledMetrics: { arms: true, legs: true, torso: true, timing: true },
  powerCurve: 1.5,
};

let _params: PoseAnglesParams = { ...DEFAULT_POSE_ANGLES_PARAMS };

export function setPoseAnglesParams(params: PoseAnglesParams | undefined) {
  _params = params ? { ...params } : { ...DEFAULT_POSE_ANGLES_PARAMS };
}

export function getPoseAnglesParams(): PoseAnglesParams {
  return _params;
}

// ── Helpers ──

/** Correlation coefficient between two arrays */
function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n, meanB = sumB / n;

  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

/** Mean absolute difference between two contours, normalized to 0-100 score */
function contourSimilarity(a: number[], b: number[], maxDiff: number): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 50;

  let totalDiff = 0;
  for (let i = 0; i < n; i++) {
    totalDiff += Math.abs(a[i] - b[i]);
  }
  const avgDiff = totalDiff / n;
  return Math.max(0, 100 - (avgDiff / maxDiff) * 100);
}

/** Compare pose distribution vectors (cosine similarity) */
function distributionSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, magA = 0, magB = 0;
  keys.forEach((k) => {
    const va = a[k] || 0, vb = b[k] || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  });
  if (magA === 0 || magB === 0) return 0;
  return (dot / (Math.sqrt(magA) * Math.sqrt(magB))) * 100;
}

// ── Joint groups ──

const ARM_JOINTS = ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'];
const LEG_JOINTS = ['leftKnee', 'rightKnee', 'leftHip', 'rightHip'];

// ── Main comparison ──

export function comparePoseAngles(
  ref: MotionPatternV2,
  learner: MotionPatternV2,
  params?: PoseAnglesParams,
  options?: { applyQualityPenalty?: boolean },
): {
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
  debug?: Record<string, number>;
} {
  const p = params ?? _params;
  const maxAngleDiff = 60; // degrees — max meaningful difference

  // ── Arms score: elbow + shoulder contours ──
  let armsScore = 50;
  if (p.enabledMetrics.arms) {
    const armScores: number[] = [];
    for (const joint of ARM_JOINTS) {
      const refContour = ref.angleContours[joint];
      const learnerContour = learner.angleContours[joint];
      if (refContour && learnerContour) {
        armScores.push(contourSimilarity(refContour, learnerContour, maxAngleDiff));
      }
    }
    armsScore = armScores.length > 0
      ? armScores.reduce((a, b) => a + b, 0) / armScores.length
      : 50;
  }

  // ── Legs score: knee + hip contours ──
  let legsScore = 50;
  if (p.enabledMetrics.legs) {
    const legScores: number[] = [];
    for (const joint of LEG_JOINTS) {
      const refContour = ref.angleContours[joint];
      const learnerContour = learner.angleContours[joint];
      if (refContour && learnerContour) {
        legScores.push(contourSimilarity(refContour, learnerContour, maxAngleDiff));
      }
    }
    legsScore = legScores.length > 0
      ? legScores.reduce((a, b) => a + b, 0) / legScores.length
      : 50;
  }

  // ── Torso score: pose distribution + velocity similarity ──
  let torsoScore = 50;
  if (p.enabledMetrics.torso) {
    const distSim = distributionSimilarity(
      ref.poseDistribution,
      learner.poseDistribution,
    );
    const velSim = contourSimilarity(
      ref.velocityContour,
      learner.velocityContour,
      0.5,
    );
    torsoScore = distSim * 0.5 + velSim * 0.5;
  }

  // ── Timing score: temporal correlation of velocity + angle changes ──
  let timingScore = 50;
  if (p.enabledMetrics.timing) {
    const velCorr = (correlation(ref.velocityContour, learner.velocityContour) + 1) / 2 * 100;
    // Average angle contour correlation
    const angleCorrs: number[] = [];
    for (const joint of JOINT_NAMES) {
      const r = ref.angleContours[joint];
      const l = learner.angleContours[joint];
      if (r && l) {
        angleCorrs.push((correlation(r, l) + 1) / 2 * 100);
      }
    }
    const avgAngleCorr = angleCorrs.length > 0
      ? angleCorrs.reduce((a, b) => a + b, 0) / angleCorrs.length
      : 50;
    timingScore = velCorr * 0.4 + avgAngleCorr * 0.6;
  }

  // ── Weighted combination ──
  const scores: Record<string, number> = {
    arms: armsScore,
    legs: legsScore,
    torso: torsoScore,
    timing: timingScore,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const key of ['arms', 'legs', 'torso', 'timing'] as const) {
    if (p.enabledMetrics[key]) {
      weightedSum += scores[key] * p.weights[key];
      totalWeight += p.weights[key];
    }
  }

  let rawScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

  // Power curve for discriminability
  rawScore = Math.pow(rawScore / 100, p.powerCurve) * 100;

  // Quality penalty
  if (options?.applyQualityPenalty !== false) {
    const qualityFactor = Math.max(0.5, 1 - learner.quality.missingFrameRatio);
    rawScore *= qualityFactor;
  }

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  // ── Breakdown ──
  const breakdown: Record<string, number> = {};
  for (const key of ['arms', 'legs', 'torso', 'timing'] as const) {
    if (p.enabledMetrics[key]) {
      breakdown[key] = Math.round(scores[key]);
    }
  }

  // ── Feedback ──
  const feedback: string[] = [];
  const weakest = Object.entries(breakdown).sort(([, a], [, b]) => a - b);
  if (weakest.length > 0 && weakest[0][1] < 60) {
    feedback.push(`Focus on improving your ${weakest[0][0]} positioning`);
  }
  if (weakest.length > 1 && weakest[1][1] < 60) {
    feedback.push(`Also work on ${weakest[1][0]}`);
  }
  if (score >= 80) feedback.push('Excellent pose match!');
  else if (score >= 60) feedback.push('Good form — keep refining');

  // ── Debug ──
  const debug: Record<string, number> = {
    rawArms: Math.round(armsScore),
    rawLegs: Math.round(legsScore),
    rawTorso: Math.round(torsoScore),
    rawTiming: Math.round(timingScore),
    powerCurve: p.powerCurve,
    qualityPenalty: options?.applyQualityPenalty !== false
      ? Math.round((1 - learner.quality.missingFrameRatio) * 100)
      : 100,
  };

  return { score, breakdown, feedback, debug };
}
