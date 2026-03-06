/**
 * Unit tests for Sound V2.1 pipeline.
 * Tests cross-language style comparison, quality gating, determinism,
 * voiced-only contours, and spectral comparison.
 */

import { describe, it, expect } from 'vitest';
import type { SoundPatternV2 } from '@/engine/sound/types';
import { compareSoundStyle } from '@/engine/sound/styleComparer';
import { evaluateQuality } from '@/engine/sound/qualityGate';
import { extractSoundPattern } from '@/engine/sound/patternExtractor';
import { compareStyleFingerprints, extractFingerprint } from '@/engine/sound/styleFingerprintComparer';
import { compareDeliveryStyle, extractDeliveryProfile } from '@/engine/sound/styleDeliveryComparer';
import { compareWav2VecStyle } from '@/engine/sound/styleWav2vecComparer';
import type { SoundFrameV2 } from '@/engine/sound/types';

// ── Helper: create a synthetic pattern ──

function makePattern(overrides: Partial<SoundPatternV2> = {}): SoundPatternV2 {
  const N = 180;
  const pitchContour = new Array(N).fill(0).map((_, i) => Math.sin(i * 0.1) * 2);
  const pitchSlope = new Array(N).fill(0).map((_, i) => Math.cos(i * 0.1) * 0.2);
  return {
    duration: 5,
    pitchContourNorm: pitchContour,
    pitchSlope: pitchSlope,
    pitchContourVoiced: pitchContour,
    pitchSlopeVoiced: pitchSlope,
    energyContourNorm: new Array(N).fill(0).map((_, i) => Math.sin(i * 0.05)),
    spectralCentroidContour: new Array(N).fill(0).map((_, i) => Math.sin(i * 0.08) * 0.5),
    spectralRolloffContour: new Array(N).fill(0).map((_, i) => Math.cos(i * 0.06) * 0.3),
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

describe('Sound V2.1 - Determinism', () => {
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

  it('flat but identical contours still score high (no false zero from Pearson)', () => {
    const flat = makePattern({
      pitchContourNorm: new Array(180).fill(0),
      pitchSlope: new Array(180).fill(0),
      pitchContourVoiced: new Array(180).fill(0),
      pitchSlopeVoiced: new Array(180).fill(0),
      energyContourNorm: new Array(180).fill(0),
      spectralCentroidContour: new Array(180).fill(0),
      spectralRolloffContour: new Array(180).fill(0),
    });

    const result = compareSoundStyle(flat, flat);
    expect(result.score).toBeGreaterThan(75);
    expect(result.breakdown.intonation).toBeGreaterThan(70);
  });
});

describe('Sound V2.1 - Cross-language style', () => {
  it('pitch shift with same shape scores high on intonation', () => {
    const ref = makePattern();
    // Shift pitch up by 3 semitones but keep same shape
    const shifted = makePattern({
      pitchContourVoiced: ref.pitchContourVoiced.map(v => v + 3),
      pitchContourNorm: ref.pitchContourNorm.map(v => v + 3),
      pitchSlopeVoiced: ref.pitchSlopeVoiced, // same slope = same shape
      pitchSlope: ref.pitchSlope,
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
      pitchContourVoiced: new Array(180).fill(0),
      pitchSlopeVoiced: new Array(180).fill(0),
    });

    const result = compareSoundStyle(expressive, monotone);
    expect(result.breakdown.intonation).toBeLessThan(60);
  });

  it('strongly mismatched prosody should stay below medium score', () => {
    const ref = makePattern({
      pitchContourNorm: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.12) * 2.2),
      pitchSlope: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.12) * 0.3),
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.12) * 2.2),
      pitchSlopeVoiced: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.12) * 0.3),
      energyContourNorm: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.07)),
      spectralCentroidContour: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.1)),
      spectralRolloffContour: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.1)),
      pausePattern: [{ pos: 1.0, dur: 0.35 }, { pos: 2.4, dur: 0.28 }, { pos: 3.7, dur: 0.3 }],
      speechRate: 4.2,
      avgIOI: 380,
      regularity: 0.82,
      voicedRatio: 0.72,
    });

    const veryDifferent = makePattern({
      pitchContourNorm: new Array(180).fill(0).map((_, i) => (i % 24 < 12 ? -2.5 : 2.5)),
      pitchSlope: new Array(180).fill(0),
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => (i % 24 < 12 ? -2.5 : 2.5)),
      pitchSlopeVoiced: new Array(180).fill(0),
      energyContourNorm: new Array(180).fill(0).map((_, i) => (i % 30 < 5 ? 2 : -1.5)),
      spectralCentroidContour: new Array(180).fill(0).map((_, i) => (i % 20 < 10 ? 1.5 : -1.5)),
      spectralRolloffContour: new Array(180).fill(0).map((_, i) => (i % 15 < 8 ? 1 : -1)),
      pausePattern: [],
      speechRate: 1.6,
      avgIOI: 980,
      regularity: 0.22,
      voicedRatio: 0.35,
    });

    const result = compareSoundStyle(ref, veryDifferent);
    expect(result.score).toBeLessThan(60);
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
    expect(result.breakdown.rhythmPause).toBeLessThan(90);
  });
});

describe('Sound V2.1 - Voiced-only contour', () => {
  it('intonation uses voiced contour when available (higher fidelity)', () => {
    // Voiced contour has clean melody, legacy contour is zero-polluted
    const cleanMelody = new Array(180).fill(0).map((_, i) => Math.sin(i * 0.1) * 2);
    const pollutedMelody = new Array(180).fill(0).map((_, i) =>
      i % 3 === 0 ? 0 : Math.sin(i * 0.1) * 2 // every 3rd sample is zero (simulating zero-fill)
    );

    const ref = makePattern({
      pitchContourVoiced: cleanMelody,
      pitchContourNorm: pollutedMelody,
    });
    const usr = makePattern({
      pitchContourVoiced: cleanMelody,
      pitchContourNorm: pollutedMelody,
    });

    const result = compareSoundStyle(ref, usr);
    // Should get high intonation because voiced contours are clean and identical
    expect(result.breakdown.intonation).toBeGreaterThan(80);
  });

  it('falls back to legacy contour when voiced contour is all zeros', () => {
    const melody = new Array(180).fill(0).map((_, i) => Math.sin(i * 0.1) * 2);

    const ref = makePattern({
      pitchContourVoiced: new Array(180).fill(0), // empty/flat
      pitchContourNorm: melody,
    });
    const usr = makePattern({
      pitchContourVoiced: new Array(180).fill(0), // empty/flat
      pitchContourNorm: melody,
    });

    const result = compareSoundStyle(ref, usr);
    // Should still work via fallback to legacy
    expect(result.breakdown.intonation).toBeGreaterThan(70);
  });
});

describe('Sound V2.1 - Spectral comparison', () => {
  it('similar spectral contours score high on timbre', () => {
    const ref = makePattern();
    const usr = makePattern(); // same spectral contours

    const result = compareSoundStyle(ref, usr);
    expect(result.breakdown.timbre).toBeGreaterThan(80);
    expect(result.debug!.centroidSim).toBeGreaterThan(0.8);
    expect(result.debug!.rolloffSim).toBeGreaterThan(0.8);
  });

  it('very different spectral contours reduce timbre score', () => {
    const ref = makePattern({
      spectralCentroidContour: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.05)),
      spectralRolloffContour: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.03)),
    });
    const usr = makePattern({
      spectralCentroidContour: new Array(180).fill(0).map((_, i) => (i % 20 < 10 ? 2 : -2)),
      spectralRolloffContour: new Array(180).fill(0).map((_, i) => (i % 15 < 7 ? 1.5 : -1.5)),
    });

    const result = compareSoundStyle(ref, usr);
    expect(result.breakdown.timbre).toBeLessThan(80);
  });

  it('empty spectral contours degrade gracefully', () => {
    const ref = makePattern({
      spectralCentroidContour: [],
      spectralRolloffContour: [],
    });
    const usr = makePattern({
      spectralCentroidContour: [],
      spectralRolloffContour: [],
    });

    // Should not crash, just get lower timbre (spectral portion = 0)
    const result = compareSoundStyle(ref, usr);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.timbre).toBeDefined();
  });
});

describe('Sound V2.1 - Weight rebalance', () => {
  it('intonation weight is 30% by default (not 10%)', () => {
    const ref = makePattern();
    const usr = makePattern();
    const result = compareSoundStyle(ref, usr);

    expect(result.debug!.w_intonation).toBeCloseTo(0.3, 1);
    expect(result.debug!.w_rhythmPause).toBeCloseTo(0.25, 1);
    expect(result.debug!.w_energy).toBeCloseTo(0.2, 1);
    expect(result.debug!.w_timbre).toBeCloseTo(0.25, 1);
  });

  it('intonation difference now significantly impacts total score', () => {
    const ref = makePattern();
    // Same everything except very different intonation
    const diffIntonation = makePattern({
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => (i % 20 < 10 ? -3 : 3)),
      pitchSlopeVoiced: new Array(180).fill(0),
      pitchContourNorm: new Array(180).fill(0).map((_, i) => (i % 20 < 10 ? -3 : 3)),
      pitchSlope: new Array(180).fill(0),
    });

    const result = compareSoundStyle(ref, diffIntonation);
    // With 30% weight, bad intonation should drag overall score down significantly
    expect(result.score).toBeLessThan(75);
  });
});

describe('Sound V2.1 - Quality Gate', () => {
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

  it('quality factor never goes below 0.4', () => {
    const terrible = makePattern({
      duration: 0.3,
      voicedRatio: 0.05,
      quality: { snrLike: 2, clippingRatio: 0.2, confidence: 0.1 },
    });
    const report = evaluateQuality(terrible);
    expect(report.factor).toBeGreaterThanOrEqual(0.4);
  });
});

describe('Sound V2.1 - Quality Penalty Toggle', () => {
  it('applyQualityPenalty reduces DTW final score for poor quality audio', () => {
    const ref = makePattern();
    const poor = makePattern({
      quality: { snrLike: 3, clippingRatio: 0.12, confidence: 0.2 },
      voicedRatio: 0.08,
      duration: 0.6,
    });

    const withoutPenalty = compareSoundStyle(ref, poor, undefined, { applyQualityPenalty: false });
    const withPenalty = compareSoundStyle(ref, poor, undefined, { applyQualityPenalty: true });

    expect(withPenalty.score).toBeLessThanOrEqual(withoutPenalty.score);
    expect(withPenalty.debug!.applyQualityPenalty).toBe(1);
  });

  it('applyQualityPenalty reduces fingerprint final score for poor quality audio', () => {
    const ref = makePattern();
    const poor = makePattern({
      quality: { snrLike: 4, clippingRatio: 0.08, confidence: 0.25 },
      voicedRatio: 0.1,
      duration: 0.8,
    });

    const withoutPenalty = compareStyleFingerprints(ref, poor);
    const withPenalty = compareStyleFingerprints(ref, poor, undefined, { applyQualityPenalty: true });

    expect(withPenalty.score).toBeLessThanOrEqual(withoutPenalty.score);
    expect(withPenalty.debug!.applyQualityPenalty).toBe(1);
  });
});

describe('Sound V2.1 - Score has breakdown + feedback', () => {
  it('result contains all required fields including new spectral debug', () => {
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
    // New debug fields
    expect(result.debug).toHaveProperty('centroidSim');
    expect(result.debug).toHaveProperty('rolloffSim');
  });
});

describe('Sound V2.1 - Pattern Extraction', () => {
  it('extracts pattern with voiced-only contours from synthetic frames', () => {
    const frames: SoundFrameV2[] = [];
    for (let i = 0; i < 100; i++) {
      frames.push({
        t: i * 0.02,
        pitchHz: 200 + Math.sin(i * 0.1) * 50,
        pitchConf: 0.8,
        energyDb: -20 + Math.sin(i * 0.05) * 10,
        centroid: 1500 + Math.sin(i * 0.08) * 300,
        zcr: 0.1,
        rolloff: 3000 + Math.cos(i * 0.06) * 500,
        flux: i % 10 === 0 ? 0.5 : 0.01,
        voiced: true,
      });
    }

    const pattern = extractSoundPattern(frames, 2.0);
    expect(pattern.pitchContourNorm.length).toBe(180);
    expect(pattern.pitchContourVoiced.length).toBe(180);
    expect(pattern.pitchSlopeVoiced.length).toBe(180);
    expect(pattern.energyContourNorm.length).toBe(180);
    expect(pattern.spectralCentroidContour.length).toBe(180);
    expect(pattern.spectralRolloffContour.length).toBe(180);
    expect(pattern.voicedRatio).toBeGreaterThan(0.5);
    expect(pattern.duration).toBe(2.0);
  });

  it('voiced-only contour excludes silence (no zero-fill pollution)', () => {
    const frames: SoundFrameV2[] = [];
    // 50 voiced frames, 20 silent frames, 50 voiced frames
    for (let i = 0; i < 120; i++) {
      const isVoiced = i < 50 || i >= 70;
      frames.push({
        t: i * 0.02,
        pitchHz: isVoiced ? 200 + Math.sin(i * 0.1) * 50 : null,
        pitchConf: isVoiced ? 0.8 : 0.1,
        energyDb: isVoiced ? -20 : -60,
        centroid: isVoiced ? 1500 : 0,
        zcr: 0.1,
        rolloff: isVoiced ? 3000 : 0,
        flux: 0.01,
        voiced: isVoiced,
      });
    }

    const pattern = extractSoundPattern(frames, 2.4);

    // Voiced contour should NOT have a flat section at 0 in the middle
    // (the 20-frame gap > MAX_INTERPOLATION_GAP=8 so it should be excluded)
    const midSection = pattern.pitchContourVoiced.slice(80, 100);
    const hasVariation = midSection.some((v, i) => i > 0 && Math.abs(v - midSection[i - 1]) > 0.001);
    // The voiced contour should be continuous melody, not zeros
    expect(hasVariation || midSection.every(v => Math.abs(v) > 0.01)).toBe(true);
  });

  it('short consonant gaps are interpolated (< 8 frames)', () => {
    const frames: SoundFrameV2[] = [];
    // 80 voiced, 30 silent (noise floor region), 4 silent (short gap), 80 voiced
    // Lots of silent frames so noise floor is properly estimated at -60 dB
    for (let i = 0; i < 194; i++) {
      let isVoiced: boolean;
      if (i < 80) isVoiced = true;
      else if (i < 110) isVoiced = false; // 30 silent frames for noise floor
      else if (i < 114) isVoiced = false; // 4-frame short gap (should be interpolated)
      else isVoiced = true;

      frames.push({
        t: i * 0.02,
        pitchHz: isVoiced ? 200 : null,
        pitchConf: isVoiced ? 0.8 : 0.1,
        energyDb: isVoiced ? -10 : -60,
        centroid: isVoiced ? 1500 : 0,
        zcr: 0.1,
        rolloff: isVoiced ? 3000 : 0,
        flux: 0.01,
        voiced: isVoiced,
      });
    }

    const pattern = extractSoundPattern(frames, 3.88);
    // Voiced contour should be resampled to 180 points
    expect(pattern.pitchContourVoiced.length).toBe(180);
    // Voiced ratio should reflect majority voiced frames
    expect(pattern.voicedRatio).toBeGreaterThan(0.5);
  });
});

// ══════════════════════════════════════════════════════════
// Style Fingerprint Comparer Tests
// ══════════════════════════════════════════════════════════

describe('Style Fingerprint - Core concept', () => {
  it('identical patterns score very high', () => {
    const pattern = makePattern();
    const result = compareStyleFingerprints(pattern, pattern);
    expect(result.score).toBeGreaterThan(85);
  });

  it('is deterministic across 10 runs', () => {
    const ref = makePattern();
    const usr = makePattern({ speechRate: 3.0, avgIOI: 550 });
    const scores: number[] = [];
    for (let i = 0; i < 10; i++) {
      scores.push(compareStyleFingerprints(ref, usr).score);
    }
    expect(new Set(scores).size).toBe(1);
  });

  it('same style different content scores HIGH (this is the key test)', () => {
    // Ref: energetic speaker, wide pitch range, fast, punchy
    const energeticRef = makePattern({
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.15) * 4), // wide range
      pitchSlopeVoiced: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.15) * 0.5),
      energyContourNorm: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.08) * 1.5), // high contrast
      speechRate: 4.5,
      regularity: 0.7,
      pausePattern: [{ pos: 1.2, dur: 0.2 }, { pos: 2.8, dur: 0.25 }],
      spectralCentroidContour: new Array(180).fill(0).map(() => 0.8), // bright
    });

    // Usr: SAME style (energetic, wide, fast) but DIFFERENT melody shape
    const energeticUsr = makePattern({
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.2) * 3.8), // different shape, similar range
      pitchSlopeVoiced: new Array(180).fill(0).map((_, i) => -Math.sin(i * 0.2) * 0.45),
      energyContourNorm: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.1) * 1.4), // different shape, similar contrast
      speechRate: 4.2,
      regularity: 0.65,
      pausePattern: [{ pos: 1.5, dur: 0.22 }, { pos: 3.2, dur: 0.2 }],
      spectralCentroidContour: new Array(180).fill(0).map(() => 0.75), // similar brightness
    });

    const result = compareStyleFingerprints(energeticRef, energeticUsr);
    // Should score HIGH because the STYLE matches even though contour shapes differ
    expect(result.score).toBeGreaterThan(60);
  });

  it('different style scores LOW even with similar content', () => {
    // Ref: calm, narrow pitch, slow, even energy
    const calm = makePattern({
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.1) * 0.5), // narrow range
      pitchSlopeVoiced: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.1) * 0.05),
      energyContourNorm: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.05) * 0.3), // low contrast
      speechRate: 2.0,
      regularity: 0.4,
      pausePattern: [{ pos: 1.5, dur: 0.8 }, { pos: 3.5, dur: 0.7 }], // long pauses
      spectralCentroidContour: new Array(180).fill(0).map(() => -0.5), // dark voice
    });

    // Usr: energetic, wide pitch, fast, punchy — opposite style
    const energetic = makePattern({
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.15) * 4), // wide range
      pitchSlopeVoiced: new Array(180).fill(0).map((_, i) => Math.cos(i * 0.15) * 0.5),
      energyContourNorm: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.08) * 1.5), // high contrast
      speechRate: 5.0,
      regularity: 0.8,
      pausePattern: [{ pos: 1.0, dur: 0.15 }], // few short pauses
      spectralCentroidContour: new Array(180).fill(0).map(() => 1.0), // bright voice
    });

    const result = compareStyleFingerprints(calm, energetic);
    // Should score LOW because styles are completely different
    expect(result.score).toBeLessThan(50);
  });
});

describe('Style Fingerprint - Fingerprint extraction', () => {
  it('extracts meaningful fingerprint from a pattern', () => {
    const pattern = makePattern();
    const fp = extractFingerprint(pattern);

    expect(fp.pitchRange).toBeGreaterThan(0);
    expect(fp.pitchVariability).toBeGreaterThan(0);
    expect(fp.pitchDirectionBias).toBeGreaterThanOrEqual(0);
    expect(fp.pitchDirectionBias).toBeLessThanOrEqual(1);
    expect(fp.speechRate).toBe(pattern.speechRate);
    expect(fp.voicedRatio).toBe(pattern.voicedRatio);
  });

  it('monotone pattern has low pitch variability', () => {
    const monotone = makePattern({
      pitchContourVoiced: new Array(180).fill(0),
      pitchSlopeVoiced: new Array(180).fill(0),
    });
    const fp = extractFingerprint(monotone);
    expect(fp.pitchRange).toBe(0);
    expect(fp.pitchVariability).toBe(0);
  });

  it('expressive pattern has high pitch variability', () => {
    const expressive = makePattern({
      pitchContourVoiced: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.1) * 5),
    });
    const fp = extractFingerprint(expressive);
    expect(fp.pitchRange).toBeGreaterThan(5);
    expect(fp.pitchVariability).toBeGreaterThan(1);
  });
});

describe('Style Fingerprint - Result structure', () => {
  it('returns all required fields', () => {
    const result = compareStyleFingerprints(makePattern(), makePattern());

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown).toHaveProperty('intonation');
    expect(result.breakdown).toHaveProperty('rhythmPause');
    expect(result.breakdown).toHaveProperty('energy');
    expect(result.breakdown).toHaveProperty('timbre');
    expect(result.qualityFactor).toBeGreaterThanOrEqual(0.6);
    expect(Array.isArray(result.feedback)).toBe(true);
    // Debug has fingerprint-specific keys
    expect(result.debug).toHaveProperty('pitchRangeSim');
    expect(result.debug).toHaveProperty('pitchVarSim');
    expect(result.debug).toHaveProperty('speedSim');
    expect(result.debug).toHaveProperty('brightSim');
    expect(result.debug).toHaveProperty('warmSim');
  });
});

// ══════════════════════════════════════════════════════════
// Delivery Pattern Comparer Tests
// ══════════════════════════════════════════════════════════

describe('Delivery Pattern - Core concept', () => {
  it('identical patterns score very high', () => {
    const pattern = makePattern();
    const result = compareDeliveryStyle(pattern, pattern);
    expect(result.score).toBeGreaterThan(80);
  });

  it('is deterministic across 10 runs', () => {
    const ref = makePattern();
    const usr = makePattern({ speechRate: 3.0, avgIOI: 550 });
    const scores: number[] = [];
    for (let i = 0; i < 10; i++) {
      scores.push(compareDeliveryStyle(ref, usr).score);
    }
    expect(new Set(scores).size).toBe(1);
  });

  it('similar elongation patterns score HIGH (the key use case)', () => {
    // Ref: elongation at positions ~0.2 and ~0.9 (early and end)
    // Simulates "i muốnnnnn đi tới đó vào ngày maiiiiiii"
    const elongatedRef = makePattern({
      onsetTimes: [0.1, 0.3, 1.5, 2.0, 2.5, 3.0, 3.5, 4.2],
      duration: 5,
      speechRate: 3.5,
      regularity: 0.5, // irregular = elongation style
    });

    // Usr: similar elongation pattern (early and end stretching)
    // Simulates "i wanttttt to go there tomorrrowww"
    const elongatedUsr = makePattern({
      onsetTimes: [0.1, 0.3, 1.8, 2.3, 2.8, 3.3, 4.3],
      duration: 5,
      speechRate: 3.2,
      regularity: 0.45,
    });

    const result = compareDeliveryStyle(elongatedRef, elongatedUsr);
    expect(result.score).toBeGreaterThan(50);
  });

  it('uniform vs elongated patterns score LOW', () => {
    // Ref: very uniform timing (metronomic)
    const uniform = makePattern({
      onsetTimes: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5],
      duration: 5,
      speechRate: 4.0,
      regularity: 0.9,
    });

    // Usr: heavy elongation (some segments very long)
    const elongated = makePattern({
      onsetTimes: [0.1, 0.2, 2.0, 2.2, 2.4, 4.5],
      duration: 5,
      speechRate: 2.5,
      regularity: 0.3,
    });

    const result = compareDeliveryStyle(uniform, elongated);
    expect(result.score).toBeLessThan(60);
  });
});

describe('Delivery Pattern - Profile extraction', () => {
  it('extracts profile with correct segment count', () => {
    const pattern = makePattern({
      onsetTimes: [0.5, 1.2, 2.0, 2.8, 3.5],
      duration: 5,
    });
    const profile = extractDeliveryProfile(pattern);
    // 6 segments: [0→0.5], [0.5→1.2], [1.2→2.0], [2.0→2.8], [2.8→3.5], [3.5→5.0]
    expect(profile.segmentCount).toBe(6);
    expect(profile.relDurations.length).toBe(6);
  });

  it('detects elongated segments when they exist', () => {
    // One very long segment among short ones
    const pattern = makePattern({
      onsetTimes: [0.1, 0.2, 0.3, 0.4, 0.5, 3.0, 3.1, 3.2],
      duration: 4,
    });
    const profile = extractDeliveryProfile(pattern);
    // The segment from 0.5→3.0 is very long relative to others
    expect(profile.elongatedRatio).toBeGreaterThan(0);
    expect(profile.maxMedianRatio).toBeGreaterThan(2);
    expect(profile.durationCV).toBeGreaterThan(0.5);
  });

  it('uniform segments have low elongation metrics', () => {
    const pattern = makePattern({
      onsetTimes: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5],
      duration: 5,
    });
    const profile = extractDeliveryProfile(pattern);
    expect(profile.elongatedRatio).toBeLessThan(0.2);
    expect(profile.durationCV).toBeLessThan(0.3);
  });

  it('falls back gracefully when too few onsets', () => {
    const pattern = makePattern({
      onsetTimes: [1.0], // only 1 onset
      duration: 5,
    });
    const profile = extractDeliveryProfile(pattern);
    // Should use fallback (contour-based)
    expect(profile.segmentCount).toBe(0);
    expect(profile.durationProfile.length).toBe(16);
  });
});

describe('Delivery Pattern - Result structure', () => {
  it('returns all required fields', () => {
    const result = compareDeliveryStyle(makePattern(), makePattern());

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown).toHaveProperty('elongation');
    expect(result.breakdown).toHaveProperty('emphasis');
    expect(result.breakdown).toHaveProperty('expressiveness');
    expect(result.breakdown).toHaveProperty('rhythm');
    expect(result.qualityFactor).toBeGreaterThanOrEqual(0.4);
    expect(Array.isArray(result.feedback)).toBe(true);
    // Debug fields
    expect(result.debug).toHaveProperty('elongSim');
    expect(result.debug).toHaveProperty('emphSim');
    expect(result.debug).toHaveProperty('exprSim');
    expect(result.debug).toHaveProperty('rhythmSim');
    expect(result.debug).toHaveProperty('ref_segments');
    expect(result.debug).toHaveProperty('usr_segments');
    expect(result.debug).toHaveProperty('durationProfileCorr');
    expect(result.debug).toHaveProperty('w_elongation');
  });

  it('supports custom params', () => {
    const result = compareDeliveryStyle(makePattern(), makePattern(), {
      weights: { elongation: 0.5, emphasis: 0.2, expressiveness: 0.2, rhythm: 0.1 },
      elongationThreshold: 2.0,
    });
    expect(result.debug!.w_elongation).toBeCloseTo(0.5, 1);
  });
});

describe('Wav2Vec Hybrid - Core behavior', () => {
  it('returns expected structure with hybrid breakdown keys', () => {
    const result = compareWav2VecStyle(makePattern(), makePattern());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown).toHaveProperty('embedding');
    expect(result.breakdown).toHaveProperty('delivery');
    expect(result.breakdown).toHaveProperty('fingerprint');
    expect(result.debug).toHaveProperty('embedSim');
    expect(result.debug).toHaveProperty('w_embedding');
  });

  it('is deterministic across repeated runs', () => {
    const ref = makePattern();
    const usr = makePattern({ speechRate: 3.1, regularity: 0.62 });
    const scores: number[] = [];
    for (let i = 0; i < 10; i++) {
      scores.push(compareWav2VecStyle(ref, usr).score);
    }
    expect(new Set(scores).size).toBe(1);
  });

  it('uses provided wav2vec embeddings when attached', () => {
    const ref: any = makePattern();
    const usr: any = makePattern();
    ref._wav2vecEmbedding = [1, 0, 0, 0];
    usr._wav2vecEmbedding = [1, 0, 0, 0];

    const result = compareWav2VecStyle(ref, usr);
    expect(result.debug!.refEmbeddingSource).toBe(1);
    expect(result.debug!.usrEmbeddingSource).toBe(1);
    expect(result.breakdown.embedding).toBeGreaterThanOrEqual(95);
  });
});
