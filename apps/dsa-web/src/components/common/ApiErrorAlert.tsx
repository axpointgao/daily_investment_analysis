import type React from 'react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ParsedApiError } from '../../api/error';
import { cn } from '@/lib/utils';

interface ApiErrorAlertProps {
  error: ParsedApiError;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  onDismiss?: () => void;
}

export const ApiErrorAlert: React.FC<ApiErrorAlertProps> = ({
  error,
  className,
  actionLabel,
  onAction,
  dismissLabel = '关闭',
  onDismiss,
}) => {
  const showDetails = error.rawMessage.trim() && error.rawMessage.trim() !== error.message.trim();

  return (
    <Alert variant="destructive" className={cn(className)}>
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {showDetails ? (
          <details className="mt-3 rounded-lg border p-3">
            <summary className="cursor-pointer text-xs">查看详情</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{error.rawMessage}</pre>
          </details>
        ) : null}
      </AlertDescription>
      {(actionLabel && onAction) || onDismiss ? (
        <AlertAction className="flex items-center gap-2">
          {actionLabel && onAction ? (
            <Button type="button" variant="outline" size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          ) : null}
          {onDismiss ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              {dismissLabel}
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
};
