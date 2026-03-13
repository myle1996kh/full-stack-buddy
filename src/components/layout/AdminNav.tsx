import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, BookOpen, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/admin/users', icon: Users, label: 'Users' },
  { path: '/admin/lessons', icon: BookOpen, label: 'Lessons' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

interface AdminNavProps {
  className?: string;
}

export default function AdminNav({ className }: AdminNavProps) {
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
