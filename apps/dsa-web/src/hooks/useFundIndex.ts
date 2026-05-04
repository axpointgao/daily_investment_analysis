import { useEffect, useState } from 'react';
import type { FundIndexItem } from '../types/fundIndex';
import { loadFundIndex } from '../utils/fundIndexLoader';

export interface UseFundIndexResult {
  index: FundIndexItem[];
  loading: boolean;
  error: Error | null;
  fallback: boolean;
  loaded: boolean;
}

export function useFundIndex(): UseFundIndexResult {
  const [index, setIndex] = useState<FundIndexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      const result = await loadFundIndex();
      if (!mounted) {
        return;
      }
      setIndex(result.data);
      setFallback(result.fallback);
      setError(result.error ?? null);
      setLoading(false);
    }

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  return {
    index,
    loading,
    error,
    fallback,
    loaded: !loading,
  };
}

export default useFundIndex;
