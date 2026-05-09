import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFundAutocomplete } from '../../hooks/useFundAutocomplete';
import { useFundIndex } from '../../hooks/useFundIndex';
import { cn } from '@/lib/utils';
import { FundSuggestionsList } from './FundSuggestionsList';

const AUTOCOMPLETE_INPUT_CLASS =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50';

export interface FundAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (code: string, name?: string, source?: 'manual' | 'autocomplete') => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

function FallbackInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = '输入基金代码或名称',
  className,
}: FundAutocompleteProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !disabled && value) {
          onSubmit(value);
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(AUTOCOMPLETE_INPUT_CLASS, className)}
      data-autocomplete-mode="fallback"
    />
  );
}

interface FundAutocompleteBoundaryProps extends FundAutocompleteProps {
  children: ReactNode;
}

interface FundAutocompleteBoundaryState {
  hasError: boolean;
}

class FundAutocompleteBoundary extends Component<FundAutocompleteBoundaryProps, FundAutocompleteBoundaryState> {
  override state: FundAutocompleteBoundaryState = { hasError: false };

  static getDerivedStateFromError(): FundAutocompleteBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Fund autocomplete runtime error. Falling back to plain input.', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      const { children, ...fallbackProps } = this.props;
      void children;
      return <FallbackInput {...fallbackProps} />;
    }

    return this.props.children;
  }
}

function FundAutocompleteInner({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = '输入基金代码或名称，如 000001、华夏成长',
  className,
}: FundAutocompleteProps) {
  const { index, loading, fallback } = useFundIndex();
  const {
    setQuery,
    suggestions,
    isOpen,
    highlightedIndex,
    setHighlightedIndex,
    highlightPrevious,
    highlightNext,
    close,
    isComposing,
    setIsComposing,
    runtimeFallback,
    error: autocompleteError,
  } = useFundAutocomplete(index);

  const inputRef = useRef<HTMLInputElement>(null);
  const previousValueRef = useRef(value);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number; width: string } | null>(null);

  const updateDropdownPosition = () => {
    if (!inputRef.current) {
      setDropdownStyle(null);
      return;
    }
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      top: rect.bottom,
      left: rect.left,
      width: `${rect.width}px`,
    });
  };

  const closeSuggestions = () => {
    close();
    setDropdownStyle(null);
  };

  useEffect(() => {
    if (previousValueRef.current !== value) {
      setQuery(value);
      previousValueRef.current = value;
    }
  }, [setQuery, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(updateDropdownPosition);
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (autocompleteError) {
      console.error('Fund autocomplete runtime fallback activated.', autocompleteError);
    }
  }, [autocompleteError]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        highlightNext();
        break;
      case 'ArrowUp':
        event.preventDefault();
        highlightPrevious();
        break;
      case 'Enter':
        event.preventDefault();
        if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          const selected = suggestions[highlightedIndex];
          onChange(selected.fundCode);
          closeSuggestions();
          onSubmit(selected.fundCode, selected.fundName, 'autocomplete');
        } else {
          onSubmit(value);
        }
        break;
      case 'Escape':
        event.preventDefault();
        closeSuggestions();
        break;
      default:
        break;
    }
  };

  if (fallback || loading || runtimeFallback) {
    return (
      <FallbackInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <div className="relative fund-autocomplete">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onFocus={() => {
          if (isOpen) {
            updateDropdownPosition();
          }
        }}
        onBlur={() => {
          setTimeout(() => closeSuggestions(), 200);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(AUTOCOMPLETE_INPUT_CLASS, isOpen && 'rounded-b-none', className)}
        aria-autocomplete="none"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="fund-suggestions-list"
      />

      {loading ? (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-cyan" />
        </div>
      ) : null}

      {isOpen && dropdownStyle
        ? createPortal(
            <FundSuggestionsList
              suggestions={suggestions}
              highlightedIndex={highlightedIndex}
              onSelect={(suggestion) => {
                onChange(suggestion.fundCode);
                closeSuggestions();
                onSubmit(suggestion.fundCode, suggestion.fundName, 'autocomplete');
              }}
              onMouseEnter={(index) => setHighlightedIndex(index)}
              style={{ position: 'fixed', ...dropdownStyle }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

export function FundAutocomplete(props: FundAutocompleteProps) {
  return (
    <FundAutocompleteBoundary {...props}>
      <FundAutocompleteInner {...props} />
    </FundAutocompleteBoundary>
  );
}

export default FundAutocomplete;
