import type React from 'react';
import {
  Card as ShadcnCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CardProps extends Omit<React.ComponentProps<typeof ShadcnCard>, 'title'> {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const contentPadding: Record<NonNullable<CardProps['padding']>, string> = {
  none: 'px-0',
  sm: 'px-3',
  md: 'px-4',
  lg: 'px-6',
};

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  children,
  className,
  style,
  padding = 'md',
  ...props
}) => {
  const hasHeader = Boolean(title || subtitle);

  return (
    <ShadcnCard className={cn(className)} style={style} {...props}>
      {hasHeader ? (
        <CardHeader>
          {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
          {title ? <CardTitle>{title}</CardTitle> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(!hasHeader && contentPadding[padding])}>{children}</CardContent>
    </ShadcnCard>
  );
};
