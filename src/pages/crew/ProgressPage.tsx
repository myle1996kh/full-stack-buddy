import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, Zap, Award } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { getScoreLevel } from '@/types/modules';
import type { Json } from '@/integrations/supabase/types';
import MSERadarChart from '@/components/charts/MSERadarChart';
import ConsciousnessTrendChart from '@/components/charts/ConsciousnessTrendChart';
import ScoreBreakdownChart from '@/components/charts/ScoreBreakdownChart';
import SoundContourChart from '@/components/charts/SoundContourChart';
import GazeMapChart from '@/components/charts/GazeMapChart';

interface SessionScores {
  motion?: number;
  sound?: number;
  eyes?: number;
  pitchContour?: number[];
  volumeContour?: number[];
  zoneDwellTimes?: Record<string, number>;
}

interface Session {
  id: string;
  consciousness_percent: number;
  level: string;
  duration: number | null;
  scores: Json | null;
  created_at: string;
  lessons: { title: string } | null;
}

const levelColors: Record<string, string> = {
  unconscious: 'text-score-gray', awakening: 'text-score-yellow', developing: 'text-score-orange',
  conscious: 'text-score-green', mastery: 'text-score-gold',
};

function parseScores(s: Json | null): SessionScores {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
  return s as unknown as SessionScores;
}

export default function ProgressPage() {
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('sessions')
      .select('id, consciousness_percent, level, duration, scores, created_at, lessons(title)')
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

  // Aggregate MSE averages
  const mseAvg = useMemo(() => {
    if (sessions.length === 0) return { motion: 0, sound: 0, eyes: 0 };
    let m = 0, s = 0, e = 0, c = 0;
    sessions.forEach(sess => {
      const sc = parseScores(sess.scores);
      if (sc.motion != null) { m += sc.motion; c++; }
      if (sc.sound != null) { s += sc.sound; }
      if (sc.eyes != null) { e += sc.eyes; }
    });
    const n = c || 1;
    return { motion: Math.round(m / n), sound: Math.round(s / n), eyes: Math.round(e / n) };
  }, [sessions]);

  // Trend data (chronological)
  const trendData = useMemo(() => {
    return sessions.slice(0, 20).reverse().map((s, i) => {
      const sc = parseScores(s.scores);
      return {
        label: `#${i + 1}`,
        consciousness: Math.round(s.consciousness_percent),
        motion: Math.round(sc.motion ?? 0),
        sound: Math.round(sc.sound ?? 0),
        eyes: Math.round(sc.eyes ?? 0),
      };
    });
  }, [sessions]);

  // Latest session details for sound/gaze charts
  const latest = sessions.length > 0 ? parseScores(sessions[0].scores) : null;

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">My Progress</h1>

      {/* Stats cards */}
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

      {sessions.length > 0 && (
        <>
          {/* MSE Radar */}
          <Card className="glass">
            <CardContent className="p-4">
              <h3 className="text-sm font-medium mb-2">MSE Radar</h3>
              <MSERadarChart motion={mseAvg.motion} sound={mseAvg.sound} eyes={mseAvg.eyes} />
            </CardContent>
          </Card>

          {/* Score Breakdown */}
          <Card className="glass">
            <CardContent className="p-4">
              <h3 className="text-sm font-medium mb-2">Score Breakdown</h3>
              <ScoreBreakdownChart motion={mseAvg.motion} sound={mseAvg.sound} eyes={mseAvg.eyes} consciousness={avgConsciousness} />
            </CardContent>
          </Card>

          {/* Consciousness Trend */}
          <Card className="glass">
            <CardContent className="p-4">
              <h3 className="text-sm font-medium mb-2">Consciousness Trend</h3>
              <p className="text-[10px] text-muted-foreground mb-2">
                <span className="inline-block w-2 h-2 rounded-full bg-mse-motion mr-1" />Motion
                <span className="inline-block w-2 h-2 rounded-full bg-mse-sound ml-2 mr-1" />Sound
                <span className="inline-block w-2 h-2 rounded-full bg-mse-eyes ml-2 mr-1" />Eyes
                <span className="inline-block w-2 h-2 rounded-full bg-mse-consciousness ml-2 mr-1" />MSE
              </p>
              <ConsciousnessTrendChart data={trendData} />
            </CardContent>
          </Card>

          {/* Sound Contour (latest session) */}
          {latest?.pitchContour && latest.pitchContour.length > 0 && (
            <Card className="glass">
              <CardContent className="p-4">
                <h3 className="text-sm font-medium mb-1">Sound Contour <span className="text-[10px] text-muted-foreground">(latest)</span></h3>
                <SoundContourChart pitchContour={latest.pitchContour} volumeContour={latest.volumeContour ?? []} />
              </CardContent>
            </Card>
          )}

          {/* Gaze Map (latest session) */}
          {latest?.zoneDwellTimes && (
            <Card className="glass">
              <CardContent className="p-4">
                <h3 className="text-sm font-medium mb-1">Gaze Map <span className="text-[10px] text-muted-foreground">(latest)</span></h3>
                <GazeMapChart points={[]} zoneDwellTimes={latest.zoneDwellTimes} />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Session history */}
      <div>
        <h3 className="text-sm font-medium mb-3">Session History</h3>
        {sessions.length === 0 ? (
          <Card className="glass"><CardContent className="p-8 text-center text-sm text-muted-foreground">No sessions yet — start practicing!</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => {
              const sc = parseScores(s.scores);
              return (
                <Card key={s.id} className="glass">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.lessons?.title || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()} · {s.duration}s</p>
                      <div className="flex gap-2 mt-1">
                        {sc.motion != null && <span className="text-[10px] text-mse-motion font-mono">M:{Math.round(sc.motion)}%</span>}
                        {sc.sound != null && <span className="text-[10px] text-mse-sound font-mono">S:{Math.round(sc.sound)}%</span>}
                        {sc.eyes != null && <span className="text-[10px] text-mse-eyes font-mono">E:{Math.round(sc.eyes)}%</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-mse-consciousness">{Math.round(s.consciousness_percent)}%</div>
                      <div className={`text-[10px] capitalize ${levelColors[s.level] || ''}`}>{s.level}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
