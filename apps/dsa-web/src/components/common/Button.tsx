import type React from 'react';
import { Loader2 } from 'lucide-react';
import { Button as ShadcnButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type LegacyButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'gradient'
  | 'danger'
  | 'danger-subtle';

type LegacyButtonSize = 'xsm' | 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends Omit<React.ComponentProps<typeof ShadcnButton>, 'variant' | 'size'> {
  variant?: LegacyButtonVariant;
  size?: LegacyButtonSize;
  isLoading?: boolean;
  loadingText?: string;
  glow?: boolean;
}

const variantMap: Record<LegacyButtonVariant, React.ComponentProps<typeof ShadcnButton>['variant']> = {
  primary: 'default',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  gradient: 'default',
  danger: 'destructive',
  'danger-subtle': 'destructive',
};

const sizeMap: Record<LegacyButtonSize, React.ComponentProps<typeof ShadcnButton>['size']> = {
  xsm: 'xs',
  sm: 'sm',
  md: 'default',
  lg: 'lg',
  xl: 'lg',
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  loadingText = '处理中...',
  className,
  disabled,
  type = 'button',
  glow,
  ...props
}) => {
  void glow;

  return (
    <ShadcnButton
      type={type}
      aria-busy={isLoading || undefined}
      variant={variantMap[variant]}
      size={sizeMap[size]}
      className={cn(className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Loader2 className="animate-spin" />
          {loadingText}
        </>
      ) : (
        children
      )}
    </ShadcnButton>
  );
};
