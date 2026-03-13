import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';
import { getRouter9RuntimeConfig } from './router9Config';

export interface CoachV2Params {
  tempoDecay: number;
  tempoPerfectCap: number;
  energyTiers: Array<{ upper: number; score: number }>;
  energyDefault: number;
  energyCapThreshold: number;
  energyCapMultiplier: number;
  energyFloorRatio: number;
  energyFloorMultiplier: number;
  llm: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    combo: string;
    apiKey?: string;
    timeoutMs: number;
  };
}

export interface CoachV2CompareOptions {
  applyQualityPenalty?: boolean;
}

const router9 = getRouter9RuntimeConfig();

export const DEFAULT_COACH_V2_PARAMS: CoachV2Params = {
  tempoDecay: 60,
  tempoPerfectCap: 95,
  energyTiers: [
    { upper: 5, score: 90 },
    { upper: 15, score: 85 },
    { upper: 30, score: 65 },
    { upper: 50, score: 50 },
    { upper: 70, score: 35 },
  ],
  energyDefault: 8,
  energyCapThreshold: 20,
  energyCapMultiplier: 2.5,
  energyFloorRatio: 0.6,
  energyFloorMultiplier: 1.05,
  llm: {
    enabled: router9.llmEnabled,
    baseUrl: router9.baseUrl,
    model: router9.model,
    combo: router9.combo,
    apiKey: router9.apiKey || undefined,
    timeoutMs: router9.timeoutMs,
  },
};

let _coachV2Params: CoachV2Params = structuredClone(DEFAULT_COACH_V2_PARAMS);

export function setSoundCoachV2Params(params: Partial<CoachV2Params> | undefined): void {
  if (!params) {
    _coachV2Params = structuredClone(DEFAULT_COACH_V2_PARAMS);
    return;
  }

  _coachV2Params = {
    ..._coachV2Params,
    ...params,
    llm: {
      ..._coachV2Params.llm,
      ...(params.llm ?? {}),
    },
  };
}

export function getSoundCoachV2Params(): CoachV2Params {
  return _coachV2Params;
}

interface CoachFeatures {
  tempoBpm: number;
  energyProxy: number;
  voicedRatio: number;
  speechRate: number;
  regularity: number;
}

interface TempoScore {
  score: number;
  bpmDiffPct: number;
}

interface EnergyScore {
  score: number;
  diffPct: number;
}

interface OverallScore {
  overallScore: number;
  baseScore: number;
  rule: 'energy_cap' | 'energy_floor' | 'average';
}

interface LLMResult {
  tempoScore: number;
  energyScore: number;
  overallScore: number;
  baseScore?: number;
  ruleApplied?: 'energy_cap' | 'energy_floor' | 'average';
  confidence?: number;
}

export async function compareCoachV2Style(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
  params: CoachV2Params = _coachV2Params,
  options?: CoachV2CompareOptions,
): Promise<SoundCompareResultV2> {
  const refFeatures = extractCoachFeatures(ref);
  const usrFeatures = extractCoachFeatures(usr);

  const tempo = scoreTempo(refFeatures, usrFeatures, params);
  const energy = scoreEnergy(refFeatures, usrFeatures, params);
  const overall = computeOverall(tempo.score, energy.score, params);

  let finalTempo = tempo.score;
  let finalEnergy = energy.score;
  let finalOverall = overall.overallScore;
  let finalBase = overall.baseScore;
  let finalRule = overall.rule;
  let llmUsed = 0;
  let llmConfidence = 0;
  let llmError = '';

  const apiKey = resolveApiKey(params.llm.apiKey);
  if (params.llm.enabled && apiKey) {
    try {
      const llm = await requestCoachScoreFromLLM(
        refFeatures,
        usrFeatures,
        tempo,
        energy,
        overall,
        params,
        apiKey,
      );
      if (llm) {
        finalTempo = clamp(llm.tempoScore, 0, 100);
        finalEnergy = clamp(llm.energyScore, 0, 100);
        finalOverall = clamp(llm.overallScore, 0, 100);
        finalBase = clamp(llm.baseScore ?? ((finalTempo + finalEnergy) / 2), 0, 100);
        finalRule = llm.ruleApplied ?? finalRule;
        llmUsed = 1;
        llmConfidence = clamp(llm.confidence ?? 0.75, 0, 1);
      }
    } catch (err) {
      llmError = err instanceof Error ? err.message : 'Unknown LLM error';
    }
  }

  const refQuality = evaluateQuality(ref);
  const usrQuality = evaluateQuality(usr);
  const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

  const applyQualityPenalty = options?.applyQualityPenalty ?? false;
  const rawScore = clamp(finalOverall, 0, 100);
  const finalScore = applyQualityPenalty ? rawScore * qualityFactor : rawScore;
  const score = Math.round(clamp(finalScore, 0, 100));

  const feedback = buildFeedback(
    finalTempo,
    finalEnergy,
    finalOverall,
    finalRule,
    [...refQuality.warnings, ...usrQuality.warnings],
    llmUsed === 1,
    llmError,
  );

  return {
    score,
    breakdown: {
      tempo: Math.round(finalTempo),
      energy: Math.round(finalEnergy),
    } as any,
    qualityFactor: round3(qualityFactor),
    feedback,
    debug: {
      tempoScore: round3(finalTempo),
      energyScore: round3(finalEnergy),
      overallScore: round3(finalOverall),
      baseScore: round3(finalBase),
      bpmDiffPct: round3(tempo.bpmDiffPct),
      energyDiffPct: round3(energy.diffPct),
      refTempoBpm: round3(refFeatures.tempoBpm),
      usrTempoBpm: round3(usrFeatures.tempoBpm),
      refEnergyProxy: round3(refFeatures.energyProxy),
      usrEnergyProxy: round3(usrFeatures.energyProxy),
      refVoicedRatio: round3(refFeatures.voicedRatio),
      usrVoicedRatio: round3(usrFeatures.voicedRatio),
      refSpeechRate: round3(refFeatures.speechRate),
      usrSpeechRate: round3(usrFeatures.speechRate),
      refRegularity: round3(refFeatures.regularity),
      usrRegularity: round3(usrFeatures.regularity),
      ruleCode: finalRule === 'energy_cap' ? 1 : finalRule === 'energy_floor' ? 2 : 0,
      rule_energyCap: finalRule === 'energy_cap' ? 1 : 0,
      rule_energyFloor: finalRule === 'energy_floor' ? 1 : 0,
      llmUsed,
      llmConfidence: round3(llmConfidence),
      applyQualityPenalty: applyQualityPenalty ? 1 : 0,
      qualityFactor: round3(qualityFactor),
      rawScore: round3(rawScore),
      finalScore: round3(finalScore),
    },
  };
}

function resolveApiKey(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const cfg = getRouter9RuntimeConfig();
  return cfg.apiKey;
}

function extractCoachFeatures(pattern: SoundPatternV2): CoachFeatures {
  const tempoBpm = estimateTempoBpm(pattern);
  const energyProxy = computeEnergyProxy(pattern);

  return {
    tempoBpm,
    energyProxy,
    voicedRatio: pattern.voicedRatio || 0,
    speechRate: pattern.speechRate || 0,
    regularity: pattern.regularity || 0,
  };
}

function estimateTempoBpm(pattern: SoundPatternV2): number {
  const onsets = [...(pattern.onsetTimes ?? [])].sort((a, b) => a - b);
  if (onsets.length >= 2) {
    const iois: number[] = [];
    for (let i = 1; i < onsets.length; i++) {
      iois.push(onsets[i] - onsets[i - 1]);
    }
    const med = median(iois.filter(v => v > 0.08 && v < 2.0));
    if (med > 0) return clamp(60 / med, 20, 260);
  }

  if (pattern.avgIOI > 0) {
    return clamp(60000 / pattern.avgIOI, 20, 260);
  }

  if (pattern.speechRate > 0) {
    // weak fallback: syllables/s -> rough beat proxy
    return clamp(pattern.speechRate * 60, 20, 260);
  }

  return 80;
}

function computeEnergyProxy(pattern: SoundPatternV2): number {
  const e = pattern.energyContourNorm ?? [];
  if (e.length === 0) return 0.2;

  const absMean = mean(e.map(v => Math.abs(v)));
  const std = Math.sqrt(mean(e.map(v => (v - mean(e)) ** 2)));
  const p10 = percentile(e, 10);
  const p90 = percentile(e, 90);
  const dynamic = Math.max(0, p90 - p10);
  const snrPart = clamp((pattern.quality?.snrLike ?? 0) / 24, 0, 2);

  // Proxy tuned for normalized contours: combine dynamic shape + clarity signal.
  return 0.45 * absMean + 0.3 * std + 0.15 * dynamic + 0.1 * snrPart;
}

function scoreTempo(ref: CoachFeatures, cand: CoachFeatures, p: CoachV2Params): TempoScore {
  const bpmDiffPct = (Math.abs(cand.tempoBpm - ref.tempoBpm) / Math.max(ref.tempoBpm, 1)) * 100;
  const score = Math.min(p.tempoPerfectCap, 100 * Math.exp(-bpmDiffPct / p.tempoDecay));
  return {
    score,
    bpmDiffPct,
  };
}

function scoreEnergy(ref: CoachFeatures, cand: CoachFeatures, p: CoachV2Params): EnergyScore {
  const diffPct = (Math.abs(cand.energyProxy - ref.energyProxy) / Math.max(ref.energyProxy, 1e-9)) * 100;
  let score = p.energyDefault;
  for (const tier of p.energyTiers) {
    if (diffPct < tier.upper) {
      score = tier.score;
      break;
    }
  }
  return {
    score,
    diffPct,
  };
}

function computeOverall(tempoScore: number, energyScore: number, p: CoachV2Params): OverallScore {
  const base = tempoScore * 0.5 + energyScore * 0.5;

  if (energyScore < p.energyCapThreshold) {
    return {
      overallScore: Math.min(base, energyScore * p.energyCapMultiplier),
      baseScore: base,
      rule: 'energy_cap',
    };
  }

  if (tempoScore < energyScore * p.energyFloorRatio) {
    return {
      overallScore: Math.max(base, energyScore * p.energyFloorMultiplier),
      baseScore: base,
      rule: 'energy_floor',
    };
  }

  return {
    overallScore: base,
    baseScore: base,
    rule: 'average',
  };
}

async function requestCoachScoreFromLLM(
  ref: CoachFeatures,
  usr: CoachFeatures,
  tempo: TempoScore,
  energy: EnergyScore,
  overall: OverallScore,
  params: CoachV2Params,
  apiKey: string,
): Promise<LLMResult | null> {
  const baseUrl = params.llm.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model: params.llm.model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a vocal coach scoring engine. Return STRICT JSON only with fields: tempo_score, energy_score, overall_score, base_score, rule_applied, confidence. rule_applied must be one of: energy_cap, energy_floor, average.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          combo: params.llm.combo,
          formulas: {
            tempo_score: 'min(95, 100 * exp(-bpm_diff_pct / 60))',
            energy_score: 'tiers: <5%=90, <15%=85, <30%=65, <50%=50, <70%=35, else=8',
            overall: 'base = tempo*0.5 + energy*0.5; if energy<20 => min(base, energy*2.5); elif tempo<energy*0.6 => max(base, energy*1.05); else base',
          },
          reference_features: ref,
          candidate_features: usr,
          deterministic_preview: {
            tempo_score: round3(tempo.score),
            energy_score: round3(energy.score),
            overall_score: round3(overall.overallScore),
            base_score: round3(overall.baseScore),
            rule_applied: overall.rule,
          },
        }),
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(2000, params.llm.timeoutMs));

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`9router HTTP ${resp.status}`);
    }

    const json = await resp.json() as any;
    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') return null;

    const parsed = parseJsonObject(content);
    if (!parsed) return null;

    const tempoScore = Number(parsed.tempo_score);
    const energyScore = Number(parsed.energy_score);
    const overallScore = Number(parsed.overall_score);
    if (!Number.isFinite(tempoScore) || !Number.isFinite(energyScore) || !Number.isFinite(overallScore)) {
      return null;
    }

    const baseScore = Number(parsed.base_score);
    const confidence = Number(parsed.confidence);

    return {
      tempoScore,
      energyScore,
      overallScore,
      baseScore: Number.isFinite(baseScore) ? baseScore : undefined,
      ruleApplied: normalizeRule(parsed.rule_applied),
      confidence: Number.isFinite(confidence) ? confidence : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(raw: string): Record<string, any> | null {
  const clean = raw.trim();

  try {
    return JSON.parse(clean);
  } catch {
    // continue
  }

  const block = clean.match(/```json\s*([\s\S]*?)```/i) || clean.match(/```\s*([\s\S]*?)```/i);
  if (block?.[1]) {
    try {
      return JSON.parse(block[1].trim());
    } catch {
      // continue
    }
  }

  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(clean.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeRule(rule: unknown): 'energy_cap' | 'energy_floor' | 'average' {
  if (rule === 'energy_cap' || rule === 'energy_floor' || rule === 'average') return rule;
  return 'average';
}

function buildFeedback(
  tempoScore: number,
  energyScore: number,
  overallScore: number,
  rule: 'energy_cap' | 'energy_floor' | 'average',
  qualityWarnings: string[],
  llmUsed: boolean,
  llmError: string,
): string[] {
  const fb: string[] = [];
  fb.push(...qualityWarnings);

  if (tempoScore < 45) fb.push('Tempo lệch khá nhiều so với reference, cần bám nhịp ổn định hơn.');
  else if (tempoScore < 70) fb.push('Tempo ở mức trung bình, thử luyện theo beat để vào nhịp tốt hơn.');

  if (energyScore < 35) fb.push('Năng lượng giọng chưa khớp (quá nhỏ hoặc quá gắt), cần cân lại lực giọng.');
  else if (energyScore < 65) fb.push('Energy gần đúng nhưng chưa đều, cần kiểm soát cường độ tốt hơn.');

  if (rule === 'energy_cap') fb.push('Rule energy_cap kích hoạt: năng lượng quá thấp đang giới hạn điểm tổng.');
  if (rule === 'energy_floor') fb.push('Rule energy_floor kích hoạt: energy tốt hơn tempo, điểm tổng được giữ sàn nhẹ.');

  if (overallScore >= 85) fb.push('Excellent coach-style match (tempo + energy).');
  else if (overallScore >= 70) fb.push('Good match, còn chút lệch nhịp/lực giọng.');
  else if (overallScore >= 55) fb.push('Moderate match, cần luyện đồng bộ tempo và energy rõ hơn.');

  if (llmUsed) fb.push('LLM coach mode: score được xác nhận qua 9router combo:mse.');
  else fb.push('LLM coach mode đang fallback local formula (không có API key hoặc request lỗi).');

  if (llmError) fb.push(`LLM note: ${llmError}`);

  return fb;
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
