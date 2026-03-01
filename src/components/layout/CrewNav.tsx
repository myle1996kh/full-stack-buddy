import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Gamepad2, BarChart3, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/crew/library', icon: BookOpen, label: 'Library' },
  { path: '/crew/playground', icon: Gamepad2, label: 'Play' },
  { path: '/crew/progress', icon: BarChart3, label: 'Progress' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export default function CrewNav() {
  const { pathname } = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/50">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors text-xs',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
