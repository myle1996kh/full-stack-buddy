/**
 * Motion V2 Pattern Extractor — aggregate MotionFrameV2[] into MotionPatternV2.
 *
 * Follows the same approach as Sound V2's extractSoundPatternV2:
 * - Resample contours to fixed length
 * - Detect segments via state transitions
 * - Compute statistics and invariant features
 */

import type {
  MotionFrameV2,
  MotionPatternV2,
  MotionSegment,
  PoseLabel,
} from './types';
import { CONTOUR_LENGTH, JOINT_NAMES } from './types';
import { computeLimbRatios } from './featureExtractor';

// ── Resampling ──

function resampleArray(arr: number[], targetLen: number): number[] {
  if (arr.length === 0) return new Array(targetLen).fill(0);
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

// ── Segment detection via state machine ──

function detectSegments(frames: MotionFrameV2[]): MotionSegment[] {
  if (frames.length === 0) return [];

  const segments: MotionSegment[] = [];
  let currentType: PoseLabel = frames[0].poseLabel;
  let segStart = 0;

  for (let i = 1; i <= frames.length; i++) {
    const isEnd = i === frames.length;
    const changed = !isEnd && frames[i].poseLabel !== currentType;

    if (changed || isEnd) {
      const segFrames = frames.slice(segStart, i);
      const startTime = segFrames[0].t;
      const endTime = segFrames[segFrames.length - 1].t;

      // Average angles across segment frames
      const avgAngles: Record<string, number> = {};
      for (const joint of JOINT_NAMES) {
        const vals = segFrames
          .map((f) => f.jointAngles[joint])
          .filter((v) => v !== undefined);
        avgAngles[joint] =
          vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      }

      const avgVelocity =
        segFrames.reduce((s, f) => s + f.velocity, 0) / segFrames.length;

      segments.push({
        type: currentType,
        startTime,
        endTime,
        duration: endTime - startTime,
        avgAngles,
        avgVelocity,
      });

      if (!isEnd) {
        currentType = frames[i].poseLabel;
        segStart = i;
      }
    }
  }

  return segments;
}

// ── Main extraction ──

/**
 * Extract MotionPatternV2 from V2 frames.
 *
 * @param frames Extracted MotionFrameV2[] from featureExtractor
 * @param duration Total duration in seconds (from video metadata)
 * @returns MotionPatternV2 ready for comparison
 */
export function extractMotionPatternV2(
  frames: MotionFrameV2[],
  duration?: number,
): MotionPatternV2 {
  if (frames.length === 0) {
    return emptyPattern(duration ?? 0);
  }

  const actualDuration =
    duration ?? (frames[frames.length - 1].t - frames[0].t);

  // ── Angle contours (per-joint, resampled) ──
  const angleContours: Record<string, number[]> = {};
  for (const joint of JOINT_NAMES) {
    const raw = frames.map((f) => f.jointAngles[joint] ?? 0);
    angleContours[joint] = resampleArray(raw, CONTOUR_LENGTH);
  }

  // ── Velocity contour ──
  const velocityContour = resampleArray(
    frames.map((f) => f.velocity),
    CONTOUR_LENGTH,
  );

  // ── Segments ──
  const segments = detectSegments(frames);

  // ── Statistics ──
  const avgVelocity =
    frames.reduce((s, f) => s + f.velocity, 0) / frames.length;

  // Pose distribution (fraction of frames in each pose)
  const poseCounts: Record<PoseLabel, number> = {
    still: 0,
    subtle: 0,
    gesture: 0,
    movement: 0,
    active: 0,
  };
  for (const f of frames) {
    poseCounts[f.poseLabel]++;
  }
  const poseDistribution: Record<PoseLabel, number> = {
    still: poseCounts.still / frames.length,
    subtle: poseCounts.subtle / frames.length,
    gesture: poseCounts.gesture / frames.length,
    movement: poseCounts.movement / frames.length,
    active: poseCounts.active / frames.length,
  };

  const gestureSequence = segments.map((s) => s.type);

  // ── Limb ratios (from average landmarks) ──
  const framesWithLandmarks = frames.filter((f) => f.landmarks.length >= 33);
  let limbRatios: number[] = [];
  if (framesWithLandmarks.length > 0) {
    // Use middle frame for ratios (most representative)
    const midFrame =
      framesWithLandmarks[Math.floor(framesWithLandmarks.length / 2)];
    const lm = midFrame.landmarks.map((coords) => ({
      x: coords[0] ?? 0,
      y: coords[1] ?? 0,
      z: coords[2] ?? 0,
    }));
    limbRatios = computeLimbRatios(lm);
  }

  // ── Quality ──
  const avgConfidence =
    frames.reduce((s, f) => s + f.quality, 0) / frames.length;
  const missingFrameRatio =
    frames.filter((f) => f.landmarks.length < 33).length / frames.length;

  return {
    duration: actualDuration,
    angleContours,
    velocityContour,
    segments,
    avgVelocity,
    poseDistribution,
    gestureSequence,
    limbRatios,
    quality: { avgConfidence, missingFrameRatio },
  };
}

function emptyPattern(duration: number): MotionPatternV2 {
  const angleContours: Record<string, number[]> = {};
  for (const joint of JOINT_NAMES) {
    angleContours[joint] = new Array(CONTOUR_LENGTH).fill(0);
  }
  return {
    duration,
    angleContours,
    velocityContour: new Array(CONTOUR_LENGTH).fill(0),
    segments: [],
    avgVelocity: 0,
    poseDistribution: {
      still: 1,
      subtle: 0,
      gesture: 0,
      movement: 0,
      active: 0,
    },
    gestureSequence: [],
    limbRatios: [],
    quality: { avgConfidence: 0, missingFrameRatio: 1 },
  };
}
