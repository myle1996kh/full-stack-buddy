import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

function toFiniteNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.map((item) => toFiniteNumber(item)).filter((item): item is number => item !== undefined);
  return arr.length > 0 ? arr : undefined;
}

function toFiniteRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => {
      const n = toFiniteNumber(raw);
      return n === undefined ? null : [key, n] as const;
    })
    .filter((entry): entry is readonly [string, number] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
  const raw = s as Record<string, unknown>;
  return {
    motion: getModuleScore(raw.motion),
    sound: getModuleScore(raw.sound),
    eyes: getModuleScore(raw.eyes),
    pitchContour: toFiniteNumberArray(raw.pitchContour),
    volumeContour: toFiniteNumberArray(raw.volumeContour),
    zoneDwellTimes: toFiniteRecord(raw.zoneDwellTimes),
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
    <div className="space-y-6">
      <motion.h1
        className="text-2xl font-bold"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        My Progress
      </motion.h1>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Zap, value: `${avgConsciousness}%`, label: 'Average', color: 'text-mse-consciousness', iconColor: 'text-mse-consciousness' },
          { icon: Award, value: `${bestConsciousness}%`, label: 'Best', color: 'text-score-gold', iconColor: 'text-score-gold' },
          { icon: TrendingUp, value: `${sessions.length}`, label: 'Sessions', color: '', iconColor: 'text-primary' },
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

      <AnimatePresence>
        {sessions.length > 0 && (
          <>
            <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
              <Card className="glass">
                <CardContent className="p-4">
                  <h3 className="text-sm font-medium mb-2">MSE Radar</h3>
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
            </motion.div>

            {latest?.pitchContour && latest.pitchContour.length > 0 && (
              <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
                <Card className="glass">
                  <CardContent className="p-4">
                    <h3 className="text-sm font-medium mb-1">Sound Contour <span className="text-[10px] text-muted-foreground">(latest)</span></h3>
                    <SoundContourChart pitchContour={latest.pitchContour} volumeContour={latest.volumeContour ?? []} />
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {latest?.zoneDwellTimes && (
              <motion.div custom={4} variants={cardVariants} initial="hidden" animate="visible">
                <Card className="glass">
                  <CardContent className="p-4">
                    <h3 className="text-sm font-medium mb-1">Gaze Map <span className="text-[10px] text-muted-foreground">(latest)</span></h3>
                    <GazeMapChart points={[]} zoneDwellTimes={latest.zoneDwellTimes} />
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>

      {/* Session history */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
        <h3 className="text-sm font-medium mb-3">Session History</h3>
        {sessions.length === 0 ? (
          <Card className="glass"><CardContent className="p-8 text-center text-sm text-muted-foreground">No sessions yet — start practicing!</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {sessions.map((s, i) => {
              const sc = parseScores(s.scores);
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.03, duration: 0.3 }}
                >
                  <Card className="glass">
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
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
