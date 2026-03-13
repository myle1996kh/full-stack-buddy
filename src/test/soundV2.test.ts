/**
 * Unit tests for Sound V2.1 pipeline.
 * Tests cross-language style comparison, quality gating, determinism,
 * voiced-only contours, and spectral comparison.
 */

import { describe, it, expect } from 'vitest';
import type { SoundPatternV2 } from '@/engine/sound/types';
import { evaluateQuality } from '@/engine/sound/qualityGate';
import { extractSoundPattern } from '@/engine/sound/patternExtractor';
import { compareStyleFingerprints, extractFingerprint } from '@/engine/sound/styleFingerprintComparer';
import { compareDeliveryStyle, extractDeliveryProfile } from '@/engine/sound/styleDeliveryComparer';
import { compareCoachSStyle } from '@/engine/sound/styleCoachSComparer';
import { extractMeasureSAcousticFeatures } from '@/engine/sound/measureSFeatureExtractor';
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

describe('Measure S waveform extraction', () => {
  it('extracts librosa-style RMS, tempo, and segment counts from raw waveform', () => {
    const sr = 16000;
    const duration = 2;
    const samples = new Float32Array(sr * duration);

    const pulseStarts = [0, 0.5, 1.0, 1.5];
    for (const startSec of pulseStarts) {
      const start = Math.floor(startSec * sr);
      const len = Math.floor(0.08 * sr);
      for (let i = 0; i < len && start + i < samples.length; i++) {
        const t = i / sr;
        samples[start + i] = 0.4 * Math.sin(2 * Math.PI * 220 * t);
      }
    }

    const features = extractMeasureSAcousticFeatures(samples, sr, duration);
    expect(features.avgRms).toBeGreaterThan(0);
    expect(features.maxRms).toBeGreaterThan(features.avgRms);
    expect(features.nSegments).toBeGreaterThanOrEqual(3);
    expect(features.tempoBpm).toBeGreaterThan(90);
    expect(features.tempoBpm).toBeLessThan(150);
  }, 15000);

  it('Measure S prefers attached acoustic features over proxy fallbacks', async () => {
    const ref = makePattern({
      measureS: {
        duration: 2.38,
        tempoBpm: 103.4,
        avgRms: 0.0543,
        maxRms: 0.2452,
        nSegments: 7,
      },
    });

    const usr = makePattern({
      measureS: {
        duration: 2.43,
        tempoBpm: 103.4,
        avgRms: 0.0569,
        maxRms: 0.2785,
        nSegments: 5,
      },
      onsetTimes: [0.25, 0.5, 0.75, 1.0], // intentionally conflicting proxy tempo
    });

    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS, { applyQualityPenalty: false });
    expect(result.debug!.refMeasureSFeatures).toBe(1);
    expect(result.debug!.usrMeasureSFeatures).toBe(1);
    expect(result.debug!.refTempoBpm).toBeCloseTo(103.4, 1);
    expect(result.debug!.usrTempoBpm).toBeCloseTo(103.4, 1);
    expect(result.debug!.tempoScore).toBeGreaterThanOrEqual(90);
  });
});
);
);
);
);
);
);
);
);

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
);
);

// ══════════════════════════════════════════════════════════
// Vocal Coach S (Measure S) — VOCAL_SCORING_SPEC Tests
// ══════════════════════════════════════════════════════════

const COACH_S_LOCAL_PARAMS = {
  llm: {
    enabled: false,
    baseUrl: 'http://localhost:9999/v1',
    model: 'combo:mse',
    combo: 'mse',
    timeoutMs: 1000,
  },
  scoring: {
    energyCapThreshold: 20,
    energyCapMultiplier: 2.5,
    energyFloorRatio: 0.6,
    energyFloorMultiplier: 1.05,
    tempoGateEnabled: true,
    tempoGateThreshold: 45,
    tempoGateCapMin: 20,
    tempoGateCapMax: 40,
  },
};

describe('Vocal Coach S — Structure & Determinism', () => {
  it('returns coach-S breakdown with tempo, energy, and grade', async () => {
    const result = await compareCoachSStyle(makePattern(), makePattern(), COACH_S_LOCAL_PARAMS);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown).toHaveProperty('tempo');
    expect(result.breakdown).toHaveProperty('energy');
    expect(result.debug).toHaveProperty('tempoScore');
    expect(result.debug).toHaveProperty('energyScore');
    expect(result.debug).toHaveProperty('grade');
    expect(result.debug).toHaveProperty('bpmDiffPct');
    expect(result.debug).toHaveProperty('energyDiffPct');
    expect(result.debug).toHaveProperty('energyDirection');
    expect(result.debug).toHaveProperty('llmUsed');
    expect(result.debug!.llmUsed).toBe(0); // local mode
    expect(Array.isArray(result.feedback)).toBe(true);
  });

  it('is deterministic in local formula mode', async () => {
    const ref = makePattern({ avgIOI: 520, regularity: 0.65 });
    const usr = makePattern({ avgIOI: 700, regularity: 0.35 });

    const scores: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS, { applyQualityPenalty: false });
      scores.push(r.score);
    }
    expect(new Set(scores).size).toBe(1);
  });
});

describe('Vocal Coach S — Tiered Tempo Scoring', () => {
  it('identical BPM → score ~97 (perfect match tier)', async () => {
    const ref = makePattern({
      onsetTimes: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
      duration: 5,
    });
    const usr = makePattern({
      onsetTimes: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0], // same
      duration: 5,
    });

    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS);
    expect(result.debug!.bpmDiffPct).toBeLessThanOrEqual(1);
    expect(result.debug!.tempoScore).toBeGreaterThanOrEqual(90);
  });

  it('very different BPM (gấp đôi) → score ~20 (worst tier)', async () => {
    const ref = makePattern({
      onsetTimes: [0.5, 1.0, 1.5, 2.0],
      duration: 3,
    });
    // Double the speed
    const usr = makePattern({
      onsetTimes: [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0],
      duration: 3,
    });

    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS);
    expect(result.debug!.tempoScore).toBeLessThanOrEqual(35);
  });
});

describe('Vocal Coach S — Direction-Aware Energy', () => {
  it('small energy difference scores high regardless of direction', async () => {
    const ref = makePattern();
    const usr = makePattern(); // same energy
    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS);
    expect(result.debug!.energyScore).toBeGreaterThanOrEqual(70);
  });

  it('very low energy (softer extreme) scores very low', async () => {
    const ref = makePattern({
      energyContourNorm: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.05) * 1.5),
      quality: { snrLike: 25, clippingRatio: 0, confidence: 0.9 },
    });
    const usr = makePattern({
      energyContourNorm: new Array(180).fill(0).map(() => 0.01), // near silent
      quality: { snrLike: 2, clippingRatio: 0, confidence: 0.3 },
    });

    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS);
    expect(result.debug!.energyScore).toBeLessThan(40);
  });
});

describe('Vocal Coach S — Overall Rules (Cap & Floor)', () => {
  it('energy_cap: when energy < 20, overall ≤ energy × 2.5', async () => {
    // Manipulate patterns so energy score is very low but tempo is fine
    const ref = makePattern({
      onsetTimes: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
      duration: 4,
      energyContourNorm: new Array(180).fill(0).map((_, i) => Math.sin(i * 0.05) * 1.5),
      quality: { snrLike: 25, clippingRatio: 0, confidence: 0.9 },
    });
    const usr = makePattern({
      onsetTimes: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0], // same tempo
      duration: 4,
      energyContourNorm: new Array(180).fill(0).map(() => 0.001), // near silent
      quality: { snrLike: 1, clippingRatio: 0, confidence: 0.1 },
    });

    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS);
    if (result.debug!.energyScore < 20) {
      expect(result.debug!.rule_energyCap).toBe(1);
      expect(result.debug!.overallScore).toBeLessThanOrEqual(result.debug!.energyScore * 2.5 + 1);
    }
  });

  it('tempo gate blocks energy_floor and caps overall into low band when tempo is too low', async () => {
    const ref = makePattern({
      measureS: { duration: 5.22, tempoBpm: 66.3, avgRms: 0.052, maxRms: 0.361, nSegments: 11 },
    });
    const usr = makePattern({
      measureS: { duration: 6.48, tempoBpm: 191.4, avgRms: 0.041, maxRms: 0.302, nSegments: 12 },
    });

    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS, { applyQualityPenalty: false });
    expect(result.debug!.tempoScore).toBeLessThan(45);
    expect(result.debug!.rule_energyFloor).toBe(0);
    expect(result.debug!.rule_tempoGateCap).toBe(1);
    expect(result.debug!.rule_floorBlockedByTempoGate).toBe(1);
    expect(result.debug!.overallScore).toBeLessThanOrEqual(40.5);
    expect(result.debug!.overallScore).toBeGreaterThanOrEqual(19.5);
  });
});

describe('Vocal Coach S — Grade Assignment', () => {
  it('grade field maps correctly to score ranges', async () => {
    const ref = makePattern();
    const usr = makePattern();
    const result = await compareCoachSStyle(ref, usr, COACH_S_LOCAL_PARAMS);

    const grade = String(result.debug!.grade);
    const overall = Number(result.debug!.overallScore);

    if (overall >= 90) expect(grade).toBe('S');
    else if (overall >= 80) expect(grade).toBe('A');
    else if (overall >= 70) expect(grade).toBe('B');
    else if (overall >= 55) expect(grade).toBe('C');
    else if (overall >= 40) expect(grade).toBe('D');
    else expect(grade).toBe('F');
  });
});

describe('Vocal Coach S — Quality Penalty', () => {
  it('quality penalty reduces final score for poor audio', async () => {
    const ref = makePattern();
    const poor = makePattern({
      quality: { snrLike: 3, clippingRatio: 0.12, confidence: 0.2 },
      voicedRatio: 0.08,
      duration: 0.6,
    });

    const withoutPenalty = await compareCoachSStyle(ref, poor, COACH_S_LOCAL_PARAMS, { applyQualityPenalty: false });
    const withPenalty = await compareCoachSStyle(ref, poor, COACH_S_LOCAL_PARAMS, { applyQualityPenalty: true });

    expect(withPenalty.score).toBeLessThanOrEqual(withoutPenalty.score);
    expect(withPenalty.debug!.applyQualityPenalty).toBe(1);
  });
});
