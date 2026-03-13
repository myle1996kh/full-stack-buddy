/**
 * Eyes V2 Feature Extractor — per-frame gaze, blink, and head pose extraction.
 *
 * Reuses iris tracking logic from gazeDetector.ts and adds:
 * - Eye Aspect Ratio (EAR) blink detection
 * - Head pose estimation from face landmarks
 * - Quality scoring
 */

import type { EyesFrameV2 } from './types';
import { EAR_BLINK_THRESHOLD, EAR_BLINK_CONSEC_FRAMES } from './types';

// ── FaceLandmarker indices ──

// Iris centers
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;

// Eye corners for gaze computation
const LEFT_EYE_INNER = 133;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const LEFT_EYE_TOP = 159;
const LEFT_EYE_BOTTOM = 145;
const RIGHT_EYE_TOP = 386;
const RIGHT_EYE_BOTTOM = 374;

// EAR landmarks (6 points per eye for aspect ratio)
// Left eye: p1=33, p2=160, p3=158, p4=133, p5=153, p6=144
const LEFT_EAR_POINTS = [33, 160, 158, 133, 153, 144];
// Right eye: p1=263, p2=387, p3=385, p4=362, p5=380, p6=373
const RIGHT_EAR_POINTS = [263, 387, 385, 362, 380, 373];

// Head pose reference landmarks
const NOSE_TIP = 1;
const CHIN = 152;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;
const FOREHEAD = 10;

// Sensitivity gain for iris ratios (raw range is usually narrow)
const GAZE_GAIN_X = 2.4;
const GAZE_GAIN_Y = 2.2;

// ── Landmark type ──

interface FLM {
  x: number;
  y: number;
  z: number;
}

// ── Gaze extraction (from gazeDetector.ts logic) ──

function computeIrisRatio(
  inner: FLM,
  outer: FLM,
  top: FLM,
  bottom: FLM,
  iris: FLM,
): { x: number; y: number } {
  const eyeWidth = inner.x - outer.x;
  const rawX = Math.abs(eyeWidth) > 1e-5 ? (iris.x - outer.x) / eyeWidth : 0.5;

  const eyeHeight = bottom.y - top.y;
  const rawY = Math.abs(eyeHeight) > 1e-5 ? (iris.y - top.y) / eyeHeight : 0.5;

  const boostedX = (rawX - 0.5) * GAZE_GAIN_X + 0.5;
  const boostedY = (rawY - 0.5) * GAZE_GAIN_Y + 0.5;

  return {
    x: Math.max(0, Math.min(1, boostedX)),
    y: Math.max(0, Math.min(1, boostedY)),
  };
}

/**
 * Extract gaze direction from face landmarks with iris data.
 */
export function extractGaze(lm: FLM[]): { gazeX: number; gazeY: number } {
  if (lm.length < 478)
    return { gazeX: 0.5, gazeY: 0.5 };

  const leftGaze = computeIrisRatio(
    lm[LEFT_EYE_INNER],
    lm[LEFT_EYE_OUTER],
    lm[LEFT_EYE_TOP],
    lm[LEFT_EYE_BOTTOM],
    lm[LEFT_IRIS_CENTER],
  );
  const rightGaze = computeIrisRatio(
    lm[RIGHT_EYE_INNER],
    lm[RIGHT_EYE_OUTER],
    lm[RIGHT_EYE_TOP],
    lm[RIGHT_EYE_BOTTOM],
    lm[RIGHT_IRIS_CENTER],
  );

  return {
    gazeX: Math.max(0, Math.min(1, (leftGaze.x + rightGaze.x) / 2)),
    gazeY: Math.max(0, Math.min(1, (leftGaze.y + rightGaze.y) / 2)),
  };
}

// ── Blink detection via Eye Aspect Ratio (EAR) ──

function dist(a: FLM, b: FLM): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute Eye Aspect Ratio for one eye.
 * EAR = (|p2-p6| + |p3-p5|) / (2 × |p1-p4|)
 * Low EAR = eye closed (blink).
 */
function computeEAR(lm: FLM[], points: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = points;
  const vertical1 = dist(lm[p2], lm[p6]);
  const vertical2 = dist(lm[p3], lm[p5]);
  const horizontal = dist(lm[p1], lm[p4]);
  if (horizontal < 0.001) return 0.3; // fallback
  return (vertical1 + vertical2) / (2 * horizontal);
}

/**
 * Compute left and right EAR values.
 */
export function computeEARs(lm: FLM[]): { earLeft: number; earRight: number } {
  if (lm.length < 478) return { earLeft: 0.3, earRight: 0.3 };
  return {
    earLeft: computeEAR(lm, LEFT_EAR_POINTS),
    earRight: computeEAR(lm, RIGHT_EAR_POINTS),
  };
}

// ── Head pose estimation ──

/**
 * Extract approximate head yaw and pitch from face landmarks.
 * Yaw: horizontal rotation (-1 = looking left, +1 = looking right)
 * Pitch: vertical tilt (-1 = looking down, +1 = looking up)
 */
export function extractHeadPose(lm: FLM[]): {
  headYaw: number;
  headPitch: number;
} {
  if (lm.length < 468) return { headYaw: 0, headPitch: 0 };

  const nose = lm[NOSE_TIP];
  const leftCheek = lm[LEFT_CHEEK];
  const rightCheek = lm[RIGHT_CHEEK];
  const chin = lm[CHIN];
  const forehead = lm[FOREHEAD];

  // Yaw: nose position relative to face center (left-right)
  const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
  const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
  const yaw =
    faceWidth > 0.001 ? ((nose.x - faceCenterX) / (faceWidth / 2)) * -1 : 0;

  // Pitch: nose position relative to face center (up-down)
  const faceCenterY = (forehead.y + chin.y) / 2;
  const faceHeight = Math.abs(chin.y - forehead.y);
  const pitch =
    faceHeight > 0.001
      ? ((nose.y - faceCenterY) / (faceHeight / 2)) * -1
      : 0;

  return {
    headYaw: Math.max(-1, Math.min(1, yaw)),
    headPitch: Math.max(-1, Math.min(1, pitch)),
  };
}

// ── Zone classification ──

export function classifyZone(x: number, y: number): string {
  const col = x < 0.4 ? 'left' : x > 0.6 ? 'right' : 'center';
  const row = y < 0.4 ? 'top' : y > 0.6 ? 'bottom' : 'center';
  if (col === 'center' && row === 'center') return 'center';
  return `${row}-${col}`;
}

// ── Full frame extraction ──

/**
 * Extract V2 features from a sequence of raw FaceLandmarker results.
 *
 * @param faceLandmarkFrames Array of { t, landmarks (478 points), confidence? }
 * @returns EyesFrameV2[] with full per-frame features including blink detection
 */
export function extractEyesFramesV2(
  faceLandmarkFrames: {
    t: number;
    landmarks: number[][] | null; // null = no face detected
    confidence?: number;
  }[],
): EyesFrameV2[] {
  const frames: EyesFrameV2[] = [];
  let blinkCounter = 0; // consecutive frames below EAR threshold

  for (const raw of faceLandmarkFrames) {
    if (!raw.landmarks || raw.landmarks.length < 468) {
      // No face detected
      blinkCounter = 0;
      frames.push({
        t: raw.t,
        gazeX: 0.5,
        gazeY: 0.5,
        zone: 'center',
        blinkDetected: false,
        earLeft: 0.3,
        earRight: 0.3,
        headYaw: 0,
        headPitch: 0,
        faceDetected: false,
        quality: 0,
      });
      continue;
    }

    const lm: FLM[] = raw.landmarks.map((coords) => ({
      x: coords[0] ?? 0,
      y: coords[1] ?? 0,
      z: coords[2] ?? 0,
    }));

    const { gazeX, gazeY } = extractGaze(lm);
    const zone = classifyZone(gazeX, gazeY);
    const { earLeft, earRight } = computeEARs(lm);
    const { headYaw, headPitch } = extractHeadPose(lm);

    // Blink detection: both eyes below threshold for consecutive frames
    const avgEAR = (earLeft + earRight) / 2;
    let blinkDetected = false;
    if (avgEAR < EAR_BLINK_THRESHOLD) {
      blinkCounter++;
      if (blinkCounter >= EAR_BLINK_CONSEC_FRAMES) {
        blinkDetected = true;
      }
    } else {
      blinkCounter = 0;
    }

    frames.push({
      t: raw.t,
      gazeX,
      gazeY,
      zone,
      blinkDetected,
      earLeft,
      earRight,
      headYaw,
      headPitch,
      faceDetected: true,
      quality: raw.confidence ?? 0.7,
    });
  }

  return frames;
}
