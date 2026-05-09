export function getChangeToneClass(value?: number): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '';
  }

  if (value > 0) {
    return 'text-red-600 dark:text-red-500';
  }

  if (value < 0) {
    return 'text-green-600 dark:text-green-500';
  }

  return '';
}
