/**
 * Sound Module V2 — Orchestration layer.
 * Wires preprocessing → feature extraction → VAD → pattern → comparison.
 * Exposes the 3 main APIs: analyzeAudioChunk, extractSoundPattern, compareSoundStyleCrossLanguage.
 */

import type { SoundFrameV2, SoundPatternV2, SoundCompareResultV2 } from './types';
import { FRAME_HOP_S, DEFAULT_WINDOW } from './types';
import { mixToMono, peakNormalize, clippingRatio } from './audioPreprocess';
import { extractFrameFeatures, extractAllFrames } from './featureExtractor';
import { extractSoundPattern as buildPattern } from './patternExtractor';
import { compareSoundStyle } from './styleComparer';

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
): Promise<{ frames: SoundFrameV2[]; duration: number; clipping: number }> {
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

  onProgress?.(20);

  const hopSamples = Math.floor(sampleRate * FRAME_HOP_S);
  const windowSamples = Math.min(DEFAULT_WINDOW, hopSamples * 4);
  const frames = extractAllFrames(normalized, sampleRate, hopSamples, windowSamples);

  onProgress?.(90);

  return { frames, duration, clipping: clip };
}

// ── Pattern extraction ──

/**
 * Build a SoundPatternV2 from extracted frames.
 */
export function extractSoundPatternV2(frames: SoundFrameV2[], duration: number, clipping: number = 0): SoundPatternV2 {
  const pattern = buildPattern(frames, duration);
  // Inject clipping ratio from preprocess
  pattern.quality.clippingRatio = clipping;
  return pattern;
}

// ── Comparison ──

/**
 * Compare reference vs attempt for cross-language style similarity.
 * Fully deterministic: same input → same output.
 */
export function compareSoundStyleCrossLanguage(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
): SoundCompareResultV2 {
  return compareSoundStyle(ref, usr);
}

// ── Re-exports for convenience ──
export type { SoundFrameV2, SoundPatternV2, SoundCompareResultV2 } from './types';
export { compareStyleFingerprints, extractFingerprint } from './styleFingerprintComparer';
export type { StyleFingerprint } from './styleFingerprintComparer';
export { compareDeliveryStyle, extractDeliveryProfile, setDeliveryParams, getDeliveryParams } from './styleDeliveryComparer';
export type { DeliveryParams, DeliveryProfile } from './styleDeliveryComparer';
export { compareWav2VecStyle, DEFAULT_WAV2VEC_PARAMS } from './styleWav2vecComparer';
export type { Wav2VecParams, Wav2VecCompareOptions } from './styleWav2vecComparer';
