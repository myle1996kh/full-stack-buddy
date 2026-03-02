import { Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import CaptainNav from './CaptainNav';
import CrewNav from './CrewNav';
import AdminNav from './AdminNav';
import { Zap } from 'lucide-react';

export default function AppLayout() {
  const role = useAuthStore((s) => s.role);

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 glass border-b border-border/50">
        <div className="flex items-center justify-between h-14 px-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-sm">MSE-Conscious</span>
          </div>
          <span className="text-xs text-muted-foreground capitalize px-2 py-1 rounded bg-muted">
            {role === 'admin' ? '🛡️ Admin' : role === 'captain' ? '🧑‍✈️ Captain' : '🚣 Crew'}
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Outlet />
      </main>

      {role === 'admin' ? <AdminNav /> : role === 'captain' ? <CaptainNav /> : <CrewNav />}
    </div>
  );
}
