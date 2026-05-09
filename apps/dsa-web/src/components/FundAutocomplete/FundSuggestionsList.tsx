import type { CSSProperties } from 'react';
import type { FundSuggestion } from '../../types/fundIndex';
import { Badge } from '../common';
import { cn } from '@/lib/utils';

export interface FundSuggestionsListProps {
  suggestions: FundSuggestion[];
  highlightedIndex: number;
  onSelect: (suggestion: FundSuggestion) => void;
  onMouseEnter: (index: number) => void;
  style?: CSSProperties;
}

export function FundSuggestionsList({
  suggestions,
  highlightedIndex,
  onSelect,
  onMouseEnter,
  style,
}: FundSuggestionsListProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <ul
      id="fund-suggestions-list"
      className="z-[100] max-h-60 overflow-auto rounded-b-lg rounded-t-none border-x border-b border-border bg-card/95 shadow-lg backdrop-blur"
      style={style}
      role="listbox"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={suggestion.fundCode}
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
          <div className="flex min-w-0 items-center gap-3">
            <Badge variant="default" size="sm" className="min-w-[3rem] justify-center border-primary/25 bg-primary/10 text-primary shadow-none">
              基金
            </Badge>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {suggestion.fundName}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {suggestion.fundCode}{suggestion.fundType ? ` · ${suggestion.fundType}` : ''}
              </span>
            </div>
          </div>
          <MatchTypeBadge matchType={suggestion.matchType} />
        </li>
      ))}
    </ul>
  );
}

function MatchTypeBadge({ matchType }: { matchType: string }) {
  const configMap = {
    exact: { label: '精确', className: 'border-primary/25 bg-primary/10 text-primary' },
    prefix: { label: '前缀', className: 'border-muted/25 bg-muted/10 text-muted-foreground' },
    contains: { label: '包含', className: 'border-amber-500/25 bg-amber-500/10 text-amber-600' },
    fuzzy: { label: '模糊', className: 'border-border/55 bg-card/75 text-muted-foreground' },
  };
  const config = configMap[matchType as keyof typeof configMap] || configMap.fuzzy;

  return (
    <Badge variant="default" size="sm" className={cn('shrink-0 shadow-none', config.className)}>
      {config.label}
    </Badge>
  );
}

export default FundSuggestionsList;
