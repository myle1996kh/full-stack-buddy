/**
 * Audio quality gate: evaluates recording quality and computes a quality factor.
 * Quality factor scales the final comparison score to penalize poor recordings.
 */

import type { SoundPatternV2 } from './types';

export interface QualityReport {
  factor: number;       // 0.4..1.0
  warnings: string[];
}

/**
 * Evaluate audio quality and return a scaling factor + warnings.
 */
export function evaluateQuality(pattern: SoundPatternV2): QualityReport {
  const warnings: string[] = [];
  let factor = 1.0;

  const { snrLike, clippingRatio, confidence } = pattern.quality;

  // Low SNR
  if (snrLike < 6) {
    warnings.push('Very noisy recording — results may be unreliable');
    factor -= 0.32;
  } else if (snrLike < 12) {
    warnings.push('Background noise detected — consider a quieter environment');
    factor -= 0.14;
  }

  // Clipping
  if (clippingRatio > 0.05) {
    warnings.push('Audio clipping detected — reduce microphone volume');
    factor -= 0.22;
  } else if (clippingRatio > 0.01) {
    warnings.push('Minor clipping detected');
    factor -= 0.08;
  }

  // Low pitch confidence
  if (confidence < 0.3) {
    warnings.push('Low pitch detection confidence — ensure clear speech/audio');
    factor -= 0.2;
  } else if (confidence < 0.5) {
    factor -= 0.08;
  }

  // Too little voiced content
  if (pattern.voicedRatio < 0.1) {
    warnings.push('Very little voiced content detected');
    factor -= 0.25;
  } else if (pattern.voicedRatio < 0.2) {
    warnings.push('Low voiced content ratio');
    factor -= 0.12;
  }

  // Very short duration
  if (pattern.duration < 1.0) {
    warnings.push('Recording too short for reliable analysis');
    factor -= 0.2;
  } else if (pattern.duration < 2.0) {
    factor -= 0.08;
  }

  // Clamp factor to [0.4, 1.0]
  factor = Math.max(0.4, Math.min(1.0, factor));

  return { factor, warnings };
}
