import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Users, TrendingUp, Award } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import type { Json } from '@/integrations/supabase/types';
import MSERadarChart from '@/components/charts/MSERadarChart';
import ConsciousnessTrendChart from '@/components/charts/ConsciousnessTrendChart';
import ScoreBreakdownChart from '@/components/charts/ScoreBreakdownChart';

interface SessionScores {
  motion?: number;
  sound?: number;
  eyes?: number;
}

interface CrewSession {
  id: string;
  crew_id: string;
  consciousness_percent: number;
  scores: Json | null;
  created_at: string;
  lessons: { title: string } | null;
}

function parseScores(s: Json | null): SessionScores {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
  return s as unknown as SessionScores;
}

export default function CrewProgressPage() {
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<CrewSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('sessions')
      .select('id, crew_id, consciousness_percent, scores, created_at, lessons(title)')
      .eq('captain_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setSessions((data || []) as unknown as CrewSession[]);
        setLoading(false);
      });
  }, [user]);

  const uniqueCrew = useMemo(() => new Set(sessions.map(s => s.crew_id)).size, [sessions]);
  const avgConsciousness = sessions.length > 0
    ? Math.round(sessions.reduce((a, s) => a + s.consciousness_percent, 0) / sessions.length) : 0;

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

  const trendData = useMemo(() => {
    return sessions.slice(0, 30).reverse().map((s, i) => {
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

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="space-y-6 animate-slide-up">
        <h1 className="text-2xl font-bold">Crew Progress</h1>
        <Card className="glass">
          <CardContent className="p-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">No crew activity yet</h3>
            <p className="text-sm text-muted-foreground">Publish a lesson first, then crew members can practice and their progress will appear here.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">Crew Progress</h1>

      <div className="grid grid-cols-3 gap-3">
        <Card className="glass"><CardContent className="p-4 text-center">
          <Users className="w-5 h-5 text-primary mx-auto mb-2" />
          <div className="text-2xl font-bold">{uniqueCrew}</div>
          <div className="text-[10px] text-muted-foreground">Crew</div>
        </CardContent></Card>
        <Card className="glass"><CardContent className="p-4 text-center">
          <TrendingUp className="w-5 h-5 text-mse-consciousness mx-auto mb-2" />
          <div className="text-2xl font-bold text-mse-consciousness">{avgConsciousness}%</div>
          <div className="text-[10px] text-muted-foreground">Avg Score</div>
        </CardContent></Card>
        <Card className="glass"><CardContent className="p-4 text-center">
          <Award className="w-5 h-5 text-score-gold mx-auto mb-2" />
          <div className="text-2xl font-bold">{sessions.length}</div>
          <div className="text-[10px] text-muted-foreground">Sessions</div>
        </CardContent></Card>
      </div>

      <Card className="glass">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-2">Crew MSE Radar</h3>
          <MSERadarChart motion={mseAvg.motion} sound={mseAvg.sound} eyes={mseAvg.eyes} />
        </CardContent>
      </Card>

      <Card className="glass">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-2">Score Breakdown</h3>
          <ScoreBreakdownChart motion={mseAvg.motion} sound={mseAvg.sound} eyes={mseAvg.eyes} consciousness={avgConsciousness} />
        </CardContent>
      </Card>

      <Card className="glass">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-2">Crew Consciousness Trend</h3>
          <p className="text-[10px] text-muted-foreground mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-mse-motion mr-1" />Motion
            <span className="inline-block w-2 h-2 rounded-full bg-mse-sound ml-2 mr-1" />Sound
            <span className="inline-block w-2 h-2 rounded-full bg-mse-eyes ml-2 mr-1" />Eyes
            <span className="inline-block w-2 h-2 rounded-full bg-mse-consciousness ml-2 mr-1" />MSE
          </p>
          <ConsciousnessTrendChart data={trendData} />
        </CardContent>
      </Card>
    </div>
  );
}
