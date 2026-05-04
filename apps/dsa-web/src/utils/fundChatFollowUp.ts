import type { AnalysisReport } from '../types/analysis';
import { historyApi } from '../api/history';

export interface FundChatFollowUpContext {
  fund_code: string;
  fund_name: string | null;
  fund_type?: string;
  latest_nav?: number;
  nav_date?: string;
  daily_return_pct?: number;
  previous_analysis_summary?: unknown;
  previous_allocation_rating?: string;
  previous_holding_advice?: string;
  previous_risk_summary?: string;
  previous_metrics?: unknown;
  context_error?: string;
}

type ResolveFundChatFollowUpContextParams = {
  fundCode: string;
  fundName: string | null;
  recordId?: number;
};

const MAX_FOLLOW_UP_FUND_NAME_LENGTH = 100;

export function sanitizeFollowUpFundCode(fundCode: string | null): string | null {
  const normalized = fundCode?.trim() ?? '';
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

export function sanitizeFollowUpFundName(fundName: string | null): string | null {
  const normalized = fundName?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_FOLLOW_UP_FUND_NAME_LENGTH) {
    return null;
  }

  return normalized;
}

export function buildFundFollowUpPrompt(fundCode: string, fundName: string | null): string {
  const displayName = fundName ? `${fundName}(${fundCode})` : fundCode;
  return `请基于上一份基金诊断继续分析 ${displayName}`;
}

export function buildFundChatFollowUpContext(
  fundCode: string,
  fundName: string | null,
  report?: AnalysisReport | null,
): FundChatFollowUpContext {
  const context: FundChatFollowUpContext = {
    fund_code: fundCode,
    fund_name: fundName,
  };

  if (!report) {
    return context;
  }

  const { meta, summary, metrics } = report;
  context.fund_type = meta.fundType;
  context.latest_nav = meta.latestNav;
  context.nav_date = meta.navDate;
  context.daily_return_pct = meta.dailyReturnPct;

  if (summary) {
    context.previous_analysis_summary = summary.analysisSummary;
    context.previous_allocation_rating = summary.allocationRating;
    context.previous_holding_advice = summary.holdingAdvice;
    context.previous_risk_summary = summary.riskSummary;
  }

  if (metrics) {
    context.previous_metrics = {
      risk: metrics.risk,
      performance: metrics.performance,
      profile: metrics.profile,
      manager: metrics.manager,
      ranking: metrics.ranking,
      grade: metrics.grade,
    };
  }

  return context;
}

export async function resolveFundChatFollowUpContext({
  fundCode,
  fundName,
  recordId,
}: ResolveFundChatFollowUpContextParams): Promise<FundChatFollowUpContext> {
  if (!recordId) {
    return buildFundChatFollowUpContext(fundCode, fundName);
  }

  const report = await historyApi.getMixedDetail(recordId);
  return buildFundChatFollowUpContext(fundCode, fundName, report);
}
