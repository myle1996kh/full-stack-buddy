import { describe, expect, it } from 'vitest';
import type { EyesFrameV2, EyesPatternV2 } from '@/engine/eyes/types';
import { compareGazePattern } from '@/engine/eyes/gazePatternComparer';
import { extractEyesPatternV2 } from '@/engine/eyes/patternExtractor';

function makePattern(overrides: Partial<EyesPatternV2> = {}): EyesPatternV2 {
  const gazeX = new Array(120).fill(0).map((_, i) => 0.5 + Math.sin(i * 0.08) * 0.12);
  const gazeY = new Array(120).fill(0).map((_, i) => 0.5 + Math.cos(i * 0.07) * 0.1);

  return {
    duration: 6,
    gazeContourX: gazeX,
    gazeContourY: gazeY,
    zoneDwellTimes: { center: 0.6, 'center-left': 0.2, 'center-right': 0.2 },
    zoneSequence: ['center', 'center-left', 'center', 'center-right', 'center'],
    attentionSegments: [
      { type: 'focused', startTime: 0, endTime: 2.5, duration: 2.5, avgZone: 'center' },
      { type: 'scanning', startTime: 2.5, endTime: 4.5, duration: 2.0, avgZone: 'center-left' },
      { type: 'focused', startTime: 4.5, endTime: 6, duration: 1.5, avgZone: 'center' },
    ],
    attentionDistribution: { focused: 0.66, scanning: 0.34, away: 0 },
    blinkRate: 16,
    blinkCount: 2,
    avgFixationDuration: 1.2,
    headPoseProfile: { avgYaw: 0.02, avgPitch: -0.01, yawStability: 0.05, pitchStability: 0.04 },
    primaryZone: 'center',
    quality: { faceDetectedRatio: 0.95, avgConfidence: 0.85 },
    ...overrides,
  };
}

describe('Eyes V2 - gaze pattern comparer', () => {
  it('scores high for identical patterns', () => {
    const ref = makePattern();
    const learner = makePattern();

    const result = compareGazePattern(ref, learner);
    expect(result.score).toBeGreaterThan(85);
    expect(result.breakdown.zoneMatch).toBeGreaterThan(80);
  });

  it('degrades zoneMatch when dwell distribution differs', () => {
    const ref = makePattern();
    const learner = makePattern({
      zoneDwellTimes: { 'top-left': 0.6, 'bottom-right': 0.4 },
      primaryZone: 'top-left',
    });

    const result = compareGazePattern(ref, learner);
    expect(result.breakdown.zoneMatch).toBeLessThan(60);
    expect(result.score).toBeLessThan(80);
  });

  it('applies quality penalty when face detection ratio is low', () => {
    const ref = makePattern();
    const learner = makePattern({ quality: { faceDetectedRatio: 0.4, avgConfidence: 0.4 } });

    const withPenalty = compareGazePattern(ref, learner, undefined, { applyQualityPenalty: true });
    const withoutPenalty = compareGazePattern(ref, learner, undefined, { applyQualityPenalty: false });

    expect(withPenalty.score).toBeLessThan(withoutPenalty.score);
  });
});

describe('Eyes V2 - pattern extraction', () => {
  it('extracts attention distribution and blink count from frames', () => {
    const frames: EyesFrameV2[] = [];

    for (let i = 0; i < 12; i++) {
      const t = i * 0.2;
      const faceDetected = i !== 5 && i !== 6;
      const gazeX = i < 8 ? 0.5 : 0.2 + (i - 8) * 0.2;
      const gazeY = 0.5;
      const zone = faceDetected ? (gazeX < 0.33 ? 'center-left' : gazeX > 0.66 ? 'center-right' : 'center') : 'center';

      frames.push({
        t,
        gazeX,
        gazeY,
        zone,
        blinkDetected: i === 2 || i === 3,
        earLeft: 0.24,
        earRight: 0.23,
        headYaw: faceDetected ? 0.02 : 0,
        headPitch: faceDetected ? -0.01 : 0,
        faceDetected,
        quality: faceDetected ? 0.8 : 0,
      });
    }

    const pattern = extractEyesPatternV2(frames, 2.4);
    expect(pattern.gazeContourX).toHaveLength(120);
    expect(pattern.gazeContourY).toHaveLength(120);
    expect(pattern.blinkCount).toBeGreaterThanOrEqual(1);
    expect(pattern.attentionDistribution.away).toBeGreaterThan(0);
  });

  it('is deterministic for the same frame sequence', () => {
    const frames: EyesFrameV2[] = new Array(8).fill(0).map((_, i) => ({
      t: i * 0.2,
      gazeX: 0.5,
      gazeY: 0.5,
      zone: 'center',
      blinkDetected: false,
      earLeft: 0.25,
      earRight: 0.25,
      headYaw: 0,
      headPitch: 0,
      faceDetected: true,
      quality: 0.9,
    }));

    const a = extractEyesPatternV2(frames, 1.6);
    const b = extractEyesPatternV2(frames, 1.6);

    expect(a).toEqual(b);
  });
});
