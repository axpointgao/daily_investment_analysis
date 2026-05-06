import React, { useId } from 'react';
import { cn } from '../../utils/cn';

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
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
}

/**
 * Select component with terminal-inspired styling.
 */
export const Select: React.FC<SelectProps> = ({
  id,
  value,
  onChange,
  options,
  label,
  placeholder = '请选择',
  disabled = false,
  className = '',
}) => {
  const selectId = useId();
  const resolvedId = id ?? selectId;

  return (
    <div className={cn('flex flex-col', className)}>
      {label ? <label htmlFor={resolvedId} className="mb-2 text-sm font-medium text-foreground">{label}</label> : null}
      <div>
        <select
          id={resolvedId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            'input-surface input-focus-glow h-11 w-full appearance-none rounded-xl border bg-transparent px-4 py-2.5 pr-10 text-sm text-foreground',
            'transition-all duration-200 focus:outline-none',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-elevated text-foreground">
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
