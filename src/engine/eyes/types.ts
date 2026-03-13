/**
 * Eyes V2 Types — gaze, blink, head pose features for comparison.
 */

export type AttentionType = 'focused' | 'scanning' | 'away';

/** Per-frame V2 features extracted from MediaPipe FaceLandmarker */
export interface EyesFrameV2 {
  t: number; // seconds
  gazeX: number; // 0-1 horizontal gaze position
  gazeY: number; // 0-1 vertical gaze position
  zone: string; // 3×3 zone classification
  blinkDetected: boolean; // EAR-based blink detection
  earLeft: number; // left eye aspect ratio
  earRight: number; // right eye aspect ratio
  headYaw: number; // head horizontal rotation (-1 to 1)
  headPitch: number; // head vertical tilt (-1 to 1)
  faceDetected: boolean;
  quality: number; // 0-1 face detection confidence
}

/** Attention segment — a contiguous period of one attention type */
export interface AttentionSegment {
  type: AttentionType;
  startTime: number;
  endTime: number;
  duration: number;
  avgZone: string;
}

/** Aggregated eyes pattern for comparison */
export interface EyesPatternV2 {
  duration: number;
  // Contours (resampled to CONTOUR_LENGTH points)
  gazeContourX: number[]; // horizontal gaze over time
  gazeContourY: number[]; // vertical gaze over time
  // Zone analysis
  zoneDwellTimes: Record<string, number>; // normalized % per zone
  zoneSequence: string[]; // transition sequence
  // Attention segments
  attentionSegments: AttentionSegment[];
  attentionDistribution: Record<AttentionType, number>; // fraction per type
  // Blink & fixation
  blinkRate: number; // blinks per minute
  blinkCount: number;
  avgFixationDuration: number; // seconds
  // Enhanced blink metrics
  blinkMetrics: {
    avgDuration: number; // average blink duration in seconds
    durationStdDev: number; // standard deviation of blink duration
    rateVariability: number; // coefficient of variation of blink rate
  };
  // Head pose
  headPoseProfile: {
    avgYaw: number;
    avgPitch: number;
    yawStability: number; // lower = more stable (std dev)
    pitchStability: number;
  };
  // Summary
  primaryZone: string;
  // Quality
  quality: {
    faceDetectedRatio: number;
    avgConfidence: number;
  };
}

/** Standard contour length for resampling */
export const CONTOUR_LENGTH = 120;

/** Eye Aspect Ratio threshold for blink detection */
export const EAR_BLINK_THRESHOLD = 0.21;

/** Minimum consecutive frames below threshold to count as blink */
export const EAR_BLINK_CONSEC_FRAMES = 2;

/**
 * Zone classification: 3×3 grid.
 * Zones: center, top-center, top-left, top-right,
 *        center-left, center-right,
 *        bottom-center, bottom-left, bottom-right
 */
export const ALL_ZONES = [
  'center',
  'top-center',
  'top-left',
  'top-right',
  'center-left',
  'center-right',
  'bottom-center',
  'bottom-left',
  'bottom-right',
] as const;