/**
 * Style comparer: cross-language prosodic similarity using DTW.
 * Compares intonation, energy, rhythm/pause, and timbre patterns.
 * Fully deterministic — no randomness.
 */

import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';

// Weights for final score fusion
const W_INTONATION = 0.45;
const W_RHYTHM = 0.30;
const W_ENERGY = 0.20;
const W_TIMBRE = 0.05;

/**
 * Compare two sound patterns for cross-language style similarity.
 * Returns a deterministic score 0–100 with breakdown and feedback.
 */
export function compareSoundStyle(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
): SoundCompareResultV2 {
  // ── Intonation (pitch contour + pitch slope) ──
  const pitchContourSim = dtwSimilarity(ref.pitchContourNorm, usr.pitchContourNorm);
  const pitchSlopeSim = dtwSimilarity(ref.pitchSlope, usr.pitchSlope);
  const intonation = pitchContourSim * 0.6 + pitchSlopeSim * 0.4;

  // ── Energy ──
  const energy = dtwSimilarity(ref.energyContourNorm, usr.energyContourNorm);

  // ── Rhythm & Pause ──
  const speechRateSim = ratioSimilarity(ref.speechRate, usr.speechRate);
  const regularitySim = 1 - Math.abs(ref.regularity - usr.regularity);
  const ioiSim = ref.avgIOI > 0 && usr.avgIOI > 0
    ? ratioSimilarity(ref.avgIOI, usr.avgIOI)
    : 0.5;
  const pauseSim = comparePauses(ref, usr);
  const rhythmPause = speechRateSim * 0.3 + regularitySim * 0.2 + ioiSim * 0.25 + pauseSim * 0.25;

  // ── Timbre (lightweight — voiced ratio similarity as proxy) ──
  const timbre = 1 - Math.abs(ref.voicedRatio - usr.voicedRatio);

  // ── Quality factor ──
  const refQuality = evaluateQuality(ref);
  const usrQuality = evaluateQuality(usr);
  const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

  // ── Score fusion ──
  const base = intonation * W_INTONATION + rhythmPause * W_RHYTHM + energy * W_ENERGY + timbre * W_TIMBRE;
  const score = Math.round(Math.max(0, Math.min(100, qualityFactor * base * 100)));

  // ── Feedback ──
  const feedback = generateFeedback(intonation, rhythmPause, energy, timbre, qualityFactor, usrQuality.warnings);

  return {
    score,
    breakdown: {
      intonation: Math.round(intonation * 100),
      rhythmPause: Math.round(rhythmPause * 100),
      energy: Math.round(energy * 100),
      timbre: Math.round(timbre * 100),
    },
    qualityFactor: Math.round(qualityFactor * 100) / 100,
    feedback,
    debug: {
      pitchContourSim,
      pitchSlopeSim,
      speechRateSim,
      regularitySim,
      ioiSim,
      pauseSim,
    },
  };
}

// ── DTW (Dynamic Time Warping) ──

/**
 * Compute DTW distance between two sequences, return similarity 0..1.
 * Uses Sakoe-Chiba band for efficiency.
 */
function dtwSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const n = a.length;
  const m = b.length;
  const bandWidth = Math.max(10, Math.floor(Math.max(n, m) * 0.2));

  // Use two rows for memory efficiency
  let prev = new Float64Array(m + 1).fill(Infinity);
  let curr = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr.fill(Infinity);
    const jStart = Math.max(1, i - bandWidth);
    const jEnd = Math.min(m, i + bandWidth);

    for (let j = jStart; j <= jEnd; j++) {
      const cost = (a[i - 1] - b[j - 1]) ** 2;
      curr[j] = cost + Math.min(
        prev[j],       // insertion
        curr[j - 1],   // deletion
        prev[j - 1],   // match
      );
    }

    [prev, curr] = [curr, prev];
  }

  const dtwDist = prev[m];
  if (!isFinite(dtwDist)) return 0;

  // Normalize by path length and convert to similarity
  const pathLen = Math.max(n, m);
  const avgDist = Math.sqrt(dtwDist / pathLen);

  // Map distance to similarity: dist=0 -> sim=1, dist>=3 -> sim~0
  // Using exponential decay
  const similarity = Math.exp(-avgDist * 0.7);
  return Math.max(0, Math.min(1, similarity));
}

// ── Pause Alignment ──

function comparePauses(ref: SoundPatternV2, usr: SoundPatternV2): number {
  const refPauses = ref.pausePattern;
  const usrPauses = usr.pausePattern;

  if (refPauses.length === 0 && usrPauses.length === 0) return 1;
  if (refPauses.length === 0 || usrPauses.length === 0) return 0.3;

  // Normalize pause positions to [0, 1] relative to duration
  const refNorm = refPauses.map(p => ({ pos: p.pos / (ref.duration || 1), dur: p.dur }));
  const usrNorm = usrPauses.map(p => ({ pos: p.pos / (usr.duration || 1), dur: p.dur }));

  // Count matched pauses (within 10% position tolerance)
  const tolerance = 0.1;
  let matched = 0;
  const used = new Set<number>();

  for (const rp of refNorm) {
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < usrNorm.length; j++) {
      if (used.has(j)) continue;
      const dist = Math.abs(rp.pos - usrNorm[j].pos);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0 && bestDist <= tolerance) {
      matched++;
      used.add(bestIdx);
    }
  }

  // Count similarity based on matched ratio
  const countSim = matched / Math.max(refNorm.length, usrNorm.length);

  // Penalize large difference in pause count
  const countRatio = ratioSimilarity(refPauses.length, usrPauses.length);

  return countSim * 0.7 + countRatio * 0.3;
}

// ── Helpers ──

function ratioSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  if (a === 0 || b === 0) return 0;
  const ratio = Math.min(a, b) / Math.max(a, b);
  return ratio;
}

function generateFeedback(
  intonation: number,
  rhythm: number,
  energy: number,
  timbre: number,
  qualityFactor: number,
  qualityWarnings: string[],
): string[] {
  const feedback: string[] = [];

  // Quality warnings first
  feedback.push(...qualityWarnings);

  // Intonation
  if (intonation < 0.4) {
    feedback.push('Intonation pattern differs significantly — try matching the pitch rise/fall pattern');
  } else if (intonation < 0.6) {
    feedback.push('Intonation partially matches — focus on key pitch movements');
  }

  // Rhythm
  if (rhythm < 0.4) {
    feedback.push('Rhythm and pause timing are very different from reference');
  } else if (rhythm < 0.6) {
    feedback.push('Timing needs work — pay attention to pause placement and speech rate');
  }

  // Energy
  if (energy < 0.4) {
    feedback.push('Energy/volume dynamics differ — match the emphasis patterns');
  } else if (energy < 0.6) {
    feedback.push('Volume dynamics partially match — try more expressive delivery');
  }

  // Overall positive
  if (intonation >= 0.8 && rhythm >= 0.7 && energy >= 0.7) {
    feedback.push('Excellent prosodic match! Great style similarity.');
  } else if (intonation >= 0.7 && rhythm >= 0.6) {
    feedback.push('Good overall style match.');
  }

  return feedback;
}
