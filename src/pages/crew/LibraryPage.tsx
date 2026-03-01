import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Search, Activity, Volume2, Eye } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';

const mockLibrary = [
  { id: '1', title: 'Hello Everyone', captain: 'Captain Demo', difficulty: 'beginner', avgScore: 72, crewCount: 12 },
  { id: '2', title: 'Confident Pitch Delivery', captain: 'Captain Pro', difficulty: 'intermediate', avgScore: 65, crewCount: 8 },
  { id: '3', title: 'Eye Contact Mastery', captain: 'Captain Focus', difficulty: 'advanced', avgScore: 58, crewCount: 5 },
];

export default function LibraryPage() {
  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">Lesson Library</h1>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search lessons..." className="pl-10" />
      </div>

      <div className="space-y-3">
        {mockLibrary.map((lesson) => (
          <Link key={lesson.id} to={`/crew/playground/${lesson.id}`}>
            <Card className="glass hover:border-primary/30 transition-all duration-200 cursor-pointer mb-3">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-medium">{lesson.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">by {lesson.captain}</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {lesson.difficulty}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Activity className="w-3 h-3 text-mse-motion" />
                    <Volume2 className="w-3 h-3 text-mse-sound" />
                    <Eye className="w-3 h-3 text-mse-eyes" />
                  </div>
                  <span>{lesson.crewCount} practiced</span>
                  <span>avg {lesson.avgScore}%</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
