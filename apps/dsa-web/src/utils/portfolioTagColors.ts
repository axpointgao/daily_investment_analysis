export const PORTFOLIO_TAG_COLORS = [
  '#FDCDC5',
  '#FDF4BF',
  '#EDF8BB',
  '#B7F4EC',
  '#C3E7FE',
  '#F7BAEF',
] as const;

export function getPortfolioTagColor(index: number) {
  return PORTFOLIO_TAG_COLORS[index % PORTFOLIO_TAG_COLORS.length];
}

export function resolvePortfolioTagColor(color?: string | null, fallbackIndex?: number): string | undefined {
  if (typeof color === 'string' && PORTFOLIO_TAG_COLORS.includes(color as (typeof PORTFOLIO_TAG_COLORS)[number])) {
    return color;
  }
  if (fallbackIndex != null && fallbackIndex >= 0) {
    return getPortfolioTagColor(fallbackIndex);
  }
  return undefined;
}
