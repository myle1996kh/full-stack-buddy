import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function getModuleScore(value: unknown): number | undefined {
  const direct = toFiniteNumber(value);
  if (direct !== undefined) return direct;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return toFiniteNumber((value as Record<string, unknown>).score);
  }
  return undefined;
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
  const raw = s as Record<string, unknown>;
  return {
    motion: getModuleScore(raw.motion),
    sound: getModuleScore(raw.sound),
    eyes: getModuleScore(raw.eyes),
  };
}

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" as const },
  }),
};

const statVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: (i: number) => ({
    opacity: 1, scale: 1,
    transition: { delay: 0.1 + i * 0.1, type: "spring" as const, stiffness: 200, damping: 15 },
  }),
};

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
    let m = 0, s = 0, e = 0;
    let mCount = 0, sCount = 0, eCount = 0;
    sessions.forEach(sess => {
      const sc = parseScores(sess.scores);
      if (sc.motion != null) { m += sc.motion; mCount++; }
      if (sc.sound != null) { s += sc.sound; sCount++; }
      if (sc.eyes != null) { e += sc.eyes; eCount++; }
    });
    return {
      motion: Math.round(m / Math.max(1, mCount)),
      sound: Math.round(s / Math.max(1, sCount)),
      eyes: Math.round(e / Math.max(1, eCount)),
    };
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
      <div className="space-y-6">
        <motion.h1 className="text-2xl font-bold" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Crew Progress</motion.h1>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="glass">
            <CardContent className="p-12 text-center">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-medium mb-2">No crew activity yet</h3>
              <p className="text-sm text-muted-foreground">Publish a lesson first, then crew members can practice and their progress will appear here.</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.h1
        className="text-2xl font-bold"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        Crew Progress
      </motion.h1>

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Users, value: `${uniqueCrew}`, label: 'Crew', color: '', iconColor: 'text-primary' },
          { icon: TrendingUp, value: `${avgConsciousness}%`, label: 'Avg Score', color: 'text-mse-consciousness', iconColor: 'text-mse-consciousness' },
          { icon: Award, value: `${sessions.length}`, label: 'Sessions', color: '', iconColor: 'text-score-gold' },
        ].map((stat, i) => (
          <motion.div key={stat.label} custom={i} variants={statVariants} initial="hidden" animate="visible">
            <Card className="glass"><CardContent className="p-4 text-center">
              <stat.icon className={`w-5 h-5 ${stat.iconColor} mx-auto mb-2`} />
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-[10px] text-muted-foreground">{stat.label}</div>
            </CardContent></Card>
          </motion.div>
        ))}
      </div>

      <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
        <Card className="glass">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-2">Crew MSE Radar</h3>
            <MSERadarChart motion={mseAvg.motion} sound={mseAvg.sound} eyes={mseAvg.eyes} />
          </CardContent>
        </Card>
      </motion.div>

      <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
        <Card className="glass">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-2">Score Breakdown</h3>
            <ScoreBreakdownChart motion={mseAvg.motion} sound={mseAvg.sound} eyes={mseAvg.eyes} consciousness={avgConsciousness} />
          </CardContent>
        </Card>
      </motion.div>

      <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
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
      </motion.div>
    </div>
  );
}
