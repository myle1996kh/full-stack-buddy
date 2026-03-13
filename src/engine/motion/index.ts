/**
 * Motion V2 — public API barrel export.
 */

export type {
  MotionFrameV2,
  MotionPatternV2,
  MotionSegment,
  PoseLabel,
  JointName,
} from './types';
export { CONTOUR_LENGTH, JOINT_NAMES, LIMB_PAIRS } from './types';

export {
  extractMotionFramesV2,
  extractJointAngles,
  extractRelativeAngles,
  computeVelocity,
  classifyPose,
  computeQuality,
  computeLimbRatios,
} from './featureExtractor';

export { extractMotionPatternV2 } from './patternExtractor';

export {
  comparePoseAngles,
  setPoseAnglesParams,
  getPoseAnglesParams,
  DEFAULT_POSE_ANGLES_PARAMS,
} from './poseAnglesComparer';
export type { PoseAnglesParams } from './poseAnglesComparer';

export {
  comparePoseRelative,
  setPoseRelativeParams,
  DEFAULT_POSE_RELATIVE_PARAMS,
} from './poseRelativeComparer';
export type { PoseRelativeParams } from './poseRelativeComparer';

export {
  comparePoseInvariant,
  setPoseInvariantParams,
  DEFAULT_POSE_INVARIANT_PARAMS,
} from './poseInvariantComparer';
export type { PoseInvariantParams } from './poseInvariantComparer';
