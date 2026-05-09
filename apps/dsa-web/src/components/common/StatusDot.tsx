import type React from 'react';
import { cn } from '@/lib/utils';

type StatusDotTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusDotTone;
  pulse?: boolean;
  className?: string;
}

const toneStyles: Record<StatusDotTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-destructive',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground',
};

export const StatusDot: React.FC<StatusDotProps> = ({
  tone = 'neutral',
  pulse = false,
  className,
  ...rest
}) => {
  const hasAccessibleLabel = typeof rest['aria-label'] === 'string' && rest['aria-label'].length > 0;

  return (
    <span
      {...rest}
      aria-hidden={hasAccessibleLabel ? undefined : true}
      className={cn('inline-flex size-2.5 shrink-0 rounded-full', toneStyles[tone], pulse && 'animate-pulse', className)}
    />
  );
};
