import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  description,
  defaultOpen = true,
  className,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('space-y-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>

        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 self-start">
            {open ? (
              <>
                <ChevronUp className="h-4 w-4" /> Hide
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" /> Expand
              </>
            )}
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
