/**
 * Eyes V2 — public API barrel export.
 */

export type {
  EyesFrameV2,
  EyesPatternV2,
  AttentionSegment,
  AttentionType,
} from './types';
export { CONTOUR_LENGTH, EAR_BLINK_THRESHOLD, EAR_BLINK_CONSEC_FRAMES, ALL_ZONES } from './types';

export {
  extractEyesFramesV2,
  extractGaze,
  computeEARs,
  extractHeadPose,
  classifyZone,
} from './featureExtractor';

export { extractEyesPatternV2 } from './patternExtractor';

export {
  compareGazePattern,
  setGazePatternParams,
  DEFAULT_GAZE_PATTERN_PARAMS,
} from './gazePatternComparer';
export type { GazePatternParams } from './gazePatternComparer';

export {
  compareAttentionProfile,
  setAttentionParams,
  DEFAULT_ATTENTION_PARAMS,
} from './attentionComparer';
export type { AttentionParams } from './attentionComparer';

export {
  compareEngagement,
  setEngagementParams,
  DEFAULT_ENGAGEMENT_PARAMS,
} from './engagementComparer';
export type { EngagementParams } from './engagementComparer';
