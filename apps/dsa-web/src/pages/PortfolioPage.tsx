import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tag } from 'lucide-react';
import { portfolioApi } from '../api/portfolio';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Card, Badge, ConfirmDialog, Drawer, EmptyState, InlineAlert, ToastViewport } from '../components/common';
import { useFundIndex } from '../hooks/useFundIndex';
import { useStockIndex } from '../hooks/useStockIndex';
import { toDateInputValue } from '../utils/format';
import type {
  PortfolioAccountItem,
  PortfolioAdvisoryEventType,
  PortfolioAdvisoryLedgerListItem,
  PortfolioAdvisoryProductType,
  PortfolioAnalysisResponse,
  PortfolioBankAssetKind,
  PortfolioBankWealthProductItem,
  PortfolioBankIncomeMode,
  PortfolioBankInvestmentNature,
  PortfolioBankLedgerListItem,
  PortfolioBankRiskLevel,
  PortfolioCashDirection,
  PortfolioCashLedgerListItem,
  PortfolioCorporateActionListItem,
  PortfolioCorporateActionType,
  PortfolioCostMethod,
  PortfolioFxRefreshResponse,
  PortfolioImportBrokerItem,
  PortfolioImportCommitResponse,
  PortfolioImportParseResponse,
  PortfolioInsuranceEventType,
  PortfolioInsuranceLedgerListItem,
  PortfolioInsuranceDesignType,
  PortfolioInsuranceKind,
  PortfolioInsurancePaymentMode,
  PortfolioInsurancePolicyItem,
  PortfolioMarket,
  PortfolioPositionItem,
  PortfolioSide,
  PortfolioSnapshotResponse,
  PortfolioTagItem,
  PortfolioTradeListItem,
} from '../types/portfolio';

const DEFAULT_PAGE_SIZE = 20;
const PORTFOLIO_ANALYSIS_CACHE_PREFIX = 'dsa_portfolio_analysis';
const FALLBACK_BROKERS: PortfolioImportBrokerItem[] = [
  { broker: 'huatai', aliases: [], displayName: '华泰' },
  { broker: 'citic', aliases: ['zhongxin'], displayName: '中信' },
  { broker: 'cmb', aliases: ['cmbchina', 'zhaoshang'], displayName: '招商' },
];

type AccountOption = 'all' | number;
type EventType = 'trade' | 'cash' | 'corporate' | 'bank' | 'advisory' | 'insurance';
type EntryPanelType = 'trade' | 'cash' | 'corporate' | 'manualPrice' | 'bank' | 'bankNav' | 'advisory' | 'advisoryNav' | 'insurancePolicy' | 'insuranceLedger';

type FlatPosition = PortfolioPositionItem & {
  accountId: number;
  accountName: string;
};

type BankPositionOption = FlatPosition & {
  optionValue: string;
};

type BankWealthAction = 'buy' | 'append' | 'redeem';
type AdvisoryFormEventType = PortfolioAdvisoryEventType | 'append_buy';

type AdvisoryLedgerPayloadDraft =
  | { error: string }
  | { amount: number; product?: BankPositionOption };

type PendingDelete =
  | { eventType: 'trade'; id: number; message: string }
  | { eventType: 'cash'; id: number; message: string }
  | { eventType: 'corporate'; id: number; message: string }
  | { eventType: 'bank'; id: number; message: string }
  | { eventType: 'advisory'; id: number; message: string }
  | { eventType: 'insurance'; id: number; message: string };

type FxRefreshFeedback = {
  tone: 'neutral' | 'success' | 'warning';
  text: string;
};

type FxRefreshContext = {
  viewKey: string;
  requestId: number;
};

type PortfolioAlertVariant = 'info' | 'success' | 'warning' | 'danger';

type PortfolioToast = {
  id: number;
  title: string;
  message: string;
};

type AssetBreakdownView = 'tag' | 'type';

type ActiveTagTarget = {
  productKey: string;
  row: FlatPosition;
};

type InsuranceEventOption = {
  value: PortfolioInsuranceEventType;
  label: string;
};

const PORTFOLIO_ANALYSIS_DESCRIPTION = '整合本地持仓快照、风险指标和基金/投顾适用的盈米专项结果，生成一份资产分析报告。';

const INSURANCE_TERMINAL_STATUS_VALUES = new Set(['surrendered', 'matured', 'expired', 'cancelled']);

type AssetNameMaps = {
  stockByCode: Map<string, string>;
  stockAssetTypeByCode: Map<string, string>;
  fundByCode: Map<string, string>;
};

const PORTFOLIO_INPUT_CLASS =
  'input-surface input-focus-glow h-9 w-full rounded-lg border bg-transparent px-3 text-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const PORTFOLIO_SELECT_CLASS = `${PORTFOLIO_INPUT_CLASS} appearance-none pr-10`;
const PORTFOLIO_FILE_PICKER_CLASS =
  'input-surface input-focus-glow flex h-9 w-full cursor-pointer items-center justify-center rounded-lg border bg-transparent px-3 text-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const PORTFOLIO_FIELD_LABEL_CLASS = 'mb-1.5 block text-[11px] font-medium leading-none text-secondary';
const PORTFOLIO_FORM_CLASS = 'space-y-2';
const PORTFOLIO_ENTRY_FORM_CLASS = 'max-w-5xl space-y-2';
const PORTFOLIO_FORM_GRID_CLASS = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-4';
const PORTFOLIO_FORM_GRID_8_CLASS = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-8';
const PORTFOLIO_FORM_GRID_2_CLASS = 'grid gap-2 md:grid-cols-2';
const PORTFOLIO_FORM_ACTION_CLASS = 'btn-secondary h-9 w-full self-end whitespace-nowrap !px-3 !py-1.5 text-sm';
const PORTFOLIO_FORM_TEXT_ACTION_CLASS =
  'h-9 w-full cursor-pointer text-left text-[11px] font-medium leading-none text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-60';
const PORTFOLIO_FORM_SPAN_2_CLASS = 'md:col-span-2';
const PORTFOLIO_FORM_SPAN_4_CLASS = 'lg:col-span-4';
const BANK_WEALTH_SEARCH_TIMEOUT_MS = 15000;
const PORTFOLIO_ASSET_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--color-purple))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(212 78% 54%)',
  'hsl(169 68% 42%)',
  'hsl(326 62% 58%)',
  'hsl(24 84% 56%)',
];

function PortfolioField({
  label,
  action,
  className = '',
  children,
}: {
  label: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className={`${PORTFOLIO_FIELD_LABEL_CLASS} flex items-center justify-between gap-2`}>
        <span>{label}</span>
        {action ? <span>{action}</span> : null}
      </span>
      {children}
    </label>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getTodayIso(): string {
  return toDateInputValue(new Date());
}

function formatMoney(value: number | undefined | null, currency = 'CNY'): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${currency} ${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPositionListMoney(value: number | undefined | null, currency = 'CNY'): string {
  if (value == null || Number.isNaN(value)) return '--';
  const amount = Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'USD' ? `USD ${amount}` : amount;
}

function formatMissingFxPairs(snapshot: PortfolioSnapshotResponse | null): string {
  const pairs = snapshot?.missingFxPairs || [];
  if (pairs.length === 0) return '';
  return pairs.map((pair) => `${pair.fromCurrency}/${pair.toCurrency}`).join('、');
}

function formatAggregateMoney(snapshot: PortfolioSnapshotResponse | null, value: number | undefined | null): string {
  if (snapshot?.fxMissing) return '不可计算';
  return formatMoney(value, snapshot?.currency || 'CNY');
}

function formatPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
}

function formatSignedPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function getTagButtonStyle(row: PortfolioPositionItem): React.CSSProperties | undefined {
  if (!row.tagColor) return undefined;
  return {
    color: row.tagColor,
    borderColor: row.tagColor,
  };
}

function hasPositionPrice(row: PortfolioPositionItem): boolean {
  return row.priceAvailable !== false && row.priceSource !== 'missing';
}

function isBankWealthPosition(row: PortfolioPositionItem): boolean {
  return row.market === 'bank' && Boolean(row.symbol?.startsWith('BANK:W:'));
}

function isBankWealthNavPosition(row: PortfolioPositionItem): boolean {
  if (!isBankWealthPosition(row)) return false;
  const units = row.wealthUnits ?? row.quantity;
  return Number.isFinite(units) && units > 0;
}

function formatPositionPrice(row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  if (row.priceDisplayValue != null) {
    if (row.valuationModel === 'amount_value' || row.valuationModel === 'insurance_cash_value') {
      return formatPositionListMoney(row.priceDisplayValue, row.valuationCurrency);
    }
    return Number(row.priceDisplayValue).toFixed(4);
  }
  if (row.market === 'advisory') return formatPositionListMoney(row.marketValueBase, row.valuationCurrency);
  if (isBankWealthPosition(row) && !isBankWealthNavPosition(row)) return formatPositionListMoney(row.marketValueBase, row.valuationCurrency);
  return row.lastPrice.toFixed(4);
}

function formatAssetQuantity(
  value: number | undefined | null,
  market?: string,
  maximumFractionDigitsOverride?: number,
): string {
  if (value == null || Number.isNaN(value)) return '--';
  const maximumFractionDigits = maximumFractionDigitsOverride ?? (market === 'crypto' ? 8 : 4);
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function parsePositiveFormNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPositionQuantity(row: PortfolioPositionItem): string {
  if (row.market === 'advisory') return '-';
  if (row.market === 'bank' && !isBankWealthNavPosition(row)) return '-';
  return formatAssetQuantity(row.quantity, row.market, 2);
}

function formatPositionQuantityTitle(row: PortfolioPositionItem): string {
  if (row.market === 'advisory') return '无份额概念';
  if (row.market === 'bank' && !isBankWealthNavPosition(row)) return '无份额概念';
  return formatAssetQuantity(row.quantity, row.market);
}

function formatPositionCostPrice(row: PortfolioPositionItem): string {
  if (row.costDisplayValue != null) {
    if (row.valuationModel === 'amount_value' || row.valuationModel === 'insurance_cash_value') {
      return formatPositionListMoney(row.costDisplayValue, row.valuationCurrency);
    }
    return Number(row.costDisplayValue).toFixed(4);
  }
  if (row.market === 'advisory') return formatPositionListMoney(row.totalCost || row.avgCost, row.valuationCurrency);
  if (isBankWealthPosition(row) && !isBankWealthNavPosition(row)) return formatPositionListMoney(row.totalCost || row.avgCost, row.valuationCurrency);
  if (row.market === 'bank' && !isBankWealthPosition(row)) return formatPositionListMoney(row.totalCost || row.avgCost, row.valuationCurrency);
  return row.avgCost.toFixed(4);
}

function formatTradeQuantity(item: PortfolioTradeListItem): string {
  return formatAssetQuantity(item.quantity, item.market);
}

function formatPositionMoney(value: number, row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return formatPositionListMoney(value, row.valuationCurrency);
}

function getChinaPnlColorClass(value: number | undefined | null, hasValue: boolean): string {
  if (!hasValue || value == null || Number.isNaN(value) || value === 0) return 'text-secondary';
  return value > 0 ? 'text-danger' : 'text-success';
}

function getPositionPriceLabel(row: PortfolioPositionItem): string {
  if (row.priceSource === 'manual_price') {
    if (row.market === 'bank') return row.priceDate ? `价值更新 · ${row.priceDate}` : '价值更新';
    if (row.market === 'advisory') return row.priceDate ? `价值更新 · ${row.priceDate}` : '价值更新';
    return row.market === 'fund' ? '手工净值' : '手工价格';
  }
  if (row.priceSource === 'advisory_value_update') return row.priceDate ? `价值更新 · ${row.priceDate}` : '价值更新';
  if (row.priceSource === 'advisory_net_invested_estimate') return '流水金额';
  if (row.priceSource === 'bank_value_update') return row.priceDate ? `价值更新 · ${row.priceDate}` : '价值更新';
  if (row.priceSource === 'bank_net_invested_estimate') return '流水金额';
  if (row.priceSource === 'bank_cost_nav') return row.priceDate ? `成本净值 · ${row.priceDate}` : '成本净值';
  if (row.priceSource === 'bank_wealth_nav') return row.priceDate ? `理财净值 · ${row.priceDate}` : '理财净值';
  if (row.priceSource === 'insurance_value_update') return row.priceDate ? `保单价值 · ${row.priceDate}` : '保单价值';
  if (row.priceSource === 'insurance_no_value') return '待录入价值';
  if (row.priceSource === 'insurance_net_invested') return '净投入暂估';
  if (row.priceSource === 'fund_nav') return row.priceDate ? `基金净值 · ${row.priceDate}` : '基金净值';
  if (row.priceSource === 'crypto_price') return row.priceProvider ? `数字货币价格 · ${row.priceProvider}` : '数字货币价格';
  if (row.priceSource === 'manual_amount') return '手工金额';
  if (!hasPositionPrice(row)) return '缺价';
  if (row.priceSource === 'realtime_quote') {
    return row.priceProvider ? `实时价 · ${row.priceProvider}` : '实时价';
  }
  if (row.priceSource === 'history_close') {
    return row.priceStale && row.priceDate ? `收盘价 · ${row.priceDate}` : '收盘价';
  }
  return row.priceSource || '未知来源';
}

function formatSideLabel(value: PortfolioSide): string {
  return value === 'buy' ? '买入' : '卖出';
}

function formatCashDirectionLabel(value: PortfolioCashDirection): string {
  return value === 'in' ? '流入' : '流出';
}

function formatCorporateActionLabel(value: PortfolioCorporateActionType): string {
  return value === 'cash_dividend' ? '现金分红' : '拆并股调整';
}

function formatMarketLabel(value: string): string {
  const labels: Record<string, string> = {
    cn: 'A 股',
    hk: '港股',
    us: '美股',
    fund: '场外基金',
    crypto: '数字货币',
    bank: '银行',
    advisory: '投顾组合',
    insurance: '保险',
    stock: '股票',
    cash: '现金',
  };
  return labels[value] || value;
}

function getDefaultCurrencyForMarket(market: PortfolioMarket): string {
  if (market === 'hk') return 'HKD';
  if (market === 'us' || market === 'crypto') return 'USD';
  return 'CNY';
}

function isStockMarket(market?: string): boolean {
  return market === 'cn' || market === 'hk' || market === 'us';
}

function formatBankAssetKind(value: PortfolioBankAssetKind | string): string {
  if (value === 'deposit' || value === 'term') return '定期存款';
  if (value === 'wealth') return '银行理财';
  return '活期/现金';
}

function formatBankInvestmentNature(value?: string | null): string {
  const labels: Record<string, string> = {
    fixed_income: '固定收益类',
    mixed: '混合类',
    equity: '权益类',
    commodity_derivative: '商品及金融衍生品类',
    cash_management: '现金管理类',
    other: '其他',
  };
  return value ? labels[value] || value : '';
}

function formatBankIncomeMode(value?: string | null): string {
  if (value === 'dividend') return '派息';
  if (value === 'reinvest') return '滚存';
  return value || '';
}

function getPositionDisplayName(row: PortfolioPositionItem): string {
  if (row.market === 'advisory') {
    return row.productName || row.displayName || row.productCode || row.symbol;
  }
  if (row.market === 'insurance') {
    return row.policyName || row.displayName || row.symbol;
  }
  if (row.market === 'bank') {
    return row.productName || row.bankName || row.symbol;
  }
  return row.symbol;
}

function formatAdvisoryProductTypeLabel(value?: string | null): string {
  if (value === 'dca_plan') return '定投计划';
  return '投顾组合';
}

function formatAdvisoryEventLabel(value?: string | null): string {
  const labels: Record<string, string> = {
    buy: '买入',
    append_buy: '追加买入',
    initial_buy: '首次买入',
    dca_buy: '跟投',
    follow_buy: '跟投',
    redeem: '赎回/止盈',
  };
  return value ? labels[value] || value : '';
}

function formatInsuranceKind(value?: string | null): string {
  const labels: Record<string, string> = {
    annuity: '年金险',
    whole_life: '终身寿险',
    endowment: '两全保险',
    universal: '万能险',
    unit_linked: '投连险',
    other: '其他保险',
  };
  return value ? labels[value] || value : '';
}

function formatInsuranceDesignType(value?: string | null): string {
  const labels: Record<string, string> = {
    ordinary: '普通型',
    participating: '分红型',
    universal: '万能型',
    unit_linked: '投资连结型',
    other: '其他',
  };
  return value ? labels[value] || value : '';
}

function formatInsurancePaymentMode(value?: string | null): string {
  const labels: Record<string, string> = {
    single: '趸交',
    annual: '年交',
    semiannual: '半年交',
    quarterly: '季交',
    monthly: '月交',
    irregular: '不定期',
  };
  return value ? labels[value] || value : '';
}

function formatInsuranceEventType(value?: string | null): string {
  const labels: Record<string, string> = {
    premium: '缴费',
    value_update: '价值更新',
    survival_benefit: '生存金',
    annuity_payment: '年金领取',
    maturity_benefit: '满期金',
    dividend: '分红',
    partial_withdrawal: '部分领取',
    surrender: '退保到账',
    refund: '退费',
    other_inflow: '其他返还',
    other_outflow: '其他支出',
  };
  return value ? labels[value] || value : '';
}

function isTerminalInsuranceStatus(value?: string | null): boolean {
  return INSURANCE_TERMINAL_STATUS_VALUES.has(String(value || '').trim().toLowerCase());
}

function getInsuranceEventOptions(policy?: PortfolioInsurancePolicyItem | null): InsuranceEventOption[] {
  const options: InsuranceEventOption[] = [];
  if (!policy) return options;

  const kind = String(policy.insuranceKind || 'other').trim().toLowerCase();
  const designType = String(policy.designType || 'ordinary').trim().toLowerCase();
  const status = String(policy.status || 'active').trim().toLowerCase();

  if (isTerminalInsuranceStatus(status)) return options;

  if (status !== 'paid_up') {
    options.push({ value: 'premium', label: '缴费' });
  }
  options.push({ value: 'value_update', label: '价值更新' });
  if (['annuity', 'endowment'].includes(kind)) {
    options.push({ value: 'survival_benefit', label: '生存金' });
  }
  if (kind === 'annuity') {
    options.push({ value: 'annuity_payment', label: '年金领取' });
  }
  if (kind === 'endowment') {
    options.push({ value: 'maturity_benefit', label: '满期金' });
  }
  if (designType === 'participating') {
    options.push({ value: 'dividend', label: '分红' });
  }
  if (['whole_life', 'universal', 'unit_linked'].includes(kind) || ['universal', 'unit_linked'].includes(designType)) {
    options.push({ value: 'partial_withdrawal', label: '部分领取' });
  }
  options.push(
    { value: 'surrender', label: '退保到账' },
    { value: 'refund', label: '退费' },
    { value: 'other_inflow', label: '其他返还' },
    { value: 'other_outflow', label: '其他支出' },
  );
  return options;
}

function getDefaultInsuranceEventType(policy?: PortfolioInsurancePolicyItem | null): PortfolioInsuranceEventType {
  return getInsuranceEventOptions(policy)[0]?.value || 'value_update';
}

function formatAdvisoryPositionOption(row: PortfolioPositionItem): string {
  const title = getPositionDisplayName(row);
  const details = [
    formatAdvisoryProductTypeLabel(row.productType),
    row.platform,
    row.productCode,
    row.riskLevel,
    row.investmentStyle,
    `价值 ${formatMoney(row.marketValueBase, row.valuationCurrency)}`,
  ].filter(Boolean);
  return `${title}${details.length ? ` · ${details.join(' · ')}` : ''}`;
}

function formatBankPositionOption(row: PortfolioPositionItem): string {
  const title = getPositionDisplayName(row);
  const details = [
    row.bankName,
    row.issuerName,
    row.productPublicCode,
    row.registrationCode,
    row.startDate && row.maturityDate ? `${row.startDate} 至 ${row.maturityDate}` : row.startDate || row.maturityDate,
    row.annualRate != null ? `年化 ${row.annualRate}%` : '',
    `价值 ${formatMoney(row.marketValueBase, row.valuationCurrency)}`,
  ].filter(Boolean);
  return `${title}${details.length ? ` · ${details.join(' · ')}` : ''}`;
}

function getTradeQuantityPlaceholder(
  market: PortfolioMarket | undefined,
  side: PortfolioSide,
): string {
  if (market === 'fund') return side === 'buy' ? '申购确认份额' : '赎回份额';
  if (market === 'crypto') return '成交数量（币）';
  return '成交数量（股）';
}

function getTradePricePlaceholder(market: PortfolioMarket | undefined): string {
  if (market === 'fund') return '成交净值（每份）';
  if (market === 'crypto') return '成交价（USD/币）';
  return '成交价（每股）';
}

function getBankAmountPlaceholder(
  assetKind: PortfolioBankAssetKind,
  direction: PortfolioCashDirection,
  wealthAction?: BankWealthAction,
): string {
  if (assetKind === 'wealth') {
    if (wealthAction === 'append') return '追加投入金额';
    return direction === 'out' ? '赎回到账金额' : '买入支付金额';
  }
  if (assetKind === 'deposit') return direction === 'out' ? '取出本金金额' : '存入本金金额';
  return direction === 'out' ? '取出金额' : '存入金额';
}

function getBankSubmitLabel(
  assetKind: PortfolioBankAssetKind,
  direction: PortfolioCashDirection,
  wealthAction?: BankWealthAction,
): string {
  if (assetKind === 'wealth') {
    if (wealthAction === 'append') return '提交理财追加';
    return direction === 'out' ? '提交理财赎回' : '提交理财买入';
  }
  if (assetKind === 'deposit') return direction === 'out' ? '提交定期取出' : '提交定期存入';
  return direction === 'out' ? '提交活期取出' : '提交活期存入';
}

function getBankSuccessTitle(
  assetKind: PortfolioBankAssetKind,
  direction: PortfolioCashDirection,
  wealthAction?: BankWealthAction,
): string {
  if (assetKind === 'wealth') {
    if (wealthAction === 'append') return '理财追加已记录';
    return direction === 'out' ? '理财赎回已记录' : '理财买入已记录';
  }
  if (assetKind === 'deposit') return direction === 'out' ? '定期取出已记录' : '定期存入已记录';
  return direction === 'out' ? '活期取出已记录' : '活期存入已记录';
}

function getBankProductRequiredMessage(
  assetKind: PortfolioBankAssetKind,
  wealthAction: BankWealthAction,
): string {
  if (assetKind === 'deposit') return '请先选择要取出的定期产品。';
  if (wealthAction === 'append') return '请先选择要追加的理财产品。';
  return '请先选择要赎回的理财产品。';
}

function normalizeBankRiskLevel(value?: string | null): '' | PortfolioBankRiskLevel {
  const text = String(value || '').toUpperCase();
  if (text.includes('R2') || text.includes('较低风险')) return 'R2';
  if (text.includes('R1') || text.includes('低风险')) return 'R1';
  if (text.includes('R3') || text.includes('中风险')) return 'R3';
  if (text.includes('R4') || text.includes('较高风险')) return 'R4';
  if (text.includes('R5') || text.includes('高风险')) return 'R5';
  return '';
}

function normalizeBankInvestmentNature(value?: string | null): '' | PortfolioBankInvestmentNature {
  const text = String(value || '');
  if (text.includes('固定收益')) return 'fixed_income';
  if (text.includes('混合')) return 'mixed';
  if (text.includes('权益')) return 'equity';
  if (text.includes('衍生')) return 'commodity_derivative';
  if (text.includes('现金')) return 'cash_management';
  return '';
}

function getBankWealthCandidateKey(product: PortfolioBankWealthProductItem, index: number): string {
  return `${product.productCode || ''}|${product.productPublicCode || ''}|${product.productName}|${index}`;
}

function getCodeCandidates(symbol: string): string[] {
  const raw = String(symbol || '').trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  const compact = upper.replace(/\s+/g, '');
  const noSuffix = compact.replace(/\.(SH|SZ|BJ|HK|US)$/i, '');
  const noPrefix = compact.replace(/^(SH|SZ|BJ)/i, '');
  const hkDigits = compact.startsWith('HK') ? compact.slice(2) : noSuffix;
  const candidates = [
    compact,
    noSuffix,
    noPrefix,
    hkDigits,
    hkDigits ? `HK${hkDigits.padStart(5, '0')}` : '',
    hkDigits ? `${hkDigits.padStart(5, '0')}.HK` : '',
    noSuffix ? `${noSuffix}.SH` : '',
    noSuffix ? `${noSuffix}.SZ` : '',
    noSuffix ? `${noSuffix}.BJ` : '',
  ];
  return Array.from(new Set(candidates.filter(Boolean)));
}

function getPositionSecondaryName(row: PortfolioPositionItem, assetNameMaps: AssetNameMaps): string {
  if (row.market === 'advisory') {
    return [
      formatAdvisoryProductTypeLabel(row.productType),
      row.platform,
      row.productCode,
      row.riskLevel,
      row.investmentStyle,
      row.investedAmount != null ? `投入 ${formatMoney(row.investedAmount, row.currency)}` : '',
      row.redeemedAmount != null && row.redeemedAmount > 0 ? `赎回 ${formatMoney(row.redeemedAmount, row.currency)}` : '',
    ].filter(Boolean).join(' · ');
  }
  if (row.market === 'insurance') {
    return [
      row.insurer,
      formatInsuranceKind(row.insuranceKind),
      formatInsuranceDesignType(row.designType),
      formatInsurancePaymentMode(row.paymentMode),
      row.nextPaymentDate ? `下次缴费 ${row.nextPaymentDate}` : '',
      row.valueEstimated ? '按净投入暂估' : '',
    ].filter(Boolean).join(' · ');
  }
  if (row.market === 'bank') {
    const hints = [
      row.bankName,
      row.registrationCode,
      row.riskLevel,
      formatBankInvestmentNature(row.investmentNature),
      formatBankIncomeMode(row.incomeMode),
    ].filter(Boolean);
    return hints.join(' · ');
  }
  if (row.displayName) return row.displayName;
  const candidates = getCodeCandidates(row.symbol);
  if (row.market === 'fund') {
    for (const code of candidates) {
      const name = assetNameMaps.fundByCode.get(code);
      if (name) return name;
    }
    return '';
  }
  if (row.market === 'cn' || row.market === 'hk' || row.market === 'us') {
    for (const code of candidates) {
      const name = assetNameMaps.stockByCode.get(code);
      if (name) return name;
    }
    for (const code of candidates) {
      const name = assetNameMaps.fundByCode.get(code);
      if (name) return name;
    }
  }
  return '';
}

function getPositionSecondaryLine(row: PortfolioPositionItem, assetNameMaps: AssetNameMaps): string {
  const secondaryName = getPositionSecondaryName(row, assetNameMaps);
  return [
    secondaryName,
    row.startDate ? `起息 ${row.startDate}` : '',
    row.maturityDate ? `到期 ${row.maturityDate}` : '',
    row.annualRate != null ? `年化 ${row.annualRate}%` : '',
  ].filter(Boolean).join(' · ');
}

function isExchangeTradedFundName(name: string | undefined): boolean {
  return Boolean(name && /(ETF|LOF|REIT|封闭式|场内)/i.test(name));
}

function getPositionAssetType(row: PortfolioPositionItem, assetNameMaps: AssetNameMaps): string {
  if (row.market === 'advisory') return formatAdvisoryProductTypeLabel(row.productType);
  if (row.market === 'insurance') return '保险';
  if (row.market === 'bank') {
    if (row.registrationCode) return '银行理财';
    return row.maturityDate ? '定期存款' : '活期/现金';
  }
  if (row.market === 'fund') return formatMarketLabel(row.market);
  const candidates = getCodeCandidates(row.symbol);
  for (const code of candidates) {
    const fundName = assetNameMaps.fundByCode.get(code);
    if (assetNameMaps.stockAssetTypeByCode.get(code) === 'etf' || isExchangeTradedFundName(fundName)) {
      return 'ETF';
    }
  }
  return formatMarketLabel(row.market);
}

function buildSnapshotSignature(snapshot: PortfolioSnapshotResponse | null, selectedAccount: AccountOption, costMethod: PortfolioCostMethod): string {
  if (!snapshot) return '';
  const payload = {
    selectedAccount,
    costMethod,
    asOf: snapshot.asOf,
    currency: snapshot.currency,
    totalCash: snapshot.totalCash,
    totalMarketValue: snapshot.totalMarketValue,
    totalEquity: snapshot.totalEquity,
    fxStale: snapshot.fxStale,
    fxMissing: snapshot.fxMissing,
    positions: (snapshot.accounts || []).flatMap((account) =>
      (account.positions || []).map((position) => ({
        accountId: account.accountId,
        symbol: position.symbol,
        market: position.market,
        currency: position.currency,
        quantity: position.quantity,
        lastPrice: position.lastPrice,
        marketValueBase: position.marketValueBase,
        priceDate: position.priceDate,
        priceSource: position.priceSource,
      })),
    ),
  };
  const text = JSON.stringify(payload);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1:${(hash >>> 0).toString(16)}`;
}

function loadCachedPortfolioAnalysis(cacheKey: string, signature: string): PortfolioAnalysisResponse | null {
  if (!cacheKey || !signature) return null;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PortfolioAnalysisResponse;
    return parsed.snapshotSignature === signature ? parsed : null;
  } catch {
    return null;
  }
}

function saveCachedPortfolioAnalysis(cacheKey: string, value: PortfolioAnalysisResponse): void {
  if (!cacheKey) return;
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(value));
  } catch {
    // Ignore storage quota/private-mode failures; analysis still remains in memory.
  }
}

function formatBrokerLabel(value: string, displayName?: string): string {
  if (displayName && displayName.trim()) return `${value}（${displayName.trim()}）`;
  if (value === 'huatai') return 'huatai（华泰）';
  if (value === 'citic') return 'citic（中信）';
  if (value === 'cmb') return 'cmb（招商）';
  return value;
}

function buildFxRefreshFeedback(data: PortfolioFxRefreshResponse): FxRefreshFeedback {
  if (data.refreshEnabled === false) {
    return {
      tone: 'neutral',
      text: '汇率在线刷新已被禁用。',
    };
  }

  if (data.pairCount === 0) {
    return {
      tone: 'neutral',
      text: '当前范围无可刷新的汇率对。',
    };
  }

  if (data.updatedCount > 0 && data.staleCount === 0 && data.errorCount === 0) {
    return {
      tone: 'success',
      text: `汇率已刷新，共更新 ${data.updatedCount} 对。`,
    };
  }

  const summary = `更新 ${data.updatedCount} 对，仍过期 ${data.staleCount} 对，失败 ${data.errorCount} 对。`;
  if (data.staleCount > 0) {
    return {
      tone: 'warning',
      text: `已尝试刷新，但仍有部分货币对使用 stale/fallback 汇率。${summary}`,
    };
  }

  return {
    tone: 'warning',
    text: `在线刷新未完全成功。${summary}`,
  };
}

function getFxRefreshFeedbackVariant(tone: FxRefreshFeedback['tone']): PortfolioAlertVariant {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  return 'info';
}

function getCsvParseVariant(result: PortfolioImportParseResponse): PortfolioAlertVariant {
  return result.errorCount > 0 || result.skippedCount > 0 ? 'warning' : 'info';
}

function getCsvCommitVariant(result: PortfolioImportCommitResponse, isDryRun: boolean): PortfolioAlertVariant {
  if (isDryRun) return 'info';
  return result.failedCount > 0 || result.duplicateCount > 0 ? 'warning' : 'success';
}

const PortfolioPage: React.FC = () => {
  // Set page title
  useEffect(() => {
    document.title = '持仓分析 - DSA';
  }, []);

  const stockIndex = useStockIndex();
  const fundIndex = useFundIndex();
  const [accounts, setAccounts] = useState<PortfolioAccountItem[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountOption>('all');
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [accountCreating, setAccountCreating] = useState(false);
  const [accountCreateError, setAccountCreateError] = useState<string | null>(null);
  const [accountCreateSuccess, setAccountCreateSuccess] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    name: '',
    broker: '',
    market: 'cn' as PortfolioMarket,
    baseCurrency: 'CNY',
  });
  const [costMethod, setCostMethod] = useState<PortfolioCostMethod>('fifo');
  const [snapshot, setSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<PortfolioAnalysisResponse | null>(null);
  const [portfolioAnalysisLoading, setPortfolioAnalysisLoading] = useState(false);
  const [portfolioAnalysisError, setPortfolioAnalysisError] = useState<ParsedApiError | null>(null);
  const [portfolioAnalysisDrawerOpen, setPortfolioAnalysisDrawerOpen] = useState(false);
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const [fxRefreshFeedback, setFxRefreshFeedback] = useState<FxRefreshFeedback | null>(null);
  const [portfolioToast, setPortfolioToast] = useState<PortfolioToast | null>(null);
  const [portfolioTags, setPortfolioTags] = useState<PortfolioTagItem[]>([]);
  const [tagLoadError, setTagLoadError] = useState<ParsedApiError | null>(null);
  const [activeTagTarget, setActiveTagTarget] = useState<ActiveTagTarget | null>(null);
  const [tagUpdatingKey, setTagUpdatingKey] = useState<string | null>(null);
  const [assetBreakdownView, setAssetBreakdownView] = useState<AssetBreakdownView>('tag');
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [writeWarning, setWriteWarning] = useState<string | null>(null);

  const [brokers, setBrokers] = useState<PortfolioImportBrokerItem[]>([]);
  const [selectedBroker, setSelectedBroker] = useState('huatai');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvDryRun, setCsvDryRun] = useState(true);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvCommitting, setCsvCommitting] = useState(false);
  const [csvParseResult, setCsvParseResult] = useState<PortfolioImportParseResponse | null>(null);
  const [csvCommitResult, setCsvCommitResult] = useState<PortfolioImportCommitResponse | null>(null);
  const [brokerLoadWarning, setBrokerLoadWarning] = useState<string | null>(null);

  const [eventType, setEventType] = useState<EventType>('trade');
  const [eventDateFrom, setEventDateFrom] = useState('');
  const [eventDateTo, setEventDateTo] = useState('');
  const [eventSymbol, setEventSymbol] = useState('');
  const [eventSide, setEventSide] = useState<'' | PortfolioSide>('');
  const [eventDirection, setEventDirection] = useState<'' | PortfolioCashDirection>('');
  const [eventActionType, setEventActionType] = useState<'' | PortfolioCorporateActionType>('');
  const [eventBankAssetKind, setEventBankAssetKind] = useState<'' | PortfolioBankAssetKind>('');
  const [eventAdvisoryDirection, setEventAdvisoryDirection] = useState<'' | PortfolioAdvisoryEventType>('');
  const [eventInsuranceEventType, setEventInsuranceEventType] = useState<'' | PortfolioInsuranceEventType>('');
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventLoading, setEventLoading] = useState(false);
  const [tradeEvents, setTradeEvents] = useState<PortfolioTradeListItem[]>([]);
  const [cashEvents, setCashEvents] = useState<PortfolioCashLedgerListItem[]>([]);
  const [corporateEvents, setCorporateEvents] = useState<PortfolioCorporateActionListItem[]>([]);
  const [bankEvents, setBankEvents] = useState<PortfolioBankLedgerListItem[]>([]);
  const [advisoryEvents, setAdvisoryEvents] = useState<PortfolioAdvisoryLedgerListItem[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<PortfolioInsurancePolicyItem[]>([]);
  const [insuranceEvents, setInsuranceEvents] = useState<PortfolioInsuranceLedgerListItem[]>([]);
  const [showEventFilters, setShowEventFilters] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [activeEntryPanel, setActiveEntryPanel] = useState<EntryPanelType>('trade');

  const [tradeForm, setTradeForm] = useState({
    symbol: '',
    tradeDate: getTodayIso(),
    side: 'buy' as PortfolioSide,
    quantity: '',
    price: '',
    fee: '',
    tax: '',
    tradeUid: '',
    note: '',
  });
  const [cashForm, setCashForm] = useState({
    eventDate: getTodayIso(),
    direction: 'in' as PortfolioCashDirection,
    amount: '',
    currency: '',
    note: '',
  });
  const [corpForm, setCorpForm] = useState({
    symbol: '',
    effectiveDate: getTodayIso(),
    actionType: 'cash_dividend' as PortfolioCorporateActionType,
    cashDividendPerShare: '',
    splitRatio: '',
    note: '',
  });
  const [manualPriceForm, setManualPriceForm] = useState({
    symbol: '',
    priceDate: getTodayIso(),
    price: '',
    note: '',
  });
  const [bankForm, setBankForm] = useState({
    eventDate: getTodayIso(),
    assetKind: 'demand' as PortfolioBankAssetKind,
    direction: 'in' as PortfolioCashDirection,
    wealthAction: 'buy' as BankWealthAction,
    amount: '',
    bankName: '',
    productName: '',
    productCode: '',
    productPublicCode: '',
    issuerName: '',
    registrationCode: '',
    linkedEntryId: '',
    quantity: '',
    nav: '',
    startDate: '',
    maturityDate: '',
    annualRate: '',
    investmentNature: '' as '' | PortfolioBankInvestmentNature,
    riskLevel: '' as '' | PortfolioBankRiskLevel,
    incomeMode: 'reinvest' as PortfolioBankIncomeMode,
  });
  const [bankWealthSearchResults, setBankWealthSearchResults] = useState<PortfolioBankWealthProductItem[]>([]);
  const [bankWealthSearchLoading, setBankWealthSearchLoading] = useState(false);
  const [bankWealthNavLoading, setBankWealthNavLoading] = useState(false);
  const [bankWealthCandidateModalOpen, setBankWealthCandidateModalOpen] = useState(false);
  const [selectedBankWealthCandidateKey, setSelectedBankWealthCandidateKey] = useState('');
  const [bankWealthMatchedProduct, setBankWealthMatchedProduct] = useState<PortfolioBankWealthProductItem | null>(null);
  const [bankNavForm, setBankNavForm] = useState({
    selectedProduct: '',
    priceDate: getTodayIso(),
    price: '',
  });
  const [advisoryForm, setAdvisoryForm] = useState({
    eventDate: getTodayIso(),
    platform: '',
    selectedProduct: '',
    productName: '',
    productCode: '',
    productType: 'advisory_combo' as PortfolioAdvisoryProductType,
    eventType: 'buy' as AdvisoryFormEventType,
    amount: '',
    riskLevel: '',
    investmentStyle: '',
  });
  const [advisoryNavForm, setAdvisoryNavForm] = useState({
    selectedProduct: '',
    priceDate: getTodayIso(),
    price: '',
  });
  const [insurancePolicyForm, setInsurancePolicyForm] = useState({
    policyName: '',
    insurer: '',
    policyNo: '',
    insuranceKind: 'annuity' as PortfolioInsuranceKind,
    designType: 'ordinary' as PortfolioInsuranceDesignType,
    paymentMode: 'annual' as PortfolioInsurancePaymentMode,
    premiumPerPeriod: '',
    firstPaymentDate: getTodayIso(),
    totalPeriods: '',
    note: '',
  });
  const [insuranceLedgerForm, setInsuranceLedgerForm] = useState({
    policyId: '',
    eventDate: getTodayIso(),
    eventType: 'premium' as PortfolioInsuranceEventType,
    amount: '',
    periodNo: '',
    note: '',
  });

  const queryAccountId = selectedAccount === 'all' ? undefined : selectedAccount;
  const refreshViewKey = `${selectedAccount === 'all' ? 'all' : `account:${selectedAccount}`}:cost:${costMethod}`;
  const refreshContextRef = useRef<FxRefreshContext>({ viewKey: refreshViewKey, requestId: 0 });
  const hasAccounts = accounts.length > 0;
  const writableAccount = selectedAccount === 'all' ? undefined : accounts.find((item) => item.id === selectedAccount);
  const writableAccountId = writableAccount?.id;
  const writeBlocked = !writableAccountId;
  const selectedMarket = writableAccount?.market;
  const isStockAccount = isStockMarket(selectedMarket);
  const isFundAccount = selectedMarket === 'fund';
  const isCryptoAccount = selectedMarket === 'crypto';
  const isBankAccount = selectedMarket === 'bank';
  const isAdvisoryAccount = selectedMarket === 'advisory';
  const isInsuranceAccount = selectedMarket === 'insurance';
  const supportsCashLedger = isStockAccount || isFundAccount || isCryptoAccount || isAdvisoryAccount;
  const quantityStep = isCryptoAccount ? '0.00000001' : '0.0001';
  const missingFxPairsText = formatMissingFxPairs(snapshot);
  const snapshotSignature = useMemo(
    () => buildSnapshotSignature(snapshot, selectedAccount, costMethod),
    [costMethod, selectedAccount, snapshot],
  );
  const portfolioAnalysisCacheKey = snapshotSignature
    ? `${PORTFOLIO_ANALYSIS_CACHE_PREFIX}:${selectedAccount === 'all' ? 'all' : selectedAccount}:${costMethod}:standard:${snapshotSignature}`
    : '';
  const portfolioAnalysisButtonLabel = portfolioAnalysis
    ? '重新生成报告'
    : '生成资产分析报告';
  const assetNameMaps = useMemo<AssetNameMaps>(() => {
    const stockByCode = new Map<string, string>();
    const stockAssetTypeByCode = new Map<string, string>();
    for (const item of stockIndex.index) {
      const canonicalCode = item.canonicalCode.toUpperCase();
      const displayCode = item.displayCode.toUpperCase();
      if (item.nameZh) {
        stockByCode.set(canonicalCode, item.nameZh);
        stockByCode.set(displayCode, item.nameZh);
      }
      stockAssetTypeByCode.set(canonicalCode, item.assetType);
      stockAssetTypeByCode.set(displayCode, item.assetType);
    }
    const fundByCode = new Map<string, string>();
    for (const item of fundIndex.index) {
      if (item.fundCode && item.fundName) {
        fundByCode.set(item.fundCode.toUpperCase(), item.fundName);
      }
    }
    return { stockByCode, stockAssetTypeByCode, fundByCode };
  }, [fundIndex.index, stockIndex.index]);
  const totalEventPages = Math.max(1, Math.ceil(eventTotal / DEFAULT_PAGE_SIZE));
  const currentEventCount = eventType === 'trade'
    ? tradeEvents.length
    : eventType === 'cash'
      ? cashEvents.length
      : eventType === 'corporate'
        ? corporateEvents.length
        : eventType === 'bank'
          ? bankEvents.length
          : eventType === 'advisory'
            ? advisoryEvents.length
            : insuranceEvents.length;
  const entryPanelOptions = [
    ...((isStockAccount || isFundAccount || isCryptoAccount)
      ? [{ value: 'trade' as const, label: isFundAccount ? '基金' : isCryptoAccount ? '买卖' : '交易' }]
      : []),
    ...(supportsCashLedger
      ? [{ value: 'cash' as const, label: '资金' }]
      : []),
    ...(isStockAccount ? [{ value: 'corporate' as const, label: '公司行为' }] : []),
    ...((isFundAccount || isCryptoAccount) ? [{ value: 'manualPrice' as const, label: '手工价格' }] : []),
    ...(isBankAccount ? [{ value: 'bank' as const, label: '银行' }] : []),
    ...(isBankAccount ? [{ value: 'bankNav' as const, label: '价值更新' }] : []),
    ...(isAdvisoryAccount ? [{ value: 'advisory' as const, label: '投顾流水' }] : []),
    ...(isAdvisoryAccount ? [{ value: 'advisoryNav' as const, label: '价值更新' }] : []),
    ...(isInsuranceAccount ? [{ value: 'insurancePolicy' as const, label: '保单' }] : []),
    ...(isInsuranceAccount ? [{ value: 'insuranceLedger' as const, label: '缴费/返还' }] : []),
  ];
  const activeEntryPanelAvailable = entryPanelOptions.some((item) => item.value === activeEntryPanel);
  const selectedEntryPanel = activeEntryPanelAvailable ? activeEntryPanel : entryPanelOptions[0]?.value;
  const eventFilterChips = [
    eventDateFrom ? `起 ${eventDateFrom}` : null,
    eventDateTo ? `止 ${eventDateTo}` : null,
    (eventType === 'trade' || eventType === 'corporate') && eventSymbol ? `代码 ${eventSymbol}` : null,
    eventType === 'trade' && eventSide ? formatSideLabel(eventSide) : null,
    eventType === 'cash' && eventDirection ? formatCashDirectionLabel(eventDirection) : null,
    eventType === 'corporate' && eventActionType ? formatCorporateActionLabel(eventActionType) : null,
    eventType === 'bank' && eventBankAssetKind ? formatBankAssetKind(eventBankAssetKind) : null,
    eventType === 'advisory' && eventAdvisoryDirection ? formatAdvisoryEventLabel(eventAdvisoryDirection) : null,
    eventType === 'insurance' && eventInsuranceEventType ? formatInsuranceEventType(eventInsuranceEventType) : null,
  ].filter(Boolean) as string[];
  const hasEventFilters = eventFilterChips.length > 0;

  const isActiveRefreshContext = (requestedViewKey: string, requestedRequestId: number) => {
    return (
      refreshContextRef.current.viewKey === requestedViewKey
      && refreshContextRef.current.requestId === requestedRequestId
    );
  };

  const showPortfolioToast = useCallback((title: string, message: string) => {
    setPortfolioToast({
      id: Date.now(),
      title,
      message,
    });
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const response = await portfolioApi.getAccounts(false);
      const items = response.accounts || [];
      setAccounts(items);
      setSelectedAccount((prev) => {
        if (items.length === 0) return 'all';
        if (prev !== 'all' && !items.some((item) => item.id === prev)) return items[0].id;
        return prev;
      });
      if (items.length === 0) setShowCreateAccount(true);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, []);

  const loadBrokers = useCallback(async () => {
    try {
      const response = await portfolioApi.listImportBrokers();
      const brokerItems = response.brokers || [];
      if (brokerItems.length === 0) {
        setBrokers(FALLBACK_BROKERS);
        setBrokerLoadWarning('券商列表接口返回为空，已回退为内置券商列表（华泰/中信/招商）。');
        if (!FALLBACK_BROKERS.some((item) => item.broker === selectedBroker)) {
          setSelectedBroker(FALLBACK_BROKERS[0].broker);
        }
        return;
      }
      setBrokers(brokerItems);
      setBrokerLoadWarning(null);
      if (!brokerItems.some((item) => item.broker === selectedBroker)) {
        setSelectedBroker(brokerItems[0].broker);
      }
    } catch {
      setBrokers(FALLBACK_BROKERS);
      setBrokerLoadWarning('券商列表接口不可用，已回退为内置券商列表（华泰/中信/招商）。');
      if (!FALLBACK_BROKERS.some((item) => item.broker === selectedBroker)) {
        setSelectedBroker(FALLBACK_BROKERS[0].broker);
      }
    }
  }, [selectedBroker]);

  const loadPortfolioTags = useCallback(async () => {
    try {
      const response = await portfolioApi.listTags();
      setPortfolioTags(response.tags || []);
      setTagLoadError(null);
    } catch (err) {
      setTagLoadError(getParsedApiError(err));
    }
  }, []);

  const loadInsurancePolicies = useCallback(async () => {
    if (!writableAccountId || writableAccount?.market !== 'insurance') {
      setInsurancePolicies([]);
      return;
    }
    try {
      const response = await portfolioApi.listInsurancePolicies({
        accountId: writableAccountId,
        includeInactive: true,
      });
      setInsurancePolicies(response.policies || []);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, [writableAccount?.market, writableAccountId]);

  const loadSnapshot = useCallback(async (options: { refreshPrices?: boolean } = {}) => {
    setIsLoading(true);
    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: queryAccountId,
        costMethod,
        refreshPrices: options.refreshPrices ?? false,
      });
      setSnapshot(snapshotData);
      setError(null);
    } catch (err) {
      setSnapshot(null);
      setError(getParsedApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, [queryAccountId, costMethod]);

  const loadEventsPage = useCallback(async (page: number) => {
    setEventLoading(true);
    try {
      if (eventType === 'trade') {
        const response = await portfolioApi.listTrades({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          symbol: eventSymbol || undefined,
          side: eventSide || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setTradeEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else if (eventType === 'cash') {
        const response = await portfolioApi.listCashLedger({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          direction: eventDirection || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setCashEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else if (eventType === 'corporate') {
        const response = await portfolioApi.listCorporateActions({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          symbol: eventSymbol || undefined,
          actionType: eventActionType || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setCorporateEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else if (eventType === 'bank') {
        const response = await portfolioApi.listBankLedger({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          assetKind: eventBankAssetKind || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setBankEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else if (eventType === 'advisory') {
        const response = await portfolioApi.listAdvisoryLedger({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          direction: eventAdvisoryDirection || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setAdvisoryEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else {
        const response = await portfolioApi.listInsuranceLedger({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          eventType: eventInsuranceEventType || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setInsuranceEvents(response.items || []);
        setEventTotal(response.total || 0);
      }
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setEventLoading(false);
    }
  }, [
    eventActionType,
    eventAdvisoryDirection,
    eventBankAssetKind,
    eventDateFrom,
    eventDateTo,
    eventDirection,
    eventInsuranceEventType,
    eventSide,
    eventSymbol,
    eventType,
    queryAccountId,
  ]);

  const loadEvents = useCallback(async () => {
    await loadEventsPage(eventPage);
  }, [eventPage, loadEventsPage]);

  const refreshPortfolioData = useCallback(async (page = eventPage, options: { refreshPrices?: boolean } = {}) => {
    await Promise.all([loadSnapshot({ refreshPrices: options.refreshPrices ?? false }), loadEventsPage(page), loadInsurancePolicies()]);
  }, [eventPage, loadEventsPage, loadInsurancePolicies, loadSnapshot]);

  useEffect(() => {
    void loadAccounts();
    void loadBrokers();
    void loadPortfolioTags();
  }, [loadAccounts, loadBrokers, loadPortfolioTags]);

  useEffect(() => {
    void loadInsurancePolicies();
  }, [loadInsurancePolicies]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    refreshContextRef.current = {
      viewKey: refreshViewKey,
      requestId: refreshContextRef.current.requestId + 1,
    };
    setFxRefreshing(false);
    setFxRefreshFeedback(null);
  }, [refreshViewKey]);

  useEffect(() => {
    setEventPage(1);
  }, [
    eventType,
    queryAccountId,
    eventDateFrom,
    eventDateTo,
    eventSymbol,
    eventSide,
    eventDirection,
    eventActionType,
    eventBankAssetKind,
    eventAdvisoryDirection,
    eventInsuranceEventType,
  ]);

  useEffect(() => {
    if (selectedMarket === 'bank') {
      setEventType('bank');
      return;
    }
    if (selectedMarket === 'insurance') {
      setEventType('insurance');
      return;
    }
    if (selectedMarket === 'advisory') {
      setEventType((prev) => (prev === 'cash' ? prev : 'advisory'));
      return;
    }
    if (selectedMarket === 'fund' || selectedMarket === 'crypto') {
      setEventType((prev) => (prev === 'corporate' || prev === 'bank' || prev === 'advisory' || prev === 'insurance' ? 'trade' : prev));
      return;
    }
    setEventType((prev) => (prev === 'bank' || prev === 'advisory' || prev === 'insurance' ? 'trade' : prev));
  }, [selectedMarket]);

  useEffect(() => {
    if (selectedMarket === 'bank') {
      setActiveEntryPanel('bank');
      return;
    }
    if (selectedMarket === 'insurance') {
      setActiveEntryPanel((prev) => (prev === 'insuranceLedger' ? prev : 'insurancePolicy'));
      return;
    }
    if (selectedMarket === 'advisory') {
      setActiveEntryPanel((prev) => (prev === 'cash' || prev === 'advisoryNav' ? prev : 'advisory'));
      return;
    }
    if (selectedMarket === 'fund' || selectedMarket === 'crypto') {
      setActiveEntryPanel((prev) => (prev === 'cash' || prev === 'manualPrice' ? prev : 'trade'));
      return;
    }
    if (isStockMarket(selectedMarket)) {
      setActiveEntryPanel((prev) => (prev === 'cash' || prev === 'corporate' ? prev : 'trade'));
    }
  }, [selectedMarket]);

  useEffect(() => {
    if (!writeBlocked) {
      setWriteWarning(null);
    }
  }, [writeBlocked]);

  useEffect(() => {
    if (!portfolioToast) return;
    const timer = window.setTimeout(() => {
      setPortfolioToast(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [portfolioToast]);

  useEffect(() => {
    setPortfolioAnalysisError(null);
    setPortfolioAnalysis(loadCachedPortfolioAnalysis(portfolioAnalysisCacheKey, snapshotSignature));
  }, [portfolioAnalysisCacheKey, snapshotSignature]);

  const positionRows: FlatPosition[] = useMemo(() => {
    if (!snapshot) return [];
    const rows: FlatPosition[] = [];
    for (const account of snapshot.accounts || []) {
      for (const position of account.positions || []) {
        rows.push({
          ...position,
          accountId: account.accountId,
          accountName: account.accountName,
        });
      }
    }
    rows.sort((a, b) => Number(b.marketValueBase || 0) - Number(a.marketValueBase || 0));
    return rows;
  }, [snapshot]);

  const bankDepositOptions: BankPositionOption[] = useMemo(
    () => positionRows
      .filter((item) => item.accountId === writableAccountId && item.market === 'bank' && !item.registrationCode && item.linkedEntryId && item.marketValueBase > 0)
      .map((item) => ({ ...item, optionValue: String(item.linkedEntryId) })),
    [positionRows, writableAccountId],
  );
  const bankWealthOptions: BankPositionOption[] = useMemo(
    () => positionRows
      .filter((item) => item.accountId === writableAccountId && item.market === 'bank' && item.symbol?.startsWith('BANK:W:') && item.marketValueBase > 0)
      .map((item) => ({ ...item, optionValue: item.symbol || '' }))
      .filter((item) => item.optionValue),
    [positionRows, writableAccountId],
  );
  const selectedDepositOption = bankDepositOptions.find((item) => item.optionValue === bankForm.linkedEntryId);
  const selectedWealthOption = bankWealthOptions.find((item) => item.optionValue === bankForm.linkedEntryId);
  const selectedNavWealthOption = bankWealthOptions.find((item) => item.optionValue === bankNavForm.selectedProduct);
  const advisoryOptions: BankPositionOption[] = useMemo(
    () => positionRows
      .filter((item) => item.accountId === writableAccountId && item.market === 'advisory')
      .map((item) => ({ ...item, optionValue: item.symbol }))
      .filter((item) => item.optionValue),
    [positionRows, writableAccountId],
  );
  const advisoryComboOptions = useMemo(
    () => advisoryOptions.filter((item) => item.productType !== 'dca_plan'),
    [advisoryOptions],
  );
  const advisoryDcaPlanOptions = useMemo(
    () => advisoryOptions.filter((item) => item.productType === 'dca_plan'),
    [advisoryOptions],
  );
  const advisoryFormProductOptions = advisoryForm.productType === 'dca_plan' ? advisoryDcaPlanOptions : advisoryComboOptions;
  const selectedAdvisoryOption = advisoryFormProductOptions.find((item) => item.optionValue === advisoryForm.selectedProduct);
  const selectedNavAdvisoryOption = advisoryOptions.find((item) => item.optionValue === advisoryNavForm.selectedProduct);
  const advisoryEventRequiresExistingProduct = ['append_buy', 'follow_buy', 'redeem'].includes(advisoryForm.eventType);
  const advisoryProductSelectPlaceholder = advisoryForm.productType === 'dca_plan'
    ? '选择定投计划'
    : '选择投顾组合';
  const selectedInsurancePolicy = insurancePolicies.find((item) => String(item.id) === insuranceLedgerForm.policyId);
  const insuranceLedgerEventOptions = useMemo(
    () => getInsuranceEventOptions(selectedInsurancePolicy),
    [selectedInsurancePolicy],
  );
  useEffect(() => {
    if (!selectedInsurancePolicy || insuranceLedgerEventOptions.length === 0) return;
    if (!insuranceLedgerEventOptions.some((item) => item.value === insuranceLedgerForm.eventType)) {
      setInsuranceLedgerForm((prev) => ({ ...prev, eventType: insuranceLedgerEventOptions[0].value }));
    }
  }, [insuranceLedgerEventOptions, insuranceLedgerForm.eventType, selectedInsurancePolicy]);
  const buildAdvisoryLedgerPayload = (): AdvisoryLedgerPayloadDraft => {
    if (advisoryEventRequiresExistingProduct) {
      if (!selectedAdvisoryOption) {
        return { error: `请先${advisoryProductSelectPlaceholder}。` };
      }
      const amount = parsePositiveFormNumber(advisoryForm.amount);
      if (amount == null) {
        return { error: advisoryForm.eventType === 'redeem' ? '请填写赎回/止盈到账金额。' : '请填写投入金额。' };
      }
      return { amount, product: selectedAdvisoryOption };
    }

    const amount = parsePositiveFormNumber(advisoryForm.amount);
    if (amount == null) {
      return { error: '请填写投入金额。' };
    }
    return { amount, product: undefined };
  };

  const assetBreakdownRows = Object.entries(snapshot?.assetBreakdown || {})
    .filter(([, value]) => Math.abs(Number(value || 0)) > 0.000001)
    .map(([key, value]) => ({ key, value: Number(value || 0) }));
  const assetBreakdownTotal = assetBreakdownRows.reduce((total, item) => total + Math.abs(item.value), 0);
  const tagBreakdownRows = (snapshot?.tagBreakdown || [])
    .filter((item) => item.key !== '__cash__' && Math.abs(Number(item.amount || 0)) > 0.000001)
    .map((item) => ({
      ...item,
      tagName: item.key === '__untagged__' ? '未定义' : item.tagName,
      amount: Number(item.amount || 0),
    }));
  const tagBreakdownTotal = tagBreakdownRows.reduce((total, item) => total + Math.abs(item.amount), 0);

  const handleTradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      const market = writableAccount?.market;
      await portfolioApi.createTrade({
        accountId: writableAccountId,
        symbol: tradeForm.symbol,
        tradeDate: tradeForm.tradeDate,
        side: tradeForm.side,
        quantity: Number(tradeForm.quantity),
        price: Number(tradeForm.price),
        fee: Number(tradeForm.fee || 0),
        tax: isStockMarket(market) ? Number(tradeForm.tax || 0) : 0,
        market,
        currency: market ? getDefaultCurrencyForMarket(market) : undefined,
        tradeUid: tradeForm.tradeUid || undefined,
        note: tradeForm.note || undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setTradeForm((prev) => ({ ...prev, symbol: '', tradeUid: '', note: '' }));
      showPortfolioToast(
        isFundAccount ? '基金流水已记录' : isCryptoAccount ? '数字货币流水已记录' : '交易已记录',
        `${tradeForm.symbol} ${tradeForm.side === 'buy' ? (isFundAccount ? '申购' : '买入') : (isFundAccount ? '赎回' : '卖出')} ${formatAssetQuantity(Number(tradeForm.quantity), market)}。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleProductTagChange = async (row: FlatPosition, rawTagId: string) => {
    const productKey = String(row.productKey || '').trim();
    if (!productKey) {
      setWriteWarning('当前持仓缺少产品标识，无法设置标签。');
      return;
    }
    const tagId = rawTagId ? Number(rawTagId) : null;
    const selectedTag = tagId ? portfolioTags.find((item) => item.id === tagId) : undefined;
    setTagUpdatingKey(productKey);
    setSnapshot((current) => {
      if (!current) return current;
      return {
        ...current,
        accounts: current.accounts.map((account) => ({
          ...account,
          positions: account.positions.map((position) => (
            position.productKey === productKey
              ? {
                ...position,
                tagId,
                tagName: selectedTag?.name ?? null,
                tagColor: selectedTag?.color ?? null,
              }
              : position
          )),
        })),
      };
    });
    try {
      await portfolioApi.setProductTag(productKey, tagId);
      setActiveTagTarget(null);
      showPortfolioToast('标签已更新', `${getPositionDisplayName(row)} 已${selectedTag ? `标记为 ${selectedTag.name}` : '移除标签'}。`);
      await loadSnapshot();
    } catch (err) {
      setError(getParsedApiError(err));
      await loadSnapshot();
    } finally {
      setTagUpdatingKey(null);
    }
  };

  const handleCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createCashLedger({
        accountId: writableAccountId,
        eventDate: cashForm.eventDate,
        direction: cashForm.direction,
        amount: Number(cashForm.amount),
        currency: cashForm.currency || undefined,
        note: cashForm.note || undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setCashForm((prev) => ({ ...prev, note: '' }));
      showPortfolioToast(
        cashForm.direction === 'in' ? '入金已记录' : '出金已记录',
        `${cashForm.direction === 'in' ? '入金' : '出金'} ${formatMoney(Number(cashForm.amount), cashForm.currency || writableAccount?.baseCurrency || 'CNY')}。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleCorporateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createCorporateAction({
        accountId: writableAccountId,
        symbol: corpForm.symbol,
        effectiveDate: corpForm.effectiveDate,
        actionType: corpForm.actionType,
        cashDividendPerShare: corpForm.cashDividendPerShare ? Number(corpForm.cashDividendPerShare) : undefined,
        splitRatio: corpForm.splitRatio ? Number(corpForm.splitRatio) : undefined,
        note: corpForm.note || undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setCorpForm((prev) => ({ ...prev, symbol: '', note: '' }));
      showPortfolioToast(
        '公司行为已记录',
        `${corpForm.symbol} ${corpForm.actionType === 'cash_dividend' ? '现金分红' : '拆并股调整'}已加入持仓计算。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };


  const handleManualPriceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId || !writableAccount?.market) {
      setWriteWarning('请先选择具体基金或数字货币账户。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.upsertManualPrice({
        accountId: writableAccountId,
        symbol: manualPriceForm.symbol,
        market: writableAccount.market,
        priceDate: manualPriceForm.priceDate,
        price: Number(manualPriceForm.price),
        currency: getDefaultCurrencyForMarket(writableAccount.market),
        note: manualPriceForm.note || undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setManualPriceForm((prev) => ({ ...prev, symbol: '', price: '', note: '' }));
      showPortfolioToast(
        writableAccount.market === 'fund' ? '基金净值已保存' : '数字货币价格已保存',
        `${manualPriceForm.symbol} ${manualPriceForm.priceDate} 的手工价格已更新。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleBankNavSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId || writableAccount?.market !== 'bank') {
      setWriteWarning('请先选择具体银行账户。');
      return;
    }
    if (!selectedNavWealthOption?.symbol) {
      setWriteWarning('请先选择需要更新价值的理财产品。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.upsertManualPrice({
        accountId: writableAccountId,
        symbol: selectedNavWealthOption.symbol,
        market: 'bank',
        priceDate: bankNavForm.priceDate,
        price: Number(bankNavForm.price),
        currency: writableAccount.baseCurrency || 'CNY',
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setBankNavForm((prev) => ({ ...prev, selectedProduct: '', price: '' }));
      showPortfolioToast(
        '价值已保存',
        `${selectedNavWealthOption.productName || selectedNavWealthOption.symbol} ${bankNavForm.priceDate} 的当前总价值已更新。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleBankWealthProductSearch = async () => {
    const keyword = bankForm.productName.trim();
    if (!keyword) {
      setWriteWarning('请先输入理财产品名称。');
      return;
    }
    try {
      setWriteWarning(null);
      setBankWealthSearchLoading(true);
      setBankWealthNavLoading(false);
      setBankWealthCandidateModalOpen(false);
      setSelectedBankWealthCandidateKey('');
      setBankWealthMatchedProduct(null);
      setBankWealthSearchResults([]);
      setBankForm((prev) => ({
        ...prev,
        productCode: '',
        productPublicCode: '',
        issuerName: '',
        registrationCode: '',
        bankName: '',
        riskLevel: '',
        investmentNature: '',
        quantity: '',
        nav: '',
      }));
      const response = await withTimeout(
        portfolioApi.searchBankWealthProducts(keyword),
        BANK_WEALTH_SEARCH_TIMEOUT_MS,
      );
      const products = response.products || [];
      setBankWealthSearchResults(products);
      if (!products.length) {
        setWriteWarning('问财没有返回匹配的银行理财产品，可继续手动填写后保存。');
        return;
      }
      setSelectedBankWealthCandidateKey(getBankWealthCandidateKey(products[0], 0));
      setBankWealthCandidateModalOpen(true);
    } catch (err) {
      setBankWealthMatchedProduct(null);
      setBankWealthSearchResults([]);
      setBankWealthCandidateModalOpen(false);
      setSelectedBankWealthCandidateKey('');
      setBankForm((prev) => ({
        ...prev,
        productCode: '',
        productPublicCode: '',
        issuerName: '',
        registrationCode: '',
        bankName: '',
        riskLevel: '',
        investmentNature: '',
        quantity: '',
        nav: '',
      }));
      const parsed = getParsedApiError(err);
      setWriteWarning(
        err instanceof Error && err.message === 'timeout'
          ? '银行理财查询超时，可继续手动填写后保存。'
          : parsed.message || '问财查询失败，可继续手动填写后保存。',
      );
    } finally {
      setBankWealthSearchLoading(false);
      setBankWealthNavLoading(false);
    }
  };

  const applyBankWealthNav = async (productIdentifier: string) => {
    if (!productIdentifier || !bankForm.eventDate) {
      return;
    }
    try {
      setBankWealthNavLoading(true);
      const nav = await portfolioApi.getBankWealthNav(productIdentifier, bankForm.eventDate);
      if (nav.unitNav && nav.unitNav > 0) {
        const amount = Number(bankForm.amount);
        setBankForm((prev) => ({
          ...prev,
          nav: String(nav.unitNav),
          quantity: amount > 0 ? String(amount / Number(nav.unitNav)) : prev.quantity,
        }));
      } else {
        setBankForm((prev) => ({ ...prev, nav: '', quantity: '' }));
        setWriteWarning('已选中产品，但问财未返回交易日单位净值；本次将按价值型理财记录。');
      }
    } catch (err) {
      setBankForm((prev) => ({ ...prev, nav: '', quantity: '' }));
      setWriteWarning(getParsedApiError(err).message || '交易日单位净值查询失败；本次将按价值型理财记录。');
    } finally {
      setBankWealthNavLoading(false);
    }
  };

  const applyBankWealthProduct = async (product: PortfolioBankWealthProductItem) => {
    const productName = product.productName || bankForm.productName;
    const productIdentifier = product.productCode || product.productPublicCode || productName;
    setBankWealthMatchedProduct(product);
    setBankForm((prev) => ({
      ...prev,
      productName,
      productCode: product.productCode || '',
      productPublicCode: product.productPublicCode || '',
      issuerName: product.issuerName || '',
      bankName: product.issuerName || prev.bankName,
      registrationCode: product.productPublicCode || prev.registrationCode,
      riskLevel: normalizeBankRiskLevel(product.riskLevel),
      investmentNature: normalizeBankInvestmentNature(product.investmentType),
    }));
    try {
      await applyBankWealthNav(productIdentifier);
    } finally {
      setBankWealthCandidateModalOpen(false);
    }
  };

  const handleConfirmBankWealthCandidate = async () => {
    const selectedProduct = bankWealthSearchResults.find(
      (item, index) => getBankWealthCandidateKey(item, index) === selectedBankWealthCandidateKey,
    ) || bankWealthSearchResults[0];
    if (!selectedProduct) {
      setBankWealthCandidateModalOpen(false);
      return;
    }
    await applyBankWealthProduct(selectedProduct);
  };

  const handleExistingBankWealthNavLookup = async () => {
    if (!selectedWealthOption) {
      setWriteWarning(getBankProductRequiredMessage(bankForm.assetKind, bankForm.wealthAction));
      return;
    }
    const productIdentifier = (
      selectedWealthOption.productCode
      || selectedWealthOption.productPublicCode
      || selectedWealthOption.registrationCode
      || selectedWealthOption.productName
      || selectedWealthOption.displayName
      || ''
    );
    await applyBankWealthNav(productIdentifier);
  };

  const handleBankLedgerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先选择具体银行账户。');
      return;
    }
    try {
      setWriteWarning(null);
      const wealthDirection: PortfolioCashDirection = bankForm.assetKind === 'wealth' && bankForm.wealthAction === 'redeem' ? 'out' : 'in';
      const ledgerDirection = bankForm.assetKind === 'wealth' ? wealthDirection : bankForm.direction;
      const isBankProductOut = ledgerDirection === 'out' && bankForm.assetKind !== 'demand';
      const isWealthFollowUp = bankForm.assetKind === 'wealth' && bankForm.wealthAction !== 'buy';
      const selectedBankProduct = bankForm.assetKind === 'deposit' ? selectedDepositOption : selectedWealthOption;
      if ((isBankProductOut || isWealthFollowUp) && !selectedBankProduct) {
        setWriteWarning(getBankProductRequiredMessage(bankForm.assetKind, bankForm.wealthAction));
        return;
      }
      await portfolioApi.createBankLedger({
        accountId: writableAccountId,
        eventDate: bankForm.eventDate,
        assetKind: bankForm.assetKind,
        direction: ledgerDirection,
        amount: Number(bankForm.amount),
        currency: writableAccount?.baseCurrency || 'CNY',
        bankName: selectedBankProduct?.bankName || bankForm.bankName,
        productName: bankForm.assetKind !== 'demand' ? selectedBankProduct?.productName || bankForm.productName || undefined : undefined,
        productCode: bankForm.assetKind === 'wealth' ? selectedBankProduct?.productCode || bankForm.productCode || undefined : undefined,
        productPublicCode: bankForm.assetKind === 'wealth' ? selectedBankProduct?.productPublicCode || bankForm.productPublicCode || undefined : undefined,
        issuerName: bankForm.assetKind === 'wealth' ? selectedBankProduct?.issuerName || bankForm.issuerName || undefined : undefined,
        registrationCode: bankForm.assetKind === 'wealth' ? selectedBankProduct?.registrationCode || bankForm.registrationCode || undefined : undefined,
        linkedEntryId: (isBankProductOut || isWealthFollowUp) && selectedBankProduct?.linkedEntryId ? selectedBankProduct.linkedEntryId : undefined,
        quantity: bankForm.assetKind === 'wealth' && bankForm.nav && bankForm.quantity ? Number(bankForm.quantity) : undefined,
        unitNav: bankForm.assetKind === 'wealth' && bankForm.nav ? Number(bankForm.nav) : undefined,
        navDate: bankForm.assetKind === 'wealth' && bankForm.nav ? bankForm.eventDate : undefined,
        startDate: bankForm.assetKind !== 'demand' ? selectedBankProduct?.startDate || bankForm.startDate || undefined : undefined,
        maturityDate: bankForm.assetKind !== 'demand' ? selectedBankProduct?.maturityDate || bankForm.maturityDate || undefined : undefined,
        annualRate: bankForm.assetKind === 'deposit' ? Number(selectedBankProduct?.annualRate ?? bankForm.annualRate) : undefined,
        investmentNature: bankForm.assetKind === 'wealth' && (selectedBankProduct?.investmentNature || bankForm.investmentNature)
          ? (selectedBankProduct?.investmentNature as PortfolioBankInvestmentNature | undefined) || bankForm.investmentNature || undefined
          : undefined,
        riskLevel: bankForm.assetKind === 'wealth' && (selectedBankProduct?.riskLevel || bankForm.riskLevel)
          ? (selectedBankProduct?.riskLevel as PortfolioBankRiskLevel | undefined) || bankForm.riskLevel || undefined
          : undefined,
        incomeMode: bankForm.assetKind === 'wealth' ? (selectedBankProduct?.incomeMode as PortfolioBankIncomeMode | undefined) || bankForm.incomeMode : undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setBankForm((prev) => ({
        ...prev,
        amount: '',
        productName: '',
        productCode: '',
        productPublicCode: '',
        issuerName: '',
        registrationCode: '',
        linkedEntryId: '',
        quantity: '',
        nav: '',
        startDate: '',
        maturityDate: '',
        annualRate: '',
        investmentNature: '',
        riskLevel: '',
      }));
      setBankWealthSearchResults([]);
      setBankWealthMatchedProduct(null);
      showPortfolioToast(
        getBankSuccessTitle(bankForm.assetKind, ledgerDirection, bankForm.wealthAction),
        `${selectedBankProduct?.productName || bankForm.productName || bankForm.bankName} ${getBankAmountPlaceholder(bankForm.assetKind, ledgerDirection, bankForm.wealthAction)} ${formatMoney(Number(bankForm.amount), writableAccount?.baseCurrency || 'CNY')}。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleAdvisoryLedgerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId || writableAccount?.market !== 'advisory') {
      setWriteWarning('请先选择具体投顾账户。');
      return;
    }
    try {
      setWriteWarning(null);
      const payload = buildAdvisoryLedgerPayload();
      if ('error' in payload) {
        setWriteWarning(payload.error);
        return;
      }
      const selectedProduct = payload.product;
      const ledgerEventType: PortfolioAdvisoryEventType = advisoryForm.eventType === 'append_buy'
        ? 'buy'
        : advisoryForm.eventType;
      await portfolioApi.createAdvisoryLedger({
        accountId: writableAccountId,
        eventDate: advisoryForm.eventDate,
        platform: selectedProduct?.platform || advisoryForm.platform,
        productName: selectedProduct?.productName || advisoryForm.productName,
        productCode: selectedProduct?.productCode || advisoryForm.productCode || undefined,
        productType: selectedProduct?.productType === 'dca_plan' ? 'dca_plan' : advisoryForm.productType,
        eventType: ledgerEventType,
        amount: payload.amount,
        currency: writableAccount.baseCurrency || 'CNY',
        riskLevel: selectedProduct?.riskLevel || advisoryForm.riskLevel || undefined,
        investmentStyle: selectedProduct?.investmentStyle || advisoryForm.investmentStyle || undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setAdvisoryForm((prev) => ({
        ...prev,
        amount: '',
        productName: advisoryEventRequiresExistingProduct ? prev.productName : '',
        productCode: advisoryEventRequiresExistingProduct ? prev.productCode : '',
        selectedProduct: advisoryEventRequiresExistingProduct ? prev.selectedProduct : '',
      }));
      showPortfolioToast(
        advisoryForm.eventType === 'redeem' ? '投顾赎回已记录' : '投顾投入已记录',
        `${selectedProduct?.productName || advisoryForm.productName} ${formatAdvisoryEventLabel(advisoryForm.eventType)} ${formatMoney(payload.amount, writableAccount.baseCurrency || 'CNY')}。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleAdvisoryNavSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId || writableAccount?.market !== 'advisory') {
      setWriteWarning('请先选择具体投顾账户。');
      return;
    }
    if (!selectedNavAdvisoryOption) {
      setWriteWarning('请先选择需要更新价值的投顾产品。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.upsertManualPrice({
        accountId: writableAccountId,
        symbol: selectedNavAdvisoryOption.symbol,
        market: 'advisory',
        priceDate: advisoryNavForm.priceDate,
        price: Number(advisoryNavForm.price),
        currency: writableAccount.baseCurrency || 'CNY',
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setAdvisoryNavForm((prev) => ({ ...prev, selectedProduct: '', price: '' }));
      showPortfolioToast(
        '投顾价值已保存',
        `${selectedNavAdvisoryOption.productName || selectedNavAdvisoryOption.symbol} ${advisoryNavForm.priceDate} 的当前总价值已更新。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleInsurancePolicySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId || writableAccount?.market !== 'insurance') {
      setWriteWarning('请先选择具体保险账户。');
      return;
    }
    try {
      setWriteWarning(null);
      const created = await portfolioApi.createInsurancePolicy({
        accountId: writableAccountId,
        policyName: insurancePolicyForm.policyName,
        insurer: insurancePolicyForm.insurer || undefined,
        policyNo: insurancePolicyForm.policyNo || undefined,
        insuranceKind: insurancePolicyForm.insuranceKind,
        designType: insurancePolicyForm.designType,
        currency: writableAccount.baseCurrency || 'CNY',
        paymentMode: insurancePolicyForm.paymentMode,
        premiumPerPeriod: insurancePolicyForm.premiumPerPeriod ? Number(insurancePolicyForm.premiumPerPeriod) : undefined,
        firstPaymentDate: insurancePolicyForm.firstPaymentDate || undefined,
        totalPeriods: insurancePolicyForm.totalPeriods ? Number(insurancePolicyForm.totalPeriods) : undefined,
        note: insurancePolicyForm.note || undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setInsuranceLedgerForm((prev) => ({
        ...prev,
        policyId: String(created.id),
        amount: insurancePolicyForm.premiumPerPeriod || prev.amount,
        eventDate: insurancePolicyForm.firstPaymentDate || prev.eventDate,
        eventType: getDefaultInsuranceEventType(created),
        periodNo: '1',
      }));
      setInsurancePolicyForm((prev) => ({ ...prev, policyName: '', policyNo: '', note: '' }));
      showPortfolioToast('保单已创建', `${created.policyName} 已加入保险账户。`);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleInsuranceLedgerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId || writableAccount?.market !== 'insurance') {
      setWriteWarning('请先选择具体保险账户。');
      return;
    }
    if (!selectedInsurancePolicy) {
      setWriteWarning('请先选择保单。');
      return;
    }
    if (insuranceLedgerEventOptions.length === 0) {
      setWriteWarning('这张保单已经终止，不能继续录入新的保险流水。');
      return;
    }
    if (!insuranceLedgerEventOptions.some((item) => item.value === insuranceLedgerForm.eventType)) {
      setWriteWarning('当前保单类型不支持这个操作，请重新选择。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createInsuranceLedger({
        accountId: writableAccountId,
        policyId: selectedInsurancePolicy.id,
        eventDate: insuranceLedgerForm.eventDate,
        eventType: insuranceLedgerForm.eventType,
        amount: Number(insuranceLedgerForm.amount),
        currency: selectedInsurancePolicy.currency || writableAccount.baseCurrency || 'CNY',
        periodNo: insuranceLedgerForm.periodNo ? Number(insuranceLedgerForm.periodNo) : undefined,
        note: insuranceLedgerForm.note || undefined,
      });
      await refreshPortfolioData(eventPage, { refreshPrices: true });
      setInsuranceLedgerForm((prev) => ({ ...prev, amount: '', note: '' }));
      showPortfolioToast(
        '保险流水已记录',
        `${selectedInsurancePolicy.policyName} · ${formatInsuranceEventType(insuranceLedgerForm.eventType)} ${formatMoney(Number(insuranceLedgerForm.amount), selectedInsurancePolicy.currency || 'CNY')}。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleParseCsv = async () => {
    if (!csvFile) return;
    try {
      setCsvParsing(true);
      const parsed = await portfolioApi.parseCsvImport(selectedBroker, csvFile);
      setCsvParseResult(parsed);
      setCsvCommitResult(null);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setCsvParsing(false);
    }
  };

  const handleCommitCsv = async () => {
    if (!csvFile) return;
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      setCsvCommitting(true);
      const committed = await portfolioApi.commitCsvImport(writableAccountId, selectedBroker, csvFile, csvDryRun);
      setCsvCommitResult(committed);
      if (!csvDryRun) {
        await refreshPortfolioData(eventPage, { refreshPrices: true });
      }
      showPortfolioToast(
        csvDryRun ? 'CSV 预演完成' : 'CSV 导入已提交',
        csvDryRun
          ? `解析到 ${committed.recordCount} 条记录，预演未写入账户。`
          : `已写入 ${committed.insertedCount} 条记录，重复 ${committed.duplicateCount} 条。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setCsvCommitting(false);
    }
  };

  const openDeleteDialog = (item: PendingDelete) => {
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行删除修正。');
      return;
    }
    setPendingDelete(item);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleteLoading) return;
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行删除修正。');
      setPendingDelete(null);
      return;
    }

    const nextPage = currentEventCount === 1 && eventPage > 1 ? eventPage - 1 : eventPage;
    try {
      setDeleteLoading(true);
      setWriteWarning(null);
      if (pendingDelete.eventType === 'trade') {
        await portfolioApi.deleteTrade(pendingDelete.id);
      } else if (pendingDelete.eventType === 'cash') {
        await portfolioApi.deleteCashLedger(pendingDelete.id);
      } else if (pendingDelete.eventType === 'corporate') {
        await portfolioApi.deleteCorporateAction(pendingDelete.id);
      } else if (pendingDelete.eventType === 'bank') {
        await portfolioApi.deleteBankLedger(pendingDelete.id);
      } else if (pendingDelete.eventType === 'advisory') {
        await portfolioApi.deleteAdvisoryLedger(pendingDelete.id);
      } else {
        await portfolioApi.deleteInsuranceLedger(pendingDelete.id);
      }
      setPendingDelete(null);
      if (nextPage !== eventPage) {
        setEventPage(nextPage);
      }
      await refreshPortfolioData(nextPage, { refreshPrices: true });
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = accountForm.name.trim();
    if (!name) {
      setAccountCreateError('账户名称不能为空。');
      setAccountCreateSuccess(null);
      return;
    }
    try {
      setAccountCreating(true);
      setAccountCreateError(null);
      setAccountCreateSuccess(null);
      const created = await portfolioApi.createAccount({
        name,
        broker: accountForm.broker.trim() || undefined,
        market: accountForm.market,
        baseCurrency: accountForm.baseCurrency.trim() || getDefaultCurrencyForMarket(accountForm.market),
      });
      await loadAccounts();
      setSelectedAccount(created.id);
      setShowCreateAccount(false);
      setWriteWarning(null);
      setAccountForm({
        name: '',
        broker: '',
        market: accountForm.market,
        baseCurrency: getDefaultCurrencyForMarket(accountForm.market),
      });
      setAccountCreateSuccess('账户创建成功，已自动切换到该账户。');
    } catch (err) {
      const parsed = getParsedApiError(err);
      setAccountCreateError(parsed.message || '创建账户失败，请稍后重试。');
      setAccountCreateSuccess(null);
    } finally {
      setAccountCreating(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadAccounts(), loadSnapshot({ refreshPrices: true }), loadEvents(), loadBrokers()]);
  };

  const clearEventFilters = () => {
    setEventDateFrom('');
    setEventDateTo('');
    setEventSymbol('');
    setEventSide('');
    setEventDirection('');
    setEventActionType('');
    setEventBankAssetKind('');
    setEventAdvisoryDirection('');
    setEventInsuranceEventType('');
  };

  const reloadSnapshotForScope = useCallback(async (
    requestedViewKey: string,
    requestedRequestId: number,
    requestedAccountId: number | undefined,
    requestedCostMethod: PortfolioCostMethod,
  ): Promise<boolean> => {
    if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
      return false;
    }

    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: requestedAccountId,
        costMethod: requestedCostMethod,
        refreshPrices: true,
      });
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(snapshotData);
      setError(null);
      return true;
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(null);
      setError(getParsedApiError(err));
      return false;
    }
  }, []);

  const handleRefreshFx = async () => {
    if (!hasAccounts || isLoading || fxRefreshing) {
      return;
    }

    const requestedViewKey = refreshViewKey;
    const requestedAccountId = queryAccountId;
    const requestedCostMethod = costMethod;
    const requestedRequestId = refreshContextRef.current.requestId + 1;
    refreshContextRef.current = {
      viewKey: requestedViewKey,
      requestId: requestedRequestId,
    };

    try {
      setFxRefreshing(true);
      setFxRefreshFeedback(null);
      const result = await portfolioApi.refreshFx({
        accountId: requestedAccountId,
      });
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      const reloaded = await reloadSnapshotForScope(
        requestedViewKey,
        requestedRequestId,
        requestedAccountId,
        requestedCostMethod,
      );
      if (!reloaded || !isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      setFxRefreshFeedback(buildFxRefreshFeedback(result));
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      setError(getParsedApiError(err));
    } finally {
      if (isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        setFxRefreshing(false);
      }
    }
  };

  const handleAnalyzePortfolio = async () => {
    if (!snapshot || !snapshotSignature || portfolioAnalysisLoading) {
      return;
    }
    const cacheKey = snapshotSignature
      ? `${PORTFOLIO_ANALYSIS_CACHE_PREFIX}:${selectedAccount === 'all' ? 'all' : selectedAccount}:${costMethod}:standard:${snapshotSignature}`
      : '';
    try {
      setPortfolioAnalysisLoading(true);
      setPortfolioAnalysisError(null);
      const response = await portfolioApi.analyzePortfolio({
        accountId: queryAccountId,
        asOf: snapshot.asOf,
        costMethod,
        snapshotSignature,
        mode: 'standard',
      });
      setPortfolioAnalysis(response);
      saveCachedPortfolioAnalysis(cacheKey, response);
    } catch (err) {
      setPortfolioAnalysisError(getParsedApiError(err));
    } finally {
      setPortfolioAnalysisLoading(false);
    }
  };

  return (
    <div className="portfolio-page min-h-screen space-y-4 p-4 md:p-6">
      <section className="space-y-3">
        <div className={PORTFOLIO_FORM_CLASS}>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">持仓管理</h1>
          <p className="text-xs md:text-sm text-secondary">
            组合快照、手工录入、CSV 导入与资产分析（支持全组合 / 单账户切换）
          </p>
        </div>
        {hasAccounts ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px_280px] gap-2 items-end">
              <div>
                <p className="text-xs text-secondary mb-1">账户视图</p>
                <select
                  value={String(selectedAccount)}
                  onChange={(e) => setSelectedAccount(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className={PORTFOLIO_SELECT_CLASS}
                >
                  <option value="all">全部账户</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} (#{account.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-secondary mb-1">成本口径</p>
                <select
                  value={costMethod}
                  onChange={(e) => setCostMethod(e.target.value as PortfolioCostMethod)}
                  className={PORTFOLIO_SELECT_CLASS}
                >
                  <option value="fifo">先进先出（FIFO）</option>
                  <option value="avg">均价成本（AVG）</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm flex-1"
                  onClick={() => {
                    setShowCreateAccount((prev) => !prev);
                    setAccountCreateError(null);
                    setAccountCreateSuccess(null);
                  }}
                >
                  {showCreateAccount ? '收起新建' : '新建账户'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={isLoading || fxRefreshing}
                  className="btn-secondary text-sm flex-1"
                >
                  {isLoading ? '刷新中...' : '刷新数据'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <InlineAlert
            variant="warning"
            className="inline-block rounded-lg px-3 py-2 text-xs shadow-none"
            message="还没有可用账户，请先创建账户后再录入交易或导入 CSV。"
          />
        )}
      </section>

      {error ? <ApiErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
      {snapshot?.fxMissing ? (
        <InlineAlert
          variant="danger"
          title="汇率缺失"
          message={`缺少 ${missingFxPairsText || '跨币种'} 汇率，CNY 汇总金额不可计算。请先刷新汇率或补录汇率后再看总览。`}
        />
      ) : null}
      {writeWarning ? (
        <InlineAlert
          variant="warning"
          title="操作提示"
          message={writeWarning}
        />
      ) : null}

      {(showCreateAccount || !hasAccounts) ? (
        <Card padding="md" className="portfolio-position-card">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">新建账户</h2>
            {hasAccounts ? (
              <button
                type="button"
                className="btn-secondary text-xs px-3 py-1"
                onClick={() => {
                  setShowCreateAccount(false);
                  setAccountCreateError(null);
                  setAccountCreateSuccess(null);
                }}
              >
                收起
              </button>
            ) : (
              <span className="text-xs text-secondary">创建后自动切换到该账户</span>
            )}
          </div>
          {accountCreateError ? (
            <InlineAlert
              variant="danger"
              className="mt-2 rounded-lg px-2 py-1 text-xs shadow-none"
              title="创建账户失败"
              message={accountCreateError}
            />
          ) : null}
          {accountCreateSuccess ? (
            <InlineAlert
              variant="success"
              className="mt-2 rounded-lg px-2 py-1 text-xs shadow-none"
              title="创建账户成功"
              message={accountCreateSuccess}
            />
          ) : null}
          <form className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2" onSubmit={handleCreateAccount}>
            <input
              className={`${PORTFOLIO_INPUT_CLASS} md:col-span-2`}
              placeholder="账户名称（必填）"
              value={accountForm.name}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className={PORTFOLIO_INPUT_CLASS}
              placeholder="机构/平台（可选，如华泰、天天基金、陆基金、招商银行）"
              value={accountForm.broker}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, broker: e.target.value }))}
            />
            <input
              className={PORTFOLIO_INPUT_CLASS}
              placeholder="基准币（如 CNY/USD/HKD）"
              value={accountForm.baseCurrency}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, baseCurrency: e.target.value.toUpperCase() }))}
            />
            <select
              className={PORTFOLIO_SELECT_CLASS}
              value={accountForm.market}
              onChange={(e) => {
                const market = e.target.value as PortfolioMarket;
                setAccountForm((prev) => ({
                  ...prev,
                  market,
                  baseCurrency: getDefaultCurrencyForMarket(market),
                }));
              }}
            >
              <option value="cn">A 股 / 场内 ETF</option>
              <option value="hk">港股</option>
              <option value="us">美股</option>
              <option value="fund">场外基金</option>
              <option value="crypto">数字货币</option>
              <option value="bank">银行</option>
              <option value="advisory">投顾</option>
              <option value="insurance">保险</option>
            </select>
            <button type="submit" className="btn-secondary text-sm" disabled={accountCreating}>
              {accountCreating ? '创建中...' : '创建账户'}
            </button>
          </form>
        </Card>
      ) : null}

      {selectedAccount !== 'all' && writableAccount ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-secondary">
          当前账户：<span className="text-foreground">{writableAccount.name}</span> · {formatMarketLabel(writableAccount.market)} · {writableAccount.baseCurrency}
        </div>
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card variant="gradient" padding="md">
          <p className="text-xs text-secondary">总权益</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatAggregateMoney(snapshot, snapshot?.totalEquity)}</p>
        </Card>
        <Card variant="gradient" padding="md">
          <p className="text-xs text-secondary">总市值</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatAggregateMoney(snapshot, snapshot?.totalMarketValue)}</p>
        </Card>
        <Card variant="gradient" padding="md">
          <p className="text-xs text-secondary">总现金</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatAggregateMoney(snapshot, snapshot?.totalCash)}</p>
        </Card>
        <Card variant="gradient" padding="md">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-secondary">汇率状态</p>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1 !text-xs shrink-0"
              onClick={() => void handleRefreshFx()}
              disabled={!hasAccounts || isLoading || fxRefreshing}
            >
              {fxRefreshing ? '刷新中...' : '刷新汇率'}
            </button>
          </div>
          <div className="mt-2">
            {snapshot?.fxMissing ? <Badge variant="danger">缺失</Badge> : snapshot?.fxStale ? <Badge variant="warning">过期</Badge> : <Badge variant="success">最新</Badge>}
          </div>
          {fxRefreshFeedback ? (
            <InlineAlert
              variant={getFxRefreshFeedbackVariant(fxRefreshFeedback.tone)}
              title="汇率刷新结果"
              message={fxRefreshFeedback.text}
              className="mt-3 rounded-xl px-3 py-2 text-xs shadow-none"
            />
          ) : null}
        </Card>
      </section>

      <section>
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">持仓明细</h2>
            <span className="text-xs text-secondary">共 {positionRows.length} 项</span>
          </div>
          {positionRows.length === 0 ? (
            <EmptyState
              title="当前无持仓数据"
              description="录入交易或导入流水后，这里会展示按账户汇总的持仓明细。"
              className="border-none bg-transparent px-4 py-8 shadow-none"
            />
          ) : (
            <div className="portfolio-position-table-wrapper">
              <table className="portfolio-position-table w-full text-sm">
                <colgroup>
                  <col className="portfolio-position-col-type" />
                  <col className="portfolio-position-col-asset" />
                  <col className="portfolio-position-col-quantity" />
                  <col className="portfolio-position-col-cost" />
                  <col className="portfolio-position-col-price" />
                  <col className="portfolio-position-col-money" />
                  <col className="portfolio-position-col-pnl" />
                  <col className="portfolio-position-col-rate" />
                  <col className="portfolio-position-col-rate" />
                </colgroup>
                <thead className="text-xs text-secondary border-b border-white/10">
                  <tr>
                    <th className="portfolio-position-head-cell text-left">类型/账户</th>
                    <th className="portfolio-position-head-cell text-left">资产</th>
                    <th className="portfolio-position-head-cell text-right">数量</th>
                    <th className="portfolio-position-head-cell text-right">成本价</th>
                    <th className="portfolio-position-head-cell text-right">现价</th>
                    <th className="portfolio-position-head-cell text-right">市值</th>
                    <th className="portfolio-position-head-cell text-right">未实现盈亏</th>
                    <th className="portfolio-position-head-cell text-right">收益率</th>
                    <th className="portfolio-position-head-cell text-right">年化</th>
                  </tr>
                </thead>
                <tbody>
                  {positionRows.map((row) => {
                    const assetName = getPositionDisplayName(row);
                    const secondaryLine = getPositionSecondaryLine(row, assetNameMaps);
                    const tagLabel = row.tagName || '+标签';
                    const assetTitle = [assetName, tagLabel, secondaryLine].filter(Boolean).join('\n');
                    const assetType = getPositionAssetType(row, assetNameMaps);
                    return (
                    <tr key={`${row.accountId}-${row.symbol}-${row.market}-${row.productName || ''}`} className="portfolio-position-row">
                      <td className="portfolio-position-cell portfolio-position-type-account-cell" data-label="类型/账户" title={`${assetType}\n${row.accountName}`}>
                        <span className="portfolio-position-type-chip inline-flex text-sm font-semibold text-foreground" title={assetType}>
                          {assetType}
                        </span>
                        <span className="portfolio-position-account-text text-[11px] text-secondary" title={row.accountName}>{row.accountName}</span>
                      </td>
                      <td className="portfolio-position-cell portfolio-position-asset-cell text-foreground" data-label="资产" title={assetTitle}>
                        <div className={`portfolio-position-asset-primary ${row.market === 'bank' || row.market === 'advisory' ? '' : 'font-mono'}`}>{assetName}</div>
                        <div className="portfolio-position-asset-secondary text-[11px] text-secondary">
                          <button
                            type="button"
                            className={`portfolio-position-tag-chip ${row.tagName ? 'portfolio-position-tag-chip-selected' : 'portfolio-position-tag-chip-empty'}`}
                            style={getTagButtonStyle(row)}
                            onClick={(event) => {
                              event.stopPropagation();
                              const productKey = String(row.productKey || '').trim();
                              if (!productKey) {
                                setWriteWarning('当前持仓缺少产品标识，无法设置标签。');
                                return;
                              }
                              setActiveTagTarget({ productKey, row });
                            }}
                            disabled={!row.productKey || tagUpdatingKey === row.productKey}
                            aria-label={`设置 ${assetName} 的标签`}
                          >
                            <Tag className="h-3 w-3" aria-hidden="true" />
                            <span>{tagUpdatingKey === row.productKey ? '保存中' : tagLabel}</span>
                          </button>
                          {secondaryLine ? <span className="portfolio-position-asset-meta">{secondaryLine}</span> : null}
                        </div>
                      </td>
                      <td
                        className="portfolio-position-cell portfolio-position-number-cell text-right"
                        data-label="数量"
                        title={formatPositionQuantityTitle(row)}
                      >
                        {formatPositionQuantity(row)}
                      </td>
                      <td className="portfolio-position-cell portfolio-position-number-cell text-right" data-label="成本价">
                        {formatPositionCostPrice(row)}
                      </td>
                      <td className="portfolio-position-cell portfolio-position-number-cell text-right" data-label="现价">
                        <div>{formatPositionPrice(row)}</div>
                        <div className={`portfolio-position-price-source text-[11px] ${hasPositionPrice(row) ? 'text-secondary' : 'text-warning'}`} title={getPositionPriceLabel(row)}>
                          {getPositionPriceLabel(row)}
                        </div>
                      </td>
                      <td className="portfolio-position-cell portfolio-position-number-cell text-right" data-label="市值">{formatPositionMoney(row.marketValueBase, row)}</td>
                      <td
                        data-label="未实现盈亏"
                        className={`portfolio-position-cell portfolio-position-number-cell text-right ${getChinaPnlColorClass(
                          row.unrealizedPnlBase,
                          (row.market !== 'bank' || isBankWealthPosition(row)) && hasPositionPrice(row),
                        )}`}
                      >
                        {row.market === 'bank' && !isBankWealthPosition(row) ? '-' : formatPositionMoney(row.unrealizedPnlBase, row)}
                      </td>
                      <td
                        data-label="收益率"
                        className={`portfolio-position-cell portfolio-position-number-cell text-right ${getChinaPnlColorClass(
                          row.unrealizedPnlPct,
                          (row.market !== 'bank' || isBankWealthPosition(row))
                            && hasPositionPrice(row)
                            && row.unrealizedPnlPct !== null
                            && row.unrealizedPnlPct !== undefined,
                        )}`}
                      >
                        {row.market === 'bank' && !isBankWealthPosition(row) ? '-' : formatSignedPct(row.unrealizedPnlPct)}
                      </td>
                      <td
                        data-label="年化"
                        className={`portfolio-position-cell portfolio-position-number-cell text-right ${getChinaPnlColorClass(
                          row.annualizedReturnPct,
                          row.annualizedReturnPct !== null && row.annualizedReturnPct !== undefined,
                        )}`}
                      >
                        {formatSignedPct(row.annualizedReturnPct)}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-3">
        <Card padding="md" className="flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">资产分布</h3>
            <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 transition-colors ${assetBreakdownView === 'tag' ? 'bg-primary/15 text-primary' : 'text-secondary hover:text-foreground'}`}
                onClick={() => setAssetBreakdownView('tag')}
              >
                资产属性
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 transition-colors ${assetBreakdownView === 'type' ? 'bg-primary/15 text-primary' : 'text-secondary hover:text-foreground'}`}
                onClick={() => setAssetBreakdownView('type')}
              >
                资产类型
              </button>
            </div>
          </div>
          {tagLoadError ? (
            <InlineAlert
              variant="warning"
              title="标签加载失败"
              message={tagLoadError.message}
              className="mt-3 rounded-xl px-3 py-2 text-xs shadow-none"
            />
          ) : null}
          <div className="mt-3 space-y-2 text-xs text-secondary">
            {assetBreakdownView === 'tag' ? (
              tagBreakdownRows.length > 0 ? tagBreakdownRows.map((item, index) => {
                const pct = tagBreakdownTotal > 0 ? Math.abs(item.amount) / tagBreakdownTotal * 100 : null;
                return (
                  <div key={item.key} className="portfolio-asset-breakdown-row">
                    <span className="portfolio-asset-breakdown-name">
                      <span
                        className="portfolio-asset-breakdown-dot"
                        style={{ background: item.tagColor || PORTFOLIO_ASSET_COLORS[index % PORTFOLIO_ASSET_COLORS.length] }}
                      />
                      {item.tagName}
                    </span>
                    <span className="portfolio-asset-breakdown-value">
                      {snapshot?.fxMissing ? '不可计算' : formatMoney(item.amount, snapshot?.currency || 'CNY')}
                    </span>
                    <span className="portfolio-asset-breakdown-pct">
                      {snapshot?.fxMissing ? '--' : formatPct(pct)}
                    </span>
                  </div>
                );
              }) : <div>暂无资产属性分布数据</div>
            ) : assetBreakdownRows.length > 0 ? assetBreakdownRows.map((item, index) => {
              const pct = assetBreakdownTotal > 0 ? Math.abs(item.value) / assetBreakdownTotal * 100 : null;
              return (
                <div key={item.key} className="portfolio-asset-breakdown-row">
                  <span className="portfolio-asset-breakdown-name">
                    <span
                      className="portfolio-asset-breakdown-dot"
                      style={{ background: PORTFOLIO_ASSET_COLORS[index % PORTFOLIO_ASSET_COLORS.length] }}
                    />
                    {formatMarketLabel(item.key)}
                  </span>
                  <span className="portfolio-asset-breakdown-value">
                    {snapshot?.fxMissing ? '不可计算' : formatMoney(item.value, snapshot?.currency || 'CNY')}
                  </span>
                  <span className="portfolio-asset-breakdown-pct">
                    {snapshot?.fxMissing ? '--' : formatPct(pct)}
                  </span>
                </div>
              );
            }) : <div>暂无资产分布数据</div>}
          </div>
        </Card>

        <Card padding="md" className="flex flex-col">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">资产分析</h2>
              <p className="mt-1 text-xs text-secondary">
                {PORTFOLIO_ANALYSIS_DESCRIPTION}
                {portfolioAnalysis?.generatedAt ? ` · ${portfolioAnalysis.generatedAt.replace('T', ' ')}` : ''}
              </p>
            </div>
          </div>

          <div className="mt-4 flex-1">
            {positionRows.length === 0 ? (
              <EmptyState
                title="暂无可分析持仓"
                description="录入持仓后可生成组合结构、风险暴露与收益风险画像。"
                className="border-none bg-transparent px-4 py-8 shadow-none"
              />
            ) : portfolioAnalysis ? (
              <div className="space-y-1.5">
                {portfolioAnalysis.summaryPoints.slice(0, 3).map((point, index) => (
                  <div
                    key={`${point}-${index}`}
                    className="flex min-h-10 items-start gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2"
                  >
                    <span className="mt-0.5 w-6 shrink-0 text-xs font-semibold tabular-nums text-secondary">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <p className="min-w-0 flex-1 text-sm leading-5 text-foreground">{point}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/12 bg-white/[0.02] px-4 py-8 text-sm leading-6 text-secondary">
                点击“{portfolioAnalysisButtonLabel}”生成组合要点；结果会按当前持仓快照缓存在本地。
              </div>
            )}
          </div>

          {portfolioAnalysisError ? (
            <ApiErrorAlert error={portfolioAnalysisError} className="mt-3" />
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {portfolioAnalysis ? (
              <button
                type="button"
                className="btn-secondary min-h-10 flex-1 !py-2 text-sm"
                onClick={() => setPortfolioAnalysisDrawerOpen(true)}
              >
                查看报告
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary min-h-10 flex-1 !py-2 text-sm"
              disabled={positionRows.length === 0 || portfolioAnalysisLoading || !snapshotSignature}
              onClick={() => void handleAnalyzePortfolio()}
            >
              {portfolioAnalysisLoading ? '分析中...' : portfolioAnalysisButtonLabel}
            </button>
          </div>
        </Card>
      </section>

      {!writeBlocked && selectedEntryPanel ? (
        <section>
          <Card padding="sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">录入流水</h3>
                <p className="mt-0.5 text-xs text-secondary">
                  {writableAccount.name} · {formatMarketLabel(writableAccount.market)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entryPanelOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={selectedEntryPanel === item.value}
                    className={`btn-secondary !px-3 !py-1.5 !text-xs !font-medium ${
                      selectedEntryPanel === item.value
                        ? '!border-primary !bg-primary !text-primary-foreground shadow-[0_8px_20px_hsl(var(--primary)/0.22),inset_0_1px_0_hsl(0_0%_100%/0.25)]'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                    onClick={() => setActiveEntryPanel(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 border-t border-white/10 pt-2">
              {selectedEntryPanel === 'trade' && (isStockAccount || isFundAccount || isCryptoAccount) ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleTradeSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label={isFundAccount ? '基金代码' : isCryptoAccount ? '币种' : '股票代码'}>
                    <input
                      className={PORTFOLIO_INPUT_CLASS}
                      placeholder={isFundAccount ? '000001' : isCryptoAccount ? 'BTC 或 ETH' : '600519'}
                      value={tradeForm.symbol}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, symbol: e.target.value }))}
                      required
                    />
                  </PortfolioField>
                  <PortfolioField label="交易日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={tradeForm.tradeDate}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, tradeDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="交易方向">
                    <select className={PORTFOLIO_SELECT_CLASS} value={tradeForm.side}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, side: e.target.value as PortfolioSide }))}>
                      <option value="buy">{isFundAccount ? '申购' : '买入'}</option>
                      <option value="sell">{isFundAccount ? '赎回' : '卖出'}</option>
                    </select>
                  </PortfolioField>
                  <PortfolioField label="数量">
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step={quantityStep} placeholder={getTradeQuantityPlaceholder(selectedMarket, tradeForm.side)} value={tradeForm.quantity}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, quantity: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label={isFundAccount ? '成交净值' : '成交价格'}>
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={getTradePricePlaceholder(selectedMarket)} value={tradeForm.price}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, price: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="手续费">
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="可选" value={tradeForm.fee}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, fee: e.target.value }))} />
                  </PortfolioField>
                  {isStockAccount ? (
                    <PortfolioField label="税费">
                      <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="可选" value={tradeForm.tax}
                        onChange={(e) => setTradeForm((prev) => ({ ...prev, tax: e.target.value }))} />
                    </PortfolioField>
                  ) : (
                    <PortfolioField label="成交币种">
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder={selectedMarket ? getDefaultCurrencyForMarket(selectedMarket) : ''} disabled />
                    </PortfolioField>
                  )}
                  <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                    {isFundAccount ? '提交基金流水' : isCryptoAccount ? '提交数字货币流水' : '提交交易'}
                  </button>
                </div>
              </form>
              ) : null}

              {selectedEntryPanel === 'cash' && supportsCashLedger ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleCashSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="流水日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={cashForm.eventDate}
                      onChange={(e) => setCashForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="资金方向">
                    <select className={PORTFOLIO_SELECT_CLASS} value={cashForm.direction}
                      onChange={(e) => setCashForm((prev) => ({ ...prev, direction: e.target.value as PortfolioCashDirection }))}>
                      <option value="in">入金</option>
                      <option value="out">出金</option>
                    </select>
                  </PortfolioField>
                  <PortfolioField label="金额">
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={cashForm.direction === 'in' ? '入金金额' : '出金金额'}
                      value={cashForm.amount} onChange={(e) => setCashForm((prev) => ({ ...prev, amount: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="币种">
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder={`默认 ${writableAccount?.baseCurrency || '基准币'}`} value={cashForm.currency}
                      onChange={(e) => setCashForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))} />
                  </PortfolioField>
                  <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>提交资金流水</button>
                </div>
              </form>
              ) : null}

              {selectedEntryPanel === 'corporate' && isStockAccount ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleCorporateSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="股票代码">
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder="600519" value={corpForm.symbol}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="生效日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={corpForm.effectiveDate}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="行为类型">
                    <select className={PORTFOLIO_SELECT_CLASS} value={corpForm.actionType}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, actionType: e.target.value as PortfolioCorporateActionType }))}>
                      <option value="cash_dividend">现金分红</option>
                      <option value="split_adjustment">拆并股调整</option>
                    </select>
                  </PortfolioField>
                  {corpForm.actionType === 'cash_dividend' ? (
                    <PortfolioField label="每股分红">
                      <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.000001" placeholder="现金分红金额"
                        value={corpForm.cashDividendPerShare}
                        onChange={(e) => setCorpForm((prev) => ({ ...prev, cashDividendPerShare: e.target.value, splitRatio: '' }))} required />
                    </PortfolioField>
                  ) : (
                    <PortfolioField label="拆并比例">
                      <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.000001" placeholder="新股数 / 旧股数"
                        value={corpForm.splitRatio}
                        onChange={(e) => setCorpForm((prev) => ({ ...prev, splitRatio: e.target.value, cashDividendPerShare: '' }))} required />
                    </PortfolioField>
                  )}
                  <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>提交公司行为</button>
                </div>
              </form>
              ) : null}

              {selectedEntryPanel === 'manualPrice' && (isFundAccount || isCryptoAccount) ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleManualPriceSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label={isFundAccount ? '基金代码' : '币种代码'}>
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder={isFundAccount ? '000001' : 'BTC 或 ETH'} value={manualPriceForm.symbol}
                      onChange={(e) => setManualPriceForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="价格日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={manualPriceForm.priceDate}
                      onChange={(e) => setManualPriceForm((prev) => ({ ...prev, priceDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label={isFundAccount ? '单位净值' : '单币价格'}>
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={isFundAccount ? '最新单位净值' : 'USD 价格'} value={manualPriceForm.price}
                      onChange={(e) => setManualPriceForm((prev) => ({ ...prev, price: e.target.value }))} required />
                  </PortfolioField>
                  <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>保存手工价格</button>
                </div>
              </form>
              ) : null}

              {selectedEntryPanel === 'bank' && isBankAccount ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleBankLedgerSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="流水日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={bankForm.eventDate}
                      onChange={(e) => setBankForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="资产类型">
                    <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.assetKind}
                      onChange={(e) => setBankForm((prev) => ({
                        ...prev,
                        assetKind: e.target.value as PortfolioBankAssetKind,
                        wealthAction: e.target.value === 'wealth' ? 'buy' : prev.wealthAction,
                        direction: e.target.value === 'wealth' ? 'in' : prev.direction,
                        linkedEntryId: '',
                        registrationCode: '',
                        productCode: '',
                        productPublicCode: '',
                        issuerName: '',
                        quantity: '',
                        nav: '',
                      }))}>
                      <option value="demand">活期/现金</option>
                      <option value="deposit">定期存款</option>
                      <option value="wealth">银行理财</option>
                    </select>
                  </PortfolioField>
                  {bankForm.assetKind === 'wealth' ? (
                    <PortfolioField label="操作类型">
                      <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.wealthAction}
                        onChange={(e) => setBankForm((prev) => ({
                          ...prev,
                          wealthAction: e.target.value as BankWealthAction,
                          direction: e.target.value === 'redeem' ? 'out' : 'in',
                          linkedEntryId: '',
                          registrationCode: '',
                          productCode: '',
                          productPublicCode: '',
                          issuerName: '',
                        }))}>
                        <option value="buy">买入</option>
                        <option value="append">追加</option>
                        <option value="redeem">赎回</option>
                      </select>
                    </PortfolioField>
                  ) : (
                    <PortfolioField label="资金方向">
                      <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.direction}
                        onChange={(e) => setBankForm((prev) => ({
                          ...prev,
                          direction: e.target.value as PortfolioCashDirection,
                          linkedEntryId: '',
                          registrationCode: '',
                        }))}>
                        <option value="in">存入/买入</option>
                        <option value="out">取出/赎回</option>
                      </select>
                    </PortfolioField>
                  )}
                  <PortfolioField label="发生金额">
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01" placeholder={getBankAmountPlaceholder(bankForm.assetKind, bankForm.assetKind === 'wealth' && bankForm.wealthAction === 'redeem' ? 'out' : bankForm.direction, bankForm.wealthAction)} value={bankForm.amount}
                      onChange={(e) => setBankForm((prev) => {
                        const amount = Number(e.target.value);
                        const nav = Number(prev.nav);
                        return {
                          ...prev,
                          amount: e.target.value,
                          quantity: prev.assetKind === 'wealth' && nav > 0 && amount > 0 ? String(amount / nav) : prev.quantity,
                        };
                      })} required />
                  </PortfolioField>
                </div>
                {bankForm.assetKind === 'demand' ? (
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <PortfolioField label="银行名称">
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder="例如 招商银行" value={bankForm.bankName}
                        onChange={(e) => setBankForm((prev) => ({ ...prev, bankName: e.target.value }))} required />
                    </PortfolioField>
                    {bankForm.assetKind === 'demand' ? (
                      <div className="flex items-end">
                        <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                          {getBankSubmitLabel(bankForm.assetKind, bankForm.direction, bankForm.wealthAction)}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {bankForm.assetKind === 'deposit' && bankForm.direction === 'in' ? (
                  <>
                    <div className={PORTFOLIO_FORM_GRID_CLASS}>
                      <PortfolioField label="银行名称">
                        <input className={PORTFOLIO_INPUT_CLASS} placeholder="例如 招商银行" value={bankForm.bankName}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, bankName: e.target.value }))} required />
                      </PortfolioField>
                      <PortfolioField label="定期产品名称" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                        <input className={PORTFOLIO_INPUT_CLASS} placeholder="产品名称" value={bankForm.productName}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, productName: e.target.value }))} required />
                      </PortfolioField>
                      <PortfolioField label="年化利率">
                        <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="%" value={bankForm.annualRate}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, annualRate: e.target.value }))} required />
                      </PortfolioField>
                    </div>
                    <div className={PORTFOLIO_FORM_GRID_CLASS}>
                      <PortfolioField label="起息日">
                        <input className={PORTFOLIO_INPUT_CLASS} type="date" value={bankForm.startDate}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, startDate: e.target.value }))} required />
                      </PortfolioField>
                      <PortfolioField label="到期日">
                        <input className={PORTFOLIO_INPUT_CLASS} type="date" value={bankForm.maturityDate}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, maturityDate: e.target.value }))} required />
                      </PortfolioField>
                      <div className="flex items-end">
                        <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                          {getBankSubmitLabel(bankForm.assetKind, bankForm.direction, bankForm.wealthAction)}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
                {bankForm.assetKind !== 'demand' ? (
                  <>
                  {bankForm.direction === 'out' && bankForm.assetKind === 'deposit' ? (
                    <div className={PORTFOLIO_FORM_GRID_CLASS}>
                      <PortfolioField label="定期产品" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                        <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.linkedEntryId}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, linkedEntryId: e.target.value }))} required>
                          <option value="">选择要取出的定期产品</option>
                          {bankDepositOptions.map((item) => (
                            <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                          ))}
                        </select>
                      </PortfolioField>
                      <div className="flex items-end">
                        <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                          {getBankSubmitLabel(bankForm.assetKind, bankForm.direction, bankForm.wealthAction)}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {bankForm.direction === 'out' && bankForm.assetKind === 'wealth' ? (
                    <>
                      <div className={PORTFOLIO_FORM_GRID_8_CLASS}>
                        <PortfolioField label="理财产品" className={PORTFOLIO_FORM_SPAN_4_CLASS}>
                          <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.linkedEntryId}
                            onChange={(e) => setBankForm((prev) => ({ ...prev, linkedEntryId: e.target.value, nav: '', quantity: '' }))} required>
                            <option value="">选择要赎回的理财产品</option>
                            {bankWealthOptions.map((item) => (
                              <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                            ))}
                          </select>
                        </PortfolioField>
                        <div className="flex items-end">
                          <button
                            type="button"
                            className={PORTFOLIO_FORM_TEXT_ACTION_CLASS}
                            onClick={handleExistingBankWealthNavLookup}
                            disabled={bankWealthNavLoading || !selectedWealthOption}
                          >
                            {bankWealthNavLoading ? '查询中...' : '查询净值'}
                          </button>
                        </div>
                      </div>
                      <div className={PORTFOLIO_FORM_GRID_CLASS}>
                        {bankForm.nav ? (
                          <>
                            <PortfolioField label="单位净值">
                              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" value={bankForm.nav}
                                onChange={(e) => setBankForm((prev) => {
                                  const nav = Number(e.target.value);
                                  const amount = Number(prev.amount);
                                  return {
                                    ...prev,
                                    nav: e.target.value,
                                    quantity: nav > 0 && amount > 0 ? String(amount / nav) : '',
                                  };
                                })} />
                            </PortfolioField>
                            <PortfolioField label="赎回份额">
                              <input className={PORTFOLIO_INPUT_CLASS} value={bankForm.quantity} readOnly />
                            </PortfolioField>
                          </>
                        ) : null}
                        <div className="flex items-end">
                          <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                            {getBankSubmitLabel(bankForm.assetKind, 'out', bankForm.wealthAction)}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {bankForm.assetKind === 'wealth' && bankForm.wealthAction === 'append' ? (
                    <>
                      <div className={PORTFOLIO_FORM_GRID_8_CLASS}>
                        <PortfolioField label="理财产品" className={PORTFOLIO_FORM_SPAN_4_CLASS}>
                          <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.linkedEntryId}
                            onChange={(e) => setBankForm((prev) => ({ ...prev, linkedEntryId: e.target.value, nav: '', quantity: '' }))} required>
                            <option value="">选择要追加的理财产品</option>
                            {bankWealthOptions.map((item) => (
                              <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                            ))}
                          </select>
                        </PortfolioField>
                        <div className="flex items-end">
                          <button
                            type="button"
                            className={PORTFOLIO_FORM_TEXT_ACTION_CLASS}
                            onClick={handleExistingBankWealthNavLookup}
                            disabled={bankWealthNavLoading || !selectedWealthOption}
                          >
                            {bankWealthNavLoading ? '查询中...' : '查询净值'}
                          </button>
                        </div>
                      </div>
                      <div className={PORTFOLIO_FORM_GRID_CLASS}>
                        {bankForm.nav ? (
                          <>
                            <PortfolioField label="单位净值">
                              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" value={bankForm.nav}
                                onChange={(e) => setBankForm((prev) => {
                                  const nav = Number(e.target.value);
                                  const amount = Number(prev.amount);
                                  return {
                                    ...prev,
                                    nav: e.target.value,
                                    quantity: nav > 0 && amount > 0 ? String(amount / nav) : '',
                                  };
                                })} />
                            </PortfolioField>
                            <PortfolioField label="确定份额">
                              <input className={PORTFOLIO_INPUT_CLASS} value={bankForm.quantity} readOnly />
                            </PortfolioField>
                          </>
                        ) : null}
                        <div className="flex items-end">
                          <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                            {getBankSubmitLabel(bankForm.assetKind, 'in', bankForm.wealthAction)}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {bankForm.direction === 'in' && bankForm.assetKind === 'wealth' && bankForm.wealthAction === 'buy' ? (
                    <>
                    <div className={PORTFOLIO_FORM_GRID_8_CLASS}>
                      <PortfolioField label="理财产品名称" className={PORTFOLIO_FORM_SPAN_4_CLASS}>
                        <input className={PORTFOLIO_INPUT_CLASS} placeholder="输入完整产品名" value={bankForm.productName}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, productName: e.target.value }))} required />
                      </PortfolioField>
                      <div className="flex items-end">
                          <button
                            type="button"
                            className={PORTFOLIO_FORM_TEXT_ACTION_CLASS}
                            onClick={handleBankWealthProductSearch}
                            disabled={bankWealthSearchLoading}
                          >
                            {bankWealthSearchLoading ? '查询中...' : '查询产品'}
                          </button>
                      </div>
                    </div>
                    </>
                  ) : null}
	                  {bankForm.assetKind === 'wealth' ? (
	                    <>
	                    {bankForm.wealthAction === 'buy' ? (
	                    <>
	                    <div className={PORTFOLIO_FORM_GRID_CLASS}>
                      <PortfolioField label="银行名称">
                        <input className={PORTFOLIO_INPUT_CLASS} placeholder="例如 招商银行" value={bankForm.bankName}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, bankName: e.target.value }))} required />
                      </PortfolioField>
                      <PortfolioField label="产品公布代码">
                        <input className={PORTFOLIO_INPUT_CLASS} placeholder="可选" value={bankForm.registrationCode}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, registrationCode: e.target.value.toUpperCase() }))} />
                      </PortfolioField>
	                      <PortfolioField label="投资性质">
	                        <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.investmentNature}
	                          onChange={(e) => setBankForm((prev) => ({ ...prev, investmentNature: e.target.value as '' | PortfolioBankInvestmentNature }))}>
                          <option value="">选填</option>
                          <option value="fixed_income">固定收益类</option>
                          <option value="mixed">混合类</option>
                          <option value="equity">权益类</option>
                          <option value="commodity_derivative">商品及金融衍生品类</option>
                          <option value="cash_management">现金管理类</option>
                          <option value="other">其他</option>
                        </select>
                      </PortfolioField>
                      <PortfolioField label="风险等级">
                        <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.riskLevel}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, riskLevel: e.target.value as '' | PortfolioBankRiskLevel }))}>
                          <option value="">选填</option>
                          <option value="R1">R1</option>
                          <option value="R2">R2</option>
                          <option value="R3">R3</option>
                          <option value="R4">R4</option>
                          <option value="R5">R5</option>
                        </select>
                      </PortfolioField>
                    </div>
                    <div className={PORTFOLIO_FORM_GRID_CLASS}>
	                      <PortfolioField label="收益方式">
	                        <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.incomeMode}
	                          onChange={(e) => setBankForm((prev) => ({ ...prev, incomeMode: e.target.value as PortfolioBankIncomeMode }))}>
	                          <option value="reinvest">滚存</option>
	                          <option value="dividend">派息</option>
	                        </select>
	                      </PortfolioField>
                      {bankWealthMatchedProduct && bankForm.nav ? (
                        <>
                          <PortfolioField label="单位净值">
                            <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" value={bankForm.nav}
                              onChange={(e) => setBankForm((prev) => {
                                const nav = Number(e.target.value);
                                const amount = Number(prev.amount);
                                return {
                                  ...prev,
                                  nav: e.target.value,
                                  quantity: nav > 0 && amount > 0 ? String(amount / nav) : '',
                                };
                              })} />
                          </PortfolioField>
                          <PortfolioField label="确定份额">
                            <input className={PORTFOLIO_INPUT_CLASS} value={bankForm.quantity} readOnly />
                          </PortfolioField>
                        </>
                      ) : null}
	                      <div className="flex items-end">
	                        <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
	                          {getBankSubmitLabel(bankForm.assetKind, 'in', bankForm.wealthAction)}
	                        </button>
	                      </div>
	                    </div>
                    </>
                    ) : null}
                    </>
                  ) : null}
                  </>
                ) : null}
                {bankForm.assetKind !== 'demand' && bankForm.assetKind !== 'deposit' && bankForm.assetKind !== 'wealth' ? (
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <div>
                      <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                        {getBankSubmitLabel(bankForm.assetKind, bankForm.assetKind === 'wealth' && bankForm.wealthAction === 'redeem' ? 'out' : bankForm.direction, bankForm.wealthAction)}
                      </button>
                    </div>
                  </div>
                ) : null}
              </form>
              ) : null}

              {selectedEntryPanel === 'bankNav' && isBankAccount ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleBankNavSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="理财产品" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                    <select className={PORTFOLIO_SELECT_CLASS} value={bankNavForm.selectedProduct}
                      onChange={(e) => setBankNavForm((prev) => ({ ...prev, selectedProduct: e.target.value }))} required>
                      <option value="">选择要更新价值的理财产品</option>
                      {bankWealthOptions.map((item) => (
                        <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                      ))}
                    </select>
                  </PortfolioField>
                  <PortfolioField label="估值日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={bankNavForm.priceDate}
                      onChange={(e) => setBankNavForm((prev) => ({ ...prev, priceDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="当前总价值">
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01" placeholder="当前总价值" value={bankNavForm.price}
                      onChange={(e) => setBankNavForm((prev) => ({ ...prev, price: e.target.value }))} required />
                  </PortfolioField>
                  <div className="flex items-end">
                    <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>保存价值</button>
                  </div>
                </div>
              </form>
              ) : null}

              {selectedEntryPanel === 'advisory' && isAdvisoryAccount ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleAdvisoryLedgerSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="流水日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={advisoryForm.eventDate}
                      onChange={(e) => setAdvisoryForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="产品类型">
                    <select className={PORTFOLIO_SELECT_CLASS} value={advisoryForm.productType}
                      onChange={(e) => setAdvisoryForm((prev) => ({
                        ...prev,
                        selectedProduct: '',
                        productType: e.target.value as PortfolioAdvisoryProductType,
                        eventType: e.target.value === 'dca_plan' ? 'initial_buy' : 'buy',
                        productCode: '',
                        productName: '',
                        amount: '',
                      }))}>
                      <option value="advisory_combo">投顾组合</option>
                      <option value="dca_plan">定投计划</option>
                    </select>
                  </PortfolioField>
                  <PortfolioField label="操作类型">
                    <select className={PORTFOLIO_SELECT_CLASS} value={advisoryForm.eventType}
                      onChange={(e) => setAdvisoryForm((prev) => ({
                        ...prev,
                        selectedProduct: '',
                        eventType: e.target.value as AdvisoryFormEventType,
                        amount: '',
                      }))}>
                      {advisoryForm.productType === 'advisory_combo' ? (
                        <>
                          <option value="buy">买入</option>
                          <option value="append_buy">追加买入</option>
                          <option value="redeem">赎回</option>
                        </>
                      ) : (
                        <>
                          <option value="initial_buy">首次买入</option>
                          <option value="follow_buy">跟投</option>
                          <option value="redeem">赎回/止盈</option>
                        </>
                      )}
                    </select>
                  </PortfolioField>
                  <PortfolioField label={advisoryForm.eventType === 'redeem' ? '到账金额' : '投入金额'}>
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01"
                      placeholder={advisoryForm.eventType === 'redeem' ? '赎回/止盈到账金额' : '投入金额'}
                      value={advisoryForm.amount}
                      onChange={(e) => setAdvisoryForm((prev) => ({ ...prev, amount: e.target.value }))} required />
                  </PortfolioField>
                </div>
                {advisoryEventRequiresExistingProduct ? (
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <PortfolioField label="投顾产品" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                      <select className={PORTFOLIO_SELECT_CLASS} value={advisoryForm.selectedProduct}
                        onChange={(e) => {
                          const option = advisoryFormProductOptions.find((item) => item.optionValue === e.target.value);
                          setAdvisoryForm((prev) => ({
                            ...prev,
                            selectedProduct: option?.optionValue || '',
                            productCode: option?.productCode || '',
                            productName: option?.productName || option?.displayName || '',
                            productType: option?.productType === 'dca_plan' ? 'dca_plan' : 'advisory_combo',
                            platform: option?.platform || prev.platform,
                            riskLevel: option?.riskLevel || prev.riskLevel,
                            investmentStyle: option?.investmentStyle || prev.investmentStyle,
                          }));
                        }} required>
                        <option value="">{advisoryProductSelectPlaceholder}</option>
                        {advisoryFormProductOptions.map((item) => (
                          <option key={item.optionValue} value={item.optionValue}>{formatAdvisoryPositionOption(item)}</option>
                        ))}
                      </select>
                    </PortfolioField>
                    <div className="lg:col-span-2">
                      <span className={PORTFOLIO_FIELD_LABEL_CLASS}>当前价值</span>
                      <div className="flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.02] px-3 text-xs text-secondary">
                        {selectedAdvisoryOption ? formatMoney(selectedAdvisoryOption.marketValueBase, selectedAdvisoryOption.valuationCurrency) : '--'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <PortfolioField label="平台">
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder="例如 陆基金/陆金所" value={advisoryForm.platform}
                        onChange={(e) => setAdvisoryForm((prev) => ({ ...prev, platform: e.target.value }))} required />
                    </PortfolioField>
                    <PortfolioField label="产品代码">
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder="可选" value={advisoryForm.productCode}
                        onChange={(e) => setAdvisoryForm((prev) => ({ ...prev, productCode: e.target.value.toUpperCase() }))} />
                    </PortfolioField>
                    <PortfolioField label="产品名称" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder="投顾产品名称" value={advisoryForm.productName}
                        onChange={(e) => setAdvisoryForm((prev) => ({ ...prev, productName: e.target.value }))} required />
                    </PortfolioField>
                  </div>
                  </>
                )}
                {!advisoryEventRequiresExistingProduct ? (
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <PortfolioField label="风险等级">
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder="可选" value={advisoryForm.riskLevel}
                        onChange={(e) => setAdvisoryForm((prev) => ({ ...prev, riskLevel: e.target.value }))} />
                    </PortfolioField>
                    <PortfolioField label="投资风格">
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder="可选" value={advisoryForm.investmentStyle}
                        onChange={(e) => setAdvisoryForm((prev) => ({ ...prev, investmentStyle: e.target.value }))} />
                    </PortfolioField>
                  </div>
                ) : null}
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <div>
                    <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>
                      {advisoryForm.eventType === 'redeem' ? '提交投顾赎回' : '提交投顾投入'}
                    </button>
                  </div>
                </div>
              </form>
              ) : null}

              {selectedEntryPanel === 'advisoryNav' && isAdvisoryAccount ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleAdvisoryNavSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="投顾产品" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                    <select className={PORTFOLIO_SELECT_CLASS} value={advisoryNavForm.selectedProduct}
                      onChange={(e) => setAdvisoryNavForm((prev) => ({ ...prev, selectedProduct: e.target.value }))} required>
                      <option value="">选择要更新价值的投顾产品</option>
                      {advisoryOptions.map((item) => (
                        <option key={item.optionValue} value={item.optionValue}>{formatAdvisoryPositionOption(item)}</option>
                      ))}
                    </select>
                  </PortfolioField>
                  <PortfolioField label="估值日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={advisoryNavForm.priceDate}
                      onChange={(e) => setAdvisoryNavForm((prev) => ({ ...prev, priceDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="当前总价值">
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01" placeholder="当前总价值" value={advisoryNavForm.price}
                      onChange={(e) => setAdvisoryNavForm((prev) => ({ ...prev, price: e.target.value }))} required />
                  </PortfolioField>
                  <div className="flex items-end">
                    <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>保存投顾价值</button>
                  </div>
                </div>
              </form>
              ) : null}

              {selectedEntryPanel === 'insurancePolicy' && isInsuranceAccount ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleInsurancePolicySubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="保单名称" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder="必填" value={insurancePolicyForm.policyName}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, policyName: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="保险公司">
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder="选填" value={insurancePolicyForm.insurer}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, insurer: e.target.value }))} />
                  </PortfolioField>
                  <PortfolioField label="保单号">
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder="选填" value={insurancePolicyForm.policyNo}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, policyNo: e.target.value }))} />
                  </PortfolioField>
                  <PortfolioField label="险种">
                    <select className={PORTFOLIO_SELECT_CLASS} value={insurancePolicyForm.insuranceKind}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, insuranceKind: e.target.value as PortfolioInsuranceKind }))}>
                      <option value="annuity">年金险</option>
                      <option value="whole_life">终身寿险</option>
                      <option value="endowment">两全保险</option>
                      <option value="universal">万能险</option>
                      <option value="unit_linked">投连险</option>
                      <option value="other">其他保险</option>
                    </select>
                  </PortfolioField>
                  <PortfolioField label="设计类型">
                    <select className={PORTFOLIO_SELECT_CLASS} value={insurancePolicyForm.designType}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, designType: e.target.value as PortfolioInsuranceDesignType }))}>
                      <option value="ordinary">普通型</option>
                      <option value="participating">分红型</option>
                      <option value="universal">万能型</option>
                      <option value="unit_linked">投资连结型</option>
                      <option value="other">其他</option>
                    </select>
                  </PortfolioField>
                  <PortfolioField label="缴费方式">
                    <select className={PORTFOLIO_SELECT_CLASS} value={insurancePolicyForm.paymentMode}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, paymentMode: e.target.value as PortfolioInsurancePaymentMode }))}>
                      <option value="single">趸交</option>
                      <option value="annual">年交</option>
                      <option value="semiannual">半年交</option>
                      <option value="quarterly">季交</option>
                      <option value="monthly">月交</option>
                      <option value="irregular">不定期</option>
                    </select>
                  </PortfolioField>
                  <PortfolioField label="每期保费">
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01" placeholder="选填" value={insurancePolicyForm.premiumPerPeriod}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, premiumPerPeriod: e.target.value }))} />
                  </PortfolioField>
                </div>
                {insurancePolicyForm.paymentMode !== 'irregular' ? (
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <PortfolioField label="首次缴费日">
                      <input className={PORTFOLIO_INPUT_CLASS} type="date" value={insurancePolicyForm.firstPaymentDate}
                        onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, firstPaymentDate: e.target.value }))} />
                    </PortfolioField>
                    <PortfolioField label="应交期数">
                      <input className={PORTFOLIO_INPUT_CLASS} type="number" min="1" step="1" placeholder="选填" value={insurancePolicyForm.totalPeriods}
                        onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, totalPeriods: e.target.value }))} />
                    </PortfolioField>
                    <div className="flex items-end">
                      <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>保存保单</button>
                    </div>
                  </div>
                ) : (
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <div>
                      <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId}>保存保单</button>
                    </div>
                  </div>
                )}
              </form>
              ) : null}

              {selectedEntryPanel === 'insuranceLedger' && isInsuranceAccount ? (
              <form className={PORTFOLIO_ENTRY_FORM_CLASS} onSubmit={handleInsuranceLedgerSubmit}>
                <div className={PORTFOLIO_FORM_GRID_CLASS}>
                  <PortfolioField label="保单" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                    <select className={PORTFOLIO_SELECT_CLASS} value={insuranceLedgerForm.policyId}
                      onChange={(e) => {
                        const policy = insurancePolicies.find((item) => String(item.id) === e.target.value);
                        const nextEventType = getDefaultInsuranceEventType(policy);
                        setInsuranceLedgerForm((prev) => ({
                          ...prev,
                          policyId: e.target.value,
                          eventType: nextEventType,
                          amount: prev.amount || (policy?.premiumPerPeriod ? String(policy.premiumPerPeriod) : ''),
                        }));
                      }} required>
                      <option value="">选择保单</option>
                      {insurancePolicies.map((item) => (
                        <option key={item.id} value={item.id}>{item.policyName}{item.insurer ? ` · ${item.insurer}` : ''}</option>
                      ))}
                    </select>
                  </PortfolioField>
                  <PortfolioField label="流水日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={insuranceLedgerForm.eventDate}
                      onChange={(e) => setInsuranceLedgerForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="事件类型">
                    <select className={PORTFOLIO_SELECT_CLASS} value={insuranceLedgerForm.eventType}
                      onChange={(e) => setInsuranceLedgerForm((prev) => ({ ...prev, eventType: e.target.value as PortfolioInsuranceEventType }))} disabled={!selectedInsurancePolicy}>
                      {insuranceLedgerEventOptions.length === 0 ? (
                        <option value={insuranceLedgerForm.eventType}>{selectedInsurancePolicy ? '保单已终止' : '先选择保单'}</option>
                      ) : insuranceLedgerEventOptions.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </PortfolioField>
                  <PortfolioField label={insuranceLedgerForm.eventType === 'value_update' ? '当前价值' : '金额'}>
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01" placeholder={insuranceLedgerForm.eventType === 'value_update' ? '现金价值/账户价值' : '金额'} value={insuranceLedgerForm.amount}
                      onChange={(e) => setInsuranceLedgerForm((prev) => ({ ...prev, amount: e.target.value }))} required />
                  </PortfolioField>
                  {insuranceLedgerForm.eventType === 'premium' ? (
                    <PortfolioField label="期数">
                      <input className={PORTFOLIO_INPUT_CLASS} type="number" min="1" step="1" placeholder="选填" value={insuranceLedgerForm.periodNo}
                        onChange={(e) => setInsuranceLedgerForm((prev) => ({ ...prev, periodNo: e.target.value }))} />
                    </PortfolioField>
                  ) : (
                    <PortfolioField label="归类">
                      <input className={PORTFOLIO_INPUT_CLASS} placeholder="系统自动归类为返还/价值" disabled />
                    </PortfolioField>
                  )}
                  <div className="flex items-end">
                    <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId || insurancePolicies.length === 0 || insuranceLedgerEventOptions.length === 0}>
                      {insuranceLedgerForm.eventType === 'value_update' ? '保存保单价值' : '提交保险流水'}
                    </button>
                  </div>
                </div>
              </form>
              ) : null}
            </div>
          </Card>
        </section>
      ) : null}

      <section className={isStockAccount ? "grid grid-cols-1 xl:grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
        {isStockAccount ? (
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-3">券商 CSV 导入</h3>
          <div className={PORTFOLIO_FORM_CLASS}>
            {brokerLoadWarning ? (
              <InlineAlert
                variant="warning"
                className="rounded-lg px-2 py-1 text-xs shadow-none"
                message={brokerLoadWarning}
              />
            ) : null}
            <div className={PORTFOLIO_FORM_GRID_2_CLASS}>
              <select className={PORTFOLIO_SELECT_CLASS} value={selectedBroker} onChange={(e) => setSelectedBroker(e.target.value)}>
                {brokers.length > 0 ? (
                  brokers.map((item) => <option key={item.broker} value={item.broker}>{formatBrokerLabel(item.broker, item.displayName)}</option>)
                ) : (
                  <option value="huatai">huatai（华泰）</option>
                )}
              </select>
              <label className={PORTFOLIO_FILE_PICKER_CLASS}>
                选择 CSV
                <input type="file" accept=".csv" className="hidden"
                  onChange={(e) => setCsvFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs text-secondary">
              <input id="csv-dry-run" type="checkbox" checked={csvDryRun} onChange={(e) => setCsvDryRun(e.target.checked)} />
              <label htmlFor="csv-dry-run">仅预演（不写入）</label>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" disabled={!csvFile || csvParsing} onClick={() => void handleParseCsv()}>
                {csvParsing ? '解析中...' : '解析文件'}
              </button>
              <button type="button" className="btn-secondary flex-1"
                disabled={!csvFile || !writableAccountId || csvCommitting} onClick={() => void handleCommitCsv()}>
                {csvCommitting ? '提交中...' : '提交导入'}
              </button>
            </div>
            {csvParseResult ? (
              <InlineAlert
                variant={getCsvParseVariant(csvParseResult)}
                title="CSV 解析结果"
                message={`有效 ${csvParseResult.recordCount} 条，跳过 ${csvParseResult.skippedCount} 条，错误 ${csvParseResult.errorCount} 条。`}
                className="rounded-lg px-3 py-2 text-xs shadow-none"
              />
            ) : null}
            {csvCommitResult ? (
              <InlineAlert
                variant={getCsvCommitVariant(csvCommitResult, csvDryRun)}
                title={csvDryRun ? 'CSV 预演结果' : 'CSV 提交结果'}
                message={`${csvDryRun ? '预演检查' : '实际写入'}：写入 ${csvCommitResult.insertedCount} 条，重复 ${csvCommitResult.duplicateCount} 条，失败 ${csvCommitResult.failedCount} 条。`}
                className="rounded-lg px-3 py-2 text-xs shadow-none"
              />
            ) : null}
          </div>
        </Card>
        ) : null}

        <Card padding="md">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">事件记录</h3>
              <p className="mt-1 text-xs text-secondary">
                共 {eventTotal} 条{writeBlocked ? ' · 单账户视图可删除修正' : ' · 可删除错误流水'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
              <select className={`${PORTFOLIO_SELECT_CLASS} md:w-36`} value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
                <option value="trade">交易流水</option>
                <option value="cash">资金流水</option>
                {isStockAccount || selectedAccount === 'all' ? <option value="corporate">公司行为</option> : null}
                {isBankAccount || selectedAccount === 'all' ? <option value="bank">银行流水</option> : null}
                {isAdvisoryAccount || selectedAccount === 'all' ? <option value="advisory">投顾流水</option> : null}
                {isInsuranceAccount || selectedAccount === 'all' ? <option value="insurance">保险流水</option> : null}
              </select>
              <button
                type="button"
                className={`btn-secondary text-sm ${showEventFilters || hasEventFilters ? 'border-primary/50 bg-primary/10 text-foreground' : ''}`}
                onClick={() => setShowEventFilters((prev) => !prev)}
              >
                {hasEventFilters ? `筛选 ${eventFilterChips.length}` : '筛选'}
              </button>
              <button type="button" className="btn-secondary text-sm col-span-2 md:col-span-1" onClick={() => void loadEvents()} disabled={eventLoading}>
                {eventLoading ? '加载中...' : '刷新'}
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {hasEventFilters ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {eventFilterChips.map((chip) => (
                  <span key={chip} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-secondary">
                    {chip}
                  </span>
                ))}
                <button type="button" className="btn-secondary !px-2 !py-1 !text-[11px]" onClick={clearEventFilters}>
                  清空
                </button>
              </div>
            ) : null}
            {(showEventFilters || hasEventFilters) ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-2 md:grid-cols-4">
                <input className={PORTFOLIO_INPUT_CLASS} type="date" value={eventDateFrom} onChange={(e) => setEventDateFrom(e.target.value)} />
                <input className={PORTFOLIO_INPUT_CLASS} type="date" value={eventDateTo} onChange={(e) => setEventDateTo(e.target.value)} />
                {(eventType === 'trade' || eventType === 'corporate') ? (
                  <input className={`${PORTFOLIO_INPUT_CLASS} col-span-2 md:col-span-1`} placeholder="代码" value={eventSymbol}
                    onChange={(e) => setEventSymbol(e.target.value)} />
                ) : null}
                {eventType === 'trade' ? (
                  <select className={PORTFOLIO_SELECT_CLASS} value={eventSide} onChange={(e) => setEventSide(e.target.value as '' | PortfolioSide)}>
                    <option value="">全部方向</option>
                    <option value="buy">买入</option>
                    <option value="sell">卖出</option>
                  </select>
                ) : null}
                {eventType === 'cash' ? (
                  <select className={PORTFOLIO_SELECT_CLASS} value={eventDirection}
                    onChange={(e) => setEventDirection(e.target.value as '' | PortfolioCashDirection)}>
                    <option value="">全部方向</option>
                    <option value="in">流入</option>
                    <option value="out">流出</option>
                  </select>
                ) : null}
                {eventType === 'corporate' ? (
                  <select className={PORTFOLIO_SELECT_CLASS} value={eventActionType}
                    onChange={(e) => setEventActionType(e.target.value as '' | PortfolioCorporateActionType)}>
                    <option value="">全部公司行为</option>
                    <option value="cash_dividend">现金分红</option>
                    <option value="split_adjustment">拆并股调整</option>
                  </select>
                ) : null}
                {eventType === 'bank' ? (
                  <select className={PORTFOLIO_SELECT_CLASS} value={eventBankAssetKind}
                    onChange={(e) => setEventBankAssetKind(e.target.value as '' | PortfolioBankAssetKind)}>
                    <option value="">全部银行资产</option>
                    <option value="demand">活期/现金</option>
                    <option value="deposit">定期存款</option>
                    <option value="wealth">银行理财</option>
                  </select>
                ) : null}
                {eventType === 'advisory' ? (
                  <select className={PORTFOLIO_SELECT_CLASS} value={eventAdvisoryDirection}
                    onChange={(e) => setEventAdvisoryDirection(e.target.value as '' | PortfolioAdvisoryEventType)}>
                    <option value="">全部投顾事件</option>
                    <option value="buy">买入/追加</option>
                    <option value="initial_buy">首次买入</option>
                    <option value="follow_buy">跟投</option>
                    <option value="redeem">赎回/止盈</option>
                  </select>
                ) : null}
                {eventType === 'insurance' ? (
                  <select className={PORTFOLIO_SELECT_CLASS} value={eventInsuranceEventType}
                    onChange={(e) => setEventInsuranceEventType(e.target.value as '' | PortfolioInsuranceEventType)}>
                    <option value="">全部保险事件</option>
                    <option value="premium">缴费</option>
                    <option value="value_update">价值更新</option>
                    <option value="survival_benefit">生存金</option>
                    <option value="annuity_payment">年金领取</option>
                    <option value="maturity_benefit">满期金</option>
                    <option value="dividend">分红</option>
                    <option value="partial_withdrawal">部分领取</option>
                    <option value="surrender">退保到账</option>
                    <option value="refund">退费</option>
                    <option value="other_inflow">其他返还</option>
                    <option value="other_outflow">其他支出</option>
                  </select>
                ) : null}
              </div>
            ) : null}
            <div className="max-h-64 overflow-auto rounded-lg border border-white/10 p-2">
              {eventType === 'trade' && tradeEvents.map((item) => (
                <div key={`t-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.tradeDate} {formatSideLabel(item.side)} {item.symbol} 数量={formatTradeQuantity(item)} 价格={item.price}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'trade',
                        id: item.id,
                        message: `确认删除 ${item.tradeDate} 的${formatSideLabel(item.side)}流水 ${item.symbol}（数量 ${formatTradeQuantity(item)}，价格 ${item.price}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {eventType === 'cash' && cashEvents.map((item) => (
                <div key={`c-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.eventDate} {formatCashDirectionLabel(item.direction)} {item.amount} {item.currency}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'cash',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的资金流水（${formatCashDirectionLabel(item.direction)} ${item.amount} ${item.currency}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {eventType === 'corporate' && corporateEvents.map((item) => (
                <div key={`ca-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.effectiveDate} {formatCorporateActionLabel(item.actionType)} {item.symbol}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'corporate',
                        id: item.id,
                        message: `确认删除 ${item.effectiveDate} 的公司行为 ${formatCorporateActionLabel(item.actionType)}（${item.symbol}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {eventType === 'bank' && bankEvents.map((item) => (
                <div key={`b-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.eventDate} {formatBankAssetKind(item.assetKind)} {formatCashDirectionLabel(item.direction)} {item.amount} {item.currency} · {item.bankName}{item.productName ? ` · ${item.productName}` : ''}{item.productPublicCode ? ` · ${item.productPublicCode}` : ''}{item.registrationCode ? ` · ${item.registrationCode}` : ''}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'bank',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的银行流水（${formatBankAssetKind(item.assetKind)} ${formatCashDirectionLabel(item.direction)} ${item.amount} ${item.currency}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {eventType === 'advisory' && advisoryEvents.map((item) => (
                <div key={`a-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.eventDate} {formatAdvisoryProductTypeLabel(item.productType)} · {formatAdvisoryEventLabel(item.eventType || item.direction)} {item.productName}
                    {item.productCode ? ` · ${item.productCode}` : ''} · {item.platform} · 金额 {item.amount} {item.currency}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'advisory',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的投顾流水（${formatAdvisoryEventLabel(item.eventType || item.direction)} ${item.productName}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {eventType === 'insurance' && insuranceEvents.map((item) => {
                const policy = insurancePolicies.find((candidate) => candidate.id === item.policyId);
                return (
                <div key={`i-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.eventDate} {formatInsuranceEventType(item.eventType)} {policy?.policyName || `保单 #${item.policyId}`} · {item.amount} {item.currency}{item.periodNo ? ` · 第 ${item.periodNo} 期` : ''}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'insurance',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的保险流水（${formatInsuranceEventType(item.eventType)} ${policy?.policyName || `保单 #${item.policyId}` }）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
                );
              })}
              {!eventLoading
                && ((eventType === 'trade' && tradeEvents.length === 0)
                  || (eventType === 'cash' && cashEvents.length === 0)
                  || (eventType === 'corporate' && corporateEvents.length === 0)
                  || (eventType === 'bank' && bankEvents.length === 0)
                  || (eventType === 'advisory' && advisoryEvents.length === 0)
                  || (eventType === 'insurance' && insuranceEvents.length === 0)) ? (
                    <EmptyState
                      title="暂无流水"
                      description="调整筛选条件或先录入一笔流水。"
                      className="border-none bg-transparent px-3 py-6 shadow-none"
                    />
                  ) : null}
            </div>
            <div className="flex items-center justify-between text-xs text-secondary">
              <span>第 {eventPage} / {totalEventPages} 页</span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-xs px-3 py-1" disabled={eventPage <= 1}
                  onClick={() => setEventPage((prev) => Math.max(1, prev - 1))}>
                  上一页
                </button>
                <button type="button" className="btn-secondary text-xs px-3 py-1" disabled={eventPage >= totalEventPages}
                  onClick={() => setEventPage((prev) => Math.min(totalEventPages, prev + 1))}>
                  下一页
                </button>
              </div>
            </div>
          </div>
        </Card>
      </section>
      {portfolioToast ? (
        <ToastViewport className="bottom-auto right-auto left-1/2 top-1/2 w-[380px] -translate-x-1/2 -translate-y-1/2">
          <div
            role="status"
            className="pointer-events-auto rounded-2xl border border-success/45 bg-card px-5 py-4 text-center text-foreground shadow-soft-card-strong ring-1 ring-success/15"
          >
            <p className="text-sm font-semibold text-success">{portfolioToast.title}</p>
            <p className="mt-1 text-sm text-foreground">{portfolioToast.message}</p>
          </div>
        </ToastViewport>
      ) : null}
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="删除错误流水"
        message={pendingDelete?.message || '确认删除这条流水吗？'}
        confirmText={deleteLoading ? '删除中...' : '确认删除'}
        cancelText="取消"
        isDanger
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (!deleteLoading) {
            setPendingDelete(null);
          }
        }}
      />
      {activeTagTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/62 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portfolio-tag-picker-title"
          onClick={() => setActiveTagTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border/70 bg-card px-5 py-4 text-foreground shadow-soft-card-strong"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="portfolio-tag-picker-title" className="text-sm font-semibold text-foreground">
                  选择持仓标签
                </h3>
                <p className="mt-1 truncate text-xs text-secondary">
                  {getPositionDisplayName(activeTagTarget.row)}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary shrink-0 !px-2.5 !py-1 !text-xs"
                onClick={() => setActiveTagTarget(null)}
              >
                取消
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                className={`portfolio-tag-picker-option ${activeTagTarget.row.tagId == null ? 'portfolio-tag-picker-option-active' : ''}`}
                onClick={() => void handleProductTagChange(activeTagTarget.row, '')}
                disabled={tagUpdatingKey === activeTagTarget.productKey}
              >
                <span className="portfolio-tag-picker-dot border border-border/70 bg-transparent" />
                <span>无标签</span>
              </button>
              {portfolioTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className={`portfolio-tag-picker-option ${activeTagTarget.row.tagId === tag.id ? 'portfolio-tag-picker-option-active' : ''}`}
                  onClick={() => void handleProductTagChange(activeTagTarget.row, String(tag.id))}
                  disabled={tagUpdatingKey === activeTagTarget.productKey}
                >
                  <span className="portfolio-tag-picker-dot" style={{ background: tag.color }} />
                  <span>{tag.name}</span>
                </button>
              ))}
              {portfolioTags.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-secondary">
                  先在设置中添加标签。
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {bankWealthSearchLoading || bankWealthCandidateModalOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/62 px-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="bank-wealth-search-title"
        >
          <div className="w-full max-w-xl rounded-2xl border border-border/70 bg-card px-5 py-4 text-foreground shadow-soft-card-strong">
            {bankWealthSearchLoading ? (
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
                <h3 id="bank-wealth-search-title" className="mt-3 text-sm font-semibold text-foreground">
                  正在查询银行理财
                </h3>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  正在通过问财匹配产品信息，请稍候。
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 id="bank-wealth-search-title" className="text-sm font-semibold text-foreground">
                      选择银行理财产品
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-secondary">
                      确认后将填入产品信息，并继续查询交易日单位净值。
                    </p>
                  </div>
                  {bankWealthNavLoading ? (
                    <span className="shrink-0 text-xs text-secondary">净值查询中...</span>
                  ) : null}
                </div>
                <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {bankWealthSearchResults.map((product, index) => {
                    const candidateKey = getBankWealthCandidateKey(product, index);
                    const selected = selectedBankWealthCandidateKey === candidateKey;
                    return (
                      <button
                        key={candidateKey}
                        type="button"
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'border-primary bg-primary/8 text-foreground'
                            : 'border-border/70 bg-muted/30 text-secondary hover:border-primary/50 hover:text-foreground'
                        }`}
                        onClick={() => setSelectedBankWealthCandidateKey(candidateKey)}
                        disabled={bankWealthNavLoading}
                      >
                        <span className="block truncate text-sm font-medium">{product.productName}</span>
                        <span className="mt-1 block text-xs leading-5">
                          {[product.issuerName, product.productPublicCode, product.riskLevel, product.investmentType]
                            .filter(Boolean)
                            .join(' · ') || '暂无更多信息'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-secondary h-9 w-24 !px-3 !py-1.5 text-sm"
                    onClick={() => {
                      setBankWealthCandidateModalOpen(false);
                      setSelectedBankWealthCandidateKey('');
                    }}
                    disabled={bankWealthNavLoading}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn-primary h-9 w-24 !px-3 !py-1.5 text-sm"
                    onClick={() => void handleConfirmBankWealthCandidate()}
                    disabled={bankWealthNavLoading || !selectedBankWealthCandidateKey}
                  >
                    {bankWealthNavLoading ? '查询中...' : '确定'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      <Drawer
        isOpen={portfolioAnalysisDrawerOpen}
        onClose={() => setPortfolioAnalysisDrawerOpen(false)}
        title="资产分析报告"
        width="max-w-4xl"
        backdropClassName="bg-background/56 backdrop-blur-[2px]"
      >
        <div className="space-y-4">
          <div className="border-b border-white/10 pb-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">资产分析报告</h2>
              <p className="mt-1 text-xs text-secondary">
                {portfolioAnalysis
                  ? `${portfolioAnalysis.asOf} · ${portfolioAnalysis.modelUsed || 'LLM'}`
                  : '尚未生成当前快照的资产分析'}
              </p>
            </div>
          </div>

          {portfolioAnalysis ? (
            <div
              className="home-markdown-prose prose prose-invert prose-sm max-w-none
                prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
                prose-h2:text-lg prose-h3:text-base
                prose-p:leading-relaxed prose-p:mb-3 prose-p:last:mb-0
                prose-strong:text-foreground prose-strong:font-semibold
                prose-ul:my-2 prose-ol:my-2 prose-li:my-1
                prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                prose-table:border-collapse prose-hr:my-4"
            >
              <Markdown remarkPlugins={[remarkGfm]}>{portfolioAnalysis.fullMarkdown}</Markdown>
            </div>
          ) : (
            <EmptyState
              title="尚未生成资产分析"
              description="点击重新分析后，这里会展示完整的组合结构、风险暴露与收益风险画像。"
              className="border-none bg-transparent px-4 py-10 shadow-none"
            />
          )}
        </div>
      </Drawer>
    </div>
  );
};

export default PortfolioPage;
