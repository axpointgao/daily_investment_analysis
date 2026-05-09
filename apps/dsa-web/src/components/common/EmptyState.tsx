import type React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  className,
}) => {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex flex-col items-center px-6 py-10 text-center">
        {icon ? <div className="mb-4 text-muted-foreground">{icon}</div> : null}
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        {description ? <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p> : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </CardContent>
    </Card>
  );
};
