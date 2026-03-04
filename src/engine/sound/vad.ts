/**
 * Voice Activity Detection (VAD) and speech segmentation.
 * Uses pitch confidence + energy to identify voiced segments and pauses.
 */

import type { SoundFrameV2, SpeechSegment, PauseEvent } from './types';
import { FRAME_HOP_S } from './types';

const MIN_SPEECH_DURATION = 0.12;  // 120ms minimum voiced segment
const MIN_PAUSE_DURATION = 0.18;   // 180ms minimum pause
const ENERGY_MARGIN = 10;          // dB above noise floor

/**
 * Estimate noise floor from the quietest frames.
 */
export function estimateNoiseFloor(frames: SoundFrameV2[]): number {
  if (frames.length === 0) return -60;
  const energies = frames.map(f => f.energyDb).filter(e => e > -100).sort((a, b) => a - b);
  if (energies.length === 0) return -60;
  // 10th percentile
  const idx = Math.floor(energies.length * 0.1);
  return energies[idx];
}

/**
 * Classify each frame as voiced or unvoiced, considering noise floor.
 */
export function classifyVoicing(frames: SoundFrameV2[], noiseFloor: number): boolean[] {
  const threshold = noiseFloor + ENERGY_MARGIN;
  return frames.map(f => f.voiced && f.energyDb > threshold);
}

/**
 * Extract speech segments from voiced classification.
 * A segment must last >= MIN_SPEECH_DURATION to count.
 */
export function extractSpeechSegments(voicedFlags: boolean[], hop: number = FRAME_HOP_S): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let segStart = -1;

  for (let i = 0; i <= voicedFlags.length; i++) {
    const voiced = i < voicedFlags.length && voicedFlags[i];
    if (voiced && segStart === -1) {
      segStart = i;
    } else if (!voiced && segStart !== -1) {
      const start = segStart * hop;
      const end = i * hop;
      if (end - start >= MIN_SPEECH_DURATION) {
        segments.push({ start, end });
      }
      segStart = -1;
    }
  }

  return segments;
}

/**
 * Extract pause events from gaps between speech segments.
 */
export function extractPauses(
  voicedFlags: boolean[],
  hop: number = FRAME_HOP_S,
): PauseEvent[] {
  const pauses: PauseEvent[] = [];
  let silenceStart = -1;

  for (let i = 0; i <= voicedFlags.length; i++) {
    const voiced = i < voicedFlags.length && voicedFlags[i];
    if (!voiced && silenceStart === -1) {
      silenceStart = i;
    } else if (voiced && silenceStart !== -1) {
      const start = silenceStart * hop;
      const end = i * hop;
      const dur = end - start;
      if (dur >= MIN_PAUSE_DURATION) {
        pauses.push({ pos: (start + end) / 2, dur });
      }
      silenceStart = -1;
    }
  }

  return pauses;
}
