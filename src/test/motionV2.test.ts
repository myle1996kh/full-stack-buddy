import { describe, expect, it } from 'vitest';
import type { MotionFrameV2, MotionPatternV2 } from '@/engine/motion/types';
import { JOINT_NAMES } from '@/engine/motion/types';
import { comparePoseAngles } from '@/engine/motion/poseAnglesComparer';
import { extractMotionPatternV2 } from '@/engine/motion/patternExtractor';

function makePattern(overrides: Partial<MotionPatternV2> = {}): MotionPatternV2 {
  const contour = new Array(120).fill(0).map((_, i) => Math.sin(i * 0.1) * 30 + 90);
  const angleContours: Record<string, number[]> = {};
  for (const joint of JOINT_NAMES) {
    angleContours[joint] = [...contour];
  }

  return {
    duration: 6,
    angleContours,
    velocityContour: new Array(120).fill(0).map((_, i) => Math.abs(Math.sin(i * 0.05)) * 0.3),
    segments: [
      { type: 'still', startTime: 0, endTime: 2, duration: 2, avgAngles: {}, avgVelocity: 0.02 },
      { type: 'gesture', startTime: 2, endTime: 4, duration: 2, avgAngles: {}, avgVelocity: 0.15 },
      { type: 'movement', startTime: 4, endTime: 6, duration: 2, avgAngles: {}, avgVelocity: 0.28 },
    ],
    avgVelocity: 0.15,
    poseDistribution: { still: 0.33, subtle: 0.1, gesture: 0.3, movement: 0.22, active: 0.05 },
    gestureSequence: ['still', 'gesture', 'movement'],
    limbRatios: [0.9, 0.8, 0.9, 0.8, 1.1, 1.0, 1.1, 1.0, 1.0, 1.0],
    quality: { avgConfidence: 0.9, missingFrameRatio: 0 },
    ...overrides,
  };
}

function makeLandmarks(seed: number): [number, number, number][] {
  return new Array(33).fill(0).map((_, i) => [seed + i * 0.001, seed + i * 0.0015, 0]) as [number, number, number][];
}

describe('Motion V2 - pose angle comparer', () => {
  it('scores high for identical patterns', () => {
    const ref = makePattern();
    const learner = makePattern();

    const result = comparePoseAngles(ref, learner);
    expect(result.score).toBeGreaterThan(85);
    expect(result.breakdown.arms).toBeGreaterThan(80);
    expect(result.breakdown.legs).toBeGreaterThan(80);
  });

  it('degrades score when arm contours diverge strongly', () => {
    const ref = makePattern();
    const learner = makePattern({
      angleContours: {
        ...ref.angleContours,
        leftElbow: new Array(120).fill(20),
        rightElbow: new Array(120).fill(20),
        leftShoulder: new Array(120).fill(30),
        rightShoulder: new Array(120).fill(30),
      },
    });

    const result = comparePoseAngles(ref, learner);
    expect(result.breakdown.arms).toBeLessThan(60);
    expect(result.score).toBeLessThan(80);
  });

  it('applies quality penalty when missing frame ratio is high', () => {
    const ref = makePattern();
    const learner = makePattern({ quality: { avgConfidence: 0.4, missingFrameRatio: 0.6 } });

    const withPenalty = comparePoseAngles(ref, learner, undefined, { applyQualityPenalty: true });
    const withoutPenalty = comparePoseAngles(ref, learner, undefined, { applyQualityPenalty: false });

    expect(withPenalty.score).toBeLessThan(withoutPenalty.score);
  });
});

describe('Motion V2 - pattern extraction', () => {
  it('extracts contours and segment transitions from frames', () => {
    const frames: MotionFrameV2[] = [];

    for (let i = 0; i < 12; i++) {
      const poseLabel = i < 4 ? 'still' : i < 8 ? 'gesture' : 'movement';
      frames.push({
        t: i * 0.1,
        landmarks: makeLandmarks(i * 0.01),
        jointAngles: {
          leftElbow: 90 + i,
          rightElbow: 95 + i,
          leftShoulder: 80 + i,
          rightShoulder: 82 + i,
          leftHip: 100,
          rightHip: 100,
          leftKnee: 120,
          rightKnee: 120,
        },
        relativeAngles: new Array(10).fill(0.5),
        velocity: i < 4 ? 0.02 : i < 8 ? 0.16 : 0.3,
        poseLabel,
        quality: 0.9,
      });
    }

    const pattern = extractMotionPatternV2(frames, 1.2);
    expect(pattern.angleContours.leftElbow).toHaveLength(120);
    expect(pattern.velocityContour).toHaveLength(120);
    expect(pattern.segments.length).toBeGreaterThanOrEqual(3);
    expect(pattern.gestureSequence.length).toBe(pattern.segments.length);
  });

  it('is deterministic for same input frames', () => {
    const frames: MotionFrameV2[] = new Array(8).fill(0).map((_, i) => ({
      t: i * 0.1,
      landmarks: makeLandmarks(0.02 * i),
      jointAngles: {
        leftElbow: 90,
        rightElbow: 90,
        leftShoulder: 80,
        rightShoulder: 80,
        leftHip: 100,
        rightHip: 100,
        leftKnee: 120,
        rightKnee: 120,
      },
      relativeAngles: new Array(10).fill(0.5),
      velocity: 0.1,
      poseLabel: 'subtle',
      quality: 0.8,
    }));

    const a = extractMotionPatternV2(frames, 0.8);
    const b = extractMotionPatternV2(frames, 0.8);

    expect(a).toEqual(b);
  });
});
