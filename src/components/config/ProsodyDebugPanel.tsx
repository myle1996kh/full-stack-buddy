import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bug } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';

interface ProsodyDebugPanelProps {
  results: Array<{
    fileName: string;
    score: number;
    debug?: Record<string, number>;
  }>;
}

const SECTIONS: { title: string; keys: string[]; labels: Record<string, string> }[] = [
  {
    title: '🎯 Final Score',
    keys: ['weightedAvg', 'coreMin', 'discriminationFactor', 'qualityFactor'],
    labels: {
      weightedAvg: 'Weighted Avg (raw)',
      coreMin: 'Core Min (lowest of inton/rhythm/energy)',
      discriminationFactor: 'Discrimination Factor',
      qualityFactor: 'Quality Factor',
    },
  },
  {
    title: '🎵 Intonation',
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
    title: '⚡ Energy',
    keys: ['energy_dtw', 'energy_pearson', 'energy_contourSim'],
    labels: {
      energy_dtw: 'Energy DTW Similarity',
      energy_pearson: 'Energy Pearson Corr.',
      energy_contourSim: 'Energy Combined (√DTW×Pearson)',
    },
  },
  {
    title: '🥁 Rhythm & Pause',
    keys: ['speechRateSim', 'regularitySim', 'ioiSim', 'pauseSim', 'ref_speechRate', 'usr_speechRate', 'ref_avgIOI', 'usr_avgIOI'],
    labels: {
      speechRateSim: 'Speech Rate Sim (quadratic)',
      regularitySim: 'Regularity Sim',
      ioiSim: 'IOI Sim (quadratic)',
      pauseSim: 'Pause Alignment Sim',
      ref_speechRate: 'Ref Speech Rate (syl/s)',
      usr_speechRate: 'Usr Speech Rate (syl/s)',
      ref_avgIOI: 'Ref Avg IOI (ms)',
      usr_avgIOI: 'Usr Avg IOI (ms)',
    },
  },
  {
    title: '🎙️ Timbre',
    keys: ['voicedSim', 'pitchRangeSim', 'energyDynSim'],
    labels: {
      voicedSim: 'Voiced Ratio Sim',
      pitchRangeSim: 'Pitch Range Sim',
      energyDynSim: 'Energy Dynamics Sim',
    },
  },
  {
    title: '⚖️ Weights',
    keys: ['w_intonation', 'w_rhythmPause', 'w_energy', 'w_timbre'],
    labels: {
      w_intonation: 'Weight: Intonation',
      w_rhythmPause: 'Weight: Rhythm & Pause',
      w_energy: 'Weight: Energy',
      w_timbre: 'Weight: Timbre',
    },
  },
];

function colorForValue(val: number, isRaw = false): string {
  // For similarity scores (0..1), color-code
  if (isRaw) return 'text-muted-foreground';
  if (val >= 0.8) return 'text-green-400';
  if (val >= 0.5) return 'text-yellow-400';
  if (val >= 0.3) return 'text-orange-400';
  return 'text-red-400';
}

const RAW_KEYS = new Set(['ref_speechRate', 'usr_speechRate', 'ref_avgIOI', 'usr_avgIOI', 'weightedAvg']);

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
                                {val.toFixed(3)}
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
