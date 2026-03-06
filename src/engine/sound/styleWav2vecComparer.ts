import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';
import { compareDeliveryStyle } from './styleDeliveryComparer';
import type { DeliveryParams } from './styleDeliveryComparer';
import { compareStyleFingerprints } from './styleFingerprintComparer';
import type { FingerprintParams } from './styleFingerprintComparer';

export interface Wav2VecParams {
  weights: {
    embedding: number;
    delivery: number;
    fingerprint: number;
  };
}

export interface Wav2VecCompareOptions {
  applyQualityPenalty?: boolean;
  deliveryParams?: DeliveryParams;
  fingerprintParams?: FingerprintParams;
}

export const DEFAULT_WAV2VEC_PARAMS: Wav2VecParams = {
  weights: {
    embedding: 0.45,
    delivery: 0.30,
    fingerprint: 0.25,
  },
};

type EmbeddingCarrier = SoundPatternV2 & {
  _wav2vecEmbedding?: number[];
  wav2vecEmbedding?: number[];
  meta?: {
    wav2vecEmbedding?: number[];
  };
};

export function compareWav2VecStyle(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
  params: Wav2VecParams = DEFAULT_WAV2VEC_PARAMS,
  options?: Wav2VecCompareOptions,
): SoundCompareResultV2 {
  const refEmbedding = resolveEmbedding(ref as EmbeddingCarrier);
  const usrEmbedding = resolveEmbedding(usr as EmbeddingCarrier);

  const embeddingSim = cosineSimilarity(refEmbedding.vector, usrEmbedding.vector);

  const delivery = compareDeliveryStyle(ref, usr, options?.deliveryParams, {
    applyQualityPenalty: false,
  });
  const fingerprint = compareStyleFingerprints(ref, usr, options?.fingerprintParams, {
    applyQualityPenalty: false,
  });

  const deliverySim = delivery.score / 100;
  const fingerprintSim = fingerprint.score / 100;

  const weights = normalizeWeights(params.weights);
  const raw = embeddingSim * weights.embedding
    + deliverySim * weights.delivery
    + fingerprintSim * weights.fingerprint;

  const refQuality = evaluateQuality(ref);
  const usrQuality = evaluateQuality(usr);
  const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

  const applyQualityPenalty = options?.applyQualityPenalty ?? false;
  const rawScore = Math.max(0, Math.min(100, raw * 100));
  const finalScore = applyQualityPenalty ? rawScore * qualityFactor : rawScore;
  const score = Math.round(Math.max(0, Math.min(100, finalScore)));

  const breakdown = {
    embedding: Math.round(embeddingSim * 100),
    delivery: Math.round(deliverySim * 100),
    fingerprint: Math.round(fingerprintSim * 100),
  };

  const feedback = buildFeedback(embeddingSim, deliverySim, fingerprintSim, usrQuality.warnings, refEmbedding.source, usrEmbedding.source);

  return {
    score,
    breakdown: breakdown as any,
    qualityFactor: round3(qualityFactor),
    feedback,
    debug: {
      w_embedding: round3(weights.embedding),
      w_delivery: round3(weights.delivery),
      w_fingerprint: round3(weights.fingerprint),
      embedSim: round3(embeddingSim),
      deliverySim: round3(deliverySim),
      fingerSim: round3(fingerprintSim),
      rawWeightedAvg: round3(raw),
      rawScore: round3(rawScore),
      finalScore: round3(finalScore),
      applyQualityPenalty: applyQualityPenalty ? 1 : 0,
      qualityFactor: round3(qualityFactor),
      refEmbeddingSource: refEmbedding.source === 'wav2vec' ? 1 : 0,
      usrEmbeddingSource: usrEmbedding.source === 'wav2vec' ? 1 : 0,
    },
  };
}

function resolveEmbedding(pattern: EmbeddingCarrier): { vector: number[]; source: 'wav2vec' | 'proxy' } {
  const candidate = pattern._wav2vecEmbedding ?? pattern.wav2vecEmbedding ?? pattern.meta?.wav2vecEmbedding;
  if (candidate && candidate.length > 0) {
    return { vector: l2Normalize(candidate), source: 'wav2vec' };
  }
  return { vector: l2Normalize(buildProxyEmbedding(pattern)), source: 'proxy' };
}

function buildProxyEmbedding(pattern: SoundPatternV2): number[] {
  const pitch = hasContent(pattern.pitchContourVoiced) ? pattern.pitchContourVoiced : pattern.pitchContourNorm;
  const energy = pattern.energyContourNorm;
  const centroid = pattern.spectralCentroidContour ?? [];
  const rolloff = pattern.spectralRolloffContour ?? [];

  const pitchRes = normalizeContour(resample(pitch, 36));
  const energyRes = normalizeContour(resample(energy, 36));
  const centroidRes = normalizeContour(resample(centroid, 18));
  const rolloffRes = normalizeContour(resample(rolloff, 18));

  const pauseRate = pattern.duration > 0 ? pattern.pausePattern.length / pattern.duration : 0;
  const avgPause = pattern.pausePattern.length > 0
    ? pattern.pausePattern.reduce((s, p) => s + p.dur, 0) / pattern.pausePattern.length
    : 0;

  const summary = [
    clampTanh(pattern.speechRate / 4),
    clampTanh(pattern.regularity),
    clampTanh(pattern.voicedRatio),
    clampTanh(pauseRate),
    clampTanh(avgPause * 3),
    clampTanh((pattern.avgIOI || 0) / 700),
  ];

  return [...pitchRes, ...energyRes, ...centroidRes, ...rolloffRes, ...summary];
}

function normalizeWeights(weights: Wav2VecParams['weights']): Wav2VecParams['weights'] {
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  if (total <= 0) return { ...DEFAULT_WAV2VEC_PARAMS.weights };
  return {
    embedding: weights.embedding / total,
    delivery: weights.delivery / total,
    fingerprint: weights.fingerprint / total,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA * normB);
  if (denom < 1e-9) return 0;

  const cos = dot / denom;
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}

function resample(arr: number[], targetLen: number): number[] {
  if (!arr || arr.length === 0) return new Array(targetLen).fill(0);
  if (arr.length === targetLen) return [...arr];
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

function normalizeContour(arr: number[]): number[] {
  if (arr.length === 0) return [];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  if (std < 1e-8) return arr.map(() => 0);
  return arr.map(v => clampTanh((v - mean) / std));
}

function l2Normalize(arr: number[]): number[] {
  if (arr.length === 0) return arr;
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-9) return arr.map(() => 0);
  return arr.map(v => v / norm);
}

function hasContent(contour: number[] | undefined): contour is number[] {
  if (!contour || contour.length === 0) return false;
  return contour.some(v => Math.abs(v) > 1e-6);
}

function clampTanh(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.tanh(v);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function buildFeedback(
  embeddingSim: number,
  deliverySim: number,
  fingerprintSim: number,
  qualityWarnings: string[],
  refSource: 'wav2vec' | 'proxy',
  usrSource: 'wav2vec' | 'proxy',
): string[] {
  const fb: string[] = [...qualityWarnings];

  if (embeddingSim < 0.35) fb.push('Embedding similarity is low — overall speaking signature differs a lot.');
  else if (embeddingSim < 0.55) fb.push('Embedding similarity is moderate — style direction is close but not stable yet.');

  if (deliverySim < 0.4) fb.push('Delivery pattern mismatch — focus on elongation and emphasis placement.');
  if (fingerprintSim < 0.45) fb.push('Global style character differs — adjust pace, energy contrast, and voice color.');

  if (refSource === 'proxy' || usrSource === 'proxy') {
    fb.push('Wav2Vec fallback mode: using runtime-safe proxy embedding (no remote wav2vec embedding attached).');
  }

  const avg = (embeddingSim + deliverySim + fingerprintSim) / 3;
  if (avg >= 0.8) fb.push('Excellent style match across embedding + delivery + fingerprint.');
  else if (avg >= 0.65) fb.push('Good hybrid style match.');
  else if (avg >= 0.5) fb.push('Moderate hybrid match — continue imitation practice.');

  return fb;
}
