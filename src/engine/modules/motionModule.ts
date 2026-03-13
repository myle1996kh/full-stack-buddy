/**
 * Motion MSE Module — wired to V2 pipeline.
 * extract() produces MotionPatternV2-compatible output,
 * compare() uses joint-angle / relative / invariant strategies.
 */

import type { MSEModule, MotionFrame, MotionPattern } from '@/types/modules';
import { extractMotionFramesV2 } from '@/engine/motion/featureExtractor';
import { extractMotionPatternV2 } from '@/engine/motion/patternExtractor';
import { comparePoseAngles, setPoseAnglesParams } from '@/engine/motion/poseAnglesComparer';
import { comparePoseRelative, setPoseRelativeParams } from '@/engine/motion/poseRelativeComparer';
import { comparePoseInvariant, setPoseInvariantParams } from '@/engine/motion/poseInvariantComparer';
import type { PoseAnglesParams } from '@/engine/motion/poseAnglesComparer';
import type { PoseRelativeParams } from '@/engine/motion/poseRelativeComparer';
import type { PoseInvariantParams } from '@/engine/motion/poseInvariantComparer';
import type { MotionPatternV2 } from '@/engine/motion/types';

// ── Dynamic params (set from UI before compare) ──

let _anglesParams: PoseAnglesParams | undefined;
let _relativeParams: PoseRelativeParams | undefined;
let _invariantParams: PoseInvariantParams | undefined;
let _applyQualityPenalty = true;

export function setMotionAnglesParams(params: PoseAnglesParams | undefined) {
  _anglesParams = params;
  if (params) setPoseAnglesParams(params);
}
export function getMotionAnglesParams() { return _anglesParams; }

export function setMotionRelativeParams(params: PoseRelativeParams | undefined) {
  _relativeParams = params;
  if (params) setPoseRelativeParams(params);
}

export function setMotionInvariantParams(params: PoseInvariantParams | undefined) {
  _invariantParams = params;
  if (params) setPoseInvariantParams(params);
}

export function setMotionApplyQualityPenalty(enabled: boolean) {
  _applyQualityPenalty = enabled;
}
export function getMotionApplyQualityPenalty() { return _applyQualityPenalty; }

// ── Bridge: convert old MotionFrame[] to V2 pattern ──

function isMotionPatternV2(pattern: any): pattern is MotionPatternV2 {
  return !!pattern
    && typeof pattern.duration === 'number'
    && typeof pattern.angleContours === 'object'
    && Array.isArray(pattern.velocityContour);
}

function bridgeToV2Pattern(frames: MotionFrame[]): MotionPattern & { _v2?: MotionPatternV2 } {
  const landmarkFrames = frames.map((f) => ({
    t: f.timestamp / 1000,
    landmarks: f.landmarks ?? [],
  }));

  const v2Frames = extractMotionFramesV2(landmarkFrames);
  const duration = frames.length > 0
    ? (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000
    : 0;
  const v2Pattern = extractMotionPatternV2(v2Frames, duration);

  const segments = v2Pattern.segments.map(s => ({
    type: s.type,
    duration: s.duration,
    landmarks: [] as number[][],
  }));

  return {
    segments,
    avgVelocity: v2Pattern.avgVelocity,
    gestureSequence: v2Pattern.gestureSequence,
    _v2: v2Pattern,
  } as MotionPattern & { _v2?: MotionPatternV2 };
}

function coerceToV2(pattern: any): MotionPatternV2 {
  if (pattern?._v2) return pattern._v2;
  if (isMotionPatternV2(pattern)) return pattern;
  return {
    duration: 0,
    angleContours: {},
    velocityContour: [],
    segments: [],
    avgVelocity: pattern?.avgVelocity ?? 0,
    poseDistribution: { still: 1, subtle: 0, gesture: 0, movement: 0, active: 0 },
    gestureSequence: pattern?.gestureSequence ?? [],
    limbRatios: [],
    quality: { avgConfidence: 0, missingFrameRatio: 1 },
  };
}

// ── Module definition ──

export const motionModule: MSEModule<MotionFrame, MotionPattern> = {
  id: 'motion',
  name: 'Motion',
  color: 'hsl(160, 59%, 42%)',
  icon: 'Activity',

  methods: [
    {
      id: 'full-pose',
      name: 'Full Body Pose (33 landmarks)',
      description: 'MediaPipe Pose detection with 33 body landmarks for full choreography analysis',
      isDefault: true,
      enabled: true,
      requires: ['camera', 'pose'],
      extract: (frames: MotionFrame[]): MotionPattern => {
        return bridgeToV2Pattern(frames);
      },
      processFrame: (frame: MotionFrame): number => {
        if (!frame.landmarks || frame.landmarks.length === 0) return 0;
        return Math.min(1, frame.landmarks.length / 33);
      },
    },
    {
      id: 'hands-only',
      name: 'Hands Only (21×2 landmarks)',
      description: 'Track hand gestures using MediaPipe Hands',
      isDefault: false,
      enabled: false,
      requires: ['camera', 'hands'],
      extract: (frames: MotionFrame[]): MotionPattern => {
        return bridgeToV2Pattern(frames);
      },
    },
    {
      id: 'upper-body',
      name: 'Upper Body (landmarks 0-22)',
      description: 'Track upper body only — good for seated/waist-up practice',
      isDefault: false,
      enabled: false,
      requires: ['camera', 'pose'],
      extract: (frames: MotionFrame[]): MotionPattern => {
        const filtered = frames.map(f => ({
          ...f,
          landmarks: f.landmarks?.slice(0, 23) ?? [],
        }));
        return bridgeToV2Pattern(filtered);
      },
    },
  ],

  charts: [
    { id: 'skeleton-overlay', name: 'Skeleton Overlay', description: 'Live pose overlay on camera', enabled: true, category: 'realtime', dataSource: 'frames' },
    { id: 'motion-trail', name: 'Motion Trail', description: 'Hand trajectory path on canvas', enabled: true, category: 'realtime', dataSource: 'frames' },
    { id: 'movement-timeline', name: 'Movement Timeline', description: 'Segments over time', enabled: false, category: 'post-session', dataSource: 'pattern' },
    { id: 'velocity-profile', name: 'Velocity Profile', description: 'Speed over time', enabled: false, category: 'post-session', dataSource: 'pattern' },
  ],

  comparers: [
    {
      id: 'pose-angles',
      name: 'Joint Angles',
      description: 'Per-joint angle similarity with temporal alignment — configurable weights per body part',
      isDefault: true,
      enabled: true,
      compare: (ref: MotionPattern, learner: MotionPattern) => {
        const refV2 = coerceToV2(ref);
        const learnerV2 = coerceToV2(learner);
        const result = comparePoseAngles(refV2, learnerV2, _anglesParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return { score: result.score, breakdown: result.breakdown, feedback: result.feedback, debug: result.debug };
      },
    },
    {
      id: 'pose-relative',
      name: 'Rotation Invariant',
      description: 'Torso-relative angles — works when camera angle differs between reference and learner',
      isDefault: false,
      enabled: true,
      compare: (ref: MotionPattern, learner: MotionPattern) => {
        const refV2 = coerceToV2(ref);
        const learnerV2 = coerceToV2(learner);
        const result = comparePoseRelative(refV2, learnerV2, _relativeParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return { score: result.score, breakdown: result.breakdown, feedback: result.feedback };
      },
    },
    {
      id: 'pose-invariant',
      name: 'Multi-Feature Invariant',
      description: 'Limb proportions + angles + topology — most robust, handles scale/rotation/body size differences',
      isDefault: false,
      enabled: true,
      compare: (ref: MotionPattern, learner: MotionPattern) => {
        const refV2 = coerceToV2(ref);
        const learnerV2 = coerceToV2(learner);
        const result = comparePoseInvariant(refV2, learnerV2, _invariantParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return { score: result.score, breakdown: result.breakdown, feedback: result.feedback };
      },
    },
    {
      id: 'multi-dtw',
      name: 'Multi-DTW (Legacy)',
      description: 'Legacy multi-feature DTW comparison',
      isDefault: false,
      enabled: true,
      compare: (ref: MotionPattern, learner: MotionPattern) => {
        const dirScore = compareSequences(ref.gestureSequence, learner.gestureSequence);
        const velScore = ref.avgVelocity > 0
          ? Math.max(0, 100 - Math.abs(ref.avgVelocity - learner.avgVelocity) / ref.avgVelocity * 100)
          : learner.avgVelocity === 0 ? 100 : 50;
        const trajScore = compareSegments(ref.segments, learner.segments);
        const gestScore = compareGestureDistribution(ref.segments, learner.segments);
        const postureScore = comparePosture(ref.segments, learner.segments);
        const overall = (dirScore + trajScore + velScore + gestScore + postureScore) / 5;

        const feedback: string[] = [];
        if (velScore < 60) feedback.push('Try matching the speed/tempo of the reference');
        if (trajScore < 60) feedback.push('Movement duration and flow differ significantly');
        if (postureScore < 60) feedback.push('Body positioning needs improvement');
        if (dirScore < 60) feedback.push('Movement sequence differs from reference');
        if (overall >= 80) feedback.push('Great motion match!');

        return {
          score: Math.round(overall),
          breakdown: {
            direction: Math.round(dirScore), trajectory: Math.round(trajScore),
            velocity: Math.round(velScore), gestures: Math.round(gestScore),
            posture: Math.round(postureScore),
          },
          feedback,
        };
      },
    },
  ],
};

// ── Legacy helpers (for multi-dtw) ──

function compareSequences(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 30;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return (dp[m][n] / Math.max(m, n)) * 100;
}

function compareSegments(refSegs: MotionPattern['segments'], learnerSegs: MotionPattern['segments']): number {
  if (refSegs.length === 0 && learnerSegs.length === 0) return 100;
  if (refSegs.length === 0 || learnerSegs.length === 0) return 30;
  const refDur = refSegs.reduce((s, seg) => s + seg.duration, 0);
  const learnerDur = learnerSegs.reduce((s, seg) => s + seg.duration, 0);
  const durScore = refDur > 0 ? Math.max(0, 100 - Math.abs(refDur - learnerDur) / refDur * 100) : 50;
  const countScore = Math.max(0, 100 - Math.abs(refSegs.length - learnerSegs.length) / Math.max(refSegs.length, learnerSegs.length) * 100);
  return (durScore + countScore) / 2;
}

function compareGestureDistribution(refSegs: MotionPattern['segments'], learnerSegs: MotionPattern['segments']): number {
  const build = (items: string[]): Map<string, number> => {
    const d = new Map<string, number>(); items.forEach(i => d.set(i, (d.get(i) || 0) + 1)); return d;
  };
  const a = build(refSegs.map(s => s.type)), b = build(learnerSegs.map(s => s.type));
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dot = 0, mA = 0, mB = 0;
  keys.forEach(k => { const va = a.get(k) || 0, vb = b.get(k) || 0; dot += va * vb; mA += va * va; mB += vb * vb; });
  return (mA === 0 || mB === 0) ? 0 : (dot / (Math.sqrt(mA) * Math.sqrt(mB))) * 100;
}

function comparePosture(refSegs: MotionPattern['segments'], learnerSegs: MotionPattern['segments']): number {
  const rL = refSegs[0]?.landmarks, lL = learnerSegs[0]?.landmarks;
  if (!rL || !lL || rL.length === 0 || lL.length === 0) return 50;
  const len = Math.min(rL.length, lL.length);
  let total = 0;
  for (let i = 0; i < len; i++) {
    const r = rL[i], l = lL[i];
    if (r && l && r.length >= 2 && l.length >= 2) total += Math.sqrt((r[0] - l[0]) ** 2 + (r[1] - l[1]) ** 2);
  }
  return Math.max(0, Math.round(100 - (total / len) * 200));
}
