import type React from 'react';
import { ScrollArea as ShadcnScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ScrollAreaProps {
  children: React.ReactNode;
  className?: string;
  viewportClassName?: string;
  testId?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

export const ScrollArea: React.FC<ScrollAreaProps> = ({
  children,
  className,
  viewportClassName,
  testId,
  viewportRef,
  onScroll,
}) => {
  return (
    <ShadcnScrollArea className={cn('min-h-0 flex-1', className)}>
      <div
        ref={viewportRef}
        data-testid={testId}
        onScroll={onScroll}
        className={cn('h-full', viewportClassName)}
      >
        {children}
      </div>
    </ShadcnScrollArea>
  );
};
