import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';

const mockLessons = [
  { id: '1', title: 'Hello Everyone', status: 'published', difficulty: 'beginner', crewCount: 12, avgScore: 72 },
  { id: '2', title: 'Confident Pitch', status: 'draft', difficulty: 'intermediate', crewCount: 0, avgScore: 0 },
];

export default function LessonsPage() {
  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Lessons</h1>
        <Link to="/captain/record">
          <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> New Lesson</Button>
        </Link>
      </div>

      <div className="space-y-3">
        {mockLessons.map((lesson) => (
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
                  {lesson.crewCount > 0 && <span>{lesson.crewCount} crew</span>}
                </div>
              </div>
              {lesson.avgScore > 0 && (
                <div className="text-right">
                  <div className="text-lg font-bold text-mse-consciousness">{lesson.avgScore}%</div>
                  <div className="text-[10px] text-muted-foreground">avg score</div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
