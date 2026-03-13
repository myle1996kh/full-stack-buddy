/**
 * Vocal Coach S — "Measure S" Comparer
 * 
 * Implements the VOCAL_SCORING_SPEC rubric faithfully:
 * - Tiered Tempo scoring with duration penalty
 * - Direction-aware Energy scoring (LOUDER vs SOFTER)
 * - Overall = T×0.5 + E×0.5 with energy_cap / energy_floor rules
 * - Grade: S≥90, A≥80, B≥70, C≥55, D≥40, F<40
 * - LLM scoring with full rubric + few-shot prompt; deterministic fallback
 */

import type { SoundPatternV2, SoundCompareResultV2 } from './types';
import { evaluateQuality } from './qualityGate';
import { getRouter9RuntimeConfig } from './router9Config';

// ── Config ──

export interface CoachSParams {
    /** LLM configuration */
    llm: {
        enabled: boolean;
        baseUrl: string;
        model: string;
        combo: string;
        apiKey?: string;
        timeoutMs: number;
    };
    scoring: {
        energyCapThreshold: number;
        energyCapMultiplier: number;
        energyFloorRatio: number;
        energyFloorMultiplier: number;
        tempoGateEnabled: boolean;
        tempoGateThreshold: number;
        tempoGateCapMin: number;
        tempoGateCapMax: number;
    };
}

export interface CoachSCompareOptions {
    applyQualityPenalty?: boolean;
}

const router9 = getRouter9RuntimeConfig();

export const DEFAULT_COACH_S_PARAMS: CoachSParams = {
    llm: {
        enabled: router9.llmEnabled,
        baseUrl: router9.baseUrl,
        model: router9.model,
        combo: router9.combo,
        apiKey: router9.apiKey || undefined,
        timeoutMs: router9.timeoutMs,
    },
    scoring: {
        energyCapThreshold: 20,
        energyCapMultiplier: 2.5,
        energyFloorRatio: 0.6,
        energyFloorMultiplier: 1.05,
        tempoGateEnabled: true,
        tempoGateThreshold: 45,
        tempoGateCapMin: 20,
        tempoGateCapMax: 40,
    },
};

let _coachSParams: CoachSParams = structuredClone(DEFAULT_COACH_S_PARAMS);

export function setSoundCoachSParams(params: Partial<CoachSParams> | undefined): void {
    if (!params) {
        _coachSParams = structuredClone(DEFAULT_COACH_S_PARAMS);
        return;
    }
    _coachSParams = {
        ..._coachSParams,
        ...params,
        llm: { ..._coachSParams.llm, ...(params.llm ?? {}) },
        scoring: { ..._coachSParams.scoring, ...(params.scoring ?? {}) },
    };
}

export function getSoundCoachSParams(): CoachSParams {
    return _coachSParams;
}

// ── Types ──

interface CoachSFeatures {
    tempoBpm: number;
    avgRms: number;
    maxRms: number;
    duration: number;
    nSegments: number;
}

interface TempoResult {
    score: number;
    bpmDiffPct: number;
    durationDiffPct: number;
    segmentDiffPct: number;
    segmentPenalty: number;
}

interface EnergyResult {
    score: number;
    diffPct: number;
    direction: 'louder' | 'softer';
}

interface OverallResult {
    score: number;
    baseScore: number;
    rule: 'energy_cap' | 'energy_floor' | 'tempo_gate_cap' | 'average';
    grade: string;
    floorBlockedByTempoGate?: boolean;
}

interface LLMScoringResult {
    tempo: { score: number; bpm_diff_pct: number; reasoning: string };
    energy: { score: number; diff_pct: number; direction: string; reasoning: string };
    overall: { score: number; grade: string; rule_applied: string; summary: string };
}

// ── Rubric Prompt (from VOCAL_SCORING_SPEC) ──

const SYSTEM_PROMPT = `Bạn là vocal coach chuyên nghiệp. Nhiệm vụ: chấm điểm giọng học viên so với mẫu gốc.
Chỉ trả về JSON, không giải thích thêm.`;

const RUBRIC = `Chấm điểm theo RUBRIC sau:

=== TEMPO SCORE (0-100) ===
Tính: bpm_diff_pct = |cand_bpm - ref_bpm| / ref_bpm × 100

Thang điểm:
- diff ≤ 1%:           97   (khớp hoàn hảo)
- diff 1–5%:           95   (gần như khớp)
- diff 5–10%:          88
- diff 10–20%:         75
- diff 20–35%:         62
- diff 35–50%:         48
- diff 50–70%:         33
- diff 70–90%:         22
- diff > 90%:          20   (gấp đôi hoặc hơn)

Bonus/penalty nhỏ dựa trên duration:
- Nếu duration lệch < 10%: không điều chỉnh
- Nếu duration lệch > 50%: trừ thêm 5–10 điểm

=== ENERGY SCORE (0-100) ===
Tính: diff_pct = |cand_avg_rms - ref_avg_rms| / ref_avg_rms × 100
Xác định direction: LOUDER nếu cand > ref, SOFTER nếu cand < ref

LOUDER (cand_rms > ref_rms):
- Penalty nặng hơn vì đẩy lực quá mức
- diff 0–5%:   82–90
- diff 5–15%:  70–82
- diff 15–30%: 55–70
- diff > 30%:  < 55

SOFTER (cand_rms < ref_rms):
- Penalty nhẹ hơn ở mức trung bình, nặng hơn khi cực thấp
- diff 0–5%:   85–92
- diff 5–15%:  82–88  ← softer nhưng gần = ít bị trừ
- diff 15–40%: 50–75
- diff 40–70%: 25–45
- diff > 70%:  < 15   (giọng gần như không nghe thấy)

Điều chỉnh thêm:
- Nếu max_rms cũng thấp tương đương avg_rms: trừ thêm (không có điểm nhấn)
- Nếu pattern tương đồng (max/avg ratio gần bằng ref): cộng thêm 2–5 điểm

=== OVERALL SCORE ===
Công thức cơ bản: base = tempo × 0.5 + energy × 0.5

Điều chỉnh:
1. Nếu energy < 20: overall = min(base, energy × 2.5)
   → Giọng quá nhỏ kéo tổng xuống mạnh
2. Nếu tempo < energy × 0.6: overall = max(base, energy × 1.05)
   → Khi tempo yếu hơn nhiều, energy làm sàn
3. Còn lại: overall = base

Grade: S≥90, A≥80, B≥70, C≥55, D≥40, F<40

=== OUTPUT FORMAT ===
Trả về JSON:
{
  "tempo": {
    "score": <0-100>,
    "bpm_diff_pct": <số>,
    "reasoning": "<giải thích ngắn>"
  },
  "energy": {
    "score": <0-100>,
    "diff_pct": <số>,
    "direction": "louder|softer",
    "reasoning": "<giải thích ngắn>"
  },
  "overall": {
    "score": <0-100>,
    "grade": "<S/A/B/C/D/F>",
    "rule_applied": "<average|energy_cap|energy_floor|tempo_gate_cap>",
    "summary": "<1 câu nhận xét>"
  }
}`;

const FEW_SHOT = `
EXAMPLES (học từ đây để calibrate):

Example 1 — En01:
  bpm_diff=0.0%, avg_rms louder 4.8%, max_rms higher, duration gần bằng
  → Tempo=95 (khớp hoàn hảo, không penalty), Energy=82 (louder nhẹ bị trừ nhiều hơn softer)
  → Overall=88 (base=88.5, plain average)

Example 2 — sound01:
  bpm_diff=38.9%, avg_rms softer 10.5%, max/avg ratio tương đồng ref (pattern OK)
  → Tempo=58 (lệch gần 40%), Energy=84 (softer nhẹ + pattern tương đồng = ít penalty)
  → Overall=72 (base=71, round up nhẹ vì pattern bonus)

Example 3 — T-01:
  bpm_diff=99.9% (gấp đôi), avg_rms softer 65.7%, max_rms cũng rất thấp
  → Tempo=20 (gấp đôi = worst tier), Energy=35 (softer nặng + max thấp = thêm penalty)
  → Overall=38 (base=27.5, energy floor=36.75 vì tempo << energy×0.6)

Example 4 — T-02:
  bpm_diff=2.0% (gần khớp), avg_rms softer 82.1%, max_rms rất thấp, FLAT
  → Tempo=97 (gần khớp hoàn hảo), Energy=8 (softer cực nặng + flat = minimum)
  → Overall=22 (energy_cap: min(52.5, 8×2.5=20) = 20)`;

// ── Main Compare Function ──

export async function compareCoachSStyle(
    ref: SoundPatternV2,
    usr: SoundPatternV2,
    params: CoachSParams = _coachSParams,
    options?: CoachSCompareOptions,
): Promise<SoundCompareResultV2> {
    const refFeatures = extractCoachSFeatures(ref);
    const usrFeatures = extractCoachSFeatures(usr);

    // Deterministic fallback scores
    const tempo = scoreTempoTiered(refFeatures, usrFeatures);
    const energy = scoreEnergyDirectional(refFeatures, usrFeatures);
    const overall = computeOverallS(tempo.score, energy.score, params.scoring);

    let finalTempo = tempo.score;
    let finalEnergy = energy.score;
    let finalOverall = overall.score;
    let finalBase = overall.baseScore;
    let finalGrade = overall.grade;
    let finalRule: 'energy_cap' | 'energy_floor' | 'tempo_gate_cap' | 'average' = overall.rule;
    let finalFloorBlockedByTempoGate = overall.floorBlockedByTempoGate === true;
    let llmUsed = 0;
    let llmError = '';
    let tempoReasoning = '';
    let energyReasoning = '';
    let overallSummary = '';

    // LLM pass
    const apiKey = resolveApiKey(params.llm.apiKey);
    if (params.llm.enabled && apiKey) {
        try {
            const llmResult = await requestScoreFromLLM(refFeatures, usrFeatures, params, apiKey);
            if (llmResult) {
                finalTempo = clamp(llmResult.tempo.score, 0, 100);
                finalEnergy = clamp(llmResult.energy.score, 0, 100);
                finalOverall = clamp(llmResult.overall.score, 0, 100);
                finalGrade = llmResult.overall.grade || overall.grade;
                finalRule = normalizeRule(llmResult.overall.rule_applied);
                tempoReasoning = llmResult.tempo.reasoning || '';
                energyReasoning = llmResult.energy.reasoning || '';
                overallSummary = llmResult.overall.summary || '';
                llmUsed = 1;
            }
        } catch (err) {
            llmError = err instanceof Error ? err.message : 'Unknown LLM error';
        }
    }

    // Enforce configured policy for overall/rule from final tempo+energy (works for local and LLM modes)
    const governedOverall = computeOverallS(finalTempo, finalEnergy, params.scoring);
    finalBase = governedOverall.baseScore;
    finalOverall = governedOverall.score;
    finalRule = governedOverall.rule;
    finalGrade = computeGrade(finalOverall);
    finalFloorBlockedByTempoGate = governedOverall.floorBlockedByTempoGate === true;

    // Quality gate
    const refQuality = evaluateQuality(ref);
    const usrQuality = evaluateQuality(usr);
    const qualityFactor = Math.min(refQuality.factor, usrQuality.factor);

    const applyQualityPenalty = options?.applyQualityPenalty ?? false;
    const rawScore = clamp(finalOverall, 0, 100);
    const finalScore = applyQualityPenalty ? rawScore * qualityFactor : rawScore;
    const score = Math.round(clamp(finalScore, 0, 100));

    const feedback = buildFeedbackS(
        finalTempo,
        finalEnergy,
        finalOverall,
        finalGrade,
        finalRule,
        energy.direction,
        [...refQuality.warnings, ...usrQuality.warnings],
        llmUsed === 1,
        llmError,
        tempoReasoning,
        energyReasoning,
        overallSummary,
        finalFloorBlockedByTempoGate,
        tempo.segmentPenalty,
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
            grade: finalGrade,
            bpmDiffPct: round3(tempo.bpmDiffPct),
            durationDiffPct: round3(tempo.durationDiffPct),
            segmentDiffPct: round3(tempo.segmentDiffPct),
            segmentPenalty: round3(tempo.segmentPenalty),
            energyDiffPct: round3(energy.diffPct),
            energyDirection: energy.direction === 'louder' ? 1 : 0,
            refTempoBpm: round3(refFeatures.tempoBpm),
            usrTempoBpm: round3(usrFeatures.tempoBpm),
            refAvgRms: round3(refFeatures.avgRms),
            usrAvgRms: round3(usrFeatures.avgRms),
            refMaxRms: round3(refFeatures.maxRms),
            usrMaxRms: round3(usrFeatures.maxRms),
            refDuration: round3(refFeatures.duration),
            usrDuration: round3(usrFeatures.duration),
            refNSegments: refFeatures.nSegments,
            usrNSegments: usrFeatures.nSegments,
            refMeasureSFeatures: ref.measureS ? 1 : 0,
            usrMeasureSFeatures: usr.measureS ? 1 : 0,
            refMeasureSBeatConfidence: round3(ref.measureS?.beatConfidence ?? 0),
            usrMeasureSBeatConfidence: round3(usr.measureS?.beatConfidence ?? 0),
            refMeasureSOnsetCount: ref.measureS?.onsetCount ?? 0,
            usrMeasureSOnsetCount: usr.measureS?.onsetCount ?? 0,
            tempoGateEnabled: params.scoring.tempoGateEnabled ? 1 : 0,
            tempoGateThreshold: params.scoring.tempoGateThreshold,
            tempoGateCapMin: round3(params.scoring.tempoGateCapMin),
            tempoGateCapMax: round3(params.scoring.tempoGateCapMax),
            tempoGateCapApplied: round3(computeTempoGateCap(finalEnergy, params.scoring.tempoGateCapMin, params.scoring.tempoGateCapMax)),
            energyCapThreshold: params.scoring.energyCapThreshold,
            energyCapMultiplier: round3(params.scoring.energyCapMultiplier),
            energyFloorRatio: round3(params.scoring.energyFloorRatio),
            energyFloorMultiplier: round3(params.scoring.energyFloorMultiplier),
            rule_floorBlockedByTempoGate: finalFloorBlockedByTempoGate ? 1 : 0,
            ruleCode: finalRule === 'energy_cap' ? 1 : finalRule === 'energy_floor' ? 2 : finalRule === 'tempo_gate_cap' ? 3 : 0,
            rule_energyCap: finalRule === 'energy_cap' ? 1 : 0,
            rule_energyFloor: finalRule === 'energy_floor' ? 1 : 0,
            rule_tempoGateCap: finalRule === 'tempo_gate_cap' ? 1 : 0,
            llmUsed,
            applyQualityPenalty: applyQualityPenalty ? 1 : 0,
            qualityFactor: round3(qualityFactor),
            rawScore: round3(rawScore),
            finalScore: round3(finalScore),
        },
    };
}

// ── Feature Extraction ──

function extractCoachSFeatures(pattern: SoundPatternV2): CoachSFeatures {
    if (pattern.measureS) {
        return {
            tempoBpm: pattern.measureS.tempoBpm,
            avgRms: pattern.measureS.avgRms,
            maxRms: pattern.measureS.maxRms,
            duration: pattern.measureS.duration || pattern.duration || 0,
            nSegments: pattern.measureS.nSegments,
        };
    }

    return {
        tempoBpm: estimateTempoBpm(pattern),
        avgRms: computeAvgRms(pattern),
        maxRms: computeMaxRms(pattern),
        duration: pattern.duration || 0,
        nSegments: (pattern.onsetTimes?.length ?? 0) + 1,
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
    if (pattern.avgIOI > 0) return clamp(60000 / pattern.avgIOI, 20, 260);
    if (pattern.speechRate > 0) return clamp(pattern.speechRate * 60, 20, 260);
    return 80;
}

/** Convert normalized energy contour back to an RMS-like proxy value */
function computeAvgRms(pattern: SoundPatternV2): number {
    const e = pattern.energyContourNorm ?? [];
    if (e.length === 0) return 0.02;
    const absMean = mean(e.map(v => Math.abs(v)));
    const snrPart = clamp((pattern.quality?.snrLike ?? 0) / 40, 0, 1);
    return 0.6 * absMean + 0.4 * snrPart;
}

function computeMaxRms(pattern: SoundPatternV2): number {
    const e = pattern.energyContourNorm ?? [];
    if (e.length === 0) return 0.05;
    const p95 = percentile(e, 95);
    return Math.max(p95, computeAvgRms(pattern) * 1.5);
}

// ── Tiered Tempo Scoring (VOCAL_SCORING_SPEC) ──

const TEMPO_TIERS = [
    { maxDiff: 1, score: 97 },
    { maxDiff: 5, score: 95 },
    { maxDiff: 10, score: 88 },
    { maxDiff: 20, score: 75 },
    { maxDiff: 35, score: 62 },
    { maxDiff: 50, score: 48 },
    { maxDiff: 70, score: 33 },
    { maxDiff: 90, score: 22 },
];
const TEMPO_WORST = 20;

/**
 * Segment penalty: penalize when candidate has too many or too few speech segments vs ref.
 * - diff ≤ 20%: no penalty
 * - diff 20–50%: linear 0 → 8
 * - diff > 50%: capped at 15 (8 + extra)
 */
function computeSegmentPenalty(diffPct: number): number {
    if (diffPct <= 20) return 0;
    if (diffPct <= 50) return lerp(0, 8, (diffPct - 20) / 30);
    return Math.min(15, 8 + (diffPct - 50) * 0.14);
}

function scoreTempoTiered(ref: CoachSFeatures, usr: CoachSFeatures): TempoResult {
    const bpmDiffPct = (Math.abs(usr.tempoBpm - ref.tempoBpm) / Math.max(ref.tempoBpm, 1)) * 100;
    const durationDiffPct = ref.duration > 0
        ? (Math.abs(usr.duration - ref.duration) / ref.duration) * 100
        : 0;

    let score = TEMPO_WORST;
    for (const tier of TEMPO_TIERS) {
        if (bpmDiffPct <= tier.maxDiff) {
            score = tier.score;
            break;
        }
    }

    // Duration penalty from spec
    if (durationDiffPct > 50) {
        score = Math.max(TEMPO_WORST, score - clamp(durationDiffPct / 10, 5, 10));
    }

    // Segment penalty: penalize when candidate has too many/few non-silent segments vs ref
    const refSeg = Math.max(ref.nSegments, 1);
    const segmentDiffPct = (Math.abs(usr.nSegments - ref.nSegments) / refSeg) * 100;
    const segmentPenalty = computeSegmentPenalty(segmentDiffPct);
    score = Math.max(TEMPO_WORST, score - segmentPenalty);

    return { score, bpmDiffPct, durationDiffPct, segmentDiffPct, segmentPenalty };
}

// ── Direction-Aware Energy Scoring (VOCAL_SCORING_SPEC) ──

function scoreEnergyDirectional(ref: CoachSFeatures, usr: CoachSFeatures): EnergyResult {
    const diffPct = (Math.abs(usr.avgRms - ref.avgRms) / Math.max(ref.avgRms, 1e-9)) * 100;
    const direction: 'louder' | 'softer' = usr.avgRms >= ref.avgRms ? 'louder' : 'softer';

    let score: number;

    if (direction === 'louder') {
        // LOUDER: heavier penalty
        if (diffPct <= 5) score = lerp(90, 82, diffPct / 5);
        else if (diffPct <= 15) score = lerp(82, 70, (diffPct - 5) / 10);
        else if (diffPct <= 30) score = lerp(70, 55, (diffPct - 15) / 15);
        else score = Math.max(10, 55 - (diffPct - 30) * 0.5);
    } else {
        // SOFTER: lighter mid, heavier extreme
        if (diffPct <= 5) score = lerp(92, 85, diffPct / 5);
        else if (diffPct <= 15) score = lerp(88, 82, (diffPct - 5) / 10);
        else if (diffPct <= 40) score = lerp(75, 50, (diffPct - 15) / 25);
        else if (diffPct <= 70) score = lerp(45, 25, (diffPct - 40) / 30);
        else score = Math.max(5, 15 - (diffPct - 70) * 0.15);
    }

    // Pattern bonus: if max/avg ratio is similar to ref, +2–5
    const refRatio = ref.maxRms / Math.max(ref.avgRms, 1e-9);
    const usrRatio = usr.maxRms / Math.max(usr.avgRms, 1e-9);
    const ratioDiff = Math.abs(refRatio - usrRatio) / Math.max(refRatio, 1);
    if (ratioDiff < 0.2) {
        score = Math.min(100, score + 5);
    } else if (ratioDiff < 0.4) {
        score = Math.min(100, score + 2);
    }

    // Extra penalty if max_rms is also low (flat/no accents)
    if (direction === 'softer' && usr.maxRms < ref.avgRms * 0.5) {
        score = Math.max(5, score - 5);
    }

    return { score: clamp(score, 0, 100), diffPct, direction };
}

// ── Overall + Grade ──

function computeOverallS(tempoScore: number, energyScore: number, scoring: CoachSParams['scoring']): OverallResult {
    const base = tempoScore * 0.5 + energyScore * 0.5;
    let finalScore: number;
    let rule: 'energy_cap' | 'energy_floor' | 'tempo_gate_cap' | 'average';
    let floorBlockedByTempoGate = false;

    const floorCandidate = tempoScore < energyScore * scoring.energyFloorRatio;
    const lowTempoBlocked = scoring.tempoGateEnabled && tempoScore < scoring.tempoGateThreshold;

    if (energyScore < scoring.energyCapThreshold) {
        finalScore = Math.min(base, energyScore * scoring.energyCapMultiplier);
        rule = 'energy_cap';
    } else if (lowTempoBlocked) {
        // Tempo is too far off: enforce a sub-50 cap band (default 20..40) scaled by energy.
        const gateCap = computeTempoGateCap(energyScore, scoring.tempoGateCapMin, scoring.tempoGateCapMax);
        finalScore = Math.min(base, gateCap);
        rule = 'tempo_gate_cap';
        floorBlockedByTempoGate = floorCandidate;
    } else if (floorCandidate) {
        finalScore = Math.max(base, energyScore * scoring.energyFloorMultiplier);
        rule = 'energy_floor';
    } else {
        finalScore = base;
        rule = 'average';
    }

    return {
        score: clamp(finalScore, 0, 100),
        baseScore: base,
        rule,
        grade: computeGrade(finalScore),
        floorBlockedByTempoGate,
    };
}

function computeTempoGateCap(energyScore: number, capMin: number, capMax: number): number {
    const lo = Math.min(capMin, capMax);
    const hi = Math.max(capMin, capMax);
    const t = clamp(energyScore / 100, 0, 1);
    return lo + (hi - lo) * t;
}

function computeGrade(score: number): string {
    if (score >= 90) return 'S';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

// ── LLM Request ──

async function requestScoreFromLLM(
    ref: CoachSFeatures,
    usr: CoachSFeatures,
    params: CoachSParams,
    apiKey: string,
): Promise<LLMScoringResult | null> {
    const baseUrl = params.llm.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/chat/completions`;

    const userContent = `Dữ liệu acoustic (trích xuất bằng librosa):

REFERENCE (mẫu gốc):
${JSON.stringify({
        tempo_bpm: round3(ref.tempoBpm),
        avg_rms: round3(ref.avgRms),
        max_rms: round3(ref.maxRms),
        duration: round3(ref.duration),
        n_segments: ref.nSegments,
    })}

CANDIDATE (học viên):
${JSON.stringify({
        tempo_bpm: round3(usr.tempoBpm),
        avg_rms: round3(usr.avgRms),
        max_rms: round3(usr.maxRms),
        duration: round3(usr.duration),
        n_segments: usr.nSegments,
    })}

${RUBRIC}

IMPLEMENTATION SETTINGS (override base rubric when applicable):
- energy_cap if energy < ${round3(params.scoring.energyCapThreshold)} => overall = min(base, energy * ${round3(params.scoring.energyCapMultiplier)})
- energy_floor only if tempo >= ${round3(params.scoring.tempoGateThreshold)} and tempo < energy * ${round3(params.scoring.energyFloorRatio)}
- when energy_floor applies => overall = max(base, energy * ${round3(params.scoring.energyFloorMultiplier)})
- if tempo < ${round3(params.scoring.tempoGateThreshold)}, apply tempo_gate_cap:
  cap = ${round3(params.scoring.tempoGateCapMin)} + (${round3(params.scoring.tempoGateCapMax)} - ${round3(params.scoring.tempoGateCapMin)}) * (energy/100)
  overall = min(base, cap)  // keep under 50 in low-tempo cases

${FEW_SHOT}`;

    const payload = {
        model: params.llm.model,
        temperature: 0,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
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

        if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);

        const json = await resp.json() as any;
        const content = json?.choices?.[0]?.message?.content;
        if (!content || typeof content !== 'string') return null;

        const parsed = parseJsonObject(content);
        if (!parsed) return null;

        // Validate structure
        if (!parsed.tempo?.score || !parsed.energy?.score || !parsed.overall?.score) {
            return null;
        }

        return {
            tempo: {
                score: Number(parsed.tempo.score),
                bpm_diff_pct: Number(parsed.tempo.bpm_diff_pct ?? 0),
                reasoning: String(parsed.tempo.reasoning ?? ''),
            },
            energy: {
                score: Number(parsed.energy.score),
                diff_pct: Number(parsed.energy.diff_pct ?? 0),
                direction: String(parsed.energy.direction ?? 'softer'),
                reasoning: String(parsed.energy.reasoning ?? ''),
            },
            overall: {
                score: Number(parsed.overall.score),
                grade: String(parsed.overall.grade ?? 'C'),
                rule_applied: String(parsed.overall.rule_applied ?? 'average'),
                summary: String(parsed.overall.summary ?? ''),
            },
        };
    } finally {
        clearTimeout(timer);
    }
}

// ── Feedback Builder ──

function buildFeedbackS(
    tempoScore: number,
    energyScore: number,
    overallScore: number,
    grade: string,
    rule: string,
    direction: string,
    qualityWarnings: string[],
    llmUsed: boolean,
    llmError: string,
    tempoReasoning: string,
    energyReasoning: string,
    overallSummary: string,
    floorBlockedByTempoGate: boolean,
    segmentPenalty: number,
): string[] {
    const fb: string[] = [];
    fb.push(...qualityWarnings);

    if (llmUsed && overallSummary) {
        fb.push(overallSummary);
    }

    if (tempoReasoning) fb.push(`Tempo: ${tempoReasoning}`);
    if (energyReasoning) fb.push(`Energy: ${energyReasoning}`);

    // Deterministic feedback fallback
    if (!llmUsed) {
        if (tempoScore < 45) fb.push('Tempo lệch khá nhiều so với reference, cần bám nhịp ổn định hơn.');
        else if (tempoScore < 70) fb.push('Tempo ở mức trung bình, thử luyện theo beat để vào nhịp tốt hơn.');

        if (energyScore < 20) fb.push(`Năng lượng giọng quá ${direction === 'louder' ? 'mạnh' : 'yếu'}, cần điều chỉnh lực giọng.`);
        else if (energyScore < 65) fb.push(`Energy ${direction === 'louder' ? 'hơi mạnh' : 'hơi nhẹ'} so với mẫu, cần cân lại cường độ.`);
    }

    // Segment feedback (applies regardless of LLM/deterministic mode)
    if (segmentPenalty >= 8) fb.push('Số đoạn lời nói (nSegments) lệch nhiều so với mẫu — kiểm tra ngắt câu hoặc khoảng lặng.');
    else if (segmentPenalty > 3) fb.push('Số đoạn lời nói hơi lệch so với mẫu, thử điều chỉnh nhịp ngắt câu.');

    if (rule === 'energy_cap') fb.push('Rule energy_cap: năng lượng quá thấp đang giới hạn điểm tổng.');
    if (rule === 'energy_floor') fb.push('Rule energy_floor: energy tốt hơn tempo, điểm tổng được giữ sàn nhẹ.');
    if (rule === 'tempo_gate_cap') fb.push('Rule tempo_gate_cap: tempo quá thấp nên overall bị cap dưới 50 (dải 20–40 theo energy).');
    if (floorBlockedByTempoGate) fb.push('Tempo quá thấp nên energy_floor bị vô hiệu.');

    fb.push(`Grade: ${grade} (Overall: ${Math.round(overallScore)})`);

    if (llmUsed) fb.push('Scored via LLM vocal coach (Measure S rubric).');
    else fb.push('Scored via local formula fallback (Measure S rubric).');

    if (llmError) fb.push(`LLM note: ${llmError}`);

    return fb;
}

// ── Utilities ──

function resolveApiKey(explicit?: string): string {
    if (explicit?.trim()) return explicit.trim();
    const cfg = getRouter9RuntimeConfig();
    return cfg.apiKey;
}

function parseJsonObject(raw: string): any {
    const clean = raw.trim();
    try { return JSON.parse(clean); } catch { /* continue */ }

    const block = clean.match(/```json\s*([\s\S]*?)```/i) || clean.match(/```\s*([\s\S]*?)```/i);
    if (block?.[1]) {
        try { return JSON.parse(block[1].trim()); } catch { /* continue */ }
    }

    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first >= 0 && last > first) {
        try { return JSON.parse(clean.slice(first, last + 1)); } catch { return null; }
    }
    return null;
}

function normalizeRule(rule: unknown): 'energy_cap' | 'energy_floor' | 'tempo_gate_cap' | 'average' {
    if (rule === 'energy_cap' || rule === 'energy_floor' || rule === 'tempo_gate_cap' || rule === 'average') return rule;
    return 'average';
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp(t, 0, 1);
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
