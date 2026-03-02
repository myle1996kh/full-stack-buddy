import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Clock, Users, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Lesson = Tables<'lessons'>;

export default function AdminLessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('lessons')
        .select('*')
        .order('created_at', { ascending: false });
      setLessons(data || []);
      setLoading(false);
    }
    fetch();
  }, []);

  const statusColor = (s: string) => {
    if (s === 'published') return 'default';
    if (s === 'draft') return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-6">
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6" /> All Lessons
        </h1>
        <Badge variant="outline">{lessons.length} total</Badge>
      </motion.div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Card key={i} className="glass animate-pulse h-24" />)}
        </div>
      ) : lessons.length === 0 ? (
        <Card className="glass">
          <CardContent className="p-8 text-center text-muted-foreground">
            No lessons yet
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lessons.map((lesson, i) => (
            <motion.div
              key={lesson.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="glass">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{lesson.title}</p>
                      <p className="text-xs text-muted-foreground">by {lesson.captain_name || 'Unknown'}</p>
                    </div>
                    <Badge variant={statusColor(lesson.status)} className="text-[10px] shrink-0">
                      {lesson.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {lesson.duration ? `${Math.round(lesson.duration / 60)}m` : '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {lesson.crew_count} crew
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {Math.round(lesson.avg_score)}%
                    </span>
                    <Badge variant="outline" className="text-[10px]">{lesson.difficulty}</Badge>
                  </div>
                  <div className="flex gap-2 text-[10px]">
                    <span className="text-mse-motion">M:{lesson.weight_motion}</span>
                    <span className="text-mse-sound">S:{lesson.weight_sound}</span>
                    <span className="text-mse-eyes">E:{lesson.weight_eyes}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
