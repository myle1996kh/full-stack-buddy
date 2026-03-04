/**
 * Unit tests for Sound V2 pipeline.
 * Tests cross-language style comparison, quality gating, and determinism.
 */

import { describe, it, expect } from 'vitest';
import type { SoundPatternV2 } from '@/engine/sound/types';
import { compareSoundStyle } from '@/engine/sound/styleComparer';
import { evaluateQuality } from '@/engine/sound/qualityGate';
import { extractSoundPattern } from '@/engine/sound/patternExtractor';
import type { SoundFrameV2 } from '@/engine/sound/types';

// ── Helper: create a synthetic pattern ──

function makePattern(overrides: Partial<SoundPatternV2> = {}): SoundPatternV2 {
  const N = 180;
  return {
    duration: 5,
    pitchContourNorm: new Array(N).fill(0).map((_, i) => Math.sin(i * 0.1) * 2),
    pitchSlope: new Array(N).fill(0).map((_, i) => Math.cos(i * 0.1) * 0.2),
    energyContourNorm: new Array(N).fill(0).map((_, i) => Math.sin(i * 0.05)),
    onsetTimes: [0.5, 1.2, 2.0, 2.8, 3.5],
    pausePattern: [{ pos: 1.5, dur: 0.3 }, { pos: 3.0, dur: 0.25 }],
    speechRate: 3.5,
    avgIOI: 500,
    regularity: 0.7,
    voicedRatio: 0.6,
    quality: { snrLike: 25, clippingRatio: 0, confidence: 0.8 },
    ...overrides,
  };
}

describe('Sound V2 - Determinism', () => {
  it('returns identical scores for identical inputs across 10 runs', () => {
    const ref = makePattern();
    const usr = makePattern();

    const scores: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = compareSoundStyle(ref, usr);
      scores.push(result.score);
    }

    // All scores must be identical
    expect(new Set(scores).size).toBe(1);
    expect(scores[0]).toBeGreaterThan(80); // same input = high score
  });
});

describe('Sound V2 - Cross-language style', () => {
  it('pitch shift with same shape scores high on intonation', () => {
    const ref = makePattern();
    // Shift pitch up by 3 semitones but keep same shape
    const shifted = makePattern({
      pitchContourNorm: ref.pitchContourNorm.map(v => v + 3),
      pitchSlope: ref.pitchSlope, // same slope = same shape
    });

    const result = compareSoundStyle(ref, shifted);
    // Intonation should still be reasonable because DTW handles shift
    expect(result.breakdown.intonation).toBeGreaterThan(40);
    expect(result.score).toBeGreaterThan(40);
  });

  it('monotone vs expressive shows low intonation score', () => {
    const expressive = makePattern();
    const monotone = makePattern({
      pitchContourNorm: new Array(180).fill(0),
      pitchSlope: new Array(180).fill(0),
    });

    const result = compareSoundStyle(expressive, monotone);
    expect(result.breakdown.intonation).toBeLessThan(60);
  });

  it('different speed but same prosody still scores okay (DTW flexibility)', () => {
    const ref = makePattern({ speechRate: 4.0, avgIOI: 400 });
    // Slower but same overall pattern shape
    const slower = makePattern({ speechRate: 2.5, avgIOI: 650 });

    const result = compareSoundStyle(ref, slower);
    // DTW should partially compensate for speed difference
    expect(result.score).toBeGreaterThan(30);
    // But rhythm should show the difference
    expect(result.breakdown.rhythmPause).toBeLessThan(80);
  });

  it('pause misalignment reduces rhythmPause score', () => {
    const ref = makePattern({
      pausePattern: [{ pos: 1.0, dur: 0.3 }, { pos: 3.0, dur: 0.4 }],
    });
    const misaligned = makePattern({
      pausePattern: [{ pos: 2.0, dur: 0.3 }, { pos: 4.5, dur: 0.4 }],
    });

    const result = compareSoundStyle(ref, misaligned);
    expect(result.breakdown.rhythmPause).toBeLessThan(70);
  });
});

describe('Sound V2 - Quality Gate', () => {
  it('high quality audio returns factor close to 1.0', () => {
    const pattern = makePattern({
      quality: { snrLike: 30, clippingRatio: 0, confidence: 0.9 },
      voicedRatio: 0.7,
    });
    const report = evaluateQuality(pattern);
    expect(report.factor).toBeGreaterThanOrEqual(0.95);
    expect(report.warnings).toHaveLength(0);
  });

  it('noisy audio reduces quality factor', () => {
    const pattern = makePattern({
      quality: { snrLike: 4, clippingRatio: 0, confidence: 0.7 },
    });
    const report = evaluateQuality(pattern);
    expect(report.factor).toBeLessThan(0.85);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('clipped audio produces warning and reduced factor', () => {
    const pattern = makePattern({
      quality: { snrLike: 25, clippingRatio: 0.1, confidence: 0.8 },
    });
    const report = evaluateQuality(pattern);
    expect(report.factor).toBeLessThan(0.9);
    expect(report.warnings.some(w => w.toLowerCase().includes('clip'))).toBe(true);
  });

  it('very short recording reduces factor', () => {
    const pattern = makePattern({ duration: 0.5 });
    const report = evaluateQuality(pattern);
    expect(report.factor).toBeLessThan(0.9);
  });

  it('quality factor never goes below 0.6', () => {
    const terrible = makePattern({
      duration: 0.3,
      voicedRatio: 0.05,
      quality: { snrLike: 2, clippingRatio: 0.2, confidence: 0.1 },
    });
    const report = evaluateQuality(terrible);
    expect(report.factor).toBeGreaterThanOrEqual(0.6);
  });
});

describe('Sound V2 - Score has breakdown + feedback', () => {
  it('result contains all required fields', () => {
    const ref = makePattern();
    const usr = makePattern();
    const result = compareSoundStyle(ref, usr);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown).toHaveProperty('intonation');
    expect(result.breakdown).toHaveProperty('rhythmPause');
    expect(result.breakdown).toHaveProperty('energy');
    expect(result.breakdown).toHaveProperty('timbre');
    expect(result.qualityFactor).toBeGreaterThanOrEqual(0.6);
    expect(result.qualityFactor).toBeLessThanOrEqual(1.0);
    expect(Array.isArray(result.feedback)).toBe(true);
  });
});

describe('Sound V2 - Pattern Extraction', () => {
  it('extracts pattern from synthetic frames', () => {
    const frames: SoundFrameV2[] = [];
    for (let i = 0; i < 100; i++) {
      frames.push({
        t: i * 0.02,
        pitchHz: 200 + Math.sin(i * 0.1) * 50,
        pitchConf: 0.8,
        energyDb: -20 + Math.sin(i * 0.05) * 10,
        centroid: 1500,
        zcr: 0.1,
        rolloff: 3000,
        flux: i % 10 === 0 ? 0.5 : 0.01,
        voiced: true,
      });
    }

    const pattern = extractSoundPattern(frames, 2.0);
    expect(pattern.pitchContourNorm.length).toBe(180);
    expect(pattern.energyContourNorm.length).toBe(180);
    expect(pattern.voicedRatio).toBeGreaterThan(0.5);
    expect(pattern.duration).toBe(2.0);
  });
});
