import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface EyesDebugPanelProps {
  results: Array<{
    fileName: string;
    score: number;
    breakdown: Record<string, number>;
    debug?: Record<string, number>;
  }>;
}

const metricLabel: Record<string, string> = {
  zoneMatch: 'Zone Match',
  sequence: 'Sequence',
  focus: 'Focus',
  stability: 'Stability',
  engagement: 'Engagement',
  focusRatio: 'Focus Ratio',
  scanPattern: 'Scan Pattern',
  awayTime: 'Away Time',
  transitions: 'Transitions',
  gazeContact: 'Gaze Contact',
  headPose: 'Head Pose',
  blinkRate: 'Blink Rate',
  expressiveness: 'Expressiveness',
};

function friendlyLabel(key: string): string {
  return metricLabel[key] ?? key;
}

function valueClass(v: number): string {
  if (v >= 80) return 'text-green-400';
  if (v >= 60) return 'text-yellow-400';
  if (v >= 40) return 'text-orange-400';
  return 'text-red-400';
}

export default function EyesDebugPanel({ results }: EyesDebugPanelProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const valid = results.filter((r) => Object.keys(r.breakdown || {}).length > 0);
  if (valid.length === 0) return null;

  return (
    <Card className="glass border-dashed border-mse-eyes/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Eye className="w-4 h-4" />
          Eyes Debug Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {valid.map((r, idx) => {
          const sorted = Object.entries(r.breakdown).sort(([, a], [, b]) => b - a);
          const weakest = sorted[sorted.length - 1];
          const strongest = sorted[0];

          return (
            <Collapsible
              key={`${r.fileName}-${idx}`}
              open={openIdx === idx}
              onOpenChange={(open) => setOpenIdx(open ? idx : null)}
            >
              <CollapsibleTrigger className="w-full text-left">
                <div className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer">
                  <span className="text-xs font-medium truncate max-w-[200px]">{r.fileName}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{r.score}%</Badge>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="mt-2 space-y-3 pl-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-md border border-border/60 p-2">
                      <p className="text-[10px] text-muted-foreground">Strongest</p>
                      <p className="text-xs font-medium">{friendlyLabel(strongest?.[0] ?? 'n/a')}</p>
                      <p className={`text-[11px] font-mono ${valueClass(strongest?.[1] ?? 0)}`}>
                        {(strongest?.[1] ?? 0).toFixed(1)}%
                      </p>
                    </div>
                    <div className="rounded-md border border-border/60 p-2">
                      <p className="text-[10px] text-muted-foreground">Weakest</p>
                      <p className="text-xs font-medium">{friendlyLabel(weakest?.[0] ?? 'n/a')}</p>
                      <p className={`text-[11px] font-mono ${valueClass(weakest?.[1] ?? 0)}`}>
                        {(weakest?.[1] ?? 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground">Breakdown</p>
                    {sorted.map(([key, value]) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-muted-foreground">{friendlyLabel(key)}</span>
                          <span className={`font-mono font-semibold ${valueClass(value)}`}>
                            {value.toFixed(1)}%
                          </span>
                        </div>
                        <Progress value={value} className="h-1.5" />
                      </div>
                    ))}
                  </div>

                  {r.debug && Object.keys(r.debug).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground">Raw Debug</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 pl-1">
                        {Object.entries(r.debug).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between text-[10px]">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono">{v.toFixed(3)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}
