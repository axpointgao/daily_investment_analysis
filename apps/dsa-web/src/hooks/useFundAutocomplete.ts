import { useCallback, useEffect, useRef, useState } from 'react';
import type { FundIndexItem, FundSuggestion } from '../types/fundIndex';
import { searchFunds } from '../utils/searchFunds';
import { SEARCH_CONFIG } from '../utils/stockIndexFields';

export interface UseFundAutocompleteOptions {
  minLength?: number;
  debounceMs?: number;
  limit?: number;
}

export interface UseFundAutocompleteResult {
  query: string;
  setQuery: (value: string) => void;
  suggestions: FundSuggestion[];
  isOpen: boolean;
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  highlightPrevious: () => void;
  highlightNext: () => void;
  close: () => void;
  reset: () => void;
  isComposing: boolean;
  setIsComposing: (composing: boolean) => void;
  runtimeFallback: boolean;
  error: Error | null;
}

export function useFundAutocomplete(
  index: FundIndexItem[],
  options: UseFundAutocompleteOptions = {},
): UseFundAutocompleteResult {
  const {
    minLength = SEARCH_CONFIG.MIN_QUERY_LENGTH,
    debounceMs = SEARCH_CONFIG.DEBOUNCE_MS,
    limit = SEARCH_CONFIG.DEFAULT_LIMIT,
  } = options;

  const [query, setInternalQuery] = useState('');
  const [suggestions, setSuggestions] = useState<FundSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isComposing, setIsComposing] = useState(false);
  const [runtimeFallback, setRuntimeFallback] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((value: string) => {
    if (runtimeFallback) {
      return;
    }
    if (value.length < minLength) {
      setSuggestions([]);
      setIsOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    try {
      const results = searchFunds(value, index, { limit });
      setSuggestions(results);
      setIsOpen(results.length > 0);
      setHighlightedIndex(-1);
    } catch (caught) {
      const runtimeError = caught instanceof Error ? caught : new Error('Fund autocomplete search failed');
      console.error('Fund autocomplete search failed. Falling back to plain input.', runtimeError);
      setError(runtimeError);
      setRuntimeFallback(true);
      setSuggestions([]);
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  }, [index, limit, minLength, runtimeFallback]);

  const setQuery = useCallback((value: string) => {
    setInternalQuery(value);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (runtimeFallback) {
      return;
    }
    debounceTimerRef.current = setTimeout(() => search(value), debounceMs);
  }, [debounceMs, runtimeFallback, search]);

  const highlightPrevious = useCallback(() => {
    setHighlightedIndex((previous) => {
      if (previous <= 0) return suggestions.length - 1;
      return previous - 1;
    });
  }, [suggestions.length]);

  const highlightNext = useCallback(() => {
    setHighlightedIndex((previous) => {
      if (previous >= suggestions.length - 1) return 0;
      return previous + 1;
    });
  }, [suggestions.length]);

  const close = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
  }, []);

  const reset = useCallback(() => {
    setInternalQuery('');
    setSuggestions([]);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    query,
    setQuery,
    suggestions,
    isOpen,
    highlightedIndex,
    setHighlightedIndex,
    highlightPrevious,
    highlightNext,
    close,
    reset,
    isComposing,
    setIsComposing,
    runtimeFallback,
    error,
  };
}

export default useFundAutocomplete;
