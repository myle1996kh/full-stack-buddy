/**
 * Eyes MSE Module — wired to V2 pipeline.
 * extract() produces EyesPatternV2-compatible output,
 * compare() uses gaze-pattern / attention / engagement strategies.
 */

import type { MSEModule, EyesFrame, EyesPattern } from '@/types/modules';
import { extractEyesFramesV2 } from '@/engine/eyes/featureExtractor';
import { extractEyesPatternV2 } from '@/engine/eyes/patternExtractor';
import { compareGazePattern, setGazePatternParams } from '@/engine/eyes/gazePatternComparer';
import { compareAttentionProfile, setAttentionParams } from '@/engine/eyes/attentionComparer';
import { compareEngagement, setEngagementParams } from '@/engine/eyes/engagementComparer';
import type { GazePatternParams } from '@/engine/eyes/gazePatternComparer';
import type { AttentionParams } from '@/engine/eyes/attentionComparer';
import type { EngagementParams } from '@/engine/eyes/engagementComparer';
import type { EyesPatternV2 } from '@/engine/eyes/types';

// ── Dynamic params (set from UI) ──

let _gazeParams: GazePatternParams | undefined;
let _attentionParams: AttentionParams | undefined;
let _engagementParams: EngagementParams | undefined;
let _applyQualityPenalty = true;

export function setEyesGazeParams(params: GazePatternParams | undefined) {
  _gazeParams = params;
  if (params) setGazePatternParams(params);
}
export function getEyesGazeParams() { return _gazeParams; }

export function setEyesAttentionParams(params: AttentionParams | undefined) {
  _attentionParams = params;
  if (params) setAttentionParams(params);
}

export function setEyesEngagementParams(params: EngagementParams | undefined) {
  _engagementParams = params;
  if (params) setEngagementParams(params);
}

export function setEyesApplyQualityPenalty(enabled: boolean) {
  _applyQualityPenalty = enabled;
}
export function getEyesApplyQualityPenalty() { return _applyQualityPenalty; }

// ── Bridge: convert old EyesFrame[] to V2 pattern ──

function isEyesPatternV2(pattern: any): pattern is EyesPatternV2 {
  return !!pattern
    && typeof pattern.duration === 'number'
    && Array.isArray(pattern.gazeContourX)
    && Array.isArray(pattern.attentionSegments);
}

function bridgeToV2Pattern(frames: EyesFrame[]): EyesPattern & { _v2?: EyesPatternV2 } {
  const duration = frames.length > 0
    ? (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000
    : 0;

  // Build V2 frames from legacy data (no raw face landmarks available)
  const v2Frames = extractEyesFramesV2(
    frames.map(f => ({
      t: f.timestamp / 1000,
      landmarks: null,
      confidence: 0.7,
    })),
  );

  // Override with actual legacy gaze data (and optional richer fields when available)
  for (let i = 0; i < Math.min(v2Frames.length, frames.length); i++) {
    const legacy = frames[i] as EyesFrame & Partial<{
      faceDetected: boolean;
      quality: number;
      headYaw: number;
      headPitch: number;
      earLeft: number;
      earRight: number;
    }>;

    v2Frames[i].gazeX = legacy.gazeX;
    v2Frames[i].gazeY = legacy.gazeY;
    v2Frames[i].zone = legacy.zone || classifyZone(legacy.gazeX, legacy.gazeY);
    v2Frames[i].faceDetected = legacy.faceDetected ?? true;
    v2Frames[i].blinkDetected = legacy.blinkDetected;
    v2Frames[i].headYaw = legacy.headYaw ?? v2Frames[i].headYaw;
    v2Frames[i].headPitch = legacy.headPitch ?? v2Frames[i].headPitch;
    v2Frames[i].earLeft = legacy.earLeft ?? v2Frames[i].earLeft;
    v2Frames[i].earRight = legacy.earRight ?? v2Frames[i].earRight;
    v2Frames[i].quality = legacy.quality ?? (legacy.faceDetected === false ? 0 : 0.7);
  }

  const v2Pattern = extractEyesPatternV2(v2Frames, duration);

   return {
     zoneDwellTimes: v2Pattern.zoneDwellTimes,
     zoneSequence: v2Pattern.zoneSequence,
     avgFixationDuration: v2Pattern.avgFixationDuration,
     blinkRate: v2Pattern.blinkRate,
     blinkCount: v2Pattern.blinkCount,
     blinkMetrics: {
       avgDuration: v2Pattern.blinkMetrics?.avgDuration ?? 0,
       durationStdDev: v2Pattern.blinkMetrics?.durationStdDev ?? 0,
       rateVariability: v2Pattern.blinkMetrics?.rateVariability ?? 0,
     },
     headPoseProfile: v2Pattern.headPoseProfile,
     primaryZone: v2Pattern.primaryZone,
     _v2: v2Pattern,
   } as EyesPattern & { _v2?: EyesPatternV2 };
}

function coerceToV2(pattern: any): EyesPatternV2 {
  if (pattern?._v2) return pattern._v2;
  if (isEyesPatternV2(pattern)) return pattern;
   return {
     duration: 0,
     gazeContourX: [],
     gazeContourY: [],
     zoneDwellTimes: pattern?.zoneDwellTimes ?? {},
     zoneSequence: pattern?.zoneSequence ?? [],
     attentionSegments: [],
     attentionDistribution: { focused: 0.5, scanning: 0.3, away: 0.2 },
     blinkRate: pattern?.blinkRate ?? 0,
     blinkCount: 0,
     avgFixationDuration: pattern?.avgFixationDuration ?? 0,
     blinkMetrics: {
       avgDuration: 0,
       durationStdDev: 0,
       rateVariability: 0,
     },
     headPoseProfile: { avgYaw: 0, avgPitch: 0, yawStability: 0, pitchStability: 0 },
     primaryZone: pattern?.primaryZone ?? 'center',
     quality: { faceDetectedRatio: 0.5, avgConfidence: 0.5 },
   };
}

function classifyZone(x: number, y: number): string {
  const col = x < 0.4 ? 'left' : x > 0.6 ? 'right' : 'center';
  const row = y < 0.4 ? 'top' : y > 0.6 ? 'bottom' : 'center';
  if (col === 'center' && row === 'center') return 'center';
  return `${row}-${col}`;
}

// ── Module definition ──

export const eyesModule: MSEModule<EyesFrame, EyesPattern> = {
  id: 'eyes',
  name: 'Eyes',
  color: 'hsl(217, 91%, 60%)',
  icon: 'Eye',

  methods: [
    {
      id: 'face-mesh-gaze',
      name: 'Face Mesh Gaze Tracking',
      description: 'MediaPipe Face detection with iris gaze + blink + head pose',
      isDefault: true,
      enabled: true,
      requires: ['camera', 'face'],
      extract: (frames: EyesFrame[]): EyesPattern => {
        return bridgeToV2Pattern(frames);
      },
      processFrame: (frame: EyesFrame): number => {
        const zone = frame.zone || classifyZone(frame.gazeX, frame.gazeY);
        return zone === 'center' ? 1.0 : zone.includes('center') ? 0.7 : 0.4;
      },
    },
    {
      id: 'head-direction',
      name: 'Head Direction Only',
      description: 'Approximate attention from head pose — no detailed gaze',
      isDefault: false,
      enabled: false,
      requires: ['camera', 'pose'],
      extract: (frames: EyesFrame[]): EyesPattern => ({
        zoneDwellTimes: { center: frames.length * 0.033 },
        zoneSequence: ['center'],
        avgFixationDuration: frames.length * 0.033,
        blinkRate: 0,
        primaryZone: 'center',
      }),
    },
  ],

  charts: [
    { id: 'gaze-heatmap', name: 'Gaze Heatmap', description: '3×3 zone time distribution', enabled: true, category: 'post-session', dataSource: 'pattern' },
    { id: 'gaze-timeline', name: 'Gaze Timeline', description: 'Zone colors over time', enabled: true, category: 'both', dataSource: 'frames' },
    { id: 'focus-ring', name: 'Focus Ring', description: 'Circular gauge of focus stability', enabled: false, category: 'realtime', dataSource: 'frames' },
    { id: 'blink-rate', name: 'Blink Rate', description: 'Blink frequency indicator', enabled: false, category: 'realtime', dataSource: 'frames' },
  ],

  comparers: [
    {
      id: 'gaze-pattern',
      name: 'Gaze Pattern',
      description: 'Zone distribution + sequence + focus quality — configurable weights',
      isDefault: true,
      enabled: true,
      compare: (ref: EyesPattern, learner: EyesPattern) => {
        const refV2 = coerceToV2(ref);
        const learnerV2 = coerceToV2(learner);
        const result = compareGazePattern(refV2, learnerV2, _gazeParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return { score: result.score, breakdown: result.breakdown, feedback: result.feedback, debug: result.debug };
      },
    },
    {
      id: 'attention-profile',
      name: 'Attention Profile',
      description: 'How attention is maintained — focused vs scanning vs away time',
      isDefault: false,
      enabled: true,
      compare: (ref: EyesPattern, learner: EyesPattern) => {
        const refV2 = coerceToV2(ref);
        const learnerV2 = coerceToV2(learner);
        const result = compareAttentionProfile(refV2, learnerV2, _attentionParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return { score: result.score, breakdown: result.breakdown, feedback: result.feedback };
      },
    },
    {
      id: 'engagement-score',
      name: 'Engagement Score',
      description: 'Overall visual engagement — gaze contact + head pose + blink + expressiveness',
      isDefault: false,
      enabled: true,
      compare: (ref: EyesPattern, learner: EyesPattern) => {
        const refV2 = coerceToV2(ref);
        const learnerV2 = coerceToV2(learner);
        const result = compareEngagement(refV2, learnerV2, _engagementParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return { score: result.score, breakdown: result.breakdown, feedback: result.feedback };
      },
    },
  ],
};
