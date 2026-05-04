import type { FundIndexData, FundIndexItem } from '../types/fundIndex';

export interface FundIndexLoadResult {
  data: FundIndexItem[];
  loaded: boolean;
  error?: Error;
  fallback: boolean;
}

export async function loadFundIndex(): Promise<FundIndexLoadResult> {
  try {
    const response = await fetch(`/funds.index.json?_t=${Math.floor(Date.now() / 3600000)}`);
    if (!response.ok) {
      throw new Error(`Failed to load fund index: ${response.status} ${response.statusText}`);
    }

    const data: FundIndexData = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Fund index format is invalid');
    }

    return {
      data,
      loaded: true,
      fallback: false,
    };
  } catch (error) {
    console.error('[FundIndexLoader] Failed to load fund index:', error);
    return {
      data: [],
      loaded: false,
      error: error as Error,
      fallback: true,
    };
  }
}
