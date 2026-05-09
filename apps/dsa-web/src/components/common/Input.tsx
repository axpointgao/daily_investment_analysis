import type React from 'react';
import { useId, useState } from 'react';
import { Key, Lock } from 'lucide-react';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EyeToggleIcon } from './EyeToggleIcon';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  trailingAction?: React.ReactNode;
  allowTogglePassword?: boolean;
  iconType?: 'password' | 'key' | 'none';
  passwordVisible?: boolean;
  onPasswordVisibleChange?: (visible: boolean) => void;
}

export const Input = ({
  label,
  hint,
  error,
  className,
  id,
  trailingAction,
  allowTogglePassword,
  iconType = 'none',
  passwordVisible,
  onPasswordVisibleChange,
  ...props
}: InputProps) => {
  const generatedId = useId();
  const inputId = id ?? props.name ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [props['aria-describedby'], errorId ?? hintId].filter(Boolean).join(' ') || undefined;
  const ariaInvalid = props['aria-invalid'] ?? (error ? true : undefined);
  const [internalVisible, setInternalVisible] = useState(false);
  const isPasswordInput = props.type === 'password';
  const visible = typeof passwordVisible === 'boolean' ? passwordVisible : internalVisible;
  const effectiveType = isPasswordInput && allowTogglePassword && visible ? 'text' : props.type;

  const leadingIcon =
    iconType === 'password' ? <Lock className="size-4 text-muted-foreground" /> :
      iconType === 'key' ? <Key className="size-4 text-muted-foreground" /> :
        null;

  const toggle = isPasswordInput && allowTogglePassword ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-7"
      onClick={() => {
        const nextVisible = !visible;
        setInternalVisible(nextVisible);
        onPasswordVisibleChange?.(nextVisible);
      }}
      aria-label={visible ? '隐藏内容' : '显示内容'}
      tabIndex={-1}
    >
      <EyeToggleIcon visible={visible} />
    </Button>
  ) : null;

  const finalTrailingAction = trailingAction || toggle;

  return (
    <div className="grid gap-2">
      {label ? <Label htmlFor={inputId}>{label}</Label> : null}
      <div className="relative flex items-center">
        {leadingIcon ? <div className="pointer-events-none absolute left-2.5 z-10">{leadingIcon}</div> : null}
        <ShadcnInput
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          className={cn(leadingIcon && 'pl-8', finalTrailingAction && 'pr-10', className)}
          {...props}
          type={effectiveType}
        />
        {finalTrailingAction ? <div className="absolute inset-y-0 right-1.5 flex items-center">{finalTrailingAction}</div> : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
};
