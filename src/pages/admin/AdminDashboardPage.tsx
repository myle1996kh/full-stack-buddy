import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, BookOpen, Activity, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Stats {
  totalUsers: number;
  totalCaptains: number;
  totalCrew: number;
  totalLessons: number;
  publishedLessons: number;
  totalSessions: number;
  avgScore: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      const [rolesRes, lessonsRes, sessionsRes] = await Promise.all([
        supabase.from('user_roles').select('role'),
        supabase.from('lessons').select('status, avg_score'),
        supabase.from('sessions').select('consciousness_percent'),
      ]);

      const roles = rolesRes.data || [];
      const lessons = lessonsRes.data || [];
      const sessions = sessionsRes.data || [];

      const avgScore = sessions.length > 0
        ? Math.round(sessions.reduce((s, r) => s + r.consciousness_percent, 0) / sessions.length)
        : 0;

      setStats({
        totalUsers: roles.length,
        totalCaptains: roles.filter(r => r.role === 'captain').length,
        totalCrew: roles.filter(r => r.role === 'crew').length,
        totalLessons: lessons.length,
        publishedLessons: lessons.filter(l => l.status === 'published').length,
        totalSessions: sessions.length,
        avgScore,
      });
      setLoading(false);
    }
    fetchStats();
  }, []);

  const cards = stats ? [
    { label: 'Total Users', value: stats.totalUsers, icon: Users, sub: `${stats.totalCaptains} captains · ${stats.totalCrew} crew`, color: 'text-primary' },
    { label: 'Lessons', value: stats.totalLessons, icon: BookOpen, sub: `${stats.publishedLessons} published`, color: 'text-mse-consciousness' },
    { label: 'Sessions', value: stats.totalSessions, icon: Activity, sub: 'total practice sessions', color: 'text-mse-motion' },
    { label: 'Avg Score', value: `${stats.avgScore}%`, icon: TrendingUp, sub: 'consciousness level', color: 'text-mse-sound' },
  ] : [];

  return (
    <div className="space-y-6">
      <motion.h1
        className="text-2xl font-bold"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
      >
        🛡️ Admin Dashboard
      </motion.h1>

      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="glass animate-pulse h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {cards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="glass">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <card.icon className={`w-4 h-4 ${card.color}`} />
                    <span className="text-xs text-muted-foreground">{card.label}</span>
                  </div>
                  <p className="text-2xl font-bold">{card.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
