import type { CSSProperties } from 'react';
import type { FundSuggestion } from '../../types/fundIndex';
import { Badge } from '../common';
import { cn } from '../../utils/cn';

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
      className="z-[100] max-h-60 overflow-auto rounded-b-lg rounded-t-none border-x border-b"
      style={{
        ...style,
        backgroundColor: 'hsl(var(--card) / 0.85)',
        borderColor: 'var(--border-accent)',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3), -4px 0 15px -3px rgba(0, 0, 0, 0.2), 4px 0 15px -3px rgba(0, 0, 0, 0.2)',
      }}
      role="listbox"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={suggestion.fundCode}
          role="option"
          aria-selected={index === highlightedIndex}
          className={cn(
            'flex cursor-pointer items-center justify-between px-4 py-1',
            'hover:bg-[var(--autocomplete-hover-bg)]/25',
            index === highlightedIndex && 'bg-[var(--autocomplete-hover-bg)]/25',
          )}
          onClick={() => onSelect(suggestion)}
          onMouseEnter={() => onMouseEnter(index)}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Badge variant="default" size="sm" className="min-w-[3rem] justify-center border-cyan/25 bg-cyan/10 text-cyan shadow-none">
              基金
            </Badge>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-primary-text">
                {suggestion.fundName}
              </span>
              <span className="truncate text-sm text-secondary-text">
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
    exact: { label: '精确', className: 'border-cyan/25 bg-cyan/10 text-cyan' },
    prefix: { label: '前缀', className: 'border-purple/25 bg-purple/10 text-purple' },
    contains: { label: '包含', className: 'border-warning/25 bg-warning/10 text-warning' },
    fuzzy: { label: '模糊', className: 'border-border/55 bg-elevated/75 text-muted-text' },
  };
  const config = configMap[matchType as keyof typeof configMap] || configMap.fuzzy;

  return (
    <Badge variant="default" size="sm" className={cn('shrink-0 shadow-none', config.className)}>
      {config.label}
    </Badge>
  );
}

export default FundSuggestionsList;
