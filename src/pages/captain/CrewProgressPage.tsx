import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';

export default function CrewProgressPage() {
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
