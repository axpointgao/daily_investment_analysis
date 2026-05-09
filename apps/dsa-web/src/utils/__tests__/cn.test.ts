import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn utility', () => {
  it('should merge basic tailwind classes', () => {
    expect(cn('p-2 text-sm', 'p-4')).toBe('text-sm p-4');
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('should handle conditional classes', () => {
    const isTrue = true;
    const isFalse = false;
    expect(cn('base-class', isTrue && 'active-class', isFalse && 'hidden-class')).toBe('base-class active-class');
  });

  it('should preserve shadcn data-slot classes alongside utilities', () => {
    expect(cn('rounded-lg border-border', 'border-input')).toBe('rounded-lg border-input');
    expect(cn('bg-card p-4', 'p-6')).toBe('bg-card p-6');
    expect(cn('text-muted-foreground bg-blue-500', 'bg-red-500')).toBe('text-muted-foreground bg-red-500');
  });

  it('should handle undefined and null gracefully', () => {
    expect(cn('base', undefined, null, '', 'extra')).toBe('base extra');
  });
});
