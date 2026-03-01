import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, Play, Square, RotateCcw, Activity, Volume2, Eye, Zap } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function PlaygroundPage() {
  const [practicing, setPracticing] = useState(false);
  const [finished, setFinished] = useState(false);

  // Mock real-time scores
  const mockScores = { motion: 78, sound: 62, eyes: 91 };
  const consciousness = Math.round((mockScores.motion + mockScores.sound + mockScores.eyes) / 3);

  const handleStop = () => {
    setPracticing(false);
    setFinished(true);
  };

  return (
    <div className="space-y-4 animate-slide-up">
      <h1 className="text-xl font-bold">🎮 Playground — "Hello Everyone"</h1>

      {/* Split view */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-muted/30 flex items-center justify-center">
              <div className="text-center p-3">
                <p className="text-[10px] text-muted-foreground mb-1">🧑‍✈️ Captain Reference</p>
                <div className="w-16 h-16 rounded-lg bg-muted/50 mx-auto flex items-center justify-center">
                  <Activity className="w-6 h-6 text-mse-motion opacity-50" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-muted/30 flex items-center justify-center">
              <div className="text-center p-3">
                <p className="text-[10px] text-muted-foreground mb-1">🎥 Your Camera</p>
                <Video className="w-8 h-8 text-muted-foreground mx-auto" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MSE Gauges */}
      <Card className="glass">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-medium">Real-time MSE Match</h3>

          {[
            { icon: Activity, label: 'Motion', score: mockScores.motion, color: 'bg-mse-motion' },
            { icon: Volume2, label: 'Sound', score: mockScores.sound, color: 'bg-mse-sound' },
            { icon: Eye, label: 'Eyes', score: mockScores.eyes, color: 'bg-mse-eyes' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <item.icon className="w-4 h-4 shrink-0" style={{ color: `var(--mse-${item.label.toLowerCase()})` ? undefined : undefined }} />
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                  <span>{item.label}</span>
                  <span className="font-mono">{practicing || finished ? `${item.score}%` : '—'}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color} transition-all duration-700`}
                    style={{ width: practicing || finished ? `${item.score}%` : '0%' }}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-mse-consciousness" />
              <span className="text-sm font-medium">Consciousness</span>
            </div>
            <span className="text-xl font-bold text-mse-consciousness">
              {practicing || finished ? `${consciousness}%` : '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        {!practicing && !finished && (
          <Button size="lg" onClick={() => setPracticing(true)} className="gap-2">
            <Play className="w-4 h-4" /> Start Practice
          </Button>
        )}
        {practicing && (
          <Button size="lg" variant="destructive" onClick={handleStop} className="gap-2">
            <Square className="w-4 h-4" /> Stop
          </Button>
        )}
        {finished && (
          <>
            <Button size="lg" variant="outline" onClick={() => { setFinished(false); setPracticing(false); }} className="gap-2">
              <RotateCcw className="w-4 h-4" /> Try Again
            </Button>
            <Button size="lg" className="gap-2">
              View Results
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
