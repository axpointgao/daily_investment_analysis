/**
 * SuggestionsList Component
 *
 * Stock search suggestion list
 * Displays matched stock options
 */

import type { CSSProperties } from 'react';
import type { StockSuggestion } from '../../types/stockIndex';
import { Badge } from '../common';
import { cn } from '@/lib/utils';

export interface SuggestionsListProps {
  /** Suggestion list */
  suggestions: StockSuggestion[];
  /** Highlighted index */
  highlightedIndex: number;
  /** Selection callback */
  onSelect: (suggestion: StockSuggestion) => void;
  /** Mouse hover callback */
  onMouseEnter: (index: number) => void;
  /** Custom style (for Portal fixed positioning) */
  style?: CSSProperties;
}

export function SuggestionsList({
  suggestions,
  highlightedIndex,
  onSelect,
  onMouseEnter,
  style,
}: SuggestionsListProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <ul
      id="suggestions-list"
      className="z-[100] max-h-60 overflow-auto rounded-b-lg rounded-t-none border-x border-b border-border bg-card/95 shadow-lg backdrop-blur"
      style={style}
      role="listbox"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={suggestion.canonicalCode}
          role="option"
          aria-selected={index === highlightedIndex}
          className={cn(
            'flex cursor-pointer items-center justify-between px-4 py-1',
            'hover:bg-muted',
            index === highlightedIndex && 'bg-muted',
          )}
          onClick={() => onSelect(suggestion)}
          onMouseEnter={() => onMouseEnter(index)}
        >
          <div className="flex items-center gap-3">
            {/* Market badge */}
            <MarketBadge market={suggestion.market} />

            {/* Name and code */}
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                {suggestion.nameZh}
              </span>
              <span className="text-sm text-muted-foreground">
                {suggestion.displayCode}
              </span>
            </div>
          </div>

          {/* Match type badge */}
          <MatchTypeBadge matchType={suggestion.matchType} />
        </li>
      ))}
    </ul>
  );
}

// Helper component: Market badge
const MARKET_BADGE_CONFIG = {
  CN: { label: 'A股', className: 'border-destructive/25 bg-destructive/10 text-destructive' },
  HK: { label: '港股', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600' },
  US: { label: '美股', className: 'border-primary/25 bg-primary/10 text-primary' },
  INDEX: { label: '指数', className: 'border-muted/25 bg-muted/10 text-muted-foreground' },
  ETF: { label: 'ETF', className: 'border-amber-500/25 bg-amber-500/10 text-amber-600' },
  BSE: { label: '北交所', className: 'border-orange-500/25 bg-orange-500/10 text-orange-500' },
} as const;

function MarketBadge({ market }: { market: string }) {
  const config = MARKET_BADGE_CONFIG[market as keyof typeof MARKET_BADGE_CONFIG];

  if (!config) {
    throw new Error(`Unsupported market in stock suggestion: ${market}`);
  }

  return (
    <Badge variant="default" size="sm" className={cn("min-w-[3rem] justify-center shadow-none", config.className)}>
      {config.label}
    </Badge>
  );
}

// Helper component: Match type badge
function MatchTypeBadge({ matchType }: { matchType: string }) {
  const configMap = {
    exact: { label: '精确', className: 'border-primary/25 bg-primary/10 text-primary' },
    prefix: { label: '前缀', className: 'border-muted/25 bg-muted/10 text-muted-foreground' },
    contains: { label: '包含', className: 'border-amber-500/25 bg-amber-500/10 text-amber-600' },
    fuzzy: { label: '模糊', className: 'border-border/55 bg-card/75 text-muted-foreground' },
  };

  const config = configMap[matchType as keyof typeof configMap] || configMap.fuzzy;

  return (
    <Badge variant="default" size="sm" className={cn("shrink-0 shadow-none", config.className)}>
      {config.label}
    </Badge>
  );
}

export default SuggestionsList;
