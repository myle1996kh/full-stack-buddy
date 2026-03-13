/**
 * Sound Module V2 — Orchestration layer.
 * Wires preprocessing → feature extraction → VAD → pattern → comparison.
 * Exposes the 3 main APIs: analyzeAudioChunk, extractSoundPattern, compareSoundPatternV2.
 *
 * Active comparers:
 *  - styleCoachSComparer  : Tempo + Energy (nhịp + lực giọng)
 *  - styleDeliveryComparer: Elongation, Emphasis, Expressiveness, Rhythm (phong cách nói)
 *  - styleFingerprintComparer: Speaking character (sắc thái tổng thể)
 */

import type { SoundFrameV2, SoundPatternV2, SoundCompareResultV2, MeasureSAcousticFeatures } from './types';
import { FRAME_HOP_S, DEFAULT_WINDOW } from './types';
import { mixToMono, peakNormalize, clippingRatio } from './audioPreprocess';
import { extractFrameFeatures, extractAllFrames } from './featureExtractor';
import { extractMeasureSAcousticFeatures } from './measureSFeatureExtractor';
import { extractSoundPattern as buildPattern } from './patternExtractor';
import { extractAdvancedSoundAnalysis } from './advancedAnalysis';

// ── Realtime: single chunk analysis ──

let prevMagnitudes: Float32Array | null = null;

/**
 * Analyze a single audio chunk in realtime.
 * Call this every ~20ms with the latest windowed PCM data.
 */
export function analyzeAudioChunk(input: Float32Array, t: number, sampleRate: number = 44100): SoundFrameV2 {
  const { frame, magnitudes } = extractFrameFeatures(input, sampleRate, t, prevMagnitudes);
  prevMagnitudes = magnitudes;
  return frame;
}

/**
 * Reset realtime state (call between sessions).
 */
export function resetRealtimeState(): void {
  prevMagnitudes = null;
}

// ── Offline: full file processing ──

/**
 * Process a complete audio file (as AudioBuffer) into SoundFrameV2[].
 */
export function processAudioBuffer(audioBuffer: AudioBuffer): SoundFrameV2[] {
  const mono = mixToMono(audioBuffer);
  const normalized = peakNormalize(mono);
  const sampleRate = audioBuffer.sampleRate;

  const hopSamples = Math.floor(sampleRate * FRAME_HOP_S);
  const windowSamples = Math.min(DEFAULT_WINDOW, hopSamples * 4);

  return extractAllFrames(normalized, sampleRate, hopSamples, windowSamples);
}

/**
 * Process a raw File into SoundFrameV2[].
 */
export async function processAudioFileV2(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ frames: SoundFrameV2[]; duration: number; clipping: number; measureSFeatures: MeasureSAcousticFeatures }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioCtx.close();

  onProgress?.(10);

  const mono = mixToMono(audioBuffer);
  const clip = clippingRatio(mono);
  const normalized = peakNormalize(mono);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const measureSFeatures = extractMeasureSAcousticFeatures(mono, sampleRate, duration);

  onProgress?.(20);

  const hopSamples = Math.floor(sampleRate * FRAME_HOP_S);
  const windowSamples = Math.min(DEFAULT_WINDOW, hopSamples * 4);
  const frames = extractAllFrames(normalized, sampleRate, hopSamples, windowSamples);

  onProgress?.(90);

  return { frames, duration, clipping: clip, measureSFeatures };
}

// ── Pattern extraction ──

/**
 * Build a SoundPatternV2 from extracted frames.
 */
export function extractSoundPatternV2(
  frames: SoundFrameV2[],
  duration: number,
  clipping: number = 0,
  measureSFeatures?: MeasureSAcousticFeatures,
): SoundPatternV2 {
  const pattern = buildPattern(frames, duration);
  // Inject clipping ratio from preprocess
  pattern.quality.clippingRatio = clipping;
  if (measureSFeatures) {
    pattern.measureS = measureSFeatures;
  }
  pattern.advanced = extractAdvancedSoundAnalysis(pattern);
  return pattern;
}

// ── Re-exports for convenience ──
export type { SoundFrameV2, SoundPatternV2, SoundCompareResultV2, MeasureSAcousticFeatures } from './types';
export type { AdvancedSoundAnalysis } from './types';
export { extractMeasureSAcousticFeatures } from './measureSFeatureExtractor';
export { extractAdvancedSoundAnalysis } from './advancedAnalysis';
// Comparers
export { compareStyleFingerprints, extractFingerprint } from './styleFingerprintComparer';
export type { StyleFingerprint } from './styleFingerprintComparer';
export { compareDeliveryStyle, extractDeliveryProfile, setDeliveryParams, getDeliveryParams } from './styleDeliveryComparer';
export type { DeliveryParams, DeliveryProfile } from './styleDeliveryComparer';
export { compareCoachSStyle, DEFAULT_COACH_S_PARAMS, setSoundCoachSParams, getSoundCoachSParams } from './styleCoachSComparer';
export type { CoachSParams, CoachSCompareOptions } from './styleCoachSComparer';
// Standalone delivery label evaluator (no reference needed)
export { evaluateDeliveryLabel } from './deliveryLabelEvaluator';
export type { DeliveryLabelResult } from './deliveryLabelEvaluator';
