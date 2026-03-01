import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, Circle, Square } from 'lucide-react';

export default function RecordPage() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">Record New Lesson</h1>

      <Card className="glass overflow-hidden">
        <CardContent className="p-0">
          <div className="aspect-video bg-muted/50 flex items-center justify-center relative">
            <div className="text-center">
              <Video className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Camera preview will appear here</p>
              <p className="text-xs text-muted-foreground mt-1">Grant camera & mic access to begin</p>
            </div>

            {recording && (
              <div className="absolute top-3 right-3 flex items-center gap-2 bg-destructive/90 text-destructive-foreground px-3 py-1.5 rounded-full text-xs font-medium">
                <Circle className="w-2 h-2 fill-current animate-pulse-glow" />
                REC {formatTime(elapsed)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Detection Status</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { label: 'Pose', color: 'bg-mse-motion', status: 'Ready' },
              { label: 'Hands', color: 'bg-mse-motion', status: 'Ready' },
              { label: 'Face', color: 'bg-mse-eyes', status: 'Ready' },
              { label: 'Audio', color: 'bg-mse-sound', status: 'Ready' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2 p-2 rounded bg-muted/50">
                <div className={`w-2 h-2 rounded-full ${item.color} opacity-50`} />
                <span className="text-muted-foreground">{item.label}: {item.status}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-4">
        <Button
          size="lg"
          className={recording ? 'bg-destructive hover:bg-destructive/90' : ''}
          onClick={() => setRecording(!recording)}
        >
          {recording ? (
            <><Square className="w-4 h-4 mr-2" /> Stop Recording</>
          ) : (
            <><Circle className="w-4 h-4 mr-2 fill-current" /> Start Recording</>
          )}
        </Button>
        <span className="text-lg font-mono text-muted-foreground">{formatTime(elapsed)}</span>
      </div>
    </div>
  );
}
