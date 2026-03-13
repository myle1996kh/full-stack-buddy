import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

interface SidebarShellProps {
  roleLabel: string;
  children: ReactNode;
  mobileOnly?: boolean;
}

export default function SidebarShell({ roleLabel, children, mobileOnly = false }: SidebarShellProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    if (!mobileOnly) return null;

    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="rounded-xl">
            <Menu className="h-4 w-4" />
            <span className="sr-only">Open navigation</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="border-white/70 bg-background/95 p-4 backdrop-blur-xl">
          <SheetHeader className="mb-6 text-left">
            <SheetTitle>{roleLabel} menu</SheetTitle>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  if (mobileOnly) return null;

  return (
    <aside className="hidden md:flex md:w-[260px] md:shrink-0">
      <div className="sticky top-24 w-full rounded-[1.75rem] border border-white/70 bg-white/75 p-4 shadow-[0_20px_50px_rgba(255,59,48,0.08)] backdrop-blur-xl">
        <div className="mb-4 px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{roleLabel}</p>
        </div>
        {children}
      </div>
    </aside>
  );
}
