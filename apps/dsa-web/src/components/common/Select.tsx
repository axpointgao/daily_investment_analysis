import type React from 'react';
import { useId } from 'react';
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const EMPTY_OPTION_VALUE = '__empty_option__';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const Select: React.FC<SelectProps> = ({
  id,
  value,
  onChange,
  options,
  label,
  placeholder = '请选择',
  disabled = false,
  className,
}) => {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;

  return (
    <div className={cn('grid gap-2', className)}>
      {label ? <Label htmlFor={resolvedId}>{label}</Label> : null}
      <ShadcnSelect
        value={value || undefined}
        onValueChange={(nextValue) => onChange(nextValue === EMPTY_OPTION_VALUE ? '' : nextValue)}
        disabled={disabled}
      >
        <SelectTrigger id={resolvedId} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value || EMPTY_OPTION_VALUE} value={option.value || EMPTY_OPTION_VALUE}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </ShadcnSelect>
    </div>
  );
};
