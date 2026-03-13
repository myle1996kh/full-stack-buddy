import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Label } from '@/components/ui/label'
import { SrcBook, Activity, Volume2, Eye, Zap, Mic, Loader2 } from 'lucide-react'
import type { AdvancedSoundAnalysis } from '@/engine/sound/types'

interface AdvancedSoundPanelProps {
  analysis: AdvancedSoundAnalysis
  title?: string
}

export default function AdvancedSoundPanel({ analysis, title = 'Advanced Sound Analysis' }: AdvancedSoundPanelProps) {
  const { summary, pauses, phrasing, elongation, intonation, rhythm } = analysis

  return (
    <Card className="glass">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <SrcBook className="w-4 h-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Summary Scores */}
        <div className="space-y-2">
          <Label className="text-xs">Summary Scores</Label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <Badge variant="destructive">Hesitation: {summary.hesitationScore}</Badge>
            </div>
            <div>
              <Badge variant="secondary">Anxiety: {summary.anxietyScore}</Badge>
            </div>
            <div>
              <Badge variant="default">Confidence: {summary.confidenceScore}</Badge>
            </div>
            <div>
              <Badge variant="success">Fluency: {summary.fluencyScore}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Activity className="w-3 h-3" />
            <span>Label: <span className="font-mono">{summary.label}</span></span>
          </div>
          {summary.evidence.length > 0 && (
            <div className="mt-1">
              <Label className="text-xs">Evidence:</Label>
              <p className="text-[10px] text-muted-foreground">{summary.evidence.join(', ')}</p>
            </div>
          )}
        </div>

        {/* Pauses */}
        <div className="border-t pt-3">
          <Label className="text-xs">Pause Analysis</Label>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
            <div>Total: {pauses.total}</div>
            <div>Short: {pauses.short}</div>
            <div>Long: {pauses.long}</div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Volume2 className="w-3 h-3" />
            <span>Total Duration: {pauses.totalDurationSec}s</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Mic className="w-3 h-3" />
            <span>Longest Pause: {pauses.longestSec}s</span>
          </div>
          {pauses.events.length > 0 && (
            <div className="mt-2">
              <Label className="text-xs">Pause Events (start–end, kind):</Label>
              <div className="space-y-1 text-[10px] font-mono">
                {pauses.events.map((e, i) => (
                  <div key={i}>
                    [{e.start.toFixed(2)}–{e.end.toFixed(2)}s] {e.kind}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Phrasing */}
        <div className="border-t pt-3">
          <Label className="text-xs">Phrasing</Label>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Volume2 className="w-3 h-3" />
            <span>Chunk Count: {phrasing.chunkCount}</span>
          </div>
          {phrasing.chunks.length > 0 && (
            <div className="mt-2">
              <Label className="text-xs">Chunks (break strength):</Label>
              <div className="space-y-1 text-[10px] font-mono">
                {phrasing.chunks.map((c, i) => (
                  <div key={i}>
                    [{c.start.toFixed(2)}–{c.end.toFixed(2)}s] {c.breakStrength ?? 'none'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Elongation */}
        <div className="border-t pt-3">
          <Label className="text-xs">Elongation</Label>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Activity className="w-3 h-3" />
            <span>Count: {elongation.count}</span>
          </div>
          {elongation.events.length > 0 && (
            <div className="mt-2">
              <Label className="text-xs">Elongation Events:</Label>
              <div className="space-y-1 text-[10px] font-mono">
                {elongation.events.map((ev, i) => (
                  <div key={i}>
                    [{ev.start.toFixed(2)}–{ev.end.toFixed(2)}s] {ev.kind} (×{ev.expectedRatio.toFixed(2)} expected)
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Intonation */}
        <div className="border-t pt-3">
          <Label className="text-xs">Intonation</Label>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <div>
              <Zap className="w-3 h-3" />
              <span>Initial Slope: {intonation.initialSlope}</span>
            </div>
            <div>
              <Zap className="w-3 h-3" />
              <span>Final Slope: {intonation.finalSlope}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Eye className="w-3 h-3" />
            <span>Pitch Range ST: {intonation.pitchRangeSt} semitones</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Activity className="w-3 h-3" />
            <span>Contour Stability: {intonation.contourStability}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Mic className="w-3 h-3" />
            <span>Initial Movement: {intonation.initialMovement}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Mic className="w-3 h-3" />
            <span>Final Movement: {intonation.finalMovement}</span>
          </div>
        </div>

        {/* Rhythm */}
        <div className="border-t pt-3">
          <Label className="text-xs">Rhythm</Label>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <div>
              <Volume2 className="w-3 h-3" />
              <span>Speech Rate: {rhythm.speechRate} syll/s</span>
            </div>
            <div>
              <Activity className="w-3 h-3" />
              <span>Articulation Rate: {rhythm.articulationRate} onsets/s</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Eye className="w-3 h-3" />
            <span>Avg IOI: {rhythm.avgIOI}s</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Zap className="w-3 h-3" />
            <span>Regularity: {rhythm.regularity}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
            <Activity className="w-3 h-3" />
            <span>Tempo Variability: {rhythm.tempoVariability}</span>
          </div>
        </div>

      </CardContent>
    </Card>
  )
}