/**
 * Attention Profile Comparer — measures HOW attention is maintained, not WHERE.
 *
 * Compares: focused ratio, scanning patterns, away time, transition patterns.
 * Best for measuring overall attention quality.
 */

import type { EyesPatternV2 } from './types';

export interface AttentionParams {
  weights: Record<'focusRatio' | 'scanPattern' | 'awayTime' | 'transitions', number>;
  enabledMetrics: Record<'focusRatio' | 'scanPattern' | 'awayTime' | 'transitions', boolean>;
}

export const DEFAULT_ATTENTION_PARAMS: AttentionParams = {
  weights: { focusRatio: 0.35, scanPattern: 0.25, awayTime: 0.20, transitions: 0.20 },
  enabledMetrics: { focusRatio: true, scanPattern: true, awayTime: true, transitions: true },
};

let _params: AttentionParams = { ...DEFAULT_ATTENTION_PARAMS };

export function setAttentionParams(params: AttentionParams | undefined) {
  _params = params ? { ...params } : { ...DEFAULT_ATTENTION_PARAMS };
}

// ── Main comparison ──

export function compareAttentionProfile(
  ref: EyesPatternV2,
  learner: EyesPatternV2,
  params?: AttentionParams,
  options?: { applyQualityPenalty?: boolean },
): {
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
} {
  const p = params ?? _params;

  // ── Focus ratio: how much time is spent focused ──
  let focusRatioScore = 50;
  if (p.enabledMetrics.focusRatio) {
    const refFocus = ref.attentionDistribution.focused;
    const learnerFocus = learner.attentionDistribution.focused;
    if (refFocus > 0) {
      focusRatioScore = Math.max(0, 100 - Math.abs(refFocus - learnerFocus) / refFocus * 100);
    } else {
      focusRatioScore = learnerFocus === 0 ? 100 : 50;
    }
  }

  // ── Scan pattern: scanning segment similarity ──
  let scanPatternScore = 50;
  if (p.enabledMetrics.scanPattern) {
    const refScanning = ref.attentionDistribution.scanning;
    const learnerScanning = learner.attentionDistribution.scanning;
    if (refScanning > 0) {
      scanPatternScore = Math.max(0, 100 - Math.abs(refScanning - learnerScanning) / Math.max(refScanning, 0.01) * 100);
    } else {
      // Reference has no scanning — learner should also have minimal
      scanPatternScore = Math.max(0, 100 - learnerScanning * 200);
    }

    // Also compare scanning segment count
    const refScanSegs = ref.attentionSegments.filter(s => s.type === 'scanning').length;
    const learnerScanSegs = learner.attentionSegments.filter(s => s.type === 'scanning').length;
    const segCountSim = Math.max(refScanSegs, learnerScanSegs) > 0
      ? Math.max(0, 100 - Math.abs(refScanSegs - learnerScanSegs) / Math.max(refScanSegs, learnerScanSegs) * 100)
      : 100;
    scanPatternScore = scanPatternScore * 0.6 + segCountSim * 0.4;
  }

  // ── Away time: less away is generally better ──
  let awayTimeScore = 50;
  if (p.enabledMetrics.awayTime) {
    const refAway = ref.attentionDistribution.away;
    const learnerAway = learner.attentionDistribution.away;
    // Match away ratio
    if (refAway > 0) {
      awayTimeScore = Math.max(0, 100 - Math.abs(refAway - learnerAway) / Math.max(refAway, 0.01) * 100);
    } else {
      // Reference has no away time — penalize learner's away time
      awayTimeScore = Math.max(0, 100 - learnerAway * 200);
    }
  }

  // ── Transitions: attention segment transition frequency ──
  let transitionsScore = 50;
  if (p.enabledMetrics.transitions) {
    const refTransitions = ref.attentionSegments.length;
    const learnerTransitions = learner.attentionSegments.length;
    if (Math.max(refTransitions, learnerTransitions) > 0) {
      transitionsScore = Math.max(0, 100 - Math.abs(refTransitions - learnerTransitions) / Math.max(refTransitions, learnerTransitions) * 100);
    } else {
      transitionsScore = 100;
    }
  }

  // ── Weighted combination ──
  const scores: Record<string, number> = {
    focusRatio: focusRatioScore,
    scanPattern: scanPatternScore,
    awayTime: awayTimeScore,
    transitions: transitionsScore,
  };

  let totalWeight = 0, weightedSum = 0;
  for (const key of ['focusRatio', 'scanPattern', 'awayTime', 'transitions'] as const) {
    if (p.enabledMetrics[key]) {
      weightedSum += scores[key] * p.weights[key];
      totalWeight += p.weights[key];
    }
  }

  let rawScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

  if (options?.applyQualityPenalty !== false) {
    const qualityFactor = Math.max(0.5, learner.quality.faceDetectedRatio);
    rawScore *= qualityFactor;
  }

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const breakdown: Record<string, number> = {};
  for (const key of ['focusRatio', 'scanPattern', 'awayTime', 'transitions'] as const) {
    if (p.enabledMetrics[key]) breakdown[key] = Math.round(scores[key]);
  }

  const feedback: string[] = [];
  if (focusRatioScore < 60) feedback.push('Try maintaining focus for longer periods');
  if (scanPatternScore < 60) feedback.push('Scanning pattern differs from reference');
  if (awayTimeScore < 60) feedback.push('Too much time looking away — stay engaged');
  if (transitionsScore < 60) feedback.push('Attention transition frequency differs');
  if (score >= 80) feedback.push('Excellent attention pattern!');

  return { score, breakdown, feedback };
}
