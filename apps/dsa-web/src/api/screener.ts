import apiClient from './index';

export type ScreenerStrategyId =
  | 'quality_value'
  | 'multi_factor'
  | 'trend_follow'
  | 'pullback'
  | 'breakout';

export type ScreenerStrategyInfo = {
  id: ScreenerStrategyId;
  name: string;
  description: string;
  cadence: string;
  dataScope: string[];
  iwencaiFit: string;
};

export type ScreenerStrategyLibraryItem = {
  id: string;
  name: string;
  description: string;
  query: string;
  backtestStatus: string;
  lastRunResult?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScreenerStrategyLibraryUpsert = {
  name: string;
  description: string;
  query: string;
  backtestStatus?: string;
  lastRunResult?: string | null;
};

export type ScreenerCandidate = {
  code: string;
  name?: string | null;
  score: number;
  matchedStrategies: string[];
  reasons: string[];
  risks: string[];
  metrics: Record<string, number | null | undefined>;
  iwencaiFields: Record<string, string>;
  latestDate?: string | null;
  dataSource: string;
};

export type ScreenerRunRequest = {
  strategyIds: ScreenerStrategyId[];
  stockCodes?: string[];
  iwencaiQuery?: string;
  iwencaiPage: number;
  limit: number;
  includeFundamentals: boolean;
  useIwencai: boolean;
  strategyLibraryId?: string;
};

export type ScreenerRunResponse = {
  strategies: ScreenerStrategyInfo[];
  candidates: ScreenerCandidate[];
  totalInput: number;
  evaluated: number;
  skipped: number;
  dataMode: string;
  executionMode: string;
  localExecutable: boolean;
  supportedTerms: string[];
  unsupportedTerms: string[];
  importRequired: boolean;
  iwencaiStatus: string;
  iwencaiQuery?: string | null;
  iwencaiCodeCount?: number | null;
  iwencaiReturnedCount?: number | null;
  iwencaiHasMore: boolean;
  iwencaiChunksInfo: Record<string, unknown>;
  notes: string[];
};

type ApiStrategyInfo = {
  id: ScreenerStrategyId;
  name: string;
  description: string;
  cadence: string;
  data_scope?: string[];
  iwencai_fit?: string;
};

type ApiCandidate = {
  code: string;
  name?: string | null;
  score: number;
  matched_strategies?: string[];
  reasons?: string[];
  risks?: string[];
  metrics?: Record<string, number | null | undefined>;
  iwencai_fields?: Record<string, string>;
  latest_date?: string | null;
  data_source?: string;
};

type ApiRunResponse = {
  strategies?: ApiStrategyInfo[];
  candidates?: ApiCandidate[];
  total_input: number;
  evaluated: number;
  skipped: number;
  data_mode: string;
  execution_mode?: string;
  local_executable?: boolean;
  supported_terms?: string[];
  unsupported_terms?: string[];
  import_required?: boolean;
  iwencai_status: string;
  iwencai_query?: string | null;
  iwencai_code_count?: number | null;
  iwencai_returned_count?: number | null;
  iwencai_has_more?: boolean;
  iwencai_chunks_info?: Record<string, unknown>;
  notes?: string[];
};

type ApiStrategyLibraryItem = {
  id: string;
  name: string;
  description: string;
  query: string;
  backtest_status: string;
  last_run_result?: string | null;
  created_at: string;
  updated_at: string;
};

function mapStrategy(item: ApiStrategyInfo): ScreenerStrategyInfo {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    cadence: item.cadence,
    dataScope: item.data_scope ?? [],
    iwencaiFit: item.iwencai_fit ?? '',
  };
}

function mapLibraryItem(item: ApiStrategyLibraryItem): ScreenerStrategyLibraryItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    query: item.query,
    backtestStatus: item.backtest_status,
    lastRunResult: item.last_run_result,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function mapCandidate(item: ApiCandidate): ScreenerCandidate {
  return {
    code: item.code,
    name: item.name,
    score: item.score,
    matchedStrategies: item.matched_strategies ?? [],
    reasons: item.reasons ?? [],
    risks: item.risks ?? [],
    metrics: item.metrics ?? {},
    iwencaiFields: item.iwencai_fields ?? {},
    latestDate: item.latest_date,
    dataSource: item.data_source ?? '',
  };
}

function mapRunResponse(data: ApiRunResponse): ScreenerRunResponse {
  return {
    strategies: (data.strategies ?? []).map(mapStrategy),
    candidates: (data.candidates ?? []).map(mapCandidate),
    totalInput: data.total_input,
    evaluated: data.evaluated,
    skipped: data.skipped,
    dataMode: data.data_mode,
    executionMode: data.execution_mode ?? 'local_query',
    localExecutable: data.local_executable ?? true,
    supportedTerms: data.supported_terms ?? [],
    unsupportedTerms: data.unsupported_terms ?? [],
    importRequired: data.import_required ?? false,
    iwencaiStatus: data.iwencai_status,
    iwencaiQuery: data.iwencai_query,
    iwencaiCodeCount: data.iwencai_code_count,
    iwencaiReturnedCount: data.iwencai_returned_count,
    iwencaiHasMore: data.iwencai_has_more ?? false,
    iwencaiChunksInfo: data.iwencai_chunks_info ?? {},
    notes: data.notes ?? [],
  };
}

export const screenerApi = {
  async getStrategies(): Promise<ScreenerStrategyInfo[]> {
    const response = await apiClient.get('/api/v1/screener/strategies');
    return (response.data as ApiStrategyInfo[]).map(mapStrategy);
  },

  async run(request: ScreenerRunRequest): Promise<ScreenerRunResponse> {
    const response = await apiClient.post('/api/v1/screener/run', {
      strategy_ids: request.strategyIds,
      stock_codes: request.stockCodes,
      iwencai_query: request.iwencaiQuery,
      iwencai_page: request.iwencaiPage,
      limit: request.limit,
      include_fundamentals: request.includeFundamentals,
      use_iwencai: request.useIwencai,
      strategy_library_id: request.strategyLibraryId,
    });
    return mapRunResponse(response.data as ApiRunResponse);
  },

  async getLibrary(): Promise<ScreenerStrategyLibraryItem[]> {
    const response = await apiClient.get('/api/v1/screener/library');
    return (response.data as ApiStrategyLibraryItem[]).map(mapLibraryItem);
  },

  async createLibraryItem(request: ScreenerStrategyLibraryUpsert): Promise<ScreenerStrategyLibraryItem> {
    const response = await apiClient.post('/api/v1/screener/library', {
      name: request.name,
      description: request.description,
      query: request.query,
      backtest_status: request.backtestStatus,
      last_run_result: request.lastRunResult,
    });
    return mapLibraryItem(response.data as ApiStrategyLibraryItem);
  },

  async updateLibraryItem(id: string, request: ScreenerStrategyLibraryUpsert): Promise<ScreenerStrategyLibraryItem> {
    const response = await apiClient.put(`/api/v1/screener/library/${encodeURIComponent(id)}`, {
      name: request.name,
      description: request.description,
      query: request.query,
      backtest_status: request.backtestStatus,
      last_run_result: request.lastRunResult,
    });
    return mapLibraryItem(response.data as ApiStrategyLibraryItem);
  },

  async importIwencaiExcel(params: {
    file: File;
    strategyQuery?: string;
    strategyLibraryId?: string;
    limit?: number;
  }): Promise<ScreenerRunResponse> {
    const form = new FormData();
    form.append('file', params.file);
    form.append('strategy_query', params.strategyQuery ?? '');
    form.append('strategy_library_id', params.strategyLibraryId ?? '');
    form.append('limit', String(params.limit ?? 100));
    const response = await apiClient.post('/api/v1/screener/imports/iwencai-excel', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return mapRunResponse(response.data as ApiRunResponse);
  },
};
