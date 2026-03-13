import type {
  AdvancedElongationEvent,
  AdvancedPauseEvent,
  AdvancedPhraseChunk,
  AdvancedSoundAnalysis,
  BreakStrength,
  DeliveryStateLabel,
  PitchMovement,
  SoundPatternV2,
} from './types';

const SHORT_PAUSE_MIN = 0.15;
const MEDIUM_PAUSE_MIN = 0.3;
const LONG_PAUSE_MIN = 0.6;
const MINOR_BREAK_MIN = 0.22;
const MAJOR_BREAK_MIN = 0.45;
const ELONGATION_RATIO = 1.6;
const MIN_ELONGATION_SEC = 0.22;
const PITCH_MOVEMENT_THRESHOLD = 0.045;

export function extractAdvancedSoundAnalysis(pattern: SoundPatternV2): AdvancedSoundAnalysis {
  const pauses = normalizePauses(pattern.pausePattern ?? []);
  const phrasing = buildPhrasing(pattern.duration, pauses.events);
  const elongation = buildElongation(pattern, phrasing.chunks);
  const intonation = buildIntonation(pattern);
  const rhythm = buildRhythm(pattern, pauses.totalDurationSec);
  const summary = buildSummary(pauses, phrasing.chunkCount, elongation.events, intonation, rhythm);
  const llmPayload = buildLlmPayload(summary, pauses, phrasing, elongation, intonation, rhythm);

  return {
    version: 'adv-sound-v1',
    summary,
    pauses,
    phrasing,
    elongation: {
      count: elongation.events.length,
      events: elongation.events,
    },
    intonation,
    rhythm,
    llmPayload,
  };
}

function normalizePauses(input: Array<{ pos: number; dur: number }>): AdvancedSoundAnalysis['pauses'] {
  const events: AdvancedPauseEvent[] = input
    .filter((p) => Number.isFinite(p.pos) && Number.isFinite(p.dur) && p.dur >= SHORT_PAUSE_MIN)
    .map((p) => {
      const start = Math.max(0, p.pos - p.dur / 2);
      const end = Math.max(start, p.pos + p.dur / 2);
      return {
        start: round3(start),
        end: round3(end),
        dur: round3(end - start),
        kind: 'silent' as const,
      };
    });

  let short = 0;
  let medium = 0;
  let long = 0;
  let totalDurationSec = 0;
  let longestSec = 0;

  for (const event of events) {
    totalDurationSec += event.dur;
    longestSec = Math.max(longestSec, event.dur);
    if (event.dur >= LONG_PAUSE_MIN) long += 1;
    else if (event.dur >= MEDIUM_PAUSE_MIN) medium += 1;
    else short += 1;
  }

  return {
    total: events.length,
    short,
    medium,
    long,
    totalDurationSec: round3(totalDurationSec),
    longestSec: round3(longestSec),
    events,
  };
}

function buildPhrasing(duration: number, pauses: AdvancedPauseEvent[]): AdvancedSoundAnalysis['phrasing'] {
  const chunks: AdvancedPhraseChunk[] = [];
  let currentStart = 0;

  for (const pause of pauses) {
    const strength: BreakStrength | null = pause.dur >= MAJOR_BREAK_MIN
      ? 'major'
      : pause.dur >= MINOR_BREAK_MIN
        ? 'minor'
        : null;

    if (!strength) continue;

    const chunkEnd = Math.max(currentStart, pause.start);
    if (chunkEnd - currentStart >= 0.08) {
      chunks.push({
        start: round3(currentStart),
        end: round3(chunkEnd),
        breakStrength: strength,
      });
    }
    currentStart = pause.end;
  }

  if (duration - currentStart >= 0.08 || chunks.length === 0) {
    chunks.push({
      start: round3(currentStart),
      end: round3(Math.max(currentStart, duration)),
      breakStrength: chunks.length === 0 ? 'major' : 'minor',
    });
  }

  return {
    chunkCount: chunks.length,
    chunks,
  };
}

function buildElongation(pattern: SoundPatternV2, chunks: AdvancedPhraseChunk[]): { count: number; events: AdvancedElongationEvent[] } {
  const onsets = [...(pattern.onsetTimes ?? [])].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (onsets.length < 2) return { count: 0, events: [] };

  const intervals = diff(onsets).filter((v) => v > 0.06 && v < 2.5);
  if (intervals.length === 0) return { count: 0, events: [] };

  const med = median(intervals);
  const events: AdvancedElongationEvent[] = [];

  for (let i = 1; i < onsets.length; i++) {
    const dur = onsets[i] - onsets[i - 1];
    if (dur < MIN_ELONGATION_SEC || dur < med * ELONGATION_RATIO) continue;

    const start = onsets[i - 1];
    const end = onsets[i];
    const chunk = chunks.find((c) => start >= c.start - 0.05 && end <= c.end + 0.15);
    const nearChunkEnd = chunk ? (chunk.end - end) <= 0.18 : false;
    const pauseAfter = (pattern.pausePattern ?? []).some((p) => Math.abs((p.pos - p.dur / 2) - end) <= 0.12 || Math.abs(p.pos - end) <= 0.15);
    const emphasis = energyBoostNear(pattern.energyContourNorm, pattern.duration, start, end);

    const kind: AdvancedElongationEvent['kind'] = nearChunkEnd
      ? 'final_lengthening'
      : pauseAfter
        ? 'hesitation_lengthening'
        : emphasis
          ? 'emphasis_lengthening'
          : 'unknown';

    events.push({
      start: round3(start),
      end: round3(end),
      dur: round3(dur),
      expectedRatio: round3(dur / Math.max(med, 1e-6)),
      kind,
    });
  }

  return { count: events.length, events };
}

function buildIntonation(pattern: SoundPatternV2): AdvancedSoundAnalysis['intonation'] {
  const contour = voicedContour(pattern);
  const firstWindow = sliceWindow(contour, 0, 0.18);
  const lastWindow = sliceWindow(contour, 0.82, 1);
  const initialSlope = slope(firstWindow);
  const finalSlope = slope(lastWindow);
  const pitchRangeSt = round3(percentile(contour, 90) - percentile(contour, 10));
  const contourStability = round3(clamp01(1 - std(diff(contour)) / 0.35));

  return {
    initialSlope: round3(initialSlope),
    finalSlope: round3(finalSlope),
    initialMovement: pitchMovement(initialSlope),
    finalMovement: pitchMovement(finalSlope),
    pitchRangeSt,
    contourStability,
  };
}

function buildRhythm(pattern: SoundPatternV2, totalPauseDuration: number): AdvancedSoundAnalysis['rhythm'] {
  const duration = Math.max(pattern.duration, 1e-6);
  const onsets = [...(pattern.onsetTimes ?? [])].filter((t) => Number.isFinite(t));
  const onsetCount = onsets.length;
  const speechDuration = Math.max(duration - totalPauseDuration, 1e-6);
  const articulationRate = onsetCount > 0 ? onsetCount / speechDuration : 0;
  const iois = diff(onsets).filter((v) => v > 0);
  const tempoVariability = iois.length > 1 ? round3(std(iois) / Math.max(mean(iois), 1e-6)) : 0;

  return {
    speechRate: round3(onsetCount > 0 ? onsetCount / duration : pattern.speechRate),
    articulationRate: round3(articulationRate),
    avgIOI: round3(pattern.avgIOI),
    regularity: round3(pattern.regularity),
    tempoVariability,
  };
}

function buildSummary(
  pauses: AdvancedSoundAnalysis['pauses'],
  chunkCount: number,
  elongations: AdvancedElongationEvent[],
  intonation: AdvancedSoundAnalysis['intonation'],
  rhythm: AdvancedSoundAnalysis['rhythm'],
): AdvancedSoundAnalysis['summary'] {
  const pausePenalty = clamp01(pauses.total / 6) * 28 + clamp01(pauses.long / 3) * 18 + clamp01(pauses.totalDurationSec / 1.8) * 12;
  const elongationPenalty = clamp01(elongations.length / 4) * 16;
  const risePenalty = intonation.finalMovement === 'rise' ? 10 : 0;
  const irregularityPenalty = clamp01(1 - rhythm.regularity) * 22 + clamp01(rhythm.tempoVariability / 0.8) * 10;
  const flatPenalty = intonation.pitchRangeSt < 2.5 ? 8 : 0;
  const confidenceBoost = clamp01(rhythm.regularity) * 18 + clamp01(intonation.contourStability) * 14 + clamp01(Math.max(0, 1 - pauses.long / 2)) * 10;

  const hesitationScore = round0(clamp(18 + pausePenalty + elongationPenalty + risePenalty + irregularityPenalty * 0.5, 0, 100));
  const anxietyScore = round0(clamp(10 + clamp01(rhythm.speechRate / 5.5) * 18 + clamp01(rhythm.tempoVariability / 0.7) * 20 + clamp01(intonation.pitchRangeSt / 8) * 16 + (intonation.finalMovement === 'rise' ? 8 : 0), 0, 100));
  const fluencyScore = round0(clamp(100 - (pausePenalty * 0.65 + irregularityPenalty + elongationPenalty * 0.7 + flatPenalty), 0, 100));
  const confidenceScore = round0(clamp(42 + confidenceBoost + fluencyScore * 0.22 - hesitationScore * 0.32 - anxietyScore * 0.12 - flatPenalty, 0, 100));

  const labelScores: Record<DeliveryStateLabel, number> = {
    confident: clamp(confidenceScore * 1.1 + fluencyScore * 0.2 - hesitationScore * 0.35, 0, 100),
    neutral: clamp(65 - Math.abs(confidenceScore - 55) * 0.5 - Math.abs(hesitationScore - 40) * 0.3, 0, 100),
    hesitant: clamp(hesitationScore * 0.95 + pauses.long * 8 + elongations.length * 6 - confidenceScore * 0.25, 0, 100),
    unsure: clamp(hesitationScore * 0.7 + (intonation.finalMovement === 'rise' ? 12 : 0) + Math.max(0, 3 - chunkCount) * 5, 0, 100),
    anxious: clamp(anxietyScore * 0.95 + Math.max(0, rhythm.speechRate - 4.8) * 8 + Math.max(0, intonation.pitchRangeSt - 5) * 4, 0, 100),
  };

  const label = (Object.entries(labelScores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral') as DeliveryStateLabel;
  const total = Object.values(labelScores).reduce((sum, value) => sum + value, 0) || 1;
  const labelProbabilities = Object.fromEntries(
    Object.entries(labelScores).map(([key, value]) => [key, round3(value / total)])
  ) as Record<DeliveryStateLabel, number>;

  const evidence: string[] = [];
  if (pauses.long > 0) evidence.push(`${pauses.long} long pause(s)`);
  if (elongations.some((e) => e.kind === 'hesitation_lengthening')) evidence.push('elongation before/around pause');
  if (intonation.finalMovement === 'rise') evidence.push('unfinished/rising ending');
  if (rhythm.regularity >= 0.7) evidence.push('steady rhythm');
  if (intonation.contourStability >= 0.65) evidence.push('stable contour');
  if (intonation.pitchRangeSt < 2.5) evidence.push('flat pitch range');

  return {
    confidenceScore,
    hesitationScore,
    anxietyScore,
    fluencyScore,
    label,
    labelProbabilities,
    evidence,
  };
}

function buildLlmPayload(
  summary: AdvancedSoundAnalysis['summary'],
  pauses: AdvancedSoundAnalysis['pauses'],
  phrasing: AdvancedSoundAnalysis['phrasing'],
  elongation: AdvancedSoundAnalysis['elongation'],
  intonation: AdvancedSoundAnalysis['intonation'],
  rhythm: AdvancedSoundAnalysis['rhythm'],
): AdvancedSoundAnalysis['llmPayload'] {
  const compactSummary = {
    label: summary.label,
    confidenceScore: summary.confidenceScore,
    hesitationScore: summary.hesitationScore,
    fluencyScore: summary.fluencyScore,
    anxietyScore: summary.anxietyScore,
    pauseCount: pauses.total,
    longPauseCount: pauses.long,
    pauseTotalSec: pauses.totalDurationSec,
    chunkCount: phrasing.chunkCount,
    elongationCount: elongation.count,
    initialMovement: intonation.initialMovement,
    finalMovement: intonation.finalMovement,
    pitchRangeSt: intonation.pitchRangeSt,
    contourStability: intonation.contourStability,
    speechRate: rhythm.speechRate,
    articulationRate: rhythm.articulationRate,
    regularity: rhythm.regularity,
    tempoVariability: rhythm.tempoVariability,
    evidence: summary.evidence,
  };

  const eventSequence = [
    ...pauses.events.map((event) => ({ type: 'pause', t: round3((event.start + event.end) / 2), dur: event.dur, kind: event.kind })),
    ...phrasing.chunks.slice(0, -1).map((chunk) => ({ type: 'chunk_break', t: chunk.end, strength: chunk.breakStrength })),
    ...elongation.events.map((event) => ({ type: 'elongation', t: round3((event.start + event.end) / 2), dur: event.dur, kind: event.kind })),
    { type: 'initial_movement', t: 0, value: intonation.initialMovement },
    { type: 'final_movement', t: 'end', value: intonation.finalMovement },
  ].sort((a, b) => numericTime(a.t) - numericTime(b.t));

  return {
    compactSummary,
    eventSequence,
  };
}

function voicedContour(pattern: SoundPatternV2): number[] {
  const contour = pattern.pitchContourVoiced?.filter((v) => Number.isFinite(v)) ?? [];
  if (contour.length >= 12) return contour;
  const fallback = pattern.pitchContourNorm?.filter((v) => Number.isFinite(v)) ?? [];
  return fallback.length ? fallback : [0, 0];
}

function energyBoostNear(energyContour: number[], duration: number, start: number, end: number): boolean {
  if (!energyContour?.length) return false;
  const a = Math.max(0, Math.floor((start / Math.max(duration, 1e-6)) * (energyContour.length - 1)));
  const b = Math.max(a, Math.ceil((end / Math.max(duration, 1e-6)) * (energyContour.length - 1)));
  const local = energyContour.slice(a, b + 1);
  if (!local.length) return false;
  return mean(local) > mean(energyContour) + 0.25;
}

function sliceWindow(values: number[], fromRatio: number, toRatio: number): number[] {
  if (values.length === 0) return [0, 0];
  const start = Math.max(0, Math.floor(values.length * fromRatio));
  const end = Math.max(start + 2, Math.min(values.length, Math.ceil(values.length * toRatio)));
  return values.slice(start, end);
}

function slope(values: number[]): number {
  if (values.length < 2) return 0;
  const first = mean(values.slice(0, Math.max(1, Math.floor(values.length / 3))));
  const last = mean(values.slice(Math.max(0, Math.floor(values.length * 2 / 3))));
  return (last - first) / Math.max(values.length - 1, 1);
}

function pitchMovement(value: number): PitchMovement {
  if (value > PITCH_MOVEMENT_THRESHOLD) return 'rise';
  if (value < -PITCH_MOVEMENT_THRESHOLD) return 'fall';
  return 'flat';
}

function numericTime(value: number | string): number {
  return typeof value === 'number' ? value : Number.POSITIVE_INFINITY;
}

function diff(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(values[i] - values[i - 1]);
  return out;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round0(value: number): number {
  return Math.round(value);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
