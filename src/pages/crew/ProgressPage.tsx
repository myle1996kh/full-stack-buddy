import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, Zap, Activity, Volume2, Eye, Award } from 'lucide-react';

const mockHistory = [
  { date: 'Today', lesson: 'Hello Everyone', score: 76, level: 'conscious' },
  { date: 'Yesterday', lesson: 'Hello Everyone', score: 68, level: 'conscious' },
  { date: '2 days ago', lesson: 'Confident Pitch', score: 54, level: 'developing' },
  { date: '3 days ago', lesson: 'Hello Everyone', score: 45, level: 'developing' },
];

const levelColors: Record<string, string> = {
  unconscious: 'text-score-gray',
  awakening: 'text-score-yellow',
  developing: 'text-score-orange',
  conscious: 'text-score-green',
  mastery: 'text-score-gold',
};

export default function ProgressPage() {
  const avgConsciousness = 61;
  const bestConsciousness = 76;
  const totalSessions = 4;

  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">My Progress</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="glass">
          <CardContent className="p-4 text-center">
            <Zap className="w-5 h-5 text-mse-consciousness mx-auto mb-2" />
            <div className="text-2xl font-bold text-mse-consciousness">{avgConsciousness}%</div>
            <div className="text-[10px] text-muted-foreground">Average</div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 text-center">
            <Award className="w-5 h-5 text-score-gold mx-auto mb-2" />
            <div className="text-2xl font-bold text-score-gold">{bestConsciousness}%</div>
            <div className="text-[10px] text-muted-foreground">Best</div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-5 h-5 text-primary mx-auto mb-2" />
            <div className="text-2xl font-bold">{totalSessions}</div>
            <div className="text-[10px] text-muted-foreground">Sessions</div>
          </CardContent>
        </Card>
      </div>

      {/* Trend placeholder */}
      <Card className="glass">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Consciousness Trend</h3>
          <div className="h-32 flex items-end gap-2">
            {mockHistory.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] font-mono text-muted-foreground">{h.score}%</span>
                <div
                  className="w-full rounded-t bg-mse-consciousness/80 transition-all"
                  style={{ height: `${(h.score / 100) * 100}%` }}
                />
                <span className="text-[9px] text-muted-foreground truncate w-full text-center">{h.date}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <div>
        <h3 className="text-sm font-medium mb-3">Session History</h3>
        <div className="space-y-2">
          {mockHistory.map((h, i) => (
            <Card key={i} className="glass">
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{h.lesson}</p>
                  <p className="text-xs text-muted-foreground">{h.date}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-mse-consciousness">{h.score}%</div>
                  <div className={`text-[10px] capitalize ${levelColors[h.level]}`}>{h.level}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
