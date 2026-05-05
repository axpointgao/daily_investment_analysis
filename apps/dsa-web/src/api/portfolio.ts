import apiClient from './index';
import { toCamelCase } from './utils';
import type {
  PortfolioAccountItem,
  PortfolioAccountCreateRequest,
  PortfolioAccountListResponse,
  PortfolioAdvisoryLedgerCreateRequest,
  PortfolioAdvisoryLedgerListResponse,
  PortfolioAnalysisRequest,
  PortfolioAnalysisResponse,
  PortfolioBankLedgerCreateRequest,
  PortfolioBankLedgerListResponse,
  PortfolioCashLedgerCreateRequest,
  PortfolioCashLedgerListResponse,
  PortfolioCorporateActionCreateRequest,
  PortfolioCorporateActionListResponse,
  PortfolioCostMethod,
  PortfolioDeleteResponse,
  PortfolioEventCreatedResponse,
  PortfolioFxRefreshResponse,
  PortfolioImportBrokerListResponse,
  PortfolioImportCommitResponse,
  PortfolioImportParseResponse,
  PortfolioInsuranceLedgerCreateRequest,
  PortfolioInsuranceLedgerListResponse,
  PortfolioInsurancePolicyCreateRequest,
  PortfolioInsurancePolicyItem,
  PortfolioInsurancePolicyListResponse,
  PortfolioManualPriceItem,
  PortfolioManualPriceUpsertRequest,
  PortfolioRiskResponse,
  PortfolioSnapshotResponse,
  PortfolioTradeCreateRequest,
  PortfolioTradeListResponse,
} from '../types/portfolio';

type SnapshotQuery = {
  accountId?: number;
  asOf?: string;
  costMethod?: PortfolioCostMethod;
  refreshPrices?: boolean;
};

type FxRefreshQuery = {
  accountId?: number;
  asOf?: string;
};

type EventQuery = {
  accountId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

type TradeListQuery = EventQuery & {
  symbol?: string;
  side?: 'buy' | 'sell';
};

type CashListQuery = EventQuery & {
  direction?: 'in' | 'out';
};

type BankLedgerListQuery = EventQuery & {
  assetKind?: 'demand' | 'deposit' | 'wealth';
};

type AdvisoryLedgerListQuery = EventQuery & {
  product?: string;
  direction?: 'subscribe' | 'redeem';
};

type InsurancePolicyListQuery = {
  accountId?: number;
  includeInactive?: boolean;
};

type InsuranceLedgerListQuery = EventQuery & {
  policyId?: number;
  eventType?: string;
};

type CorporateListQuery = EventQuery & {
  symbol?: string;
  actionType?: 'cash_dividend' | 'split_adjustment';
};

const PORTFOLIO_ANALYSIS_TIMEOUT_MS = 180000;

function buildSnapshotParams(query: SnapshotQuery): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  if (query.accountId != null) {
    params.account_id = query.accountId;
  }
  if (query.asOf) {
    params.as_of = query.asOf;
  }
  if (query.costMethod) {
    params.cost_method = query.costMethod;
  }
  if (query.refreshPrices != null) {
    params.refresh_prices = query.refreshPrices;
  }
  return params;
}

function buildFxRefreshParams(query: FxRefreshQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (query.accountId != null) {
    params.account_id = query.accountId;
  }
  if (query.asOf) {
    params.as_of = query.asOf;
  }
  return params;
}

function buildEventParams(query: EventQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (query.accountId != null) {
    params.account_id = query.accountId;
  }
  if (query.dateFrom) {
    params.date_from = query.dateFrom;
  }
  if (query.dateTo) {
    params.date_to = query.dateTo;
  }
  if (query.page != null) {
    params.page = query.page;
  }
  if (query.pageSize != null) {
    params.page_size = query.pageSize;
  }
  return params;
}

export const portfolioApi = {
  async getAccounts(includeInactive = false): Promise<PortfolioAccountListResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/accounts', {
      params: { include_inactive: includeInactive },
    });
    return toCamelCase<PortfolioAccountListResponse>(response.data);
  },

  async createAccount(payload: PortfolioAccountCreateRequest): Promise<PortfolioAccountItem> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/accounts', {
      name: payload.name,
      broker: payload.broker,
      market: payload.market,
      base_currency: payload.baseCurrency,
      owner_id: payload.ownerId,
    });
    return toCamelCase<PortfolioAccountItem>(response.data);
  },

  async getSnapshot(query: SnapshotQuery = {}): Promise<PortfolioSnapshotResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/snapshot', {
      params: buildSnapshotParams(query),
    });
    return toCamelCase<PortfolioSnapshotResponse>(response.data);
  },

  async getRisk(query: SnapshotQuery = {}): Promise<PortfolioRiskResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/risk', {
      params: buildSnapshotParams(query),
    });
    return toCamelCase<PortfolioRiskResponse>(response.data);
  },

  async analyzePortfolio(payload: PortfolioAnalysisRequest): Promise<PortfolioAnalysisResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/analysis', {
      account_id: payload.accountId,
      as_of: payload.asOf,
      cost_method: payload.costMethod,
      snapshot_signature: payload.snapshotSignature,
      mode: payload.mode,
    }, {
      timeout: PORTFOLIO_ANALYSIS_TIMEOUT_MS,
    });
    return toCamelCase<PortfolioAnalysisResponse>(response.data);
  },

  async refreshFx(query: FxRefreshQuery = {}): Promise<PortfolioFxRefreshResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/fx/refresh', undefined, {
      params: buildFxRefreshParams(query),
    });
    return toCamelCase<PortfolioFxRefreshResponse>(response.data);
  },

  async createTrade(payload: PortfolioTradeCreateRequest): Promise<PortfolioEventCreatedResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/trades', {
      account_id: payload.accountId,
      symbol: payload.symbol,
      trade_date: payload.tradeDate,
      side: payload.side,
      quantity: payload.quantity,
      price: payload.price,
      fee: payload.fee ?? 0,
      tax: payload.tax ?? 0,
      market: payload.market,
      currency: payload.currency,
      trade_uid: payload.tradeUid,
      note: payload.note,
    });
    return toCamelCase<PortfolioEventCreatedResponse>(response.data);
  },

  async deleteTrade(tradeId: number): Promise<PortfolioDeleteResponse> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/portfolio/trades/${tradeId}`);
    return toCamelCase<PortfolioDeleteResponse>(response.data);
  },

  async createCashLedger(payload: PortfolioCashLedgerCreateRequest): Promise<PortfolioEventCreatedResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/cash-ledger', {
      account_id: payload.accountId,
      event_date: payload.eventDate,
      direction: payload.direction,
      amount: payload.amount,
      currency: payload.currency,
      note: payload.note,
    });
    return toCamelCase<PortfolioEventCreatedResponse>(response.data);
  },

  async upsertManualPrice(payload: PortfolioManualPriceUpsertRequest): Promise<PortfolioManualPriceItem> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/manual-prices', {
      account_id: payload.accountId,
      symbol: payload.symbol,
      market: payload.market,
      price_date: payload.priceDate,
      price: payload.price,
      currency: payload.currency,
      note: payload.note,
    });
    return toCamelCase<PortfolioManualPriceItem>(response.data);
  },

  async createBankLedger(payload: PortfolioBankLedgerCreateRequest): Promise<PortfolioEventCreatedResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/bank-ledger', {
      account_id: payload.accountId,
      event_date: payload.eventDate,
      asset_kind: payload.assetKind,
      direction: payload.direction,
      amount: payload.amount,
      currency: payload.currency,
      bank_name: payload.bankName,
      product_name: payload.productName,
      registration_code: payload.registrationCode,
      linked_entry_id: payload.linkedEntryId,
      quantity: payload.quantity,
      start_date: payload.startDate,
      maturity_date: payload.maturityDate,
      annual_rate: payload.annualRate,
      investment_nature: payload.investmentNature,
      risk_level: payload.riskLevel,
      income_mode: payload.incomeMode,
    });
    return toCamelCase<PortfolioEventCreatedResponse>(response.data);
  },

  async deleteBankLedger(entryId: number): Promise<PortfolioDeleteResponse> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/portfolio/bank-ledger/${entryId}`);
    return toCamelCase<PortfolioDeleteResponse>(response.data);
  },

  async createAdvisoryLedger(payload: PortfolioAdvisoryLedgerCreateRequest): Promise<PortfolioEventCreatedResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/advisory-ledger', {
      account_id: payload.accountId,
      event_date: payload.eventDate,
      platform: payload.platform,
      product_name: payload.productName,
      product_code: payload.productCode,
      direction: payload.direction,
      amount: payload.amount,
      quantity: payload.quantity,
      currency: payload.currency,
      risk_level: payload.riskLevel,
      investment_style: payload.investmentStyle,
    });
    return toCamelCase<PortfolioEventCreatedResponse>(response.data);
  },

  async listInsurancePolicies(query: InsurancePolicyListQuery = {}): Promise<PortfolioInsurancePolicyListResponse> {
    const params: Record<string, string | number | boolean> = {};
    if (query.accountId != null) {
      params.account_id = query.accountId;
    }
    if (query.includeInactive != null) {
      params.include_inactive = query.includeInactive;
    }
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/insurance-policies', { params });
    return toCamelCase<PortfolioInsurancePolicyListResponse>(response.data);
  },

  async createInsurancePolicy(payload: PortfolioInsurancePolicyCreateRequest): Promise<PortfolioInsurancePolicyItem> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/insurance-policies', {
      account_id: payload.accountId,
      policy_name: payload.policyName,
      insurer: payload.insurer,
      policy_no: payload.policyNo,
      insurance_kind: payload.insuranceKind,
      design_type: payload.designType,
      currency: payload.currency,
      status: payload.status,
      payment_mode: payload.paymentMode,
      premium_per_period: payload.premiumPerPeriod,
      first_payment_date: payload.firstPaymentDate,
      total_periods: payload.totalPeriods,
      note: payload.note,
    });
    return toCamelCase<PortfolioInsurancePolicyItem>(response.data);
  },

  async createInsuranceLedger(payload: PortfolioInsuranceLedgerCreateRequest): Promise<PortfolioEventCreatedResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/insurance-ledger', {
      account_id: payload.accountId,
      policy_id: payload.policyId,
      event_date: payload.eventDate,
      event_type: payload.eventType,
      amount: payload.amount,
      currency: payload.currency,
      period_no: payload.periodNo,
      note: payload.note,
    });
    return toCamelCase<PortfolioEventCreatedResponse>(response.data);
  },

  async listInsuranceLedger(query: InsuranceLedgerListQuery = {}): Promise<PortfolioInsuranceLedgerListResponse> {
    const params = buildEventParams(query);
    if (query.policyId != null) {
      params.policy_id = query.policyId;
    }
    if (query.eventType) {
      params.event_type = query.eventType;
    }
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/insurance-ledger', { params });
    return toCamelCase<PortfolioInsuranceLedgerListResponse>(response.data);
  },

  async deleteInsuranceLedger(entryId: number): Promise<PortfolioDeleteResponse> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/portfolio/insurance-ledger/${entryId}`);
    return toCamelCase<PortfolioDeleteResponse>(response.data);
  },

  async deleteAdvisoryLedger(entryId: number): Promise<PortfolioDeleteResponse> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/portfolio/advisory-ledger/${entryId}`);
    return toCamelCase<PortfolioDeleteResponse>(response.data);
  },

  async deleteCashLedger(entryId: number): Promise<PortfolioDeleteResponse> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/portfolio/cash-ledger/${entryId}`);
    return toCamelCase<PortfolioDeleteResponse>(response.data);
  },

  async createCorporateAction(payload: PortfolioCorporateActionCreateRequest): Promise<PortfolioEventCreatedResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/corporate-actions', {
      account_id: payload.accountId,
      symbol: payload.symbol,
      effective_date: payload.effectiveDate,
      action_type: payload.actionType,
      market: payload.market,
      currency: payload.currency,
      cash_dividend_per_share: payload.cashDividendPerShare,
      split_ratio: payload.splitRatio,
      note: payload.note,
    });
    return toCamelCase<PortfolioEventCreatedResponse>(response.data);
  },

  async deleteCorporateAction(actionId: number): Promise<PortfolioDeleteResponse> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/portfolio/corporate-actions/${actionId}`);
    return toCamelCase<PortfolioDeleteResponse>(response.data);
  },

  async listTrades(query: TradeListQuery = {}): Promise<PortfolioTradeListResponse> {
    const params = buildEventParams(query);
    if (query.symbol) {
      params.symbol = query.symbol;
    }
    if (query.side) {
      params.side = query.side;
    }
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/trades', { params });
    return toCamelCase<PortfolioTradeListResponse>(response.data);
  },

  async listCashLedger(query: CashListQuery = {}): Promise<PortfolioCashLedgerListResponse> {
    const params = buildEventParams(query);
    if (query.direction) {
      params.direction = query.direction;
    }
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/cash-ledger', { params });
    return toCamelCase<PortfolioCashLedgerListResponse>(response.data);
  },

  async listBankLedger(query: BankLedgerListQuery = {}): Promise<PortfolioBankLedgerListResponse> {
    const params = buildEventParams(query);
    if (query.assetKind) {
      params.asset_kind = query.assetKind;
    }
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/bank-ledger', { params });
    return toCamelCase<PortfolioBankLedgerListResponse>(response.data);
  },

  async listAdvisoryLedger(query: AdvisoryLedgerListQuery = {}): Promise<PortfolioAdvisoryLedgerListResponse> {
    const params = buildEventParams(query);
    if (query.product) {
      params.product = query.product;
    }
    if (query.direction) {
      params.direction = query.direction;
    }
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/advisory-ledger', { params });
    return toCamelCase<PortfolioAdvisoryLedgerListResponse>(response.data);
  },

  async listCorporateActions(query: CorporateListQuery = {}): Promise<PortfolioCorporateActionListResponse> {
    const params = buildEventParams(query);
    if (query.symbol) {
      params.symbol = query.symbol;
    }
    if (query.actionType) {
      params.action_type = query.actionType;
    }
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/corporate-actions', { params });
    return toCamelCase<PortfolioCorporateActionListResponse>(response.data);
  },

  async listImportBrokers(): Promise<PortfolioImportBrokerListResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/portfolio/imports/csv/brokers');
    return toCamelCase<PortfolioImportBrokerListResponse>(response.data);
  },

  async parseCsvImport(broker: string, file: File): Promise<PortfolioImportParseResponse> {
    const formData = new FormData();
    formData.append('broker', broker);
    formData.append('file', file);
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/imports/csv/parse', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return toCamelCase<PortfolioImportParseResponse>(response.data);
  },

  async commitCsvImport(
    accountId: number,
    broker: string,
    file: File,
    dryRun = false,
  ): Promise<PortfolioImportCommitResponse> {
    const formData = new FormData();
    formData.append('account_id', String(accountId));
    formData.append('broker', broker);
    formData.append('dry_run', dryRun ? 'true' : 'false');
    formData.append('file', file);
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/portfolio/imports/csv/commit', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return toCamelCase<PortfolioImportCommitResponse>(response.data);
  },
};
