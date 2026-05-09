import type React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingProps {
  label?: string;
  className?: string;
}

export const Loading: React.FC<LoadingProps> = ({ label = '正在加载', className }) => {
  return (
    <div className={cn('flex items-center justify-center p-8', className)}>
      <div className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
};
