import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type DeliveryLabel = "confident" | "neutral" | "hesitant" | "unsure" | "anxious";
type PitchMovement = "rise" | "fall" | "flat";

interface CompactSummary {
  label?: DeliveryLabel;
  confidenceScore?: number;
  hesitationScore?: number;
  fluencyScore?: number;
  anxietyScore?: number;
  pauseCount?: number;
  longPauseCount?: number;
  pauseTotalSec?: number;
  chunkCount?: number;
  elongationCount?: number;
  initialMovement?: PitchMovement;
  finalMovement?: PitchMovement;
  pitchRangeSt?: number;
  contourStability?: number;
  speechRate?: number;
  articulationRate?: number;
  regularity?: number;
  tempoVariability?: number;
  evidence?: string[];
}

interface AdvancedPayload {
  file?: string;
  summary?: CompactSummary;
  prosody?: CompactSummary;
  events?: Array<Record<string, unknown>>;
  compactSummary?: CompactSummary;
  eventSequence?: Array<Record<string, unknown>>;
}

interface RequestBody {
  reference: AdvancedPayload;
  candidate: AdvancedPayload;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;
    if (!body?.reference || !body?.candidate) {
      return json({ error: "reference and candidate are required" }, 400);
    }

    const ref = normalizePayload(body.reference);
    const cand = normalizePayload(body.candidate);

    const metrics = {
      delivery: compareLabels(ref, cand),
      pauses: comparePauses(ref, cand),
      phrasing: comparePhrasing(ref, cand),
      intonation: compareIntonation(ref, cand),
      rhythm: compareRhythm(ref, cand),
    };

    const overall = round0(
      metrics.delivery.score * 0.28 +
      metrics.pauses.score * 0.20 +
      metrics.phrasing.score * 0.16 +
      metrics.intonation.score * 0.18 +
      metrics.rhythm.score * 0.18
    );

    const grade = overall >= 90 ? "S" : overall >= 80 ? "A" : overall >= 70 ? "B" : overall >= 55 ? "C" : overall >= 40 ? "D" : "F";

    const feedback = buildFeedback(ref, cand, metrics, overall);

    return json({
      score: overall,
      grade,
      breakdown: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value.score])),
      metrics,
      feedback,
      summary: {
        referenceLabel: ref.label,
        candidateLabel: cand.label,
        alignment: overall >= 80 ? "strong" : overall >= 60 ? "partial" : "weak",
      },
    });
  } catch (error) {
    console.error("sound-advanced-score error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function normalizePayload(payload: AdvancedPayload) {
  const src = payload.compactSummary ?? payload.summary ?? payload.prosody ?? {};
  return {
    label: (src.label ?? "neutral") as DeliveryLabel,
    confidenceScore: num(src.confidenceScore),
    hesitationScore: num(src.hesitationScore),
    fluencyScore: num(src.fluencyScore),
    anxietyScore: num(src.anxietyScore),
    pauseCount: num(src.pauseCount),
    longPauseCount: num(src.longPauseCount),
    pauseTotalSec: num(src.pauseTotalSec),
    chunkCount: num(src.chunkCount),
    elongationCount: num(src.elongationCount),
    initialMovement: (src.initialMovement ?? "flat") as PitchMovement,
    finalMovement: (src.finalMovement ?? "flat") as PitchMovement,
    pitchRangeSt: num(src.pitchRangeSt),
    contourStability: num(src.contourStability),
    speechRate: num(src.speechRate),
    articulationRate: num(src.articulationRate),
    regularity: num(src.regularity),
    tempoVariability: num(src.tempoVariability),
    evidence: Array.isArray(src.evidence) ? src.evidence.map(String) : [],
  };
}

function compareLabels(ref: ReturnType<typeof normalizePayload>, cand: ReturnType<typeof normalizePayload>) {
  const exact = ref.label === cand.label ? 100 : 55;
  const confidenceGap = Math.abs(cand.confidenceScore - ref.confidenceScore);
  const hesitationGap = Math.abs(cand.hesitationScore - ref.hesitationScore);
  const fluencyGap = Math.abs(cand.fluencyScore - ref.fluencyScore);
  const anxietyGap = Math.abs(cand.anxietyScore - ref.anxietyScore);
  const score = clamp(exact - confidenceGap * 0.25 - hesitationGap * 0.15 - fluencyGap * 0.15 - anxietyGap * 0.12, 0, 100);
  return {
    score: round0(score),
    reference: ref.label,
    candidate: cand.label,
    delta: {
      confidence: round1(cand.confidenceScore - ref.confidenceScore),
      hesitation: round1(cand.hesitationScore - ref.hesitationScore),
      fluency: round1(cand.fluencyScore - ref.fluencyScore),
      anxiety: round1(cand.anxietyScore - ref.anxietyScore),
    },
  };
}

function comparePauses(ref: ReturnType<typeof normalizePayload>, cand: ReturnType<typeof normalizePayload>) {
  const countGap = Math.abs(cand.pauseCount - ref.pauseCount);
  const longGap = Math.abs(cand.longPauseCount - ref.longPauseCount);
  const durGap = Math.abs(cand.pauseTotalSec - ref.pauseTotalSec);
  const score = clamp(100 - countGap * 12 - longGap * 16 - durGap * 28, 0, 100);
  return {
    score: round0(score),
    reference: { count: ref.pauseCount, long: ref.longPauseCount, totalSec: round2(ref.pauseTotalSec) },
    candidate: { count: cand.pauseCount, long: cand.longPauseCount, totalSec: round2(cand.pauseTotalSec) },
  };
}

function comparePhrasing(ref: ReturnType<typeof normalizePayload>, cand: ReturnType<typeof normalizePayload>) {
  const chunkGap = Math.abs(cand.chunkCount - ref.chunkCount);
  const elongGap = Math.abs(cand.elongationCount - ref.elongationCount);
  const score = clamp(100 - chunkGap * 18 - elongGap * 14, 0, 100);
  return {
    score: round0(score),
    reference: { chunkCount: ref.chunkCount, elongationCount: ref.elongationCount },
    candidate: { chunkCount: cand.chunkCount, elongationCount: cand.elongationCount },
  };
}

function compareIntonation(ref: ReturnType<typeof normalizePayload>, cand: ReturnType<typeof normalizePayload>) {
  const initMatch = ref.initialMovement === cand.initialMovement ? 1 : 0;
  const finalMatch = ref.finalMovement === cand.finalMovement ? 1 : 0;
  const rangeGap = Math.abs(cand.pitchRangeSt - ref.pitchRangeSt);
  const stabilityGap = Math.abs(cand.contourStability - ref.contourStability);
  const score = clamp(initMatch * 22 + finalMatch * 30 + 48 - rangeGap * 6 - stabilityGap * 40, 0, 100);
  return {
    score: round0(score),
    reference: { initial: ref.initialMovement, final: ref.finalMovement, pitchRangeSt: round2(ref.pitchRangeSt) },
    candidate: { initial: cand.initialMovement, final: cand.finalMovement, pitchRangeSt: round2(cand.pitchRangeSt) },
  };
}

function compareRhythm(ref: ReturnType<typeof normalizePayload>, cand: ReturnType<typeof normalizePayload>) {
  const speechGap = Math.abs(cand.speechRate - ref.speechRate);
  const articulationGap = Math.abs(cand.articulationRate - ref.articulationRate);
  const regularityGap = Math.abs(cand.regularity - ref.regularity);
  const variabilityGap = Math.abs(cand.tempoVariability - ref.tempoVariability);
  const score = clamp(100 - speechGap * 12 - articulationGap * 10 - regularityGap * 60 - variabilityGap * 55, 0, 100);
  return {
    score: round0(score),
    reference: {
      speechRate: round2(ref.speechRate),
      articulationRate: round2(ref.articulationRate),
      regularity: round2(ref.regularity),
      tempoVariability: round2(ref.tempoVariability),
    },
    candidate: {
      speechRate: round2(cand.speechRate),
      articulationRate: round2(cand.articulationRate),
      regularity: round2(cand.regularity),
      tempoVariability: round2(cand.tempoVariability),
    },
  };
}

function buildFeedback(
  ref: ReturnType<typeof normalizePayload>,
  cand: ReturnType<typeof normalizePayload>,
  metrics: Record<string, { score: number }>,
  overall: number,
) {
  const lines: string[] = [];
  if (metrics.delivery.score >= 80) lines.push(`Delivery state matches well (${cand.label}).`);
  else lines.push(`Delivery state diverges: reference is ${ref.label}, candidate sounds more ${cand.label}.`);

  if (metrics.pauses.score < 70) {
    if (cand.pauseCount > ref.pauseCount) lines.push("Candidate has more pauses / hesitation gaps than the reference.");
    else lines.push("Candidate is pausing less than the reference; chunk boundaries may be compressed.");
  }

  if (metrics.intonation.score < 70) {
    lines.push(`Ending movement differs (${ref.finalMovement} → ${cand.finalMovement}); sentence completion feeling may change.`);
  }

  if (metrics.rhythm.score < 70) {
    lines.push("Rhythm pacing differs in rate or regularity from the reference.");
  }

  if (overall >= 85) lines.push("Advanced sound delivery is strongly aligned with the reference.");
  else if (overall >= 70) lines.push("Advanced sound delivery is reasonably aligned but still needs polishing.");
  else lines.push("Advanced sound delivery differs noticeably from the reference.");

  return lines;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round0(value: number) {
  return Math.round(value);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
