/**
 * Motion V2 Feature Extractor — per-frame feature extraction from MediaPipe landmarks.
 *
 * Reuses joint angle logic from poseComparer.ts and adds:
 * - Torso-relative angles (rotation invariant, from my-pose approach)
 * - Proper velocity computation (landmark displacement)
 * - Quality scoring from landmark confidence
 */

import type { MotionFrameV2, PoseLabel } from './types';
import { LIMB_PAIRS } from './types';

// ── MediaPipe landmark type ──

interface LM {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

// ── Joint angle definitions (from poseComparer.ts) ──

const JOINT_DEFS = [
  { joint: 'leftElbow', a: 11, b: 13, c: 15 },
  { joint: 'rightElbow', a: 12, b: 14, c: 16 },
  { joint: 'leftShoulder', a: 13, b: 11, c: 23 },
  { joint: 'rightShoulder', a: 14, b: 12, c: 24 },
  { joint: 'leftHip', a: 11, b: 23, c: 25 },
  { joint: 'rightHip', a: 12, b: 24, c: 26 },
  { joint: 'leftKnee', a: 23, b: 25, c: 27 },
  { joint: 'rightKnee', a: 24, b: 26, c: 28 },
] as const;

// Key landmarks for velocity computation (wrists, ankles, nose)
const VELOCITY_LANDMARKS = [0, 15, 16, 27, 28];

// ── Core extraction ──

function calcAngle(a: LM, b: LM, c: LM): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

/**
 * Extract 8 key joint angles from 33-point MediaPipe landmarks.
 */
export function extractJointAngles(landmarks: LM[]): Record<string, number> {
  const angles: Record<string, number> = {};
  if (!landmarks || landmarks.length < 33) return angles;

  for (const { joint, a, b, c } of JOINT_DEFS) {
    angles[joint] = calcAngle(landmarks[a], landmarks[b], landmarks[c]);
  }
  return angles;
}

/**
 * Extract torso-relative angles — rotation invariant.
 *
 * Approach: compute each joint angle relative to the torso axis (spine direction).
 * This makes the features invariant to camera rotation.
 *
 * Returns array of angles normalized to [0, 1] range.
 */
export function extractRelativeAngles(landmarks: LM[]): number[] {
  if (!landmarks || landmarks.length < 33) return [];

  // Torso axis: midpoint of shoulders → midpoint of hips
  const shoulderMid = {
    x: (landmarks[11].x + landmarks[12].x) / 2,
    y: (landmarks[11].y + landmarks[12].y) / 2,
  };
  const hipMid = {
    x: (landmarks[23].x + landmarks[24].x) / 2,
    y: (landmarks[23].y + landmarks[24].y) / 2,
  };
  const torsoAngle = Math.atan2(
    hipMid.y - shoulderMid.y,
    hipMid.x - shoulderMid.x,
  );

  // Compute angle of each limb relative to torso axis
  const limbAngles: number[] = [];
  for (const [a, b] of LIMB_PAIRS) {
    const limbAngle = Math.atan2(
      landmarks[b].y - landmarks[a].y,
      landmarks[b].x - landmarks[a].x,
    );
    // Relative angle (normalized to 0-1 from -PI..PI)
    let rel = limbAngle - torsoAngle;
    // Normalize to [-PI, PI]
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    limbAngles.push((rel + Math.PI) / (2 * Math.PI)); // 0-1
  }

  return limbAngles;
}

/**
 * Compute velocity between two frames as average displacement of key landmarks.
 * Returns value in 0-1 range (capped).
 */
export function computeVelocity(
  prev: LM[] | null,
  curr: LM[],
  dt: number,
): number {
  if (!prev || prev.length < 33 || curr.length < 33 || dt <= 0) return 0;

  let totalDisp = 0;
  let count = 0;
  for (const idx of VELOCITY_LANDMARKS) {
    const dx = curr[idx].x - prev[idx].x;
    const dy = curr[idx].y - prev[idx].y;
    totalDisp += Math.sqrt(dx * dx + dy * dy);
    count++;
  }

  const avgDisp = totalDisp / count;
  // Normalize: displacement per second, capped at 1
  const velocity = Math.min(1, (avgDisp / dt) * 0.5);
  return velocity;
}

/**
 * Classify pose from velocity and joint angles.
 */
export function classifyPose(
  velocity: number,
  jointAngles: Record<string, number>,
): PoseLabel {
  if (velocity < 0.02) return 'still';
  if (velocity < 0.08) return 'subtle';

  // Check if arms are significantly different from rest position
  const armActivity =
    Math.abs((jointAngles.leftElbow || 180) - 180) +
    Math.abs((jointAngles.rightElbow || 180) - 180) +
    Math.abs((jointAngles.leftShoulder || 0) - 0) +
    Math.abs((jointAngles.rightShoulder || 0) - 0);

  if (velocity < 0.2 && armActivity > 60) return 'gesture';
  if (velocity < 0.4) return 'movement';
  return 'active';
}

/**
 * Compute average landmark confidence (visibility).
 */
export function computeQuality(landmarks: LM[]): number {
  if (!landmarks || landmarks.length === 0) return 0;
  let total = 0;
  let count = 0;
  for (const lm of landmarks) {
    if (lm.visibility !== undefined) {
      total += lm.visibility;
      count++;
    }
  }
  return count > 0 ? total / count : 0.5; // default 0.5 if no visibility data
}

/**
 * Compute limb length ratios — scale-invariant feature.
 * Normalizes all limb lengths by torso length.
 */
export function computeLimbRatios(landmarks: LM[]): number[] {
  if (!landmarks || landmarks.length < 33) return [];

  const lengths: number[] = [];
  for (const [a, b] of LIMB_PAIRS) {
    const dx = landmarks[b].x - landmarks[a].x;
    const dy = landmarks[b].y - landmarks[a].y;
    const dz = landmarks[b].z - landmarks[a].z;
    lengths.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
  }

  // Normalize by torso length (average of left+right torso)
  const torsoLength =
    (lengths[lengths.length - 2] + lengths[lengths.length - 1]) / 2;
  if (torsoLength < 0.001) return lengths.map(() => 1);

  return lengths.map((l) => l / torsoLength);
}

// ── Full frame extraction ──

/**
 * Extract V2 features from a sequence of raw MediaPipe landmark arrays.
 *
 * @param landmarkFrames Array of { t, landmarks, visibility? } from MediaPipe
 * @returns MotionFrameV2[] with full per-frame features
 */
export function extractMotionFramesV2(
  landmarkFrames: {
    t: number;
    landmarks: number[][];
    visibility?: number[];
  }[],
): MotionFrameV2[] {
  const frames: MotionFrameV2[] = [];

  for (let i = 0; i < landmarkFrames.length; i++) {
    const raw = landmarkFrames[i];
    const lm: LM[] = raw.landmarks.map((coords, j) => ({
      x: coords[0] ?? 0,
      y: coords[1] ?? 0,
      z: coords[2] ?? 0,
      visibility: raw.visibility?.[j],
    }));

    if (lm.length < 33) {
      // Missing landmarks frame
      frames.push({
        t: raw.t,
        landmarks: raw.landmarks as [number, number, number][],
        jointAngles: {},
        relativeAngles: [],
        velocity: 0,
        poseLabel: 'still',
        quality: 0,
      });
      continue;
    }

    const jointAngles = extractJointAngles(lm);
    const relativeAngles = extractRelativeAngles(lm);
    const prevLm =
      i > 0 && landmarkFrames[i - 1].landmarks.length >= 33
        ? landmarkFrames[i - 1].landmarks.map((coords, j) => ({
            x: coords[0] ?? 0,
            y: coords[1] ?? 0,
            z: coords[2] ?? 0,
            visibility: landmarkFrames[i - 1].visibility?.[j],
          }))
        : null;
    const dt = i > 0 ? raw.t - landmarkFrames[i - 1].t : 0;
    const velocity = computeVelocity(prevLm, lm, dt);
    const quality = computeQuality(lm);
    const poseLabel = classifyPose(velocity, jointAngles);

    frames.push({
      t: raw.t,
      landmarks: raw.landmarks as [number, number, number][],
      jointAngles,
      relativeAngles,
      velocity,
      poseLabel,
      quality,
    });
  }

  return frames;
}
