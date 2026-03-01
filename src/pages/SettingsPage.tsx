import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';
import { LogOut, User } from 'lucide-react';

export default function SettingsPage() {
  const { user, role, signOut } = useAuthStore();

  return (
    <div className="space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <span className="capitalize">{role === 'captain' ? '🧑‍✈️ Captain' : '🚣 Crew'}</span>
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full gap-2" onClick={signOut}>
        <LogOut className="w-4 h-4" /> Sign Out
      </Button>
    </div>
  );
}
