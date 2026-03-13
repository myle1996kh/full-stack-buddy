/**
 * Motion V2 Types — rich pose-based features for comparison.
 */

export type PoseLabel = 'still' | 'subtle' | 'gesture' | 'movement' | 'active';

/** Per-frame V2 features extracted from MediaPipe landmarks */
export interface MotionFrameV2 {
  t: number; // seconds
  landmarks: [number, number, number][]; // [x,y,z] × 33
  jointAngles: Record<string, number>; // 8 key joint angles (degrees)
  relativeAngles: number[]; // torso-relative angles (rotation-invariant)
  velocity: number; // frame-to-frame landmark displacement (0-1 scale)
  poseLabel: PoseLabel;
  quality: number; // 0-1 average landmark confidence
}

/** Motion segment — a contiguous period of one pose type */
export interface MotionSegment {
  type: PoseLabel;
  startTime: number;
  endTime: number;
  duration: number;
  avgAngles: Record<string, number>;
  avgVelocity: number;
}

/** Aggregated motion pattern for comparison */
export interface MotionPatternV2 {
  duration: number;
  // Contours (resampled to CONTOUR_LENGTH points)
  angleContours: Record<string, number[]>; // per-joint angle over time
  velocityContour: number[];
  // Segments
  segments: MotionSegment[];
  // Statistics
  avgVelocity: number;
  poseDistribution: Record<PoseLabel, number>; // fraction of time in each pose
  gestureSequence: string[]; // sequence of segment types
  // Invariant features
  limbRatios: number[]; // normalized limb length ratios
  // Quality
  quality: {
    avgConfidence: number;
    missingFrameRatio: number; // frames with no landmarks
  };
}

/** Standard contour length for resampling */
export const CONTOUR_LENGTH = 120;

/** Joint definitions from poseComparer — re-exported for convenience */
export const JOINT_NAMES = [
  'leftElbow',
  'rightElbow',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/**
 * Limb pairs for ratio computation (scale-invariant feature).
 * Each pair: [landmark_A, landmark_B] from MediaPipe 33-point pose.
 */
export const LIMB_PAIRS: [number, number][] = [
  [11, 13], // left upper arm (shoulder → elbow)
  [13, 15], // left forearm (elbow → wrist)
  [12, 14], // right upper arm
  [14, 16], // right forearm
  [23, 25], // left thigh (hip → knee)
  [25, 27], // left shin (knee → ankle)
  [24, 26], // right thigh
  [26, 28], // right shin
  [11, 23], // left torso (shoulder → hip)
  [12, 24], // right torso
];
