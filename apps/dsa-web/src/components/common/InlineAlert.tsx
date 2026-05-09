import type React from 'react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

type InlineAlertVariant = 'info' | 'success' | 'warning' | 'danger';

interface InlineAlertProps {
  title?: string;
  message: React.ReactNode;
  variant?: InlineAlertVariant;
  action?: React.ReactNode;
  className?: string;
}

export const InlineAlert: React.FC<InlineAlertProps> = ({
  title,
  message,
  variant = 'info',
  action,
  className,
}) => {
  return (
    <Alert variant={variant === 'danger' ? 'destructive' : 'default'} className={cn(className)}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{message}</AlertDescription>
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
};
