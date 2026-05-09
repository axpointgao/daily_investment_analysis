import type React from 'react';
import { useId } from 'react';
import { Checkbox as ShadcnCheckbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string;
  containerClassName?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  label,
  id,
  className,
  containerClassName,
  checked,
  defaultChecked,
  disabled,
  onChange,
  ...props
}) => {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;

  return (
    <div className={cn('flex items-center gap-2', containerClassName)}>
      <ShadcnCheckbox
        id={checkboxId}
        checked={checked as boolean | undefined}
        defaultChecked={defaultChecked as boolean | undefined}
        disabled={disabled}
        className={cn(className)}
        onCheckedChange={(nextChecked) => {
          onChange?.({
            target: { checked: nextChecked === true, ...props },
          } as unknown as React.ChangeEvent<HTMLInputElement>);
        }}
      />
      {label ? (
        <Label htmlFor={checkboxId} className="cursor-pointer">
          {label}
        </Label>
      ) : null}
    </div>
  );
};
