import { useMemo, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  AreaChart,
} from 'recharts';
import type { AdvancedSoundAnalysis, SoundPatternV2 } from '@/engine/sound/types';

interface SoundResultItem {
  fileName: string;
  score: number;
  breakdown: Record<string, number>;
  debug?: Record<string, any>;
}

interface SoundVizPair {
  fileName: string;
  referencePattern: SoundPatternV2 | null;
  attemptPattern: SoundPatternV2 | null;
}

interface SoundVisualizationPanelProps {
  results: SoundResultItem[];
  pairs: SoundVizPair[];
}

function toFixed2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sampleAt(arr: number[], pos: number): number {
  if (!arr || arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];
  const clamped = Math.max(0, Math.min(arr.length - 1, pos));
  const lo = Math.floor(clamped);
  const hi = Math.min(lo + 1, arr.length - 1);
  const frac = clamped - lo;
  return arr[lo] * (1 - frac) + arr[hi] * frac;
}

function hasContent(arr?: number[]): boolean {
  return !!arr && arr.length > 0 && arr.some((v) => Math.abs(v) > 1e-6);
}

function percentile(arr: number[], p: number): number {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function smooth(arr: number[], window = 3): number[] {
  if (!arr || arr.length === 0) return [];
  const half = Math.floor(window / 2);
  return arr.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      count++;
    }
    return sum / Math.max(1, count);
  });
}

function deriveIntensityDbPair(refEnergy: number[], usrEnergy: number[]): { ref: number[]; usr: number[] } {
  const merged = [...(refEnergy ?? []), ...(usrEnergy ?? [])];
  if (merged.length === 0) return { ref: [], usr: [] };

  const p5 = percentile(merged, 5);
  const p95 = percentile(merged, 95);
  const span = Math.max(1e-6, p95 - p5);

  const toDb = (arr: number[]) => smooth(arr.map((v) => {
    const norm = (v - p5) / span;
    const clamped = Math.max(0, Math.min(1, norm));
    return 50 + clamped * 50; // Praat-like visual range 50..100 dB
  }), 5);

  return {
    ref: toDb(refEnergy ?? []),
    usr: toDb(usrEnergy ?? []),
  };
}

function contourData(
  refArr: number[],
  usrArr: number[],
  duration: number,
  targetLen = 180,
): Array<{ t: number; ref: number; usr: number }> {
  const len = Math.max(2, targetLen);
  const rows: Array<{ t: number; ref: number; usr: number }> = [];
  for (let i = 0; i < len; i++) {
    const pRef = (i / (len - 1)) * Math.max(0, refArr.length - 1);
    const pUsr = (i / (len - 1)) * Math.max(0, usrArr.length - 1);
    rows.push({
      t: toFixed2((i / (len - 1)) * duration),
      ref: sampleAt(refArr, pRef),
      usr: sampleAt(usrArr, pUsr),
    });
  }
  return rows;
}

function buildEventTracks(
  ref: SoundPatternV2,
  usr: SoundPatternV2,
  duration: number,
  len = 220,
): Array<{ t: number; refOnset: number; usrOnset: number; refPause: number; usrPause: number }> {
  const refOnset = new Array(len).fill(0);
  const usrOnset = new Array(len).fill(0);
  const refPause = new Array(len).fill(0);
  const usrPause = new Array(len).fill(0);

  const putPulse = (arr: number[], t: number, pulse = 1) => {
    const idx = Math.max(0, Math.min(len - 1, Math.round((t / duration) * (len - 1))));
    arr[idx] = pulse;
  };

  for (const t of ref.onsetTimes ?? []) putPulse(refOnset, t, 1);
  for (const t of usr.onsetTimes ?? []) putPulse(usrOnset, t, 1);

  for (const p of ref.pausePattern ?? []) {
    const start = Math.max(0, p.pos - p.dur / 2);
    const end = Math.min(duration, p.pos + p.dur / 2);
    const i0 = Math.max(0, Math.floor((start / duration) * (len - 1)));
    const i1 = Math.min(len - 1, Math.ceil((end / duration) * (len - 1)));
    for (let i = i0; i <= i1; i++) refPause[i] = 0.8;
  }

  for (const p of usr.pausePattern ?? []) {
    const start = Math.max(0, p.pos - p.dur / 2);
    const end = Math.min(duration, p.pos + p.dur / 2);
    const i0 = Math.max(0, Math.floor((start / duration) * (len - 1)));
    const i1 = Math.min(len - 1, Math.ceil((end / duration) * (len - 1)));
    for (let i = i0; i <= i1; i++) usrPause[i] = 0.8;
  }

  return Array.from({ length: len }, (_, i) => ({
    t: toFixed2((i / (len - 1)) * duration),
    refOnset: refOnset[i],
    usrOnset: usrOnset[i],
    refPause: refPause[i],
    usrPause: usrPause[i],
  }));
}

function computeIOIs(onsets: number[]): number[] {
  if (!onsets || onsets.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < onsets.length; i++) out.push(Math.max(0, onsets[i] - onsets[i - 1]));
  return out;
}

function buildOnsetFlowData(refOnsets: number[], usrOnsets: number[], duration: number, len = 220): Array<{ t: number; refCount: number; usrCount: number }> {
  const ref = [...(refOnsets ?? [])].sort((a, b) => a - b);
  const usr = [...(usrOnsets ?? [])].sort((a, b) => a - b);
  let iRef = 0;
  let iUsr = 0;
  let cRef = 0;
  let cUsr = 0;

  const rows: Array<{ t: number; refCount: number; usrCount: number }> = [];
  for (let i = 0; i < len; i++) {
    const t = (i / (len - 1)) * duration;
    while (iRef < ref.length && ref[iRef] <= t) { cRef++; iRef++; }
    while (iUsr < usr.length && usr[iUsr] <= t) { cUsr++; iUsr++; }
    rows.push({ t: toFixed2(t), refCount: cRef, usrCount: cUsr });
  }
  return rows;
}

function buildIOIComparisonData(refOnsets: number[], usrOnsets: number[]): Array<{ beat: string; refIOI: number | null; usrIOI: number | null; refTempo: number | null; usrTempo: number | null }> {
  const ref = computeIOIs(refOnsets);
  const usr = computeIOIs(usrOnsets);
  const len = Math.max(ref.length, usr.length, 1);
  return Array.from({ length: len }, (_, i) => {
    const r = ref[i] ?? null;
    const u = usr[i] ?? null;
    return {
      beat: `#${i + 1}`,
      refIOI: r !== null ? toFixed2(r * 1000) : null,
      usrIOI: u !== null ? toFixed2(u * 1000) : null,
      refTempo: r !== null && r > 0 ? toFixed2(60 / r) : null,
      usrTempo: u !== null && u > 0 ? toFixed2(60 / u) : null,
    };
  });
}

function buildPauseDurationData(
  refPauses: Array<{ dur: number }> = [],
  usrPauses: Array<{ dur: number }> = [],
): Array<{ pause: string; refPauseMs: number | null; usrPauseMs: number | null }> {
  const len = Math.max(refPauses.length, usrPauses.length, 1);
  return Array.from({ length: len }, (_, i) => ({
    pause: `P${i + 1}`,
    refPauseMs: refPauses[i] ? toFixed2(refPauses[i].dur * 1000) : null,
    usrPauseMs: usrPauses[i] ? toFixed2(usrPauses[i].dur * 1000) : null,
  }));
}

function buildAdvancedTimelineData(
  refAdvanced: AdvancedSoundAnalysis | undefined,
  usrAdvanced: AdvancedSoundAnalysis | undefined,
  duration: number,
  len = 240,
): Array<{ t: number; refPause: number; usrPause: number; refChunk: number; usrChunk: number; refElong: number; usrElong: number }> {
  const rows = Array.from({ length: len }, (_, i) => ({
    t: toFixed2((i / (len - 1)) * duration),
    refPause: 0,
    usrPause: 0,
    refChunk: 0,
    usrChunk: 0,
    refElong: 0,
    usrElong: 0,
  }));

  const fillSpan = (key: 'refPause' | 'usrPause' | 'refChunk' | 'usrChunk' | 'refElong' | 'usrElong', start: number, end: number, value: number) => {
    const safeDuration = Math.max(duration, 1e-6);
    const i0 = Math.max(0, Math.floor((start / safeDuration) * (len - 1)));
    const i1 = Math.min(len - 1, Math.ceil((end / safeDuration) * (len - 1)));
    for (let i = i0; i <= i1; i++) rows[i][key] = value;
  };

  for (const pause of refAdvanced?.pauses.events ?? []) fillSpan('refPause', pause.start, pause.end, 0.95);
  for (const pause of usrAdvanced?.pauses.events ?? []) fillSpan('usrPause', pause.start, pause.end, 0.75);
  for (const chunk of refAdvanced?.phrasing.chunks ?? []) fillSpan('refChunk', chunk.start, chunk.end, chunk.breakStrength === 'major' ? 0.55 : 0.35);
  for (const chunk of usrAdvanced?.phrasing.chunks ?? []) fillSpan('usrChunk', chunk.start, chunk.end, chunk.breakStrength === 'major' ? 0.45 : 0.25);
  for (const elong of refAdvanced?.elongation.events ?? []) fillSpan('refElong', elong.start, elong.end, 1);
  for (const elong of usrAdvanced?.elongation.events ?? []) fillSpan('usrElong', elong.start, elong.end, 0.85);

  return rows;
}

function labelTone(label: string): string {
  switch (label) {
    case 'confident': return 'bg-green-500/15 text-green-300 border-green-500/30';
    case 'hesitant': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'unsure': return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
    case 'anxious': return 'bg-red-500/15 text-red-300 border-red-500/30';
    default: return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
}

function comparerKind(breakdown: Record<string, number>, debug?: Record<string, number>): string {
  const keys = Object.keys(breakdown);
  const dbg = (debug ?? {}) as Record<string, any>;
  if (keys.includes('embedding')) return 'Wav2Vec Hybrid';
  if (dbg.refAvgRms !== undefined || dbg.usrAvgRms !== undefined || dbg.grade !== undefined) return 'Vocal Coach S';
  if (keys.includes('tempo') && keys.includes('energy')) return 'Vocal Coach V2';
  if (keys.includes('elongation')) return 'Delivery Pattern';
  if (keys.includes('intonation') && keys.includes('timbre')) return 'DTW/Fingerprint';
  return 'Sound Comparer';
}

function pct(n: number): string {
  return `${toFixed2(n)}%`;
}

function tempoSummary(debug: Record<string, any>): string {
  const ref = Number(debug.refTempoBpm ?? 0);
  const usr = Number(debug.usrTempoBpm ?? 0);
  const diff = Number(debug.bpmDiffPct ?? 0);
  const score = Number(debug.tempoScore ?? 0);
  return `Tempo: ${toFixed2(usr)} vs ${toFixed2(ref)} BPM → lệch ${pct(diff)} → ${Math.round(score)}/100`;
}

function energySummary(debug: Record<string, any>): string {
  const ref = Number(debug.refAvgRms ?? 0);
  const usr = Number(debug.usrAvgRms ?? 0);
  const diff = Number(debug.energyDiffPct ?? 0);
  const score = Number(debug.energyScore ?? 0);
  const direction = Number(debug.energyDirection ?? 0) === 1 ? 'louder' : 'softer';
  return `Energy: avg ${usr.toFixed(4)} vs ${ref.toFixed(4)} → ${direction} ${pct(diff)} → ${Math.round(score)}/100`;
}

function overallRule(debug: Record<string, any>): 'energy_cap' | 'energy_floor' | 'tempo_gate_cap' | 'average' {
  if (Number(debug.rule_energyCap ?? 0) === 1) return 'energy_cap';
  if (Number(debug.rule_energyFloor ?? 0) === 1) return 'energy_floor';
  if (Number(debug.rule_tempoGateCap ?? 0) === 1) return 'tempo_gate_cap';
  if (Number(debug.ruleCode ?? 0) === 3) return 'tempo_gate_cap';
  return 'average';
}

function scoreTone(score: number): { label: string; className: string } {
  if (score >= 85) return { label: '🟢 Strong', className: 'text-green-400' };
  if (score >= 70) return { label: '🟡 Mid', className: 'text-yellow-400' };
  return { label: '🔴 Weak', className: 'text-red-400' };
}

function detectNotes(debug: Record<string, any>): string[] {
  const notes: string[] = [];
  const beatConfidence = Number(debug.usrMeasureSBeatConfidence ?? 0);
  const onsetCount = Number(debug.usrMeasureSOnsetCount ?? 0);
  const refTempo = Number(debug.refTempoBpm ?? 0);
  const usrTempo = Number(debug.usrTempoBpm ?? 0);
  const energyDiff = Number(debug.energyDiffPct ?? 0);
  const refAvg = Number(debug.refAvgRms ?? 0);
  const usrAvg = Number(debug.usrAvgRms ?? 0);
  const refMax = Number(debug.refMaxRms ?? 0);
  const usrMax = Number(debug.usrMaxRms ?? 0);
  const tempoGateEnabled = Number(debug.tempoGateEnabled ?? 0) === 1;
  const tempoGateThreshold = Number(debug.tempoGateThreshold ?? 45);
  const tempoGateCapMin = Number(debug.tempoGateCapMin ?? 20);
  const tempoGateCapMax = Number(debug.tempoGateCapMax ?? 40);
  const floorBlocked = Number(debug.rule_floorBlockedByTempoGate ?? 0) === 1;
  const tempoGateCapRule = Number(debug.rule_tempoGateCap ?? 0) === 1 || Number(debug.ruleCode ?? 0) === 3;

  if (tempoGateEnabled) {
    notes.push(`Tempo gate đang bật: nếu tempo < ${toFixed2(tempoGateThreshold)} thì overall bị cap ${toFixed2(tempoGateCapMin)}–${toFixed2(tempoGateCapMax)} theo energy.`);
  }
  if (floorBlocked) {
    notes.push('Energy_floor bị chặn vì tempo quá thấp.');
  }
  if (tempoGateCapRule) {
    notes.push(`Rule tempo_gate_cap đang áp dụng (cap hiện tại ~${toFixed2(Number(debug.tempoGateCapApplied ?? 0))}).`);
  }
  if (beatConfidence > 0 && beatConfidence < 0.35) {
    notes.push(`Beat confidence thấp (${toFixed2(beatConfidence)}), tempo có thể chưa ổn định.`);
  }
  if (onsetCount > 0 && onsetCount <= 2) {
    notes.push(`Onset count ít (${onsetCount}), khả năng detect nhịp chưa đủ dữ liệu.`);
  }
  if (refTempo > 0 && usrTempo > 0) {
    const ratio = usrTempo / refTempo;
    if (Math.abs(ratio - 2) < 0.15 || Math.abs(ratio - 0.5) < 0.08) {
      notes.push('Tempo có dấu hiệu half/double-tempo; nên kiểm lại onset/beat detection.');
    }
  }
  if (energyDiff > 70 || (usrAvg > 0 && usrMax / usrAvg < 2 && usrAvg < refAvg * 0.35)) {
    notes.push('Energy rất thấp và khá flat; điểm energy sẽ bị kéo mạnh xuống.');
  }
  if (usrMax > 0 && refMax > 0 && usrMax / Math.max(usrAvg, 1e-6) >= refMax / Math.max(refAvg, 1e-6) * 0.85 && energyDiff < 20) {
    notes.push('Pattern max/avg gần reference; learner vẫn giữ được accent pattern khá tốt.');
  }
  return notes;
}

export default function SoundVisualizationPanel({ results, pairs }: SoundVisualizationPanelProps) {
  const validResults = results.filter((r) => Object.keys(r.breakdown || {}).length > 0);
  const [selectedFile, setSelectedFile] = useState<string>(validResults[0]?.fileName ?? pairs[0]?.fileName ?? '');

  const activeResult = useMemo(() => {
    return validResults.find((r) => r.fileName === selectedFile) ?? validResults[0];
  }, [validResults, selectedFile]);

  const activePair = useMemo(() => {
    const key = activeResult?.fileName ?? selectedFile;
    return pairs.find((p) => p.fileName === key) ?? pairs[0];
  }, [pairs, activeResult, selectedFile]);

  if (!activeResult || !activePair) return null;

  const ref = activePair.referencePattern;
  const usr = activePair.attemptPattern;
  const debug = (activeResult.debug ?? {}) as Record<string, any>;
  const isMeasureS = debug.refAvgRms !== undefined || debug.usrAvgRms !== undefined || debug.grade !== undefined;
  const overall = Number(debug.overallScore ?? activeResult.score ?? 0);
  const finalGrade = String(debug.grade ?? (overall >= 90 ? 'S' : overall >= 80 ? 'A' : overall >= 70 ? 'B' : overall >= 55 ? 'C' : overall >= 40 ? 'D' : 'F'));
  const measureSNotes = isMeasureS ? detectNotes(debug) : [];

  if (!ref || !usr) {
    return (
      <Card className="glass border-dashed border-mse-sound/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
            <Volume2 className="w-4 h-4" />
            Sound Feature Visualization (Praat-like)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Chưa có đủ pattern chi tiết để vẽ contour âm thanh cho file này. Hãy dùng reference/upload dạng V2 để xem line charts.
          </p>
        </CardContent>
      </Card>
    );
  }

  const duration = Math.max(ref.duration || 0, usr.duration || 0, 1);

  const refPitch = hasContent(ref.pitchContourVoiced) ? ref.pitchContourVoiced : ref.pitchContourNorm;
  const usrPitch = hasContent(usr.pitchContourVoiced) ? usr.pitchContourVoiced : usr.pitchContourNorm;

  const pitchData = contourData(refPitch, usrPitch, duration);
  const energyData = contourData(ref.energyContourNorm, usr.energyContourNorm, duration);
  const intensityPair = deriveIntensityDbPair(ref.energyContourNorm, usr.energyContourNorm);
  const intensityData = contourData(intensityPair.ref, intensityPair.usr, duration);
  const centroidData = contourData(ref.spectralCentroidContour ?? [], usr.spectralCentroidContour ?? [], duration);
  const rolloffData = contourData(ref.spectralRolloffContour ?? [], usr.spectralRolloffContour ?? [], duration);
  const rhythmTracks = buildEventTracks(ref, usr, duration);
  const onsetFlowData = buildOnsetFlowData(ref.onsetTimes ?? [], usr.onsetTimes ?? [], duration);
  const ioiData = buildIOIComparisonData(ref.onsetTimes ?? [], usr.onsetTimes ?? []);
  const pauseData = buildPauseDurationData(ref.pausePattern ?? [], usr.pausePattern ?? []);
  const refAdvanced = ref.advanced;
  const usrAdvanced = usr.advanced;
  const advancedTimelineData = buildAdvancedTimelineData(refAdvanced, usrAdvanced, duration);

  return (
    <Card className="glass border-dashed border-mse-sound/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Volume2 className="w-4 h-4" />
            Sound Feature Visualization (Praat-like)
          </span>
          <div className="inline-flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-normal">
              {comparerKind(activeResult.breakdown, activeResult.debug)}
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-mono">
              Score {activeResult.score}%
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="max-w-[320px]">
          <Select value={activeResult.fileName} onValueChange={setSelectedFile}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select result file" />
            </SelectTrigger>
            <SelectContent>
              {validResults.map((r) => (
                <SelectItem key={r.fileName} value={r.fileName} className="text-xs">
                  {r.fileName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isMeasureS && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-amber-200">🏆 Measure S Insight</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] font-mono">Grade {finalGrade}</Badge>
                <Badge variant="secondary" className="text-[10px] font-mono">Overall {Math.round(overall)}/100</Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
              <div className="rounded-md border border-border/60 bg-background/40 p-2">
                <p className="text-[10px] text-muted-foreground mb-1">Tempo</p>
                <p className={`text-xs font-medium ${scoreTone(Number(debug.tempoScore ?? 0)).className}`}>{tempoSummary(debug)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Duration: {toFixed2(Number(debug.usrDuration ?? 0))}s vs {toFixed2(Number(debug.refDuration ?? 0))}s
                  {' '}· diff {pct(Number(debug.durationDiffPct ?? 0))}
                </p>
              </div>

              <div className="rounded-md border border-border/60 bg-background/40 p-2">
                <p className="text-[10px] text-muted-foreground mb-1">Energy</p>
                <p className={`text-xs font-medium ${scoreTone(Number(debug.energyScore ?? 0)).className}`}>{energySummary(debug)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Max RMS: {Number(debug.usrMaxRms ?? 0).toFixed(4)} vs {Number(debug.refMaxRms ?? 0).toFixed(4)}
                  {' '}· segments {Math.round(Number(debug.usrNSegments ?? 0))} vs {Math.round(Number(debug.refNSegments ?? 0))}
                </p>
              </div>

              <div className="rounded-md border border-border/60 bg-background/40 p-2">
                <p className="text-[10px] text-muted-foreground mb-1">Overall Rule</p>
                <p className="text-xs font-medium text-foreground">
                  Base {toFixed2(Number(debug.baseScore ?? overall))} → {overallRule(debug)} → {Math.round(overall)}/100
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Quality factor {toFixed2(Number(debug.qualityFactor ?? 1))}
                  {' '}· LLM used {Math.round(Number(debug.llmUsed ?? 0)) === 1 ? 'yes' : 'no'}
                </p>
                {Number(debug.tempoGateEnabled ?? 0) === 1 && (
                  <p className="text-[10px] text-muted-foreground">
                    Tempo gate cap band: {toFixed2(Number(debug.tempoGateCapMin ?? 20))}–{toFixed2(Number(debug.tempoGateCapMax ?? 40))}
                    {Number(debug.rule_tempoGateCap ?? 0) === 1 && ` (applied ~${toFixed2(Number(debug.tempoGateCapApplied ?? 0))})`}
                  </p>
                )}
              </div>
            </div>

            {measureSNotes.length > 0 && (
              <div className="rounded-md border border-border/60 bg-background/30 p-2">
                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Diagnostics</p>
                <ul className="space-y-1">
                  {measureSNotes.map((note, idx) => (
                    <li key={idx} className="text-[11px] text-muted-foreground">• {note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-[10px] text-muted-foreground">Ref speechRate</p>
            <p className="text-xs font-mono">{toFixed2(ref.speechRate)} syl/s</p>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-[10px] text-muted-foreground">Usr speechRate</p>
            <p className="text-xs font-mono">{toFixed2(usr.speechRate)} syl/s</p>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-[10px] text-muted-foreground">Ref voicedRatio</p>
            <p className="text-xs font-mono">{toFixed2(ref.voicedRatio * 100)}%</p>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-[10px] text-muted-foreground">Usr voicedRatio</p>
            <p className="text-xs font-mono">{toFixed2(usr.voicedRatio * 100)}%</p>
          </div>
        </div>

        <Tabs defaultValue="pitch" className="w-full">
          <TabsList className="w-full grid grid-cols-6">
            <TabsTrigger value="pitch" className="text-xs">Pitch</TabsTrigger>
            <TabsTrigger value="energy" className="text-xs">Energy</TabsTrigger>
            <TabsTrigger value="intensity" className="text-xs">Intensity dB</TabsTrigger>
            <TabsTrigger value="timbre" className="text-xs">Timbre</TabsTrigger>
            <TabsTrigger value="rhythm" className="text-xs">Rhythm</TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="pitch">
            <div className="rounded-md border border-border/60 p-2">
              <p className="text-[11px] font-semibold text-muted-foreground mb-2">Pitch Contour (voiced)</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={pitchData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip formatter={(v: number) => toFixed2(v)} labelFormatter={(v) => `t=${v}s`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="ref" name="Reference" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="usr" name="Attempt" stroke="hsl(var(--mse-sound))" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          <TabsContent value="energy">
            <div className="rounded-md border border-border/60 p-2">
              <p className="text-[11px] font-semibold text-muted-foreground mb-2">Energy Contour (normalized)</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={energyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip formatter={(v: number) => toFixed2(v)} labelFormatter={(v) => `t=${v}s`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="ref" name="Reference" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="usr" name="Attempt" stroke="hsl(var(--mse-sound))" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          <TabsContent value="intensity">
            <div className="rounded-md border border-border/60 p-2">
              <p className="text-[11px] font-semibold text-muted-foreground mb-2">Derived Intensity (50–100 dB)</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={intensityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis domain={[50, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip formatter={(v: number) => `${toFixed2(v)} dB`} labelFormatter={(v) => `t=${v}s`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="ref" name="Reference Intensity" stroke="#22c55e" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="usr" name="Attempt Intensity" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-muted-foreground mt-2">
                Derived intensity được map từ energy contour chuẩn hóa sang dải hiển thị 50–100 dB (kiểu Praat-like) để so tương quan lực giọng theo thời gian.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="timbre">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-[11px] font-semibold text-muted-foreground mb-2">Spectral Centroid</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={centroidData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip formatter={(v: number) => toFixed2(v)} labelFormatter={(v) => `t=${v}s`} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="ref" name="Reference" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="usr" name="Attempt" stroke="hsl(var(--mse-sound))" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-md border border-border/60 p-2">
                <p className="text-[11px] font-semibold text-muted-foreground mb-2">Spectral Rolloff</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={rolloffData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip formatter={(v: number) => toFixed2(v)} labelFormatter={(v) => `t=${v}s`} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="ref" name="Reference" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="usr" name="Attempt" stroke="hsl(var(--mse-sound))" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="rhythm" className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-[10px] text-muted-foreground">Ref avg IOI</p>
                <p className="text-xs font-mono">{toFixed2(ref.avgIOI)} ms</p>
              </div>
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-[10px] text-muted-foreground">Usr avg IOI</p>
                <p className="text-xs font-mono">{toFixed2(usr.avgIOI)} ms</p>
              </div>
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-[10px] text-muted-foreground">Ref regularity</p>
                <p className="text-xs font-mono">{toFixed2(ref.regularity * 100)}%</p>
              </div>
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-[10px] text-muted-foreground">Usr regularity</p>
                <p className="text-xs font-mono">{toFixed2(usr.regularity * 100)}%</p>
              </div>
            </div>

            <Tabs defaultValue="flow" className="w-full">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="flow" className="text-xs">Beat Flow</TabsTrigger>
                <TabsTrigger value="ioi" className="text-xs">IOI / Tempo</TabsTrigger>
                <TabsTrigger value="pause" className="text-xs">Pause Duration</TabsTrigger>
              </TabsList>

              <TabsContent value="flow">
                <div className="rounded-md border border-border/60 p-2">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">Cumulative Onset Flow (Nhịp tiến trình)</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={onsetFlowData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                      <Tooltip formatter={(v: number) => `${v} onsets`} labelFormatter={(v) => `t=${v}s`} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="refCount" name="Reference Beat Count" stroke="#22c55e" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="usrCount" name="Attempt Beat Count" stroke="#3b82f6" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Hai đường càng bám sát nhau thì pacing theo thời gian càng giống (kiểu nhìn “chuyển về nhịp”).
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="ioi">
                <div className="rounded-md border border-border/60 p-2 space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">IOI theo từng beat (ms)</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={ioiData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="beat" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip formatter={(v: number | null) => v == null ? '-' : `${toFixed2(v)} ms`} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="refIOI" name="Ref IOI" stroke="#22c55e" dot={false} strokeWidth={2} connectNulls />
                      <Line type="monotone" dataKey="usrIOI" name="Usr IOI" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>

                  <p className="text-[11px] font-semibold text-muted-foreground">Tempo theo beat (BPM)</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={ioiData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="beat" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip formatter={(v: number | null) => v == null ? '-' : `${toFixed2(v)} BPM`} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="refTempo" name="Ref Tempo" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
                      <Line type="monotone" dataKey="usrTempo" name="Usr Tempo" stroke="#ef4444" dot={false} strokeWidth={2} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>

              <TabsContent value="pause">
                <div className="rounded-md border border-border/60 p-2 space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">Pause Duration theo thứ tự (ms)</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={pauseData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="pause" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip formatter={(v: number | null) => v == null ? '-' : `${toFixed2(v)} ms`} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="refPauseMs" name="Ref Pause" fill="#f59e0b" />
                      <Bar dataKey="usrPauseMs" name="Usr Pause" fill="#ef4444" />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-muted-foreground">
                    Dễ nhìn chỗ nào learner nghỉ quá dài/quá ngắn so với mẫu (đặc biệt hữu ích cho delivery rhythm).
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <details className="rounded-md border border-border/60 p-2">
              <summary className="text-[11px] cursor-pointer text-muted-foreground">Raw Onset/Pause Track (legacy view)</summary>
              <div className="mt-2">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={rhythmTracks}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip formatter={(v: number) => toFixed2(v)} labelFormatter={(v) => `t=${v}s`} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="stepAfter" dataKey="refOnset" name="Ref Onset" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                    <Line type="stepAfter" dataKey="usrOnset" name="Usr Onset" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
                    <Line type="stepAfter" dataKey="refPause" name="Ref Pause" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
                    <Line type="stepAfter" dataKey="usrPause" name="Usr Pause" stroke="#ef4444" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </details>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-3">
            {refAdvanced && usrAdvanced ? (
              <>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {[{ title: 'Reference', data: refAdvanced }, { title: 'Attempt', data: usrAdvanced }].map(({ title, data }) => (
                    <div key={title} className="rounded-md border border-border/60 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{title}</p>
                        <Badge variant="outline" className={`capitalize ${labelTone(data.summary.label)}`}>
                          {data.summary.label}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Confidence</p>
                          <p className="text-xs font-mono">{data.summary.confidenceScore}</p>
                        </div>
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Hesitation</p>
                          <p className="text-xs font-mono">{data.summary.hesitationScore}</p>
                        </div>
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Fluency</p>
                          <p className="text-xs font-mono">{data.summary.fluencyScore}</p>
                        </div>
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Anxiety</p>
                          <p className="text-xs font-mono">{data.summary.anxietyScore}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Pause count</p>
                          <p className="text-xs font-mono">{data.pauses.total}</p>
                        </div>
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Chunks</p>
                          <p className="text-xs font-mono">{data.phrasing.chunkCount}</p>
                        </div>
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Elongations</p>
                          <p className="text-xs font-mono">{data.elongation.count}</p>
                        </div>
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Initial</p>
                          <p className="text-xs font-mono capitalize">{data.intonation.initialMovement}</p>
                        </div>
                        <div className="rounded-md bg-background/40 border border-border/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Final</p>
                          <p className="text-xs font-mono capitalize">{data.intonation.finalMovement}</p>
                        </div>
                      </div>

                      {data.summary.evidence.length > 0 && (
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Evidence</p>
                          <div className="flex flex-wrap gap-1">
                            {data.summary.evidence.map((item) => (
                              <Badge key={item} variant="secondary" className="text-[10px] font-normal">{item}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-md border border-border/60 p-2">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">Advanced Timeline Overlay</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={advancedTimelineData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis domain={[0, 1.1]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip formatter={(v: number) => toFixed2(v)} labelFormatter={(v) => `t=${v}s`} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area type="stepAfter" dataKey="refPause" name="Ref Pause" fill="#f59e0b" stroke="#f59e0b" fillOpacity={0.25} />
                      <Area type="stepAfter" dataKey="usrPause" name="Usr Pause" fill="#ef4444" stroke="#ef4444" fillOpacity={0.2} />
                      <Area type="stepAfter" dataKey="refChunk" name="Ref Chunk" fill="#22c55e" stroke="#22c55e" fillOpacity={0.12} />
                      <Area type="stepAfter" dataKey="usrChunk" name="Usr Chunk" fill="#3b82f6" stroke="#3b82f6" fillOpacity={0.12} />
                      <Line type="stepAfter" dataKey="refElong" name="Ref Elong" stroke="#a855f7" dot={false} strokeWidth={2} />
                      <Line type="stepAfter" dataKey="usrElong" name="Usr Elong" stroke="#ec4899" dot={false} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Pause = block nghỉ, Chunk = nhịp/cụm câu, Elong = vùng kéo dài. Đây là view trực tiếp để đọc ngắt nhịp và delivery pattern.
                  </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {[{ title: 'Reference payload', data: refAdvanced.llmPayload }, { title: 'Attempt payload', data: usrAdvanced.llmPayload }].map(({ title, data }) => (
                    <div key={title} className="rounded-md border border-border/60 p-2">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-2">{title}</p>
                      <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-words overflow-auto max-h-[280px] rounded bg-background/50 p-2">{JSON.stringify(data, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
                Advanced sound analysis chưa sẵn sàng cho result này.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
