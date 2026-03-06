/**
 * Sound MSE Module — wired to V2 pipeline.
 * extract() produces SoundPatternV2-compatible output,
 * compare() uses deterministic DTW-based style comparison.
 */

import type { MSEModule, SoundFrame, SoundPattern } from '@/types/modules';
import {
  extractSoundPatternV2,
} from '@/engine/sound/index';
import { compareSoundStyle } from '@/engine/sound/styleComparer';
import type { MetricWeights } from '@/engine/sound/styleComparer';
import {
  compareStyleFingerprints,
  DEFAULT_FINGERPRINT_PARAMS,
} from '@/engine/sound/styleFingerprintComparer';
import {
  compareWav2VecStyle,
  DEFAULT_WAV2VEC_PARAMS,
} from '@/engine/sound/styleWav2vecComparer';
import { compareDeliveryStyle, setDeliveryParams } from '@/engine/sound/styleDeliveryComparer';
import type { DeliveryParams } from '@/engine/sound/styleDeliveryComparer';
import type { FingerprintParams } from '@/engine/sound/styleFingerprintComparer';
import type { Wav2VecParams } from '@/engine/sound/styleWav2vecComparer';
import type { SoundPatternV2 } from '@/engine/sound/types';

// Global dynamic weights — set from UI before running compare
let _dynamicWeights: MetricWeights | undefined = undefined;

export function setSoundMetricWeights(weights: MetricWeights | undefined) {
  _dynamicWeights = weights;
}

export function getSoundMetricWeights(): MetricWeights | undefined {
  return _dynamicWeights;
}

// Delivery comparer params
let _deliveryParams: DeliveryParams | undefined = undefined;

export function setSoundDeliveryParams(params: DeliveryParams | undefined) {
  _deliveryParams = params;
  if (params) setDeliveryParams(params);
}

export function getSoundDeliveryParams(): DeliveryParams | undefined {
  return _deliveryParams;
}

let _fingerprintParams: FingerprintParams = { ...DEFAULT_FINGERPRINT_PARAMS };

export function setSoundFingerprintParams(params: FingerprintParams | undefined) {
  _fingerprintParams = params ? { ...params } : { ...DEFAULT_FINGERPRINT_PARAMS };
}

export function getSoundFingerprintParams(): FingerprintParams {
  return _fingerprintParams;
}

let _wav2vecParams: Wav2VecParams = { ...DEFAULT_WAV2VEC_PARAMS };

export function setSoundWav2VecParams(params: Wav2VecParams | undefined) {
  _wav2vecParams = params ? { ...params } : { ...DEFAULT_WAV2VEC_PARAMS };
}

export function getSoundWav2VecParams(): Wav2VecParams {
  return _wav2vecParams;
}

let _applyQualityPenalty = true;

export function setSoundApplyQualityPenalty(enabled: boolean) {
  _applyQualityPenalty = enabled;
}

export function getSoundApplyQualityPenalty(): boolean {
  return _applyQualityPenalty;
}

/**
 * Bridge: convert old SoundFrame[] to V2 frames for pattern extraction.
 * This allows the module to work with both legacy and new frame formats.
 */
function bridgeToV2Pattern(frames: SoundFrame[]): SoundPattern & { _v2?: SoundPatternV2 } {
  // Convert old SoundFrame to V2-compatible frame data
  const v2Frames = frames.map((f, i) => ({
    t: f.timestamp / 1000, // ms -> seconds
    pitchHz: f.pitch > 0 ? f.pitch : null,
    pitchConf: f.pitch > 60 && f.pitch < 500 ? 0.7 : 0.1,
    energyDb: f.volume > 0 ? 20 * Math.log10(f.volume / 100 + 1e-8) : -60,
    centroid: 0,
    zcr: 0,
    rolloff: 0,
    flux: 0,
    voiced: f.pitch > 60 && f.pitch < 500 && f.volume > 5,
  }));

  const duration = frames.length > 0
    ? (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000
    : 0;

  const v2Pattern = extractSoundPatternV2(v2Frames, duration);

  // Also build legacy fields for backward compatibility
  const pitchContour = frames.map(f => f.pitch);
  const volumeContour = frames.map(f => f.volume);
  const avgPitch = pitchContour.filter(p => p > 0).reduce((a, b) => a + b, 0) /
    (pitchContour.filter(p => p > 0).length || 1);
  const avgVolume = volumeContour.reduce((a, b) => a + b, 0) / (volumeContour.length || 1);

  return {
    pitchContour,
    volumeContour,
    rhythmPattern: detectRhythm(volumeContour),
    avgPitch,
    avgVolume,
    syllableRate: estimateSyllableRate(volumeContour),
    _v2: v2Pattern,
  };
}

function isSoundPatternV2(pattern: any): pattern is SoundPatternV2 {
  return !!pattern
    && typeof pattern.duration === 'number'
    && Array.isArray(pattern.pitchContourNorm)
    && Array.isArray(pattern.energyContourNorm)
    && Array.isArray(pattern.onsetTimes);
}

function coerceToV2(pattern: SoundPattern | (SoundPattern & { _v2?: SoundPatternV2 }) | SoundPatternV2): SoundPatternV2 {
  const wrapped = (pattern as any)?._v2 as SoundPatternV2 | undefined;
  if (wrapped) return wrapped;
  if (isSoundPatternV2(pattern)) return pattern;
  return buildFallbackV2(pattern as SoundPattern);
}

export const soundModule: MSEModule<SoundFrame, SoundPattern> = {
  id: 'sound',
  name: 'Sound',
  color: 'hsl(0, 84%, 60%)',
  icon: 'Volume2',

  methods: [
    {
      id: 'full-prosody',
      name: 'Full Prosody Analysis',
      description: 'Pitch + Volume + Rhythm using Web Audio API',
      isDefault: true,
      enabled: true,
      requires: ['microphone'],
      extract: (frames: SoundFrame[]): SoundPattern => {
        return bridgeToV2Pattern(frames);
      },
      processFrame: (frame: SoundFrame): number => {
        return Math.min(1, frame.volume / 100);
      },
    },
    {
      id: 'pitch-only',
      name: 'Pitch Tracking Only',
      description: 'Focus on intonation and melody patterns',
      isDefault: false,
      enabled: false,
      requires: ['microphone'],
      extract: (frames: SoundFrame[]): SoundPattern => {
        return bridgeToV2Pattern(frames);
      },
    },
  ],

  charts: [
    { id: 'sound-contour', name: 'Sound Contour', description: 'Pitch + Volume combined view', enabled: true, category: 'both', dataSource: 'pattern' },
    { id: 'waveform', name: 'Waveform', description: 'Raw audio waveform display', enabled: true, category: 'realtime', dataSource: 'frames' },
    { id: 'rhythm-dots', name: 'Rhythm Pattern', description: 'Syllable timing visualization', enabled: false, category: 'post-session', dataSource: 'pattern' },
    { id: 'pitch-line', name: 'Pitch Melody', description: 'Pitch contour line chart', enabled: false, category: 'post-session', dataSource: 'pattern' },
  ],

  comparers: [
    {
      id: 'style-delivery',
      name: 'Delivery Pattern',
      description: 'Compare delivery style: elongation, emphasis, expressiveness — detects "kéo dài âm" patterns across languages',
      isDefault: true,
      enabled: true,
      compare: (ref: SoundPattern, learner: SoundPattern) => {
        const refPattern = coerceToV2(ref as any);
        const learnerPattern = coerceToV2(learner as any);

        const result = compareDeliveryStyle(refPattern, learnerPattern, _deliveryParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return {
          score: result.score,
          breakdown: result.breakdown,
          feedback: result.feedback,
          debug: result.debug,
        };
      },
    },
    {
      id: 'style-fingerprint',
      name: 'Style Fingerprint',
      description: 'Compare speaking CHARACTER (expressiveness, energy, rhythm, voice color) — cross-language',
      isDefault: false,
      enabled: true,
      compare: (ref: SoundPattern, learner: SoundPattern) => {
        const refPattern = coerceToV2(ref as any);
        const learnerPattern = coerceToV2(learner as any);

        const result = compareStyleFingerprints(refPattern, learnerPattern, _fingerprintParams, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return {
          score: result.score,
          breakdown: result.breakdown,
          feedback: result.feedback,
          debug: result.debug,
        };
      },
    },
    {
      id: 'style-wav2vec',
      name: 'Wav2Vec Hybrid (Experimental)',
      description: 'Hybrid style scoring: embedding similarity + delivery + fingerprint. Uses wav2vec embedding if attached, else runtime-safe proxy embedding.',
      isDefault: false,
      enabled: true,
      compare: (ref: SoundPattern, learner: SoundPattern) => {
        const refPattern = coerceToV2(ref as any);
        const learnerPattern = coerceToV2(learner as any);

        const result = compareWav2VecStyle(refPattern, learnerPattern, _wav2vecParams, {
          applyQualityPenalty: _applyQualityPenalty,
          deliveryParams: _deliveryParams,
          fingerprintParams: _fingerprintParams,
        });
        return {
          score: result.score,
          breakdown: result.breakdown,
          feedback: result.feedback,
          debug: result.debug,
        };
      },
    },
    {
      id: 'style-dtw',
      name: 'Contour DTW (Legacy)',
      description: 'DTW-based prosodic contour comparison (intonation, rhythm, energy, timbre)',
      isDefault: false,
      enabled: true,
      compare: (ref: SoundPattern, learner: SoundPattern) => {
        const refPattern = coerceToV2(ref as any);
        const learnerPattern = coerceToV2(learner as any);
        const weights = _dynamicWeights;

        const result = compareSoundStyle(refPattern, learnerPattern, weights, {
          applyQualityPenalty: _applyQualityPenalty,
        });
        return {
          score: result.score,
          breakdown: result.breakdown,
          feedback: result.feedback,
          debug: result.debug,
        };
      },
    },
  ],
};

// ── Fallback V2 builder from legacy SoundPattern ──

function buildFallbackV2(pattern: SoundPattern): SoundPatternV2 {
  const CONTOUR_LENGTH = 180;

  // Convert pitch to semitones
  const pitches = pattern.pitchContour.filter(p => p > 0);
  const medianPitch = pitches.length > 0
    ? pitches.sort((a, b) => a - b)[Math.floor(pitches.length / 2)]
    : 200;

  const pitchSemitones = pattern.pitchContour.map(p =>
    p > 60 && p < 500 ? 12 * Math.log2(p / medianPitch) : 0
  );

  const pitchContourNorm = resampleArr(pitchSemitones, CONTOUR_LENGTH);
  const pitchSlope = pitchContourNorm.map((v, i) => i > 0 ? v - pitchContourNorm[i - 1] : 0);

  // Energy from volume
  const energyRaw = pattern.volumeContour.map(v => v > 0 ? 20 * Math.log10(v / 100 + 1e-8) : -60);
  const mean = energyRaw.reduce((a, b) => a + b, 0) / (energyRaw.length || 1);
  const std = Math.sqrt(energyRaw.reduce((s, v) => s + (v - mean) ** 2, 0) / (energyRaw.length || 1));
  const zNorm = std > 0.001 ? energyRaw.map(v => (v - mean) / std) : energyRaw.map(() => 0);
  const energyContourNorm = resampleArr(zNorm, CONTOUR_LENGTH);

  const duration = pattern.pitchContour.length * 0.05; // ~50ms per frame

  return {
    duration,
    pitchContourNorm,
    pitchSlope,
    pitchContourVoiced: pitchContourNorm, // legacy fallback: use same as norm
    pitchSlopeVoiced: pitchSlope,
    energyContourNorm,
    spectralCentroidContour: new Array(CONTOUR_LENGTH).fill(0),
    spectralRolloffContour: new Array(CONTOUR_LENGTH).fill(0),
    onsetTimes: [],
    pausePattern: [],
    speechRate: pattern.syllableRate,
    avgIOI: 0,
    regularity: 0,
    voicedRatio: pitches.length / (pattern.pitchContour.length || 1),
    quality: { snrLike: 20, clippingRatio: 0, confidence: 0.7 },
  };
}

function resampleArr(arr: number[], targetLen: number): number[] {
  if (arr.length === 0) return new Array(targetLen).fill(0);
  if (arr.length === 1) return new Array(targetLen).fill(arr[0]);
  const result: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const pos = (i / (targetLen - 1)) * (arr.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, arr.length - 1);
    const frac = pos - lo;
    result.push(arr[lo] * (1 - frac) + arr[hi] * frac);
  }
  return result;
}

function detectRhythm(volumes: number[]): number[] {
  const threshold = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1) * 0.6;
  return volumes.map(v => v > threshold ? 1 : 0);
}

function estimateSyllableRate(volumes: number[]): number {
  let peaks = 0;
  for (let i = 1; i < volumes.length - 1; i++) {
    if (volumes[i] > volumes[i - 1] && volumes[i] > volumes[i + 1]) peaks++;
  }
  const durationSec = volumes.length * 0.033;
  return durationSec > 0 ? peaks / durationSec : 0;
}
