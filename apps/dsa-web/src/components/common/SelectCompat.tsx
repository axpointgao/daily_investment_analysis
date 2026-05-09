import React from 'react';
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const EMPTY_OPTION_VALUE = '__empty_option__';

type SelectCompatOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

interface SelectCompatProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'onChange' | 'size'> {
  children: React.ReactNode;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

function getOptionText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getOptionText).join('');
  return '';
}

function collectOptions(children: React.ReactNode): SelectCompatOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];

    if (child.type === React.Fragment) {
      return collectOptions((child.props as { children?: React.ReactNode }).children);
    }

    if (child.type !== 'option') return [];

    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const label = props.children;
    const value = props.value == null ? getOptionText(label) : String(props.value);

    return [{
      value,
      label,
      disabled: props.disabled,
    }];
  });
}

function extractWidthClasses(className?: string): string {
  if (!className) return '';
  return className
    .split(/\s+/)
    .filter((token) => token === 'w-full' || /^w-/.test(token) || /:w-/.test(token) || token === 'min-w-0' || token === 'shrink-0')
    .join(' ');
}

export function SelectCompat({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: SelectCompatProps) {
  const options = collectOptions(children);
  const currentValue = String(value ?? defaultValue ?? '');
  const hasEmptyOption = options.some((option) => option.value === '');
  const selectedValue = currentValue === '' && hasEmptyOption
    ? EMPTY_OPTION_VALUE
    : currentValue || undefined;
  const emitChange = (nextValue: string) => {
    const resolvedValue = nextValue === EMPTY_OPTION_VALUE ? '' : nextValue;
    onChange?.({
      target: { value: resolvedValue },
      currentTarget: { value: resolvedValue },
    } as React.ChangeEvent<HTMLSelectElement>);
  };

  return (
    <ShadcnSelect
      value={selectedValue}
      disabled={disabled}
      onValueChange={emitChange}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn('w-full', extractWidthClasses(className))}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_OPTION_VALUE}
            value={option.value || EMPTY_OPTION_VALUE}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadcnSelect>
  );
}
