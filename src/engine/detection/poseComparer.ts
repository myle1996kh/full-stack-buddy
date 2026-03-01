/**
 * Skeleton-based pose comparison engine.
 * Adapted from https://github.com/sing1ee/my-pose
 * Uses joint angles from MediaPipe 33-point landmarks.
 */

export interface JointAngle {
  joint: string;
  angle: number;
}

export interface PoseSimilarityResult {
  overall: number; // 0-100
  perJoint: Record<string, number>; // per-joint similarity 0-100
  feedback: string[];
}

/** Landmark type matching our PoseLandmarkSnapshot */
interface LM { x: number; y: number; z: number }

// ── Angle extraction ──

function calcAngle(a: LM, b: LM, c: LM): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) -
    Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

/** Key joint definitions: [pointA, joint, pointB] using MediaPipe indices */
const JOINT_DEFS: { joint: string; a: number; b: number; c: number }[] = [
  { joint: 'leftElbow',     a: 11, b: 13, c: 15 },
  { joint: 'rightElbow',    a: 12, b: 14, c: 16 },
  { joint: 'leftShoulder',  a: 13, b: 11, c: 23 },
  { joint: 'rightShoulder', a: 14, b: 12, c: 24 },
  { joint: 'leftHip',       a: 11, b: 23, c: 25 },
  { joint: 'rightHip',      a: 12, b: 24, c: 26 },
  { joint: 'leftKnee',      a: 23, b: 25, c: 27 },
  { joint: 'rightKnee',     a: 24, b: 26, c: 28 },
];

export function extractKeyAngles(landmarks: LM[]): JointAngle[] {
  if (!landmarks || landmarks.length < 33) return [];
  return JOINT_DEFS.map(({ joint, a, b, c }) => ({
    joint,
    angle: calcAngle(landmarks[a], landmarks[b], landmarks[c]),
  }));
}

// ── Pose normalization ──

export function normalizeLandmarks(landmarks: LM[]): LM[] {
  if (landmarks.length < 33) return landmarks;

  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];

  const shoulderCenter = {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2,
  };
  const hipCenter = {
    x: (lHip.x + rHip.x) / 2,
    y: (lHip.y + rHip.y) / 2,
  };

  const angle = Math.atan2(
    hipCenter.y - shoulderCenter.y,
    hipCenter.x - shoulderCenter.x
  );

  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);

  return landmarks.map(lm => {
    const rx = lm.x - shoulderCenter.x;
    const ry = lm.y - shoulderCenter.y;
    return {
      x: rx * cos - ry * sin + shoulderCenter.x,
      y: rx * sin + ry * cos + shoulderCenter.y,
      z: lm.z,
    };
  });
}

// ── Comparison ──

/**
 * Compare two sets of landmarks using joint-angle similarity.
 * Returns 0-100 overall + per-joint breakdown.
 */
export function comparePoseLandmarks(
  refLandmarks: LM[],
  learnerLandmarks: LM[],
  normalize = true
): PoseSimilarityResult {
  const ref = normalize ? normalizeLandmarks(refLandmarks) : refLandmarks;
  const lrn = normalize ? normalizeLandmarks(learnerLandmarks) : learnerLandmarks;

  const refAngles = extractKeyAngles(ref);
  const lrnAngles = extractKeyAngles(lrn);

  if (!refAngles.length || !lrnAngles.length) {
    return { overall: 0, perJoint: {}, feedback: ['Could not extract joint angles'] };
  }

  const perJoint: Record<string, number> = {};
  let total = 0;
  const maxDiff = 180;

  refAngles.forEach(ra => {
    const la = lrnAngles.find(l => l.joint === ra.joint);
    if (la) {
      const diff = Math.abs(ra.angle - la.angle);
      const sim = Math.max(0, 100 - (diff / maxDiff) * 100);
      perJoint[ra.joint] = Math.round(sim);
      total += sim;
    }
  });

  const count = Object.keys(perJoint).length;
  const raw = count > 0 ? total / count : 0;
  // Power curve for more differentiation (from my-pose)
  const overall = Math.round(Math.pow(raw / 100, 2) * 100);

  const feedback: string[] = [];
  const weakJoints = Object.entries(perJoint)
    .filter(([, v]) => v < 60)
    .sort(([, a], [, b]) => a - b);

  if (weakJoints.length > 0) {
    const top2 = weakJoints.slice(0, 2).map(([j]) => j.replace(/([A-Z])/g, ' $1').toLowerCase());
    feedback.push(`Adjust your ${top2.join(' and ')}`);
  }
  if (overall >= 80) feedback.push('Excellent pose match! ✓');
  else if (overall >= 60) feedback.push('Good form — keep refining the details');

  return { overall, perJoint, feedback };
}

/**
 * Compare arrays of landmark snapshots (multiple frames).
 * Returns average similarity across matched frame pairs.
 */
export function compareMultiFramePose(
  refSnapshots: { landmarks: LM[] }[],
  learnerSnapshots: { landmarks: LM[] }[]
): PoseSimilarityResult {
  if (!refSnapshots.length || !learnerSnapshots.length) {
    return { overall: 0, perJoint: {}, feedback: ['No pose snapshots to compare'] };
  }

  // Match frames: sample evenly from both
  const count = Math.min(refSnapshots.length, learnerSnapshots.length, 10);
  const results: PoseSimilarityResult[] = [];

  for (let i = 0; i < count; i++) {
    const ri = Math.floor((i / count) * refSnapshots.length);
    const li = Math.floor((i / count) * learnerSnapshots.length);
    results.push(comparePoseLandmarks(refSnapshots[ri].landmarks, learnerSnapshots[li].landmarks));
  }

  // Average
  const avgOverall = Math.round(results.reduce((s, r) => s + r.overall, 0) / results.length);
  const allJoints = new Set(results.flatMap(r => Object.keys(r.perJoint)));
  const avgPerJoint: Record<string, number> = {};
  allJoints.forEach(j => {
    const vals = results.map(r => r.perJoint[j]).filter(v => v !== undefined);
    avgPerJoint[j] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  });

  const feedback: string[] = [];
  const weakJoints = Object.entries(avgPerJoint)
    .filter(([, v]) => v < 60)
    .sort(([, a], [, b]) => a - b);
  if (weakJoints.length > 0) {
    const top2 = weakJoints.slice(0, 2).map(([j]) => j.replace(/([A-Z])/g, ' $1').toLowerCase());
    feedback.push(`Focus on your ${top2.join(' and ')}`);
  }
  if (avgOverall >= 80) feedback.push('Excellent pose matching across the session! ✓');

  return { overall: avgOverall, perJoint: avgPerJoint, feedback };
}
