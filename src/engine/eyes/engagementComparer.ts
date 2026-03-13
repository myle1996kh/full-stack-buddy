/**
 * Engagement Score Comparer — measures overall visual engagement.
 *
 * Combines: gaze contact, head pose, blink rate, expressiveness.
 * Best for presentation and speaking training.
 */

import type { EyesPatternV2 } from './types';

export interface EngagementParams {
  weights: Record<'gazeContact' | 'headPose' | 'blinkRate' | 'blinkConsistency' | 'expressiveness', number>;
  enabledMetrics: Record<'gazeContact' | 'headPose' | 'blinkRate' | 'blinkConsistency' | 'expressiveness', boolean>;
}

export const DEFAULT_ENGAGEMENT_PARAMS: EngagementParams = {
  weights: { gazeContact: 0.30, headPose: 0.25, blinkRate: 0.15, blinkConsistency: 0.10, expressiveness: 0.20 },
  enabledMetrics: { gazeContact: true, headPose: true, blinkRate: true, blinkConsistency: true, expressiveness: true },
};

let _params: EngagementParams = { ...DEFAULT_ENGAGEMENT_PARAMS };

export function setEngagementParams(params: EngagementParams | undefined) {
  _params = params ? { ...params } : { ...DEFAULT_ENGAGEMENT_PARAMS };
}

// Normal blink rate range (blinks per minute)
const NORMAL_BLINK_MIN = 12;
const NORMAL_BLINK_MAX = 20;
// Normal blink duration range (seconds)
const NORMAL_BLINK_DURATION_MIN = 0.1;
const NORMAL_BLINK_DURATION_MAX = 0.4;

// ── Main comparison ──

export function compareEngagement(
  ref: EyesPatternV2,
  learner: EyesPatternV2,
  params?: EngagementParams,
  options?: { applyQualityPenalty?: boolean },
): {
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
} {
  const p = params ?? _params;

  // ── Gaze contact: time spent looking at center zone ──
  let gazeContactScore = 50;
  if (p.enabledMetrics.gazeContact) {
    const refCenter = ref.zoneDwellTimes['center'] || 0;
    const learnerCenter = learner.zoneDwellTimes['center'] || 0;
    if (refCenter > 0) {
      gazeContactScore = Math.max(0, 100 - Math.abs(refCenter - learnerCenter) / refCenter * 100);
    } else {
      // No center gaze in reference — just measure learner's center time
      gazeContactScore = Math.min(100, learnerCenter * 200);
    }
  }

  // ── Head pose: orientation match ──
  let headPoseScore = 50;
  if (p.enabledMetrics.headPose) {
    const yawDiff = Math.abs(ref.headPoseProfile.avgYaw - learner.headPoseProfile.avgYaw);
    const pitchDiff = Math.abs(ref.headPoseProfile.avgPitch - learner.headPoseProfile.avgPitch);
    const yawSim = Math.max(0, 100 - yawDiff * 100);
    const pitchSim = Math.max(0, 100 - pitchDiff * 100);

    // Also compare stability
    const stabDiff = Math.abs(
      (ref.headPoseProfile.yawStability + ref.headPoseProfile.pitchStability) -
      (learner.headPoseProfile.yawStability + learner.headPoseProfile.pitchStability),
    );
    const stabSim = Math.max(0, 100 - stabDiff * 200);

    headPoseScore = yawSim * 0.35 + pitchSim * 0.35 + stabSim * 0.3;
  }

  // ── Blink rate: should be in normal range ──
  let blinkRateScore = 50;
  let blinkConsistencyScore = 50;
  if (p.enabledMetrics.blinkRate) {
    const refRate = ref.blinkRate;
    const learnerRate = learner.blinkRate;

    if (refRate > 0) {
      // Match reference blink rate
      blinkRateScore = Math.max(0, 100 - Math.abs(refRate - learnerRate) / Math.max(refRate, 1) * 80);
    } else {
      // No blink data in reference — check if learner is in normal range
      if (learnerRate >= NORMAL_BLINK_MIN && learnerRate <= NORMAL_BLINK_MAX) {
        blinkRateScore = 100;
      } else if (learnerRate > 0) {
        const distFromNormal = learnerRate < NORMAL_BLINK_MIN
          ? NORMAL_BLINK_MIN - learnerRate
          : learnerRate - NORMAL_BLINK_MAX;
        blinkRateScore = Math.max(0, 100 - distFromNormal * 5);
      } else {
        blinkRateScore = 50; // no blink data
      }
    }
  }
  
  // ── Blink consistency: duration and rate variability ──
  if (p.enabledMetrics.blinkConsistency && ref.blinkMetrics) {
    // Blink duration consistency
    const refAvgDuration = ref.blinkMetrics.avgDuration || 0.2;
    const learnerAvgDuration = learner.blinkMetrics.avgDuration || 0;
    let durationScore = 50;
    if (refAvgDuration > 0) {
      durationScore = Math.max(0, 100 - Math.abs(refAvgDuration - learnerAvgDuration) / Math.max(refAvgDuration, 0.01) * 100);
    } else {
      // Check if learner duration is in normal range
      if (learnerAvgDuration >= NORMAL_BLINK_DURATION_MIN && learnerAvgDuration <= NORMAL_BLINK_DURATION_MAX) {
        durationScore = 100;
      } else if (learnerAvgDuration > 0) {
        const distFromNormal = learnerAvgDuration < NORMAL_BLINK_DURATION_MIN
          ? NORMAL_BLINK_DURATION_MIN - learnerAvgDuration
          : learnerAvgDuration - NORMAL_BLINK_DURATION_MAX;
        durationScore = Math.max(0, 100 - distFromNormal * 200); // stricter for duration
      }
    }
    
    // Blink rate variability (lower variability is better)
    let variabilityScore = 50;
    if (ref.blinkMetrics.rateVariability >= 0 && learner.blinkMetrics.rateVariability >= 0) {
      const refVariability = ref.blinkMetrics.rateVariability;
      const learnerVariability = learner.blinkMetrics.rateVariability;
      if (refVariability > 0) {
        variabilityScore = Math.max(0, 100 - Math.abs(refVariability - learnerVariability) / Math.max(refVariability, 0.01) * 100);
      } else {
        // Reference has no variability - check if learner variability is low
        variabilityScore = Math.max(0, 100 - learnerVariability * 200); // lower is better
      }
    }
    
    blinkConsistencyScore = (durationScore + variabilityScore) / 2;
  }

  // ── Expressiveness: gaze movement range (not too static, not too erratic) ──
  let expressivenessScore = 50;
  if (p.enabledMetrics.expressiveness) {
    // Compare zone transition frequency relative to duration
    const refTransRate = ref.duration > 0 ? ref.zoneSequence.length / ref.duration : 0;
    const learnerTransRate = learner.duration > 0 ? learner.zoneSequence.length / learner.duration : 0;

    if (refTransRate > 0) {
      expressivenessScore = Math.max(0, 100 - Math.abs(refTransRate - learnerTransRate) / refTransRate * 100);
    } else {
      expressivenessScore = learnerTransRate < 1 ? 80 : Math.max(0, 100 - learnerTransRate * 20);
    }

    // Also factor in gaze range (how much of the gaze space is used)
    const refZoneCount = Object.keys(ref.zoneDwellTimes).length;
    const learnerZoneCount = Object.keys(learner.zoneDwellTimes).length;
    const rangeMatch = Math.max(refZoneCount, learnerZoneCount) > 0
      ? Math.max(0, 100 - Math.abs(refZoneCount - learnerZoneCount) / Math.max(refZoneCount, learnerZoneCount) * 100)
      : 100;

    expressivenessScore = expressivenessScore * 0.6 + rangeMatch * 0.4;
  }

  // ── Weighted combination ──
  const scores: Record<string, number> = {
    gazeContact: gazeContactScore,
    headPose: headPoseScore,
    blinkRate: blinkRateScore,
    blinkConsistency: blinkConsistencyScore,
    expressiveness: expressivenessScore,
  };

  let totalWeight = 0, weightedSum = 0;
  for (const key of ['gazeContact', 'headPose', 'blinkRate', 'blinkConsistency', 'expressiveness'] as const) {
    if (p.enabledMetrics[key]) {
      weightedSum += scores[key] * p.weights[key];
      totalWeight += p.weights[key];
    }
  }

  let rawScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

  if (options?.applyQualityPenalty !== false) {
    const qualityFactor = Math.max(0.5, learner.quality.faceDetectedRatio);
    rawScore *= qualityFactor;
  }

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const breakdown: Record<string, number> = {};
  for (const key of ['gazeContact', 'headPose', 'blinkRate', 'expressiveness'] as const) {
    if (p.enabledMetrics[key]) breakdown[key] = Math.round(scores[key]);
  }

  const feedback: string[] = [];
  if (gazeContactScore < 60) feedback.push('Try maintaining more eye contact (center gaze)');
  if (headPoseScore < 60) feedback.push('Head orientation differs — face the camera more directly');
  if (blinkRateScore < 60) {
    if (learner.blinkRate < NORMAL_BLINK_MIN) feedback.push('Blink rate is low — try to blink naturally');
    else if (learner.blinkRate > NORMAL_BLINK_MAX) feedback.push('Blinking too frequently — stay relaxed');
    else feedback.push('Blink rate differs from reference');
  }
  if (expressivenessScore < 60) feedback.push('Gaze expressiveness differs — vary your gaze naturally');
  if (score >= 80) feedback.push('Excellent visual engagement!');

  return { score, breakdown, feedback };
}
