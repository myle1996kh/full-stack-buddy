import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bug } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';

interface ProsodyDebugPanelProps {
  results: Array<{
    fileName: string;
    score: number;
    debug?: Record<string, any>;
  }>;
}

// Sections auto-hide when keys are not present — fingerprint and DTW sections coexist
const SECTIONS: { title: string; keys: string[]; labels: Record<string, string> }[] = [
  // ── Shared ──
  {
    title: '🎯 Final Score',
    keys: ['weightedAvg', 'rawWeightedAvg', 'rawScore', 'finalScore', 'applyQualityPenalty', 'coreMin', 'discriminationFactor', 'discFactor', 'qualityFactor'],
    labels: {
      weightedAvg: 'Weighted Avg (raw)',
      rawWeightedAvg: 'Weighted Avg (raw)',
      rawScore: 'Raw Score',
      finalScore: 'Final Score',
      applyQualityPenalty: 'Apply Quality Penalty (1=ON)',
      coreMin: 'Core Min',
      discriminationFactor: 'Discrimination Factor',
      discFactor: 'Discrimination Factor',
      qualityFactor: 'Quality Factor',
    },
  },
  {
    title: '🎤 Vocal Coach V2',
    keys: [
      'tempoScore', 'energyScore', 'overallScore', 'baseScore',
      'bpmDiffPct', 'energyDiffPct',
      'refTempoBpm', 'usrTempoBpm',
      'refEnergyProxy', 'usrEnergyProxy',
      'refVoicedRatio', 'usrVoicedRatio',
      'refSpeechRate', 'usrSpeechRate',
      'refRegularity', 'usrRegularity',
      'ruleCode', 'rule_energyCap', 'rule_energyFloor',
      'llmUsed', 'llmConfidence',
    ],
    labels: {
      tempoScore: 'Tempo Score',
      energyScore: 'Energy Score',
      overallScore: 'Overall Score (pre-quality)',
      baseScore: 'Base Score',
      bpmDiffPct: 'Tempo Diff %',
      energyDiffPct: 'Energy Diff %',
      refTempoBpm: 'Ref Tempo (BPM)',
      usrTempoBpm: 'Usr Tempo (BPM)',
      refEnergyProxy: 'Ref Energy Proxy',
      usrEnergyProxy: 'Usr Energy Proxy',
      refVoicedRatio: 'Ref Voiced Ratio',
      usrVoicedRatio: 'Usr Voiced Ratio',
      refSpeechRate: 'Ref Speech Rate',
      usrSpeechRate: 'Usr Speech Rate',
      refRegularity: 'Ref Regularity',
      usrRegularity: 'Usr Regularity',
      ruleCode: 'Rule Code (0 avg / 1 cap / 2 floor)',
      rule_energyCap: 'Rule energy_cap',
      rule_energyFloor: 'Rule energy_floor',
      llmUsed: 'LLM Used (1=yes)',
      llmConfidence: 'LLM Confidence',
    },
  },
  {
    title: '🏆 Vocal Coach S (Measure S)',
    keys: [
      'tempoScore', 'energyScore', 'overallScore', 'baseScore', 'grade',
      'bpmDiffPct', 'durationDiffPct', 'energyDiffPct', 'energyDirection',
      'refTempoBpm', 'usrTempoBpm', 'refAvgRms', 'usrAvgRms', 'refMaxRms', 'usrMaxRms',
      'refDuration', 'usrDuration', 'refNSegments', 'usrNSegments',
      'refMeasureSFeatures', 'usrMeasureSFeatures',
      'refMeasureSBeatConfidence', 'usrMeasureSBeatConfidence',
      'refMeasureSOnsetCount', 'usrMeasureSOnsetCount',
      'tempoGateEnabled', 'tempoGateThreshold', 'tempoGateCapMin', 'tempoGateCapMax', 'tempoGateCapApplied',
      'energyCapThreshold', 'energyCapMultiplier', 'energyFloorRatio', 'energyFloorMultiplier',
      'ruleCode', 'rule_energyCap', 'rule_energyFloor', 'rule_tempoGateCap', 'rule_floorBlockedByTempoGate', 'llmUsed'
    ],
    labels: {
      tempoScore: 'Tempo Score',
      energyScore: 'Energy Score',
      overallScore: 'Overall Score (pre-quality)',
      baseScore: 'Base Score',
      grade: 'Grade',
      bpmDiffPct: 'Tempo Diff %',
      durationDiffPct: 'Duration Diff %',
      energyDiffPct: 'Energy Diff %',
      energyDirection: 'Energy Direction (1=louder / 0=softer)',
      refTempoBpm: 'Ref Tempo (BPM)',
      usrTempoBpm: 'Usr Tempo (BPM)',
      refAvgRms: 'Ref Avg RMS',
      usrAvgRms: 'Usr Avg RMS',
      refMaxRms: 'Ref Max RMS',
      usrMaxRms: 'Usr Max RMS',
      refDuration: 'Ref Duration (s)',
      usrDuration: 'Usr Duration (s)',
      refNSegments: 'Ref Segment Count',
      usrNSegments: 'Usr Segment Count',
      refMeasureSFeatures: 'Ref Uses True Measure S Features',
      usrMeasureSFeatures: 'Usr Uses True Measure S Features',
      refMeasureSBeatConfidence: 'Ref Beat Confidence',
      usrMeasureSBeatConfidence: 'Usr Beat Confidence',
      refMeasureSOnsetCount: 'Ref Onset Count',
      usrMeasureSOnsetCount: 'Usr Onset Count',
      tempoGateEnabled: 'Tempo Gate Enabled',
      tempoGateThreshold: 'Tempo Gate Threshold',
      tempoGateCapMin: 'Tempo Gate Cap Min',
      tempoGateCapMax: 'Tempo Gate Cap Max',
      tempoGateCapApplied: 'Tempo Gate Cap Applied',
      energyCapThreshold: 'Energy Cap Threshold',
      energyCapMultiplier: 'Energy Cap Multiplier',
      energyFloorRatio: 'Energy Floor Ratio',
      energyFloorMultiplier: 'Energy Floor Multiplier',
      ruleCode: 'Rule Code (0 avg / 1 cap / 2 floor / 3 tempo_gate_cap)',
      rule_energyCap: 'Rule energy_cap',
      rule_energyFloor: 'Rule energy_floor',
      rule_tempoGateCap: 'Rule tempo_gate_cap',
      rule_floorBlockedByTempoGate: 'Rule floor blocked by tempo gate',
      llmUsed: 'LLM Used (1=yes)',
    },
  },
  // ── Style Fingerprint sections ──
  {
    title: '🎵 Melody Character',
    keys: ['pitchRangeSim', 'pitchVarSim', 'pitchDirSim', 'ref_pitchRange', 'usr_pitchRange', 'ref_pitchVar', 'usr_pitchVar'],
    labels: {
      pitchRangeSim: 'Pitch Range Sim (expressiveness)',
      pitchVarSim: 'Pitch Variability Sim',
      pitchDirSim: 'Pitch Direction Sim (up/down bias)',
      ref_pitchRange: 'Ref Pitch Range (semitones)',
      usr_pitchRange: 'Usr Pitch Range (semitones)',
      ref_pitchVar: 'Ref Pitch Variability',
      usr_pitchVar: 'Usr Pitch Variability',
    },
  },
  {
    title: '💥 Energy Character',
    keys: ['energyRangeSim', 'energyVarSim', 'energyPeakSim', 'ref_energyRange', 'usr_energyRange'],
    labels: {
      energyRangeSim: 'Energy Range Sim (punch)',
      energyVarSim: 'Energy Variability Sim',
      energyPeakSim: 'Energy Peak Ratio Sim',
      ref_energyRange: 'Ref Energy Range',
      usr_energyRange: 'Usr Energy Range',
    },
  },
  {
    title: '🥁 Rhythm Character',
    keys: ['speedSim', 'regularitySim', 'pauseRateSim', 'pauseDurSim', 'ref_speechRate', 'usr_speechRate', 'ref_pauseRate', 'usr_pauseRate'],
    labels: {
      speedSim: 'Speed Sim (pace)',
      regularitySim: 'Regularity Sim (groove)',
      pauseRateSim: 'Pause Rate Sim',
      pauseDurSim: 'Pause Duration Sim',
      ref_speechRate: 'Ref Speech Rate (syl/s)',
      usr_speechRate: 'Usr Speech Rate (syl/s)',
      ref_pauseRate: 'Ref Pause Rate (/s)',
      usr_pauseRate: 'Usr Pause Rate (/s)',
    },
  },
  {
    title: '🎙️ Voice Character',
    keys: ['brightSim', 'warmSim', 'voicedSim'],
    labels: {
      brightSim: 'Brightness Sim (centroid)',
      warmSim: 'Warmth Sim (rolloff)',
      voicedSim: 'Voiced Ratio Sim',
    },
  },
  {
    title: '⚖️ Weights (Fingerprint)',
    keys: ['w_melody', 'w_energy', 'w_rhythm', 'w_voice'],
    labels: {
      w_melody: 'Weight: Melody',
      w_energy: 'Weight: Energy',
      w_rhythm: 'Weight: Rhythm',
      w_voice: 'Weight: Voice',
    },
  },
  // ── Wav2Vec Hybrid sections ──
  {
    title: '🧠 Wav2Vec Hybrid',
    keys: ['embedSim', 'deliverySim', 'fingerSim', 'w_embedding', 'w_delivery', 'w_fingerprint', 'refEmbeddingSource', 'usrEmbeddingSource'],
    labels: {
      embedSim: 'Embedding Similarity',
      deliverySim: 'Delivery Similarity',
      fingerSim: 'Fingerprint Similarity',
      w_embedding: 'Weight: Embedding',
      w_delivery: 'Weight: Delivery',
      w_fingerprint: 'Weight: Fingerprint',
      refEmbeddingSource: 'Ref Uses Real Wav2Vec (1=yes)',
      usrEmbeddingSource: 'Usr Uses Real Wav2Vec (1=yes)',
    },
  },
  // ── Delivery Pattern sections ──
  {
    title: '📏 Elongation Pattern',
    keys: ['elongSim', 'ref_durationCV', 'usr_durationCV', 'ref_elongatedRatio', 'usr_elongatedRatio', 'ref_maxMedianRatio', 'usr_maxMedianRatio', 'durationProfileCorr'],
    labels: {
      elongSim: 'Elongation Similarity',
      ref_durationCV: 'Ref Duration CV',
      usr_durationCV: 'Usr Duration CV',
      ref_elongatedRatio: 'Ref Elongated Ratio',
      usr_elongatedRatio: 'Usr Elongated Ratio',
      ref_maxMedianRatio: 'Ref Max/Median Ratio',
      usr_maxMedianRatio: 'Usr Max/Median Ratio',
      durationProfileCorr: 'Duration Profile Corr.',
    },
  },
  {
    title: '💪 Emphasis Pattern',
    keys: ['emphSim', 'ref_energyCV', 'usr_energyCV', 'ref_emphasisRatio', 'usr_emphasisRatio', 'energyProfileCorr'],
    labels: {
      emphSim: 'Emphasis Similarity',
      ref_energyCV: 'Ref Energy CV',
      usr_energyCV: 'Usr Energy CV',
      ref_emphasisRatio: 'Ref Emphasis Ratio',
      usr_emphasisRatio: 'Usr Emphasis Ratio',
      energyProfileCorr: 'Energy Profile Corr.',
    },
  },
  {
    title: '🎭 Expressiveness Pattern',
    keys: ['exprSim', 'ref_expressiveRatio', 'usr_expressiveRatio', 'ref_avgPitchRange', 'usr_avgPitchRange', 'pitchRangeProfileCorr'],
    labels: {
      exprSim: 'Expressiveness Similarity',
      ref_expressiveRatio: 'Ref Expressive Ratio',
      usr_expressiveRatio: 'Usr Expressive Ratio',
      ref_avgPitchRange: 'Ref Avg Pitch Range (st)',
      usr_avgPitchRange: 'Usr Avg Pitch Range (st)',
      pitchRangeProfileCorr: 'Pitch Range Profile Corr.',
    },
  },
  {
    title: '🏃 Rhythm (Delivery)',
    keys: ['rhythmSim', 'ref_segments', 'usr_segments'],
    labels: {
      rhythmSim: 'Rhythm Similarity',
      ref_segments: 'Ref Segment Count',
      usr_segments: 'Usr Segment Count',
    },
  },
  {
    title: '⚖️ Weights (Delivery)',
    keys: ['w_elongation', 'w_emphasis', 'w_expressiveness', 'w_rhythm'],
    labels: {
      w_elongation: 'Weight: Elongation',
      w_emphasis: 'Weight: Emphasis',
      w_expressiveness: 'Weight: Expressiveness',
      w_rhythm: 'Weight: Rhythm',
    },
  },
  // ── DTW (Legacy) sections ──
  {
    title: '🎵 Intonation (DTW)',
    keys: ['pitch_dtw', 'pitch_pearson', 'pitch_contourSim', 'slope_dtw', 'slope_pearson', 'slope_contourSim'],
    labels: {
      pitch_dtw: 'Pitch DTW Similarity',
      pitch_pearson: 'Pitch Pearson Corr.',
      pitch_contourSim: 'Pitch Combined (√DTW×Pearson)',
      slope_dtw: 'Slope DTW Similarity',
      slope_pearson: 'Slope Pearson Corr.',
      slope_contourSim: 'Slope Combined (√DTW×Pearson)',
    },
  },
  {
    title: '⚡ Energy (DTW)',
    keys: ['energy_dtw', 'energy_pearson', 'energy_contourSim'],
    labels: {
      energy_dtw: 'Energy DTW Similarity',
      energy_pearson: 'Energy Pearson Corr.',
      energy_contourSim: 'Energy Combined (√DTW×Pearson)',
    },
  },
  {
    title: '🥁 Rhythm & Pause (DTW)',
    keys: ['ioiSim', 'pauseSim', 'ref_avgIOI', 'usr_avgIOI'],
    labels: {
      ioiSim: 'IOI Sim (quadratic)',
      pauseSim: 'Pause Alignment Sim',
      ref_avgIOI: 'Ref Avg IOI (ms)',
      usr_avgIOI: 'Usr Avg IOI (ms)',
    },
  },
  {
    title: '🎙️ Timbre (DTW)',
    keys: ['pitchRangeSim', 'energyDynSim', 'centroidSim', 'rolloffSim'],
    labels: {
      pitchRangeSim: 'Pitch Range Sim',
      energyDynSim: 'Energy Dynamics Sim',
      centroidSim: 'Spectral Centroid Sim',
      rolloffSim: 'Spectral Rolloff Sim',
    },
  },
  {
    title: '⚖️ Weights (DTW)',
    keys: ['w_intonation', 'w_rhythmPause', 'w_energy', 'w_timbre'],
    labels: {
      w_intonation: 'Weight: Intonation',
      w_rhythmPause: 'Weight: Rhythm & Pause',
      w_energy: 'Weight: Energy',
      w_timbre: 'Weight: Timbre',
    },
  },
];

function colorForValue(val: unknown, isRaw = false): string {
  if (isRaw || typeof val !== 'number' || !Number.isFinite(val)) return 'text-muted-foreground';
  if (val >= 0.8) return 'text-green-400';
  if (val >= 0.5) return 'text-yellow-400';
  if (val >= 0.3) return 'text-orange-400';
  return 'text-red-400';
}

function formatDebugValue(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) return val.toFixed(3);
  if (typeof val === 'string') return val;
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

const RAW_KEYS = new Set([
  'ref_speechRate', 'usr_speechRate', 'ref_avgIOI', 'usr_avgIOI', 'weightedAvg', 'rawWeightedAvg', 'rawScore', 'finalScore', 'applyQualityPenalty',
  'ref_pitchRange', 'usr_pitchRange', 'ref_pitchVar', 'usr_pitchVar',
  'ref_energyRange', 'usr_energyRange', 'ref_pauseRate', 'usr_pauseRate',
  'refEmbeddingSource', 'usrEmbeddingSource',
  // Coach V2 raw keys
  'tempoScore', 'energyScore', 'overallScore', 'baseScore',
  'bpmDiffPct', 'energyDiffPct',
  'refTempoBpm', 'usrTempoBpm',
  'refEnergyProxy', 'usrEnergyProxy',
  'refVoicedRatio', 'usrVoicedRatio',
  'refSpeechRate', 'usrSpeechRate',
  'refRegularity', 'usrRegularity',
  'ruleCode', 'rule_energyCap', 'rule_energyFloor',
  'llmUsed', 'llmConfidence',
  'grade', 'durationDiffPct', 'energyDirection',
  'refAvgRms', 'usrAvgRms', 'refMaxRms', 'usrMaxRms',
  'refDuration', 'usrDuration', 'refNSegments', 'usrNSegments',
  'refMeasureSFeatures', 'usrMeasureSFeatures',
  'refMeasureSBeatConfidence', 'usrMeasureSBeatConfidence',
  'refMeasureSOnsetCount', 'usrMeasureSOnsetCount',
  'tempoGateEnabled', 'tempoGateThreshold', 'tempoGateCapMin', 'tempoGateCapMax', 'tempoGateCapApplied',
  'energyCapThreshold', 'energyCapMultiplier', 'energyFloorRatio', 'energyFloorMultiplier', 'rule_tempoGateCap', 'rule_floorBlockedByTempoGate',
  // Delivery raw keys
  'ref_segments', 'usr_segments', 'ref_durationCV', 'usr_durationCV',
  'ref_maxMedianRatio', 'usr_maxMedianRatio', 'ref_energyCV', 'usr_energyCV',
  'ref_avgPitchRange', 'usr_avgPitchRange', 'ref_regularity', 'usr_regularity',
]);

export default function ProsodyDebugPanel({ results }: ProsodyDebugPanelProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const debugResults = results.filter(r => r.debug && Object.keys(r.debug).length > 0);
  if (debugResults.length === 0) return null;

  return (
    <Card className="glass border-dashed border-muted-foreground/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Bug className="w-4 h-4" />
          Prosody Debug Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {debugResults.map((r, rIdx) => (
          <Collapsible
            key={rIdx}
            open={openIdx === rIdx}
            onOpenChange={(open) => setOpenIdx(open ? rIdx : null)}
          >
            <CollapsibleTrigger className="w-full text-left">
              <div className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer">
                <span className="text-xs font-medium truncate max-w-[200px]">{r.fileName}</span>
                <Badge variant="outline" className="text-[10px] font-mono">{r.score}%</Badge>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-2 pl-1">
                {SECTIONS.map((section) => {
                  const entries = section.keys.filter(k => r.debug![k] !== undefined);
                  if (entries.length === 0) return null;
                  return (
                    <div key={section.title} className="space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground">{section.title}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 pl-2">
                        {entries.map((key) => {
                          const val = r.debug![key];
                          const isRaw = RAW_KEYS.has(key);
                          return (
                            <div key={key} className="flex items-center justify-between text-[10px]">
                              <span className="text-muted-foreground">{section.labels[key] || key}</span>
                              <span className={`font-mono font-semibold ${colorForValue(val, isRaw)}`}>
                                {formatDebugValue(val)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  );
}
