import type React from 'react';
import { Badge as ShadcnBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'history';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
  style?: React.CSSProperties;
}

const variantMap: Record<BadgeVariant, React.ComponentProps<typeof ShadcnBadge>['variant']> = {
  default: 'secondary',
  success: 'outline',
  warning: 'outline',
  danger: 'destructive',
  info: 'secondary',
  history: 'outline',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  className,
  ...rest
}) => {
  return (
    <ShadcnBadge
      {...rest}
      variant={variantMap[variant]}
      className={cn(size === 'md' && 'h-6 px-2.5 text-sm', className)}
    >
      {children}
    </ShadcnBadge>
  );
};
