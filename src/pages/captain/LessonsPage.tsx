import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, FileText, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/hooks/use-toast';

interface Lesson {
  id: string;
  title: string;
  status: string;
  difficulty: string;
  crew_count: number;
  avg_score: number;
  duration: number | null;
  created_at: string;
}

export default function LessonsPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLessons = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('lessons')
      .select('id, title, status, difficulty, crew_count, avg_score, duration, created_at')
      .eq('captain_id', user.id)
      .order('created_at', { ascending: false });
    setLessons(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchLessons(); }, [user]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('lessons').delete().eq('id', id);
    if (!error) {
      setLessons(l => l.filter(x => x.id !== id));
      toast({ title: 'Lesson deleted' });
    }
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Lessons</h1>
        <Link to="/captain/record">
          <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> New Lesson</Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : lessons.length === 0 ? (
        <Card className="glass">
          <CardContent className="p-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-medium mb-1">No lessons yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Record your first lesson to get started</p>
            <Link to="/captain/record">
              <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Record</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lessons.map((lesson) => (
            <Card key={lesson.id} className="glass hover:border-primary/30 transition-colors">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{lesson.title}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className={lesson.status === 'published' ? 'text-mse-motion' : 'text-score-yellow'}>
                      {lesson.status}
                    </span>
                    <span>{lesson.difficulty}</span>
                    {lesson.duration && <span>{lesson.duration}s</span>}
                    {lesson.crew_count > 0 && <span>{lesson.crew_count} crew</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {lesson.avg_score > 0 && (
                    <div className="text-right mr-2">
                      <div className="text-lg font-bold text-mse-consciousness">{Math.round(lesson.avg_score)}%</div>
                      <div className="text-[10px] text-muted-foreground">avg</div>
                    </div>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(lesson.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
