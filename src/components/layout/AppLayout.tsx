import { Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import CaptainNav from './CaptainNav';
import CrewNav from './CrewNav';
import AdminNav from './AdminNav';
import SidebarShell from './SidebarShell';

export default function AppLayout() {
  const role = useAuthStore((s) => s.role);

  const roleLabel = role === 'admin' ? 'Admin' : role === 'captain' ? 'Captain' : 'Crew';
  const nav = role === 'admin'
    ? <AdminNav />
    : role === 'captain'
      ? <CaptainNav />
      : <CrewNav />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-white/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <SidebarShell roleLabel={roleLabel} mobileOnly>{nav}</SidebarShell>
            <img
              src="/chunks-logo.png"
              alt="Chunks logo"
              className="h-10 w-auto object-contain"
            />
            <div>
              <span className="block text-sm font-bold leading-none">MSE-Conscious</span>
              <span className="text-[11px] text-muted-foreground">Powered by CHUNKS</span>
            </div>
          </div>
          <span className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1.5 text-xs capitalize text-primary">
            {role === 'admin' ? '🛡️ Admin' : role === 'captain' ? '🧑‍✈️ Captain' : '🚣 Crew'}
          </span>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-8">
        <SidebarShell roleLabel={roleLabel}>{nav}</SidebarShell>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
