/**
 * Delivery Pattern Comparer: compare HOW you deliver each part of speech.
 *
 * Core insight: Speaking style = the PATTERN of delivery across segments.
 * "i muốnnnnn... maiiiiiii" and "i wanttttt... tomorrrowww" share the same
 * delivery pattern: stretch certain words, keep others short, emphasize specific parts.
 *
 * Approach:
 * 1. Segment audio by onsets (syllable-like units)
 * 2. Extract per-segment features (relative duration, energy, pitch range)
 * 3. Compare the PATTERN and DISTRIBUTION of these features
 *
 * Key metrics:
 * - Elongation: how and where you stretch words (critical for the user's use case)
 * - Emphasis: where and how much you push volume
 * - Expressiveness: how much pitch moves within each segment
 * - Rhythm: overall timing pattern
 *
 * Fully deterministic.
 */

import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';

// ── Configurable Parameters ──

export interface DeliveryParams {
  weights: {
    elongation: number;     // default 0.35
    emphasis: number;       // default 0.25
    expressiveness: number; // default 0.20
    rhythm: number;         // default 0.20
  };
  enabledMetrics?: {
    elongation: boolean;
    emphasis: boolean;
    expressiveness: boolean;
    rhythm: boolean;
  };
  elongationThreshold: number; // IOI/median ratio to count as "elongated", default 1.5
}

export interface DeliveryCompareOptions {
  applyQualityPenalty?: boolean;
}

export const DEFAULT_DELIVERY_PARAMS: DeliveryParams = {
  weights: {
    elongation: 0.35,
    emphasis: 0.25,
    expressiveness: 0.20,
    rhythm: 0.20,
  },
  enabledMetrics: {
    elongation: true,
    emphasis: true,
    expressiveness: true,
    rhythm: true,
  },
  elongationThreshold: 1.5,
};

// Module-level params (set from UI before comparison)
let _deliveryParams: DeliveryParams = { ...DEFAULT_DELIVERY_PARAMS };

export function setDeliveryParams(params: DeliveryParams) {
  _deliveryParams = { ...params };
}

export function getDeliveryParams(): DeliveryParams {
  return _deliveryParams;
}

// ── Types ──

interface Segment {
  startIdx: number;
  endIdx: number;
  duration: number;
  meanEnergy: number;
  pitchRange: number;
  pitchDirection: number;
  position: number; // center position [0,1]
}

export interface DeliveryProfile {
  relDurations: number[];
  relEnergies: number[];
  pitchRanges: number[];

  durationCV: number;
  maxMedianRatio: number;
  elongatedRatio: number;
  durationSkewness: number;

  energyCV: number;
  emphasisRatio: number;

  expressiveRatio: number;
  avgPitchRange: number;

  durationProfile: number[];
  energyProfile: number[];
  pitchRangeProfile: number[];

  elongationPositions: number[];

  speechRate: number;
  regularity: number;
  segmentCount: number;
}

const PROFILE_LEN = 16;
const MIN_SEGMENTS = 3;

// ── Main Compare Function ──

export function compareDeliveryStyle(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
  params?: DeliveryParams,
  options?: DeliveryCompareOptions,
): SoundCompareResultV2 {
  const p = params ?? _deliveryParams;

  const refProfile = extractDeliveryProfile(ref, p);
  const usrProfile = extractDeliveryProfile(usr, p);

  const refQuality = evaluateQuality(ref);
  const usrQuality = evaluateQuality(usr);
  const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

  // ── Sub-scores ──
  const elongSim = compareElongation(refProfile, usrProfile, p);
  const emphSim = compareEmphasis(refProfile, usrProfile);
  const exprSim = compareExpressiveness(refProfile, usrProfile);
  const rhythmSim = compareRhythm(refProfile, usrProfile);

  const rawScores = {
    elongation: elongSim,
    emphasis: emphSim,
    expressiveness: exprSim,
    rhythm: rhythmSim,
  };

  const enabled = p.enabledMetrics ?? DEFAULT_DELIVERY_PARAMS.enabledMetrics!;

  // ── Weighted total ──
  const w = normalizeEnabledWeights(p.weights, enabled);
  const enabledKeys = Object.keys(w) as Array<keyof typeof rawScores>;
  const raw = enabledKeys.reduce((sum, key) => sum + rawScores[key] * w[key], 0);

  const applyQualityPenalty = options?.applyQualityPenalty ?? false;
  const rawScore = Math.max(0, Math.min(100, raw * 100));
  const finalScore = applyQualityPenalty ? rawScore * qualityFactor : rawScore;
  const score = Math.round(Math.max(0, Math.min(100, finalScore)));

  const breakdown = Object.fromEntries(
    enabledKeys.map((key) => [key, Math.round(rawScores[key] * 100)]),
  );

  const feedback = buildFeedback(rawScores, enabledKeys, usrQuality.warnings);

  const durProfileCorr = pearsonCorrelation(refProfile.durationProfile, usrProfile.durationProfile);
  const engProfileCorr = pearsonCorrelation(refProfile.energyProfile, usrProfile.energyProfile);
  const prProfileCorr = pearsonCorrelation(refProfile.pitchRangeProfile, usrProfile.pitchRangeProfile);

  return {
    score,
    breakdown: breakdown as any,
    qualityFactor: round3(qualityFactor),
    feedback,
    debug: {
      // Weights
      w_elongation: round3(w.elongation ?? 0),
      w_emphasis: round3(w.emphasis ?? 0),
      w_expressiveness: round3(w.expressiveness ?? 0),
      w_rhythm: round3(w.rhythm ?? 0),
      enabled_elongation: enabled.elongation ? 1 : 0,
      enabled_emphasis: enabled.emphasis ? 1 : 0,
      enabled_expressiveness: enabled.expressiveness ? 1 : 0,
      enabled_rhythm: enabled.rhythm ? 1 : 0,
      // Overall
      rawWeightedAvg: round3(raw),
      rawScore: round3(rawScore),
      finalScore: round3(finalScore),
      applyQualityPenalty: applyQualityPenalty ? 1 : 0,
      qualityFactor: round3(qualityFactor),
      // Segment info
      ref_segments: refProfile.segmentCount,
      usr_segments: usrProfile.segmentCount,
      // Elongation detail
      elongSim: round3(elongSim),
      ref_durationCV: round3(refProfile.durationCV),
      usr_durationCV: round3(usrProfile.durationCV),
      ref_elongatedRatio: round3(refProfile.elongatedRatio),
      usr_elongatedRatio: round3(usrProfile.elongatedRatio),
      ref_maxMedianRatio: round3(refProfile.maxMedianRatio),
      usr_maxMedianRatio: round3(usrProfile.maxMedianRatio),
      durationProfileCorr: round3(durProfileCorr),
      // Emphasis detail
      emphSim: round3(emphSim),
      ref_energyCV: round3(refProfile.energyCV),
      usr_energyCV: round3(usrProfile.energyCV),
      ref_emphasisRatio: round3(refProfile.emphasisRatio),
      usr_emphasisRatio: round3(usrProfile.emphasisRatio),
      energyProfileCorr: round3(engProfileCorr),
      // Expressiveness detail
      exprSim: round3(exprSim),
      ref_expressiveRatio: round3(refProfile.expressiveRatio),
      usr_expressiveRatio: round3(usrProfile.expressiveRatio),
      ref_avgPitchRange: round3(refProfile.avgPitchRange),
      usr_avgPitchRange: round3(usrProfile.avgPitchRange),
      pitchRangeProfileCorr: round3(prProfileCorr),
      // Rhythm detail
      rhythmSim: round3(rhythmSim),
      ref_speechRate: round3(refProfile.speechRate),
      usr_speechRate: round3(usrProfile.speechRate),
      ref_regularity: round3(refProfile.regularity),
      usr_regularity: round3(usrProfile.regularity),
    },
  };
}

// ── Profile Extraction ──

export function extractDeliveryProfile(
  pattern: SoundPatternV2,
  params: DeliveryParams = DEFAULT_DELIVERY_PARAMS,
): DeliveryProfile {
  const segments = extractSegments(pattern);

  if (segments.length < MIN_SEGMENTS) {
    return extractContourFallbackProfile(pattern, params);
  }

  const durations = segments.map(s => s.duration);
  const medDuration = medianVal(durations);
  const energyVals = segments.map(s => s.meanEnergy);
  const medEnergy = medianVal(energyVals);
  const energyScale = robustScale(energyVals);

  const relDurations = durations.map(d => medDuration > 0 ? d / medDuration : 1);
  const relEnergies = energyVals.map(e => clampNum(1 + (e - medEnergy) / (energyScale * 2), 0.1, 3.0));
  const pitchRanges = segments.map(s => s.pitchRange);

  const durationCV = coefficientOfVariation(relDurations);
  const maxMedianRatio = relDurations.length > 0 ? Math.max(...relDurations) : 1;
  const elongatedRatio = relDurations.filter(d => d >= params.elongationThreshold).length / relDurations.length;
  const durationSkewness = skewness(relDurations);

  const energyCV = coefficientOfVariation(relEnergies);
  const emphasisRatio = relEnergies.filter(e => e > 1.3).length / relEnergies.length;

  const expressiveRatio = pitchRanges.filter(r => r > 2.5).length / pitchRanges.length;
  const avgPitchRange = meanVal(pitchRanges);

  const durationProfile = resampleProfile(relDurations, PROFILE_LEN);
  const energyProfile = resampleProfile(relEnergies, PROFILE_LEN);
  const pitchRangeProfile = resampleProfile(pitchRanges, PROFILE_LEN);

  const elongationPositions = segments
    .filter((_, i) => relDurations[i] >= params.elongationThreshold)
    .map(s => s.position);

  return {
    relDurations,
    relEnergies,
    pitchRanges,
    durationCV,
    maxMedianRatio,
    elongatedRatio,
    durationSkewness,
    energyCV,
    emphasisRatio,
    expressiveRatio,
    avgPitchRange,
    durationProfile,
    energyProfile,
    pitchRangeProfile,
    elongationPositions,
    speechRate: pattern.speechRate,
    regularity: pattern.regularity,
    segmentCount: segments.length,
  };
}

// ── Segment Extraction ──

function extractSegments(pattern: SoundPatternV2): Segment[] {
  const contourLen = pattern.energyContourNorm.length;
  const pitchContour = pattern.pitchContourVoiced?.length > 0
    ? pattern.pitchContourVoiced
    : pattern.pitchContourNorm;
  const energyContour = pattern.energyContourNorm;

  let boundaries: number[] = [];

  if (pattern.onsetTimes.length >= 3 && pattern.duration > 0) {
    boundaries = [0, ...pattern.onsetTimes];
    if (boundaries[boundaries.length - 1] < pattern.duration - 0.05) {
      boundaries.push(pattern.duration);
    }
  } else {
    boundaries = findEnergyBoundaries(energyContour, pattern.duration);
  }

  if (boundaries.length < 2) return [];

  const segments: Segment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startT = boundaries[i];
    const endT = boundaries[i + 1];
    const dur = endT - startT;

    if (dur < 0.02) continue;

    const startIdx = Math.max(0, Math.floor((startT / (pattern.duration || 1)) * (contourLen - 1)));
    const endIdx = Math.min(contourLen - 1, Math.floor((endT / (pattern.duration || 1)) * (contourLen - 1)));

    if (endIdx <= startIdx) continue;

    const energySlice = energyContour.slice(startIdx, endIdx + 1);
    const pitchSlice = pitchContour.slice(startIdx, endIdx + 1);

    segments.push({
      startIdx,
      endIdx,
      duration: dur,
      meanEnergy: meanVal(energySlice),
      pitchRange: arrRange(pitchSlice),
      pitchDirection: pitchSlice.length >= 2
        ? (pitchSlice[pitchSlice.length - 1] - pitchSlice[0]) / pitchSlice.length
        : 0,
      position: (startT + dur / 2) / (pattern.duration || 1),
    });
  }

  return segments;
}

function findEnergyBoundaries(energy: number[], duration: number): number[] {
  if (energy.length === 0 || duration <= 0) return [0, duration];

  const smoothed = movingAvg(energy, 7);
  const boundaries: number[] = [0];

  for (let i = 2; i < smoothed.length - 2; i++) {
    if (smoothed[i] < smoothed[i - 1] &&
        smoothed[i] < smoothed[i + 1] &&
        smoothed[i] < smoothed[i - 2] &&
        smoothed[i] < smoothed[i + 2]) {
      const t = (i / (smoothed.length - 1)) * duration;
      if (t - boundaries[boundaries.length - 1] > 0.1) {
        boundaries.push(t);
      }
    }
  }

  boundaries.push(duration);
  return boundaries;
}

// ── Contour-based Fallback (when not enough segments) ──

function extractContourFallbackProfile(
  pattern: SoundPatternV2,
  params: DeliveryParams,
): DeliveryProfile {
  const pitchContour = pattern.pitchContourVoiced?.length > 0
    ? pattern.pitchContourVoiced
    : pattern.pitchContourNorm;
  const energy = pattern.energyContourNorm;
  const chunkSize = Math.max(1, Math.floor(energy.length / PROFILE_LEN));

  const relEnergies: number[] = [];
  const pitchRangesArr: number[] = [];

  for (let i = 0; i < PROFILE_LEN; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, energy.length);
    const eSlice = energy.slice(start, end);
    const pSlice = pitchContour.slice(start, end);

    relEnergies.push(meanVal(eSlice));
    pitchRangesArr.push(arrRange(pSlice));
  }

  const medE = medianVal(relEnergies);
  const scaleE = robustScale(relEnergies);
  const normalizedEnergies = relEnergies.map(e => clampNum(1 + (e - medE) / (scaleE * 2), 0.1, 3.0));

  return {
    relDurations: new Array(PROFILE_LEN).fill(1),
    relEnergies: normalizedEnergies,
    pitchRanges: pitchRangesArr,
    durationCV: 0,
    maxMedianRatio: 1,
    elongatedRatio: 0,
    durationSkewness: 0,
    energyCV: coefficientOfVariation(normalizedEnergies),
    emphasisRatio: normalizedEnergies.filter(e => e > 1.3).length / normalizedEnergies.length,
    expressiveRatio: pitchRangesArr.filter(r => r > 2.5).length / pitchRangesArr.length,
    avgPitchRange: meanVal(pitchRangesArr),
    durationProfile: new Array(PROFILE_LEN).fill(1),
    energyProfile: resampleProfile(normalizedEnergies, PROFILE_LEN),
    pitchRangeProfile: resampleProfile(pitchRangesArr, PROFILE_LEN),
    elongationPositions: [],
    speechRate: pattern.speechRate,
    regularity: pattern.regularity,
    segmentCount: 0,
  };
}

// ── Comparison Functions ──

function compareElongation(
  ref: DeliveryProfile,
  usr: DeliveryProfile,
  params: DeliveryParams,
): number {
  // If neither has elongation and both are uniform, they match
  if (ref.elongatedRatio === 0 && usr.elongatedRatio === 0) {
    const cvSim = ratioSim(ref.durationCV + 0.01, usr.durationCV + 0.01);
    return cvSim * 0.5 + 0.5; // base 0.5 for both-uniform
  }

  // 1. Duration CV similarity (how varied are segment lengths)
  const cvSim = ratioSim(ref.durationCV + 0.01, usr.durationCV + 0.01);

  // 2. Elongated ratio similarity (how many segments are stretched)
  const elongRatioDiff = Math.abs(ref.elongatedRatio - usr.elongatedRatio);
  const elongSim = Math.max(0, 1 - elongRatioDiff * 2);

  // 3. Max/median ratio similarity (how extreme is the stretching)
  const maxSim = ratioSim(ref.maxMedianRatio, usr.maxMedianRatio);

  // 4. Duration profile shape (WHERE do elongations occur)
  const profileCorr = Math.max(0, pearsonCorrelation(ref.durationProfile, usr.durationProfile));

  // 5. Elongation position matching (do elongations happen at same relative positions)
  const posSim = comparePositionSets(ref.elongationPositions, usr.elongationPositions);

  return Math.max(0,
    cvSim * 0.15 +
    elongSim * 0.20 +
    maxSim * 0.15 +
    profileCorr * 0.30 +
    posSim * 0.20,
  );
}

function compareEmphasis(ref: DeliveryProfile, usr: DeliveryProfile): number {
  const cvSim = ratioSim(ref.energyCV + 0.01, usr.energyCV + 0.01);
  const emphDiff = Math.abs(ref.emphasisRatio - usr.emphasisRatio);
  const emphSim = Math.max(0, 1 - emphDiff * 2);
  const profileCorr = Math.max(0, pearsonCorrelation(ref.energyProfile, usr.energyProfile));

  return Math.max(0,
    cvSim * 0.25 +
    emphSim * 0.30 +
    profileCorr * 0.45,
  );
}

function compareExpressiveness(ref: DeliveryProfile, usr: DeliveryProfile): number {
  const exprDiff = Math.abs(ref.expressiveRatio - usr.expressiveRatio);
  const exprSim = Math.max(0, 1 - exprDiff * 2);
  const rangeSim = ratioSim(ref.avgPitchRange + 0.1, usr.avgPitchRange + 0.1);
  const profileCorr = Math.max(0, pearsonCorrelation(ref.pitchRangeProfile, usr.pitchRangeProfile));

  return Math.max(0,
    exprSim * 0.30 +
    rangeSim * 0.30 +
    profileCorr * 0.40,
  );
}

function compareRhythm(ref: DeliveryProfile, usr: DeliveryProfile): number {
  const speedSim = ratioSim(ref.speechRate + 0.1, usr.speechRate + 0.1);
  const regDiff = Math.abs(ref.regularity - usr.regularity);
  const regSim = Math.max(0, 1 - regDiff * 2);
  const skewSim = absSim(ref.durationSkewness, usr.durationSkewness, 2.0);
  const countSim = ref.segmentCount > 0 && usr.segmentCount > 0
    ? ratioSim(ref.segmentCount, usr.segmentCount)
    : 0.5;

  return Math.max(0,
    speedSim * 0.30 +
    regSim * 0.25 +
    skewSim * 0.20 +
    countSim * 0.25,
  );
}

/** Compare two sets of normalized positions using nearest-neighbor matching */
function comparePositionSets(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.2;

  const tolerance = 0.15;
  let matched = 0;
  const used = new Set<number>();

  for (const posA of a) {
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < b.length; j++) {
      if (used.has(j)) continue;
      const dist = Math.abs(posA - b[j]);
      if (dist < bestDist) { bestDist = dist; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestDist <= tolerance) {
      matched++;
      used.add(bestIdx);
    }
  }

  const maxCount = Math.max(a.length, b.length);
  const positionMatch = matched / maxCount;
  const countMatch = ratioSim(a.length, b.length);

  return positionMatch * 0.6 + countMatch * 0.4;
}

// ── Math Helpers ──

/** Linear ratio similarity (more forgiving than quadratic) */
function ratioSim(a: number, b: number): number {
  if (a <= 0 && b <= 0) return 1;
  if (a <= 0 || b <= 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

function absSim(a: number, b: number, scale: number): number {
  return Math.max(0, 1 - Math.abs(a - b) / scale);
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-10) return varA < 1e-10 && varB < 1e-10 ? 1 : 0;
  return cov / denom;
}

function meanVal(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function medianVal(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function arrRange(arr: number[]): number {
  if (arr.length === 0) return 0;
  let min = Infinity, max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

function coefficientOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = meanVal(arr);
  if (Math.abs(m) < 1e-8) return 0;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  return std / Math.abs(m);
}

function robustScale(arr: number[]): number {
  if (arr.length < 2) return 1;
  const med = medianVal(arr);
  const absDev = arr.map(v => Math.abs(v - med));
  const mad = medianVal(absDev) * 1.4826; // MAD -> std-like scale
  if (mad > 1e-4) return mad;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - meanVal(arr)) ** 2, 0) / arr.length);
  return std > 1e-4 ? std : 1;
}

function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function skewness(arr: number[]): number {
  if (arr.length < 3) return 0;
  const m = meanVal(arr);
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  if (std < 1e-8) return 0;
  return arr.reduce((s, v) => s + ((v - m) / std) ** 3, 0) / arr.length;
}

function movingAvg(arr: number[], windowSize: number): number[] {
  const half = Math.floor(windowSize / 2);
  return arr.map((_, i) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      count++;
    }
    return sum / count;
  });
}

function resampleProfile(arr: number[], targetLen: number): number[] {
  if (arr.length === 0) return new Array(targetLen).fill(0);
  if (arr.length === 1) return new Array(targetLen).fill(arr[0]);
  if (arr.length === targetLen) return [...arr];

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

function normalizeEnabledWeights(
  weights: DeliveryParams['weights'],
  enabled: NonNullable<DeliveryParams['enabledMetrics']>,
): Record<keyof DeliveryParams['weights'], number> {
  const entries = Object.entries(weights)
    .filter(([k]) => enabled[k as keyof DeliveryParams['weights']]) as Array<[keyof DeliveryParams['weights'], number]>;

  // If user disables everything, fall back to all enabled for safety
  const activeEntries = entries.length > 0
    ? entries
    : (Object.entries(weights) as Array<[keyof DeliveryParams['weights'], number]>);

  const total = activeEntries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) {
    const uniform = 1 / activeEntries.length;
    return Object.fromEntries(activeEntries.map(([k]) => [k, uniform])) as Record<keyof DeliveryParams['weights'], number>;
  }

  return Object.fromEntries(activeEntries.map(([k, v]) => [k, v / total])) as Record<keyof DeliveryParams['weights'], number>;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function buildFeedback(
  scores: Record<'elongation' | 'emphasis' | 'expressiveness' | 'rhythm', number>,
  enabledKeys: Array<'elongation' | 'emphasis' | 'expressiveness' | 'rhythm'>,
  qualityWarnings: string[],
): string[] {
  const fb: string[] = [...qualityWarnings];

  if (enabledKeys.includes('elongation')) {
    const elong = scores.elongation;
    if (elong < 0.3) fb.push('Elongation pattern is very different — try stretching the same words as the reference');
    else if (elong < 0.5) fb.push('Elongation partially matches — listen to which words get stretched');
  }

  if (enabledKeys.includes('emphasis')) {
    const emph = scores.emphasis;
    if (emph < 0.3) fb.push('Emphasis pattern is very different — focus on where you push volume');
    else if (emph < 0.5) fb.push('Emphasis partially matches — try punching the same beats');
  }

  if (enabledKeys.includes('expressiveness')) {
    const expr = scores.expressiveness;
    if (expr < 0.3) fb.push('Expressiveness differs — match how dramatically the voice moves');
    else if (expr < 0.5) fb.push('Pitch movement partially matches — try wider or narrower pitch at the right moments');
  }

  if (enabledKeys.includes('rhythm')) {
    const rhythm = scores.rhythm;
    if (rhythm < 0.3) fb.push('Rhythm and pacing are very different');
    else if (rhythm < 0.5) fb.push('Timing needs work — match the pace and pauses');
  }

  const avg = enabledKeys.length > 0
    ? enabledKeys.reduce((s, k) => s + scores[k], 0) / enabledKeys.length
    : 0;
  if (avg >= 0.8) fb.push('Excellent delivery match! Your speaking style is very similar.');
  else if (avg >= 0.65) fb.push('Good style match — the delivery feels close.');
  else if (avg >= 0.5) fb.push('Moderate match — keep practicing the delivery pattern.');

  return fb;
}
