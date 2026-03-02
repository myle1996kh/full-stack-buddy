import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/card';
import { Anchor, Users, Zap, Shield } from 'lucide-react';
import type { UserRole } from '@/types/user';

export default function RoleSelectPage() {
  const { selectRole } = useAuthStore();

  const roles: { id: UserRole; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      id: 'captain',
      icon: <Anchor className="w-10 h-10 text-mse-consciousness" />,
      title: 'Captain',
      desc: 'I create lessons & lead. Record reference videos and set MSE patterns for Crew to mirror.',
    },
    {
      id: 'crew',
      icon: <Users className="w-10 h-10 text-primary" />,
      title: 'Crew',
      desc: 'I practice & mirror the Captain. Select lessons, practice with camera, and track my consciousness progress.',
    },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-2xl animate-slide-up">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Choose Your Role</h1>
          </div>
          <p className="text-muted-foreground">You can switch roles later in settings</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {roles.map((role) => (
            <Card
              key={role.id}
              className="glass cursor-pointer transition-all duration-300 hover:border-primary/50 hover:glow-primary group"
              onClick={() => selectRole(role.id)}
            >
              <CardContent className="p-8 text-center">
                <div className="mb-6 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-muted group-hover:bg-primary/10 transition-colors">
                  {role.icon}
                </div>
                <h2 className="text-xl font-bold mb-3">{role.title}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">{role.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
