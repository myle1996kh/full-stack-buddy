import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, Zap, Award } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { getScoreLevel, getScoreLevelLabel } from '@/types/modules';

interface Session {
  id: string;
  consciousness_percent: number;
  level: string;
  duration: number | null;
  created_at: string;
  lessons: { title: string } | null;
}

const levelColors: Record<string, string> = {
  unconscious: 'text-score-gray', awakening: 'text-score-yellow', developing: 'text-score-orange',
  conscious: 'text-score-green', mastery: 'text-score-gold',
};

export default function ProgressPage() {
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('sessions')
      .select('id, consciousness_percent, level, duration, created_at, lessons(title)')
      .eq('crew_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setSessions((data || []) as unknown as Session[]);
        setLoading(false);
      });
  }, [user]);

  const avgConsciousness = sessions.length > 0
    ? Math.round(sessions.reduce((a, s) => a + s.consciousness_percent, 0) / sessions.length) : 0;
  const bestConsciousness = sessions.length > 0
    ? Math.round(Math.max(...sessions.map(s => s.consciousness_percent))) : 0;

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">My Progress</h1>

      <div className="grid grid-cols-3 gap-3">
        <Card className="glass"><CardContent className="p-4 text-center">
          <Zap className="w-5 h-5 text-mse-consciousness mx-auto mb-2" />
          <div className="text-2xl font-bold text-mse-consciousness">{avgConsciousness}%</div>
          <div className="text-[10px] text-muted-foreground">Average</div>
        </CardContent></Card>
        <Card className="glass"><CardContent className="p-4 text-center">
          <Award className="w-5 h-5 text-score-gold mx-auto mb-2" />
          <div className="text-2xl font-bold text-score-gold">{bestConsciousness}%</div>
          <div className="text-[10px] text-muted-foreground">Best</div>
        </CardContent></Card>
        <Card className="glass"><CardContent className="p-4 text-center">
          <TrendingUp className="w-5 h-5 text-primary mx-auto mb-2" />
          <div className="text-2xl font-bold">{sessions.length}</div>
          <div className="text-[10px] text-muted-foreground">Sessions</div>
        </CardContent></Card>
      </div>

      {/* Trend bar chart */}
      {sessions.length > 0 && (
        <Card className="glass">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Consciousness Trend</h3>
            <div className="h-32 flex items-end gap-1">
              {sessions.slice(0, 20).reverse().map((s, i) => (
                <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[8px] font-mono text-muted-foreground">{Math.round(s.consciousness_percent)}%</span>
                  <div className="w-full rounded-t bg-mse-consciousness/80 transition-all"
                    style={{ height: `${Math.max(4, s.consciousness_percent)}%` }} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session history */}
      <div>
        <h3 className="text-sm font-medium mb-3">Session History</h3>
        {sessions.length === 0 ? (
          <Card className="glass"><CardContent className="p-8 text-center text-sm text-muted-foreground">No sessions yet — start practicing!</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <Card key={s.id} className="glass">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{s.lessons?.title || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()} · {s.duration}s</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-mse-consciousness">{Math.round(s.consciousness_percent)}%</div>
                    <div className={`text-[10px] capitalize ${levelColors[s.level] || ''}`}>{s.level}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
