import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Gamepad2, BarChart3, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/crew/library', icon: BookOpen, label: 'Library' },
  { path: '/crew/playground', icon: Gamepad2, label: 'Play' },
  { path: '/crew/progress', icon: BarChart3, label: 'Progress' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

interface CrewNavProps {
  className?: string;
}

export default function CrewNav({ className }: CrewNavProps) {
  const { pathname } = useLocation();

  return (
    <nav className={cn('flex flex-col gap-2', className)}>
      {navItems.map((item) => {
        const active = pathname.startsWith(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground shadow-[0_12px_28px_rgba(255,59,48,0.18)]' : 'text-muted-foreground hover:bg-white/70 hover:text-foreground'
            )}
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
