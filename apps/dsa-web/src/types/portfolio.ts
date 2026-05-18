export type PortfolioCostMethod = 'fifo' | 'avg';
export type PortfolioSide = 'buy' | 'sell';
export type PortfolioCashDirection = 'in' | 'out';
export type PortfolioCorporateActionType = 'cash_dividend' | 'split_adjustment';
export type PortfolioMarket = 'cn' | 'hk' | 'us' | 'fund' | 'crypto' | 'bank' | 'advisory' | 'insurance';
export type PortfolioCashTrackingMode = 'managed' | 'asset_only';
export type PortfolioBankAssetKind = 'demand' | 'deposit' | 'wealth';
export type PortfolioAdvisoryProductType = 'advisory_combo' | 'dca_plan';
export type PortfolioAdvisoryEventType = 'buy' | 'initial_buy' | 'dca_buy' | 'follow_buy' | 'redeem';
export type PortfolioInsuranceKind = 'annuity' | 'whole_life' | 'endowment' | 'universal' | 'unit_linked' | 'other';
export type PortfolioInsuranceDesignType = 'ordinary' | 'participating' | 'universal' | 'unit_linked' | 'other';
export type PortfolioInsuranceStatus = 'active' | 'paid_up' | 'surrendered' | 'matured' | 'expired' | 'cancelled';
export type PortfolioInsurancePaymentMode = 'single' | 'annual' | 'semiannual' | 'quarterly' | 'monthly' | 'irregular';
export type PortfolioInsuranceEventType =
  | 'premium'
  | 'value_update'
  | 'survival_benefit'
  | 'annuity_payment'
  | 'maturity_benefit'
  | 'dividend'
  | 'partial_withdrawal'
  | 'surrender'
  | 'refund'
  | 'other_inflow'
  | 'other_outflow';
export type PortfolioBankInvestmentNature =
  | 'fixed_income'
  | 'mixed'
  | 'equity'
  | 'commodity_derivative'
  | 'cash_management'
  | 'other';
export type PortfolioBankRiskLevel = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type PortfolioBankIncomeMode = 'dividend' | 'reinvest';

export interface PortfolioAccountItem {
  id: number;
  ownerId?: string | null;
  name: string;
  broker?: string | null;
  market: PortfolioMarket;
  baseCurrency: string;
  cashTrackingMode: PortfolioCashTrackingMode;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PortfolioAccountListResponse {
  accounts: PortfolioAccountItem[];
}

export interface PortfolioAccountCreateRequest {
  name: string;
  broker?: string;
  market: PortfolioMarket;
  baseCurrency: string;
  cashTrackingMode?: PortfolioCashTrackingMode;
  ownerId?: string;
}

export interface PortfolioAccountUpdateRequest {
  name: string;
  broker?: string;
}

export interface PortfolioAssetTransferAsset {
  market: PortfolioMarket | string;
  symbol?: string;
  currency?: string;
  displayName?: string;
  linkedEntryId?: number | null;
  policyId?: number | null;
}

export interface PortfolioAssetTransferRequest {
  targetAccountId: number;
  asset: PortfolioAssetTransferAsset;
}

export interface PortfolioAssetTransferResponse {
  sourceAccountId: number;
  targetAccountId: number;
  sourceAccountName: string;
  targetAccountName: string;
  asset: Record<string, unknown>;
  transferredCounts: Record<string, number>;
  totalRecords: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  warnings: string[];
  transferred: boolean;
}

export interface PortfolioPositionItem {
  symbol: string;
  productKey?: string | null;
  tagId?: number | null;
  tagName?: string | null;
  tagColor?: string | null;
  displayName?: string | null;
  market: string;
  currency: string;
  quantity: number;
  avgCost: number;
  totalCost: number;
  lastPrice: number;
  marketValueBase: number;
  unrealizedPnlBase: number;
  unrealizedPnlPct?: number | null;
  annualizedReturnPct?: number | null;
  valuationModel?: string | null;
  costDisplayValue?: number | null;
  priceDisplayValue?: number | null;
  valuationCurrency: string;
  priceSource?: 'realtime_quote' | 'history_close' | 'missing' | string;
  priceProvider?: string | null;
  priceDate?: string | null;
  priceStale?: boolean;
  priceAvailable?: boolean;
  bankName?: string | null;
  productName?: string | null;
  productPublicCode?: string | null;
  issuerName?: string | null;
  registrationCode?: string | null;
  linkedEntryId?: number | null;
  startDate?: string | null;
  maturityDate?: string | null;
  annualRate?: number | null;
  investmentNature?: string | null;
  riskLevel?: string | null;
  incomeMode?: string | null;
  platform?: string | null;
  productCode?: string | null;
  productType?: PortfolioAdvisoryProductType | string | null;
  productTypeLabel?: string | null;
  investmentStyle?: string | null;
  dataProvider?: string | null;
  valuationModelDetail?: string | null;
  externalStrategyCode?: string | null;
  managerName?: string | null;
  recommendedHoldingDuration?: string | null;
  navDate?: string | null;
  investedAmount?: number | null;
  redeemedAmount?: number | null;
  valueAmount?: number | null;
  wealthUnits?: number | null;
  policyId?: number | null;
  policyName?: string | null;
  insurer?: string | null;
  policyNo?: string | null;
  insuranceKind?: string | null;
  designType?: string | null;
  policyStatus?: string | null;
  paymentMode?: string | null;
  premiumPerPeriod?: number | null;
  firstPaymentDate?: string | null;
  totalPeriods?: number | null;
  paidPeriods?: number | null;
  paidPremium?: number | null;
  receivedAmount?: number | null;
  cashValue?: number | null;
  valueDate?: string | null;
  nextPaymentDate?: string | null;
  valueEstimated?: boolean | null;
}

export interface PortfolioTagItem {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PortfolioTagListResponse {
  tags: PortfolioTagItem[];
}

export interface PortfolioTagCreateRequest {
  name: string;
  color?: string;
}

export interface PortfolioTagUpdateRequest {
  name?: string;
  color?: string;
}

export interface PortfolioProductTagUpdateRequest {
  productKey: string;
  tagId?: number | null;
}

export interface PortfolioTagBreakdownItem {
  key: string;
  tagId?: number | null;
  tagName: string;
  tagColor?: string | null;
  amount: number;
}

export interface PortfolioAccountSnapshot {
  accountId: number;
  accountName: string;
  ownerId?: string | null;
  broker?: string | null;
  market: string;
  baseCurrency: string;
  cashTrackingMode?: PortfolioCashTrackingMode | string;
  snapshotSchemaVersion?: number | null;
  asOf: string;
  costMethod: PortfolioCostMethod;
  totalCash: number | null;
  totalMarketValue: number | null;
  totalEquity: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  feeTotal: number | null;
  taxTotal: number | null;
  fxStale: boolean;
  positions: PortfolioPositionItem[];
}

export interface PortfolioSnapshotResponse {
  asOf: string;
  costMethod: PortfolioCostMethod;
  currency: string;
  accountCount: number;
  totalCash: number;
  totalMarketValue: number;
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feeTotal: number;
  taxTotal: number;
  fxStale: boolean;
  fxMissing?: boolean;
  missingFxPairs?: Array<{
    fromCurrency: string;
    toCurrency: string;
  }>;
  assetBreakdown: Record<string, number>;
  tagBreakdown?: PortfolioTagBreakdownItem[];
  accounts: PortfolioAccountSnapshot[];
}

export interface PortfolioConcentrationItem {
  symbol: string;
  marketValueBase: number;
  weightPct: number;
  isAlert: boolean;
}

export interface PortfolioSectorConcentrationItem {
  sector: string;
  marketValueBase: number;
  weightPct: number;
  symbolCount: number;
  isAlert: boolean;
}

export interface PortfolioDrawdownBlock {
  seriesPoints: number;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  alert: boolean;
  fxStale: boolean;
}

export interface PortfolioStopLossItem {
  accountId: number;
  symbol: string;
  avgCost: number;
  lastPrice: number;
  lossPct: number;
  nearThresholdPct: number;
  isTriggered: boolean;
}

export interface PortfolioRiskResponse {
  asOf: string;
  accountId?: number | null;
  costMethod: PortfolioCostMethod;
  currency: string;
  thresholds: Record<string, number>;
  concentration: {
    totalMarketValue: number;
    topWeightPct: number;
    alert: boolean;
    topPositions: PortfolioConcentrationItem[];
  };
  sectorConcentration: {
    totalMarketValue: number;
    topWeightPct: number;
    alert: boolean;
    topSectors: PortfolioSectorConcentrationItem[];
    coverage: Record<string, number>;
    errors: string[];
  };
  drawdown: PortfolioDrawdownBlock;
  stopLoss: {
    nearAlert: boolean;
    triggeredCount: number;
    nearCount: number;
    items: PortfolioStopLossItem[];
  };
}

export interface PortfolioAnalysisRequest {
  accountId?: number;
  asOf?: string;
  costMethod: PortfolioCostMethod;
  snapshotSignature: string;
  mode?: 'standard' | 'quick' | 'deep' | 'wealth_report';
}

export interface PortfolioAnalysisResponse {
  asOf: string;
  snapshotSignature: string;
  generatedAt: string;
  summaryPoints: string[];
  fullMarkdown: string;
  modelUsed?: string | null;
  analysisMode?: 'standard' | 'quick' | 'deep' | 'wealth_report';
  providerStatus?: Array<Record<string, unknown>>;
  analysisSchemaVersion?: number | null;
}

export type PortfolioAnalysisTaskState = 'pending' | 'processing' | 'completed' | 'failed';

export interface PortfolioAnalysisTaskAccepted {
  taskId: string;
  status: PortfolioAnalysisTaskState;
  message: string;
  progress: number;
  existing: boolean;
  canRetry: boolean;
}

export interface PortfolioAnalysisTaskStatus {
  taskId: string;
  status: PortfolioAnalysisTaskState;
  progress: number;
  message?: string | null;
  result?: PortfolioAnalysisResponse | null;
  error?: string | null;
  canRetry: boolean;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface PortfolioAnalysisCurrentTaskResponse {
  task?: PortfolioAnalysisTaskStatus | null;
}

export interface PortfolioAnalysisSavedReportResponse {
  report?: PortfolioAnalysisResponse | null;
}

export interface PortfolioSnapshotRefreshTaskAccepted {
  taskId: string;
  status: PortfolioAnalysisTaskState;
  message: string;
  progress: number;
  existing: boolean;
  canRetry: boolean;
}

export interface PortfolioSnapshotRefreshTaskStatus {
  taskId: string;
  status: PortfolioAnalysisTaskState;
  progress: number;
  message?: string | null;
  result?: PortfolioSnapshotResponse | null;
  error?: string | null;
  canRetry: boolean;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface PortfolioSnapshotRefreshCurrentTaskResponse {
  task?: PortfolioSnapshotRefreshTaskStatus | null;
}

export interface PortfolioTradeCreateRequest {
  accountId: number;
  symbol: string;
  tradeDate: string;
  side: PortfolioSide;
  quantity: number;
  price: number;
  fee?: number;
  tax?: number;
  market?: PortfolioMarket;
  currency?: string;
  tradeUid?: string;
  note?: string;
}

export interface PortfolioCashLedgerCreateRequest {
  accountId: number;
  eventDate: string;
  direction: PortfolioCashDirection;
  amount: number;
  currency?: string;
  note?: string;
}

export interface PortfolioCorporateActionCreateRequest {
  accountId: number;
  symbol: string;
  effectiveDate: string;
  actionType: PortfolioCorporateActionType;
  market?: PortfolioMarket;
  currency?: string;
  cashDividendPerShare?: number;
  splitRatio?: number;
  note?: string;
}

export interface PortfolioEventCreatedResponse {
  id: number;
}

export interface PortfolioManualPriceUpsertRequest {
  accountId: number;
  symbol: string;
  market: PortfolioMarket;
  priceDate: string;
  price: number;
  currency?: string;
  note?: string;
}

export interface PortfolioManualPriceItem {
  id: number;
  accountId: number;
  symbol: string;
  market: string;
  currency: string;
  priceDate: string;
  price: number;
  note?: string | null;
}

export interface PortfolioBankLedgerCreateRequest {
  accountId: number;
  eventDate: string;
  assetKind: PortfolioBankAssetKind;
  direction: PortfolioCashDirection;
  amount: number;
  currency?: string;
  bankName: string;
  productName?: string;
  productCode?: string;
  productPublicCode?: string;
  issuerName?: string;
  registrationCode?: string;
  linkedEntryId?: number;
  quantity?: number;
  unitNav?: number;
  navDate?: string;
  startDate?: string;
  maturityDate?: string;
  annualRate?: number;
  investmentNature?: PortfolioBankInvestmentNature;
  riskLevel?: PortfolioBankRiskLevel;
  incomeMode?: PortfolioBankIncomeMode;
}

export interface PortfolioBankWealthProductItem {
  productCode?: string | null;
  productName: string;
  productPublicCode?: string | null;
  issuerName?: string | null;
  riskLevel?: string | null;
  investmentType?: string | null;
  termType?: string | null;
  redeemable?: string | null;
  benchmark?: string | null;
  managementFee?: string | null;
  custodyFee?: string | null;
  subscriptionFee?: string | null;
}

export interface PortfolioBankWealthProductSearchResponse {
  products: PortfolioBankWealthProductItem[];
}

export interface PortfolioBankWealthNavResponse {
  unitNav?: number | null;
  navDate?: string | null;
  changePct?: number | null;
  source: string;
}

export interface PortfolioAdvisoryProductItem {
  strategyCode: string;
  productName: string;
  productType: PortfolioAdvisoryProductType;
  riskLevel?: string | null;
  managerName?: string | null;
  establishedDate?: string | null;
  recommendedHoldingDuration?: string | null;
  latestNav?: number | null;
  latestNavDate?: string | null;
  dailyReturn?: string | null;
  weeklyReturn?: string | null;
  monthlyReturn?: string | null;
  yearlyReturn?: string | null;
  annualizedReturn?: string | null;
  maxDrawdown?: string | null;
  source: string;
}

export interface PortfolioAdvisoryProductSearchResponse {
  products: PortfolioAdvisoryProductItem[];
}

export interface PortfolioAdvisoryNavResponse {
  unitNav?: number | null;
  navDate?: string | null;
  source: string;
}

export interface PortfolioDeleteResponse {
  deleted: number;
}

export interface PortfolioTradeListItem {
  id: number;
  accountId: number;
  tradeUid?: string | null;
  symbol: string;
  market: string;
  currency: string;
  tradeDate: string;
  side: PortfolioSide;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioTradeListResponse {
  items: PortfolioTradeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioCashLedgerListItem {
  id: number;
  accountId: number;
  eventDate: string;
  direction: PortfolioCashDirection;
  amount: number;
  currency: string;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioCashLedgerListResponse {
  items: PortfolioCashLedgerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioBankLedgerListItem {
  id: number;
  accountId: number;
  eventDate: string;
  assetKind: PortfolioBankAssetKind;
  direction: PortfolioCashDirection;
  amount: number;
  currency: string;
  bankName: string;
  productName?: string | null;
  productCode?: string | null;
  productPublicCode?: string | null;
  issuerName?: string | null;
  registrationCode?: string | null;
  linkedEntryId?: number | null;
  quantity?: number | null;
  unitNav?: number | null;
  navDate?: string | null;
  startDate?: string | null;
  maturityDate?: string | null;
  annualRate?: number | null;
  investmentNature?: string | null;
  riskLevel?: string | null;
  incomeMode?: string | null;
  createdAt?: string | null;
}

export interface PortfolioBankLedgerListResponse {
  items: PortfolioBankLedgerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioAdvisoryLedgerCreateRequest {
  accountId: number;
  eventDate: string;
  platform: string;
  productName: string;
  productCode?: string;
  productType: PortfolioAdvisoryProductType;
  eventType: PortfolioAdvisoryEventType;
  amount: number;
  currency?: string;
  riskLevel?: string;
  investmentStyle?: string;
  quantity?: number;
  nav?: number;
  navDate?: string;
  externalStrategyCode?: string;
  dataProvider?: string;
  valuationModel?: string;
  managerName?: string;
  recommendedHoldingDuration?: string;
}

export interface PortfolioAdvisoryLedgerListItem {
  id: number;
  accountId: number;
  eventDate: string;
  platform: string;
  productName: string;
  productCode?: string | null;
  productType: PortfolioAdvisoryProductType | string;
  eventType: PortfolioAdvisoryEventType | string;
  direction?: PortfolioAdvisoryEventType | string;
  amount: number;
  quantity?: number | null;
  nav?: number | null;
  navDate?: string | null;
  currency: string;
  riskLevel?: string | null;
  investmentStyle?: string | null;
  dataProvider?: string | null;
  valuationModel?: string | null;
  managerName?: string | null;
  recommendedHoldingDuration?: string | null;
  createdAt?: string | null;
}

export interface PortfolioAdvisoryLedgerListResponse {
  items: PortfolioAdvisoryLedgerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioInsurancePolicyCreateRequest {
  accountId: number;
  policyName: string;
  insurer?: string;
  policyNo?: string;
  insuranceKind?: PortfolioInsuranceKind;
  designType?: PortfolioInsuranceDesignType;
  currency?: string;
  status?: PortfolioInsuranceStatus;
  paymentMode?: PortfolioInsurancePaymentMode;
  premiumPerPeriod?: number;
  firstPaymentDate?: string;
  totalPeriods?: number;
  note?: string;
}

export interface PortfolioInsurancePolicyItem {
  id: number;
  accountId: number;
  policyName: string;
  insurer?: string | null;
  policyNo?: string | null;
  insuranceKind?: string | null;
  designType?: string | null;
  currency: string;
  status: PortfolioInsuranceStatus;
  paymentMode: PortfolioInsurancePaymentMode;
  premiumPerPeriod?: number | null;
  firstPaymentDate?: string | null;
  totalPeriods?: number | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PortfolioInsurancePolicyListResponse {
  policies: PortfolioInsurancePolicyItem[];
}

export interface PortfolioInsuranceLedgerCreateRequest {
  accountId: number;
  policyId: number;
  eventDate: string;
  eventType: PortfolioInsuranceEventType;
  amount: number;
  currency?: string;
  periodNo?: number;
  note?: string;
}

export interface PortfolioInsuranceLedgerListItem {
  id: number;
  accountId: number;
  policyId: number;
  eventDate: string;
  eventType: PortfolioInsuranceEventType;
  amount: number;
  currency: string;
  periodNo?: number | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioInsuranceLedgerListResponse {
  items: PortfolioInsuranceLedgerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioCorporateActionListItem {
  id: number;
  accountId: number;
  symbol: string;
  market: string;
  currency: string;
  effectiveDate: string;
  actionType: PortfolioCorporateActionType;
  cashDividendPerShare?: number | null;
  splitRatio?: number | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioCorporateActionListResponse {
  items: PortfolioCorporateActionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioImportTradeItem {
  tradeDate: string;
  symbol: string;
  side: PortfolioSide;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  tradeUid?: string | null;
  dedupHash: string;
  currency?: string | null;
}

export interface PortfolioImportParseResponse {
  broker: string;
  recordCount: number;
  skippedCount: number;
  errorCount: number;
  records: PortfolioImportTradeItem[];
  errors: string[];
}

export interface PortfolioImportCommitResponse {
  accountId: number;
  recordCount: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  dryRun: boolean;
  errors: string[];
}

export interface PortfolioImportBrokerItem {
  broker: string;
  aliases: string[];
  displayName?: string;
}

export interface PortfolioImportBrokerListResponse {
  brokers: PortfolioImportBrokerItem[];
}

export interface PortfolioFxRefreshResponse {
  asOf: string;
  accountCount: number;
  refreshEnabled?: boolean;
  disabledReason?: string | null;
  pairCount: number;
  updatedCount: number;
  staleCount: number;
  errorCount: number;
}
