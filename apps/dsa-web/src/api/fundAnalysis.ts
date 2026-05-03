import apiClient from './index';
import { toCamelCase } from './utils';
import type { FundAnalysisRequest, FundAnalyzeAsyncResponse } from '../types/analysis';

export const fundAnalysisApi = {
  analyzeAsync: async (data: FundAnalysisRequest): Promise<FundAnalyzeAsyncResponse> => {
    const requestData = {
      fund_code: data.fundCode,
      fund_name: data.fundName,
      report_type: data.reportType || 'detailed',
      force_refresh: data.forceRefresh || false,
      async_mode: true,
      ...(data.notify !== undefined && { notify: data.notify }),
    };

    const response = await apiClient.post<Record<string, unknown>>(
      '/api/v1/fund-analysis/analyze',
      requestData,
      {
        validateStatus: (status) => status === 200 || status === 202 || status === 409,
      },
    );

    if (response.status === 409) {
      const errorData = toCamelCase<{
        message: string;
        fundCode: string;
        existingTaskId: string;
      }>(response.data);
      throw new DuplicateFundTaskError(errorData.fundCode, errorData.existingTaskId, errorData.message);
    }

    return toCamelCase<FundAnalyzeAsyncResponse>(response.data);
  },

  getTaskStreamUrl: (): string => {
    const baseUrl = apiClient.defaults.baseURL || '';
    return `${baseUrl}/api/v1/fund-analysis/tasks/stream`;
  },
};

export class DuplicateFundTaskError extends Error {
  fundCode: string;
  existingTaskId: string;

  constructor(fundCode: string, existingTaskId: string, message?: string) {
    super(message || `基金 ${fundCode} 正在分析中`);
    this.name = 'DuplicateFundTaskError';
    this.fundCode = fundCode;
    this.existingTaskId = existingTaskId;
  }
}
