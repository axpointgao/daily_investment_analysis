import type React from 'react';
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  focusable?: boolean;
  className?: string;
  contentClassName?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'top',
  focusable = false,
  className,
  contentClassName,
}) => {
  if (!content) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider>
      <ShadcnTooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex', className)} tabIndex={focusable ? 0 : undefined}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side={side} className={cn(contentClassName)}>
          {content}
        </TooltipContent>
      </ShadcnTooltip>
    </TooltipProvider>
  );
};
