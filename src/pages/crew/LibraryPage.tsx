import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Search, Activity, Volume2, Eye } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

interface Lesson {
  id: string;
  title: string;
  captain_name: string;
  difficulty: string;
  avg_score: number;
  crew_count: number;
  duration: number | null;
}

export default function LibraryPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('lessons')
      .select('id, title, captain_name, difficulty, avg_score, crew_count, duration')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setLessons((data || []) as Lesson[]);
        setLoading(false);
      });
  }, []);

  const filtered = lessons.filter(l =>
    l.title.toLowerCase().includes(search.toLowerCase()) ||
    l.captain_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">Lesson Library</h1>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search lessons..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="glass">
          <CardContent className="p-8 text-center">
            <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No lessons available yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(lesson => (
            <Link key={lesson.id} to={`/crew/playground/${lesson.id}`}>
              <Card className="glass hover:border-primary/30 transition-all duration-200 cursor-pointer mb-3">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-medium">{lesson.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">by {lesson.captain_name}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{lesson.difficulty}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Activity className="w-3 h-3 text-mse-motion" />
                      <Volume2 className="w-3 h-3 text-mse-sound" />
                      <Eye className="w-3 h-3 text-mse-eyes" />
                    </div>
                    {lesson.duration && <span>{lesson.duration}s</span>}
                    <span>{lesson.crew_count} practiced</span>
                    {lesson.avg_score > 0 && <span>avg {Math.round(lesson.avg_score)}%</span>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
