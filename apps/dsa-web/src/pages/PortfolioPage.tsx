import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowRight, ArrowRightLeft, CheckCircle2, Loader2, Pencil, Tag } from 'lucide-react';
import { portfolioApi } from '../api/portfolio';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Card, Badge, ConfirmDialog, Drawer, EmptyState, InlineAlert, SelectCompat, ToastViewport, Tooltip } from '../components/common';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge as ShadcnBadge } from '../components/ui/badge';
import { Button as ShadcnButton, buttonVariants } from '../components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../components/ui/chart';
import { useFundIndex } from '../hooks/useFundIndex';
import { useStockIndex } from '../hooks/useStockIndex';
import { toDateInputValue } from '../utils/format';
import { getChangeToneClass } from '../utils/changeTone';
import { resolvePortfolioTagColor } from '../utils/portfolioTagColors';
import { Label, Pie, PieChart } from 'recharts';
import type {
  PortfolioAccountItem,
  PortfolioAdvisoryEventType,
  PortfolioAdvisoryLedgerListItem,
  PortfolioAdvisoryProductItem,
  PortfolioAdvisoryProductType,
  PortfolioAssetTransferAsset,
  PortfolioAssetTransferResponse,
  PortfolioAnalysisResponse,
  PortfolioAnalysisTaskStatus,
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
  PortfolioSnapshotRefreshTaskStatus,
  PortfolioTagItem,
  PortfolioTradeListItem,
} from '../types/portfolio';

const DEFAULT_PAGE_SIZE = 20;
const PORTFOLIO_ANALYSIS_CACHE_PREFIX = 'dsa_portfolio_analysis';
const PORTFOLIO_ANALYSIS_TASK_PREFIX = 'dsa_portfolio_analysis_task';
const PORTFOLIO_ANALYSIS_MODE = 'standard' as const;
const PORTFOLIO_ANALYSIS_SIGNATURE_VERSION = 'v2';

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
  | { amount: number; product?: BankPositionOption; nav?: number; quantity?: number; navDate?: string };

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

type SnapshotRefreshContext = FxRefreshContext;

type PortfolioAlertVariant = 'info' | 'success' | 'warning' | 'danger';

type PortfolioToast = {
  id: number;
  title: string;
  message: string;
};

type AssetBreakdownView = 'tag' | 'type';
type AssetTransferStep = 'select' | 'preview' | 'result';

type ActiveTagTarget = {
  productKey: string;
  row: FlatPosition;
};

type AssetTransferOption = {
  key: string;
  row: FlatPosition;
  asset: PortfolioAssetTransferAsset;
};

type AssetDistributionDatum = {
  key: string;
  chartKey: string;
  label: string;
  amount: number;
  absoluteAmount: number;
  percentage: number | null;
  color: string;
  fill: string;
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
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50';
const PORTFOLIO_SELECT_CLASS = 'w-full';
const PORTFOLIO_FIELD_LABEL_CLASS = 'mb-1.5 block text-[11px] font-medium leading-none text-muted-foreground';
const PORTFOLIO_FORM_CLASS = 'space-y-2';
const PORTFOLIO_ENTRY_FORM_CLASS = 'max-w-5xl space-y-2';
const PORTFOLIO_FORM_GRID_CLASS = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-4';
const PORTFOLIO_FORM_GRID_8_CLASS = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-8';
const PORTFOLIO_FORM_ACTION_CLASS = buttonVariants({ variant: 'default', size: 'default', className: 'w-full self-end' });
const PORTFOLIO_FORM_TEXT_ACTION_CLASS =
  'h-8 w-full cursor-pointer text-left text-[11px] font-medium leading-none text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-60';
const PORTFOLIO_FORM_SPAN_2_CLASS = 'md:col-span-2';
const PORTFOLIO_FORM_SPAN_4_CLASS = 'lg:col-span-4';
const BANK_WEALTH_SEARCH_TIMEOUT_MS = 15000;
const PORTFOLIO_ASSET_CHART_COLORS = [
  'oklch(0.55 0.18 255)',
  'oklch(0.64 0.16 240)',
  'oklch(0.72 0.13 225)',
  'oklch(0.48 0.14 265)',
  'oklch(0.78 0.10 210)',
  'oklch(0.43 0.11 245)',
  'oklch(0.68 0.11 260)',
  'oklch(0.82 0.08 235)',
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
  return currency === 'CNY' ? amount : `${currency} ${amount}`;
}

function formatPositionUnitPrice(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
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
	    return formatPositionUnitPrice(row.priceDisplayValue);
	  }
	  if (row.market === 'advisory') return formatPositionListMoney(row.marketValueBase, row.valuationCurrency);
	  if (isBankWealthPosition(row) && !isBankWealthNavPosition(row)) return formatPositionListMoney(row.marketValueBase, row.valuationCurrency);
	  return formatPositionUnitPrice(row.lastPrice);
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
  return formatAssetQuantity(row.quantity, row.market);
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
	    return formatPositionUnitPrice(row.costDisplayValue);
	  }
	  if (row.market === 'advisory') return formatPositionListMoney(row.totalCost || row.avgCost, row.valuationCurrency);
	  if (isBankWealthPosition(row) && !isBankWealthNavPosition(row)) return formatPositionListMoney(row.totalCost || row.avgCost, row.valuationCurrency);
	  if (row.market === 'bank' && !isBankWealthPosition(row)) return formatPositionListMoney(row.totalCost || row.avgCost, row.valuationCurrency);
	  return formatPositionUnitPrice(row.avgCost);
	}

function formatTradeQuantity(item: PortfolioTradeListItem): string {
  return formatAssetQuantity(item.quantity, item.market);
}

function formatPositionMoney(value: number, row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return formatPositionListMoney(value, row.valuationCurrency);
}

function getChinaPnlColorClass(value: number | undefined | null, hasValue: boolean): string {
  if (!hasValue || value == null || Number.isNaN(value) || value === 0) return 'text-muted-foreground';
  return getChangeToneClass(value);
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

function getAssetTransferKey(row: FlatPosition): string {
  if (row.market === 'bank' && row.linkedEntryId) {
    return `${row.accountId}:bank:${row.linkedEntryId}`;
  }
  if (row.market === 'insurance' && row.policyId) {
    return `${row.accountId}:insurance:${row.policyId}`;
  }
  return `${row.accountId}:${row.market}:${row.symbol}:${row.currency}`;
}

function buildAssetTransferAsset(row: FlatPosition): PortfolioAssetTransferAsset | null {
  const displayName = getPositionDisplayName(row);
  if (row.market === 'bank') {
    if (!row.linkedEntryId) return null;
    return {
      market: row.market,
      symbol: row.symbol,
      currency: row.currency,
      displayName,
      linkedEntryId: row.linkedEntryId,
    };
  }
  if (row.market === 'insurance') {
    if (!row.policyId) return null;
    return {
      market: row.market,
      symbol: row.symbol,
      currency: row.currency,
      displayName,
      policyId: row.policyId,
    };
  }
  if (!row.symbol) return null;
  return {
    market: row.market,
    symbol: row.symbol,
    currency: row.currency,
    displayName,
  };
}

function formatTransferCountLabel(key: string): string {
  const labels: Record<string, string> = {
    trades: '交易流水',
    corporate_actions: '公司行动',
    manual_prices: '手工估值',
    bank_ledger: '银行流水',
    advisory_ledger: '投顾流水',
    insurance_policies: '保单',
    insurance_ledger: '保险流水',
  };
  return labels[key] || key;
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

function calculateAdvisoryQuantity(amountText: string, navText: string): string {
  const amount = Number(amountText);
  const nav = Number(navText);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(nav) || nav <= 0) {
    return '';
  }
  return String(amount / nav);
}

function getBankWealthCandidateKey(product: PortfolioBankWealthProductItem, index: number): string {
  return `${product.productCode || ''}|${product.productPublicCode || ''}|${product.productName}|${index}`;
}

function getAdvisoryCandidateKey(product: PortfolioAdvisoryProductItem, index: number): string {
  return `${product.strategyCode || ''}|${product.productName}|${index}`;
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
  return `${PORTFOLIO_ANALYSIS_SIGNATURE_VERSION}:${(hash >>> 0).toString(16)}`;
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

function loadStoredPortfolioAnalysisTaskId(taskKey: string): string | null {
  if (!taskKey) return null;
  try {
    return window.localStorage.getItem(taskKey);
  } catch {
    return null;
  }
}

function saveStoredPortfolioAnalysisTaskId(taskKey: string, taskId: string): void {
  if (!taskKey || !taskId) return;
  try {
    window.localStorage.setItem(taskKey, taskId);
  } catch {
    // Ignore storage failures; polling still works for the current page session.
  }
}

function clearStoredPortfolioAnalysisTaskId(taskKey: string): void {
  if (!taskKey) return;
  try {
    window.localStorage.removeItem(taskKey);
  } catch {
    // Ignore storage failures.
  }
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
  const [accountEditId, setAccountEditId] = useState<number | null>(null);
  const [accountUpdating, setAccountUpdating] = useState(false);
  const [accountEditError, setAccountEditError] = useState<string | null>(null);
  const [accountEditForm, setAccountEditForm] = useState({
    name: '',
    broker: '',
  });
  const [costMethod, setCostMethod] = useState<PortfolioCostMethod>('fifo');
  const [snapshot, setSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<PortfolioAnalysisResponse | null>(null);
  const [portfolioAnalysisLoading, setPortfolioAnalysisLoading] = useState(false);
  const [portfolioAnalysisTask, setPortfolioAnalysisTask] = useState<PortfolioAnalysisTaskStatus | null>(null);
  const [portfolioAnalysisTaskChecking, setPortfolioAnalysisTaskChecking] = useState(false);
  const [portfolioAnalysisError, setPortfolioAnalysisError] = useState<ParsedApiError | null>(null);
  const [portfolioAnalysisDrawerOpen, setPortfolioAnalysisDrawerOpen] = useState(false);
  const [snapshotRefreshing, setSnapshotRefreshing] = useState(false);
  const [snapshotRefreshTask, setSnapshotRefreshTask] = useState<PortfolioSnapshotRefreshTaskStatus | null>(null);
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const [fxRefreshFeedback, setFxRefreshFeedback] = useState<FxRefreshFeedback | null>(null);
  const [portfolioToast, setPortfolioToast] = useState<PortfolioToast | null>(null);
  const [portfolioTags, setPortfolioTags] = useState<PortfolioTagItem[]>([]);
  const [tagLoadError, setTagLoadError] = useState<ParsedApiError | null>(null);
  const [activeTagTarget, setActiveTagTarget] = useState<ActiveTagTarget | null>(null);
  const [tagUpdatingKey, setTagUpdatingKey] = useState<string | null>(null);
  const [assetTransferOpen, setAssetTransferOpen] = useState(false);
  const [assetTransferStep, setAssetTransferStep] = useState<AssetTransferStep>('select');
  const [assetTransferAssetKey, setAssetTransferAssetKey] = useState('');
  const [assetTransferTargetId, setAssetTransferTargetId] = useState('');
  const [assetTransferPreview, setAssetTransferPreview] = useState<PortfolioAssetTransferResponse | null>(null);
  const [assetTransferResult, setAssetTransferResult] = useState<PortfolioAssetTransferResponse | null>(null);
  const [assetTransferLoading, setAssetTransferLoading] = useState(false);
  const [assetTransferError, setAssetTransferError] = useState<string | null>(null);
  const [assetBreakdownView, setAssetBreakdownView] = useState<AssetBreakdownView>('tag');
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [writeWarning, setWriteWarning] = useState<string | null>(null);


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
  const [advisorySearchResults, setAdvisorySearchResults] = useState<PortfolioAdvisoryProductItem[]>([]);
  const [advisorySearchLoading, setAdvisorySearchLoading] = useState(false);
  const [advisoryNavLoading, setAdvisoryNavLoading] = useState(false);
  const [advisoryCandidateModalOpen, setAdvisoryCandidateModalOpen] = useState(false);
  const [selectedAdvisoryCandidateKey, setSelectedAdvisoryCandidateKey] = useState('');
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
    nav: '',
    navDate: '',
    quantity: '',
    externalStrategyCode: '',
    dataProvider: '',
    managerName: '',
    recommendedHoldingDuration: '',
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
  const snapshotRefreshContextRef = useRef<SnapshotRefreshContext>({ viewKey: refreshViewKey, requestId: 0 });
  const hasAccounts = accounts.length > 0;
  const writableAccount = selectedAccount === 'all' ? undefined : accounts.find((item) => item.id === selectedAccount);
  const writableAccountId = writableAccount?.id;
  const writeBlocked = !writableAccountId;
  const accountEditOpen = accountEditId != null && writableAccount?.id === accountEditId;
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
    ? `${PORTFOLIO_ANALYSIS_CACHE_PREFIX}:${selectedAccount === 'all' ? 'all' : selectedAccount}:${costMethod}:${PORTFOLIO_ANALYSIS_MODE}:${snapshotSignature}`
    : '';
  const portfolioAnalysisTaskKey = snapshotSignature
    ? `${PORTFOLIO_ANALYSIS_TASK_PREFIX}:${selectedAccount === 'all' ? 'all' : selectedAccount}:${costMethod}:${PORTFOLIO_ANALYSIS_MODE}:${snapshotSignature}`
    : '';
  const portfolioAnalysisButtonLabel = portfolioAnalysis
    ? '重新生成报告'
    : '生成资产分析报告';
  const portfolioAnalysisTaskText = portfolioAnalysisTask?.message
    || (portfolioAnalysisLoading ? '后台资产分析正在运行，请保持页面或稍后回来查看。' : '');
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

  const isActiveSnapshotRefreshContext = (requestedViewKey: string, requestedRequestId: number) => {
    return (
      snapshotRefreshContextRef.current.viewKey === requestedViewKey
      && snapshotRefreshContextRef.current.requestId === requestedRequestId
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
    void loadPortfolioTags();
  }, [loadAccounts, loadPortfolioTags]);

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
    snapshotRefreshContextRef.current = {
      viewKey: refreshViewKey,
      requestId: snapshotRefreshContextRef.current.requestId + 1,
    };
    setFxRefreshing(false);
    setFxRefreshFeedback(null);
    setSnapshotRefreshing(false);
    setSnapshotRefreshTask(null);
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
    setPortfolioAnalysisTask(null);
    setPortfolioAnalysisLoading(false);
    setPortfolioAnalysis(loadCachedPortfolioAnalysis(portfolioAnalysisCacheKey, snapshotSignature));
  }, [portfolioAnalysisCacheKey, snapshotSignature]);

  useEffect(() => {
    if (!snapshot || !snapshotSignature) {
      return;
    }
    let cancelled = false;
    void portfolioApi.getSavedPortfolioAnalysis({
      accountId: queryAccountId,
      asOf: snapshot.asOf,
      costMethod,
      snapshotSignature,
      mode: PORTFOLIO_ANALYSIS_MODE,
    })
      .then((response) => {
        if (cancelled) return;
        if (!response.report) {
          setPortfolioAnalysis(null);
          if (portfolioAnalysisCacheKey) {
            window.localStorage.removeItem(portfolioAnalysisCacheKey);
          }
          return;
        }
        setPortfolioAnalysis(response.report);
        saveCachedPortfolioAnalysis(portfolioAnalysisCacheKey, response.report);
      })
      .catch(() => {
        // Local cache remains a non-blocking fallback when saved-report lookup fails.
      });
    return () => {
      cancelled = true;
    };
  }, [costMethod, portfolioAnalysisCacheKey, queryAccountId, snapshot, snapshotSignature]);

  useEffect(() => {
    if (!snapshot || !snapshotSignature || !portfolioAnalysisTaskKey) {
      return;
    }
    let cancelled = false;
    const payload = {
      accountId: queryAccountId,
      asOf: snapshot.asOf,
      costMethod,
      snapshotSignature,
      mode: PORTFOLIO_ANALYSIS_MODE,
    };
    const applyTask = (task: PortfolioAnalysisTaskStatus | null) => {
      if (cancelled) return;
      setPortfolioAnalysisTask(task);
      const active = task?.status === 'pending' || task?.status === 'processing';
      setPortfolioAnalysisLoading(Boolean(active));
      if (task?.status === 'completed' && task.result) {
        setPortfolioAnalysis(task.result);
        saveCachedPortfolioAnalysis(portfolioAnalysisCacheKey, task.result);
        clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
      } else if (task?.status === 'failed') {
        clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
      } else if (active) {
        saveStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey, task.taskId);
      }
    };

    setPortfolioAnalysisTaskChecking(true);
    const storedTaskId = loadStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
    Promise.resolve()
      .then(async () => {
        if (storedTaskId) {
          try {
            const task = await portfolioApi.getPortfolioAnalysisTask(storedTaskId);
            return task;
          } catch (err) {
            const parsed = getParsedApiError(err);
            if (parsed.status === 404) {
              clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
            } else {
              setPortfolioAnalysisError(parsed);
              return {
                taskId: storedTaskId,
                status: 'processing',
                progress: 0,
                message: '后台资产分析状态暂时无法获取，正在重试...',
                canRetry: false,
              } satisfies PortfolioAnalysisTaskStatus;
            }
          }
        }
        const current = await portfolioApi.getCurrentPortfolioAnalysisTask(payload);
        return current.task || null;
      })
      .then((task) => applyTask(task || null))
      .catch(() => {
        if (!cancelled) {
          clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPortfolioAnalysisTaskChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [costMethod, portfolioAnalysisCacheKey, portfolioAnalysisTaskKey, queryAccountId, snapshot, snapshotSignature]);

  useEffect(() => {
    if (!portfolioAnalysisTaskKey || !portfolioAnalysisTask) return;
    if (portfolioAnalysisTask.status !== 'pending' && portfolioAnalysisTask.status !== 'processing') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const task = await portfolioApi.getPortfolioAnalysisTask(portfolioAnalysisTask.taskId);
        if (cancelled) return;
        setPortfolioAnalysisTask(task);
        const active = task.status === 'pending' || task.status === 'processing';
        setPortfolioAnalysisLoading(active);
        if (task.status === 'completed' && task.result) {
          setPortfolioAnalysis(task.result);
          saveCachedPortfolioAnalysis(portfolioAnalysisCacheKey, task.result);
          clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
          setPortfolioAnalysisError(null);
        } else if (task.status === 'failed') {
          clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
          setPortfolioAnalysisError(getParsedApiError(new Error(task.error || task.message || '资产分析失败')));
        }
      } catch (err) {
        if (cancelled) return;
        const parsed = getParsedApiError(err);
        if (parsed.status === 404) {
          clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
          setPortfolioAnalysisLoading(false);
          setPortfolioAnalysisTask(null);
        }
        setPortfolioAnalysisError(parsed);
      }
    };
    const interval = window.setInterval(() => {
      void poll();
    }, 3000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [portfolioAnalysisCacheKey, portfolioAnalysisTask, portfolioAnalysisTaskKey]);

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
  const portfolioAnalysisButtonDisabled = (
    positionRows.length === 0
    || portfolioAnalysisLoading
    || portfolioAnalysisTaskChecking
    || !snapshotSignature
  );

  const assetTransferOptions: AssetTransferOption[] = useMemo(
    () => positionRows
      .filter((row) => row.accountId === writableAccountId)
      .map((row) => {
        const asset = buildAssetTransferAsset(row);
        return asset ? { key: getAssetTransferKey(row), row, asset } : null;
      })
      .filter((item): item is AssetTransferOption => Boolean(item)),
    [positionRows, writableAccountId],
  );
  const assetTransferTargets = useMemo(
    () => accounts.filter((account) => (
      writableAccount
      && account.id !== writableAccount.id
      && account.market === writableAccount.market
      && account.isActive
    )),
    [accounts, writableAccount],
  );
  const selectedAssetTransferOption = assetTransferOptions.find((item) => item.key === assetTransferAssetKey) || null;
  const selectedAssetTransferTarget = assetTransferTargets.find((item) => String(item.id) === assetTransferTargetId) || null;

  const closeAssetTransfer = useCallback(() => {
    if (assetTransferLoading) return;
    setAssetTransferOpen(false);
    setAssetTransferStep('select');
    setAssetTransferAssetKey('');
    setAssetTransferTargetId('');
    setAssetTransferPreview(null);
    setAssetTransferResult(null);
    setAssetTransferError(null);
  }, [assetTransferLoading]);

  const openAssetTransfer = useCallback(() => {
    setAssetTransferOpen(true);
    setAssetTransferStep('select');
    setAssetTransferPreview(null);
    setAssetTransferResult(null);
    setAssetTransferError(null);
    setAssetTransferAssetKey((prev) => (
      prev && assetTransferOptions.some((item) => item.key === prev)
        ? prev
        : assetTransferOptions[0]?.key || ''
    ));
    setAssetTransferTargetId((prev) => (
      prev && assetTransferTargets.some((item) => String(item.id) === prev)
        ? prev
        : (assetTransferTargets[0]?.id != null ? String(assetTransferTargets[0].id) : '')
    ));
  }, [assetTransferOptions, assetTransferTargets]);

  const handlePreviewAssetTransfer = useCallback(async () => {
    if (!writableAccountId || !selectedAssetTransferOption || !selectedAssetTransferTarget) {
      setAssetTransferError('请选择待转移资产和目标账户。');
      return;
    }
    setAssetTransferLoading(true);
    setAssetTransferError(null);
    try {
      const preview = await portfolioApi.previewAssetTransfer(writableAccountId, {
        targetAccountId: selectedAssetTransferTarget.id,
        asset: selectedAssetTransferOption.asset,
      });
      setAssetTransferPreview(preview);
      setAssetTransferStep('preview');
    } catch (err) {
      setAssetTransferError(getParsedApiError(err).message || '转移预览失败，请稍后重试。');
    } finally {
      setAssetTransferLoading(false);
    }
  }, [selectedAssetTransferOption, selectedAssetTransferTarget, writableAccountId]);

  const handleConfirmAssetTransfer = useCallback(async () => {
    if (!writableAccountId || !selectedAssetTransferOption || !selectedAssetTransferTarget) {
      setAssetTransferError('请选择待转移资产和目标账户。');
      return;
    }
    setAssetTransferLoading(true);
    setAssetTransferError(null);
    try {
      const result = await portfolioApi.transferAsset(writableAccountId, {
        targetAccountId: selectedAssetTransferTarget.id,
        asset: selectedAssetTransferOption.asset,
      });
      setAssetTransferResult(result);
      setAssetTransferStep('result');
      showPortfolioToast(
        '资产已转移',
        `${getPositionDisplayName(selectedAssetTransferOption.row)} 已移动到 ${selectedAssetTransferTarget.name}。`,
      );
      await refreshPortfolioData(eventPage, { refreshPrices: false });
    } catch (err) {
      setAssetTransferError(getParsedApiError(err).message || '资产转移失败，请稍后重试。');
    } finally {
      setAssetTransferLoading(false);
    }
  }, [
    eventPage,
    refreshPortfolioData,
    selectedAssetTransferOption,
    selectedAssetTransferTarget,
    showPortfolioToast,
    writableAccountId,
  ]);

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
  const advisoryFormHasUnitNav = advisoryForm.productType === 'advisory_combo'
    && Boolean(advisoryForm.externalStrategyCode)
    && Number(advisoryForm.nav) > 0
    && Number(advisoryForm.quantity) > 0;
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
      const nav = parsePositiveFormNumber(advisoryForm.nav);
      const quantity = parsePositiveFormNumber(advisoryForm.quantity);
      return {
        amount,
        product: selectedAdvisoryOption,
        nav: nav || undefined,
        quantity: quantity || undefined,
        navDate: advisoryForm.navDate || undefined,
      };
    }

    const amount = parsePositiveFormNumber(advisoryForm.amount);
    if (amount == null) {
      return { error: '请填写投入金额。' };
    }
    const nav = parsePositiveFormNumber(advisoryForm.nav);
    const quantity = parsePositiveFormNumber(advisoryForm.quantity);
    return {
      amount,
      product: undefined,
      nav: nav || undefined,
      quantity: quantity || undefined,
      navDate: advisoryForm.navDate || undefined,
    };
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
  const assetDistributionRows: AssetDistributionDatum[] = assetBreakdownView === 'tag'
    ? tagBreakdownRows.map((item, index) => {
      const absoluteAmount = Math.abs(item.amount);
      const chartKey = `slice_${index}`;
      const color = PORTFOLIO_ASSET_CHART_COLORS[index % PORTFOLIO_ASSET_CHART_COLORS.length];
      return {
        key: item.key,
        chartKey,
        label: item.tagName,
        amount: item.amount,
        absoluteAmount,
        percentage: tagBreakdownTotal > 0 ? absoluteAmount / tagBreakdownTotal * 100 : null,
        color,
        fill: `var(--color-${chartKey})`,
      };
    })
    : assetBreakdownRows.map((item, index) => {
      const absoluteAmount = Math.abs(item.value);
      const chartKey = `slice_${index}`;
      const color = PORTFOLIO_ASSET_CHART_COLORS[index % PORTFOLIO_ASSET_CHART_COLORS.length];
      return {
        key: item.key,
        chartKey,
        label: formatMarketLabel(item.key),
        amount: item.value,
        absoluteAmount,
        percentage: assetBreakdownTotal > 0 ? absoluteAmount / assetBreakdownTotal * 100 : null,
        color,
        fill: `var(--color-${chartKey})`,
      };
    });
  const assetDistributionTotal = assetBreakdownView === 'tag' ? tagBreakdownTotal : assetBreakdownTotal;
  const assetDistributionChartConfig = assetDistributionRows.reduce<ChartConfig>((config, item) => {
    config[item.chartKey] = {
      label: item.label,
      color: item.color,
    };
    return config;
  }, {
    absoluteAmount: {
      label: '资产金额',
    },
  });
  const hasAssetDistributionData = assetDistributionRows.length > 0 && assetDistributionTotal > 0;

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
      await refreshPortfolioData(eventPage);
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
      await refreshPortfolioData(eventPage);
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
      await refreshPortfolioData(eventPage);
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
      await refreshPortfolioData(eventPage);
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
      await refreshPortfolioData(eventPage);
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

  const applyAdvisoryNav = async (strategyCode: string, navDate = advisoryForm.eventDate) => {
    if (!strategyCode || advisoryForm.productType !== 'advisory_combo' || !navDate) {
      return;
    }
    try {
      setAdvisoryNavLoading(true);
      const nav = await portfolioApi.getAdvisoryNav(strategyCode, navDate);
      if (nav.unitNav && nav.unitNav > 0) {
        setAdvisoryForm((prev) => ({
          ...prev,
          nav: String(nav.unitNav),
          navDate: nav.navDate || navDate,
          quantity: calculateAdvisoryQuantity(prev.amount, String(nav.unitNav)),
        }));
      } else {
        setAdvisoryForm((prev) => ({ ...prev, nav: '', navDate: '', quantity: '' }));
        setWriteWarning('已选中投顾产品，但盈米未返回流水日期附近的历史净值；本次将按金额型投顾记录。');
      }
    } catch (err) {
      setAdvisoryForm((prev) => ({ ...prev, nav: '', navDate: '', quantity: '' }));
      setWriteWarning(getParsedApiError(err).message || '投顾历史净值查询失败；本次将按金额型投顾记录。');
    } finally {
      setAdvisoryNavLoading(false);
    }
  };

  const applyAdvisoryProduct = async (product: PortfolioAdvisoryProductItem) => {
    const productType = advisoryForm.productType;
    setAdvisoryForm((prev) => ({
      ...prev,
      productName: product.productName || prev.productName,
      productCode: prev.productCode,
      riskLevel: product.riskLevel || prev.riskLevel,
      investmentStyle: prev.investmentStyle,
      externalStrategyCode: product.strategyCode || '',
      dataProvider: product.source || 'yingmi_stargate',
      managerName: product.managerName || '',
      recommendedHoldingDuration: product.recommendedHoldingDuration || '',
      nav: '',
      navDate: '',
      quantity: '',
    }));
    try {
      if (productType === 'advisory_combo') {
        await applyAdvisoryNav(product.strategyCode);
      }
    } finally {
      setAdvisoryCandidateModalOpen(false);
    }
  };

  const applyExistingAdvisoryProduct = async (option: BankPositionOption | undefined) => {
    setAdvisoryForm((prev) => ({
      ...prev,
      selectedProduct: option?.optionValue || '',
      productCode: option?.productCode || '',
      productName: option?.productName || option?.displayName || '',
      productType: option?.productType === 'dca_plan' ? 'dca_plan' : 'advisory_combo',
      platform: option?.platform || prev.platform,
      riskLevel: option?.riskLevel || prev.riskLevel,
      investmentStyle: option?.investmentStyle || prev.investmentStyle,
      externalStrategyCode: option?.externalStrategyCode || '',
      dataProvider: option?.dataProvider || '',
      managerName: option?.managerName || '',
      recommendedHoldingDuration: option?.recommendedHoldingDuration || '',
      nav: '',
      navDate: '',
      quantity: '',
    }));
    if (
      option?.productType !== 'dca_plan'
      && option?.externalStrategyCode
      && option?.valuationModelDetail === 'unit_nav'
    ) {
      await applyAdvisoryNav(option.externalStrategyCode);
    }
  };

  const handleAdvisoryProductSearch = async () => {
    const keyword = advisoryForm.productName.trim();
    if (!keyword) {
      setWriteWarning('请先输入投顾产品名称。');
      return;
    }
    try {
      setWriteWarning(null);
      setAdvisorySearchLoading(true);
      setAdvisoryNavLoading(false);
      setAdvisoryCandidateModalOpen(false);
      setSelectedAdvisoryCandidateKey('');
      setAdvisorySearchResults([]);
      setAdvisoryForm((prev) => ({
        ...prev,
        externalStrategyCode: '',
        dataProvider: '',
        nav: '',
        navDate: '',
        quantity: '',
        managerName: '',
        recommendedHoldingDuration: '',
      }));
      const response = await withTimeout(
        portfolioApi.searchAdvisoryProducts(keyword, advisoryForm.productType),
        BANK_WEALTH_SEARCH_TIMEOUT_MS,
      );
      const products = response.products || [];
      setAdvisorySearchResults(products);
      if (!products.length) {
        setWriteWarning('盈米没有返回匹配的投顾产品，可继续手动填写后保存。');
        return;
      }
      setSelectedAdvisoryCandidateKey(getAdvisoryCandidateKey(products[0], 0));
      setAdvisoryCandidateModalOpen(true);
    } catch (err) {
      setAdvisorySearchResults([]);
      setAdvisoryCandidateModalOpen(false);
      setSelectedAdvisoryCandidateKey('');
      setAdvisoryForm((prev) => ({
        ...prev,
        externalStrategyCode: '',
        dataProvider: '',
        nav: '',
        navDate: '',
        quantity: '',
      }));
      const parsed = getParsedApiError(err);
      setWriteWarning(
        err instanceof Error && err.message === 'timeout'
          ? '投顾产品查询超时，可继续手动填写后保存。'
          : parsed.message || '投顾产品查询失败，可继续手动填写后保存。',
      );
    } finally {
      setAdvisorySearchLoading(false);
      setAdvisoryNavLoading(false);
    }
  };

  const handleConfirmAdvisoryCandidate = async () => {
    const selectedProduct = advisorySearchResults.find(
      (item, index) => getAdvisoryCandidateKey(item, index) === selectedAdvisoryCandidateKey,
    ) || advisorySearchResults[0];
    if (!selectedProduct) {
      setAdvisoryCandidateModalOpen(false);
      return;
    }
    await applyAdvisoryProduct(selectedProduct);
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
      await refreshPortfolioData(eventPage);
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
        quantity: advisoryFormHasUnitNav ? payload.quantity : undefined,
        nav: advisoryFormHasUnitNav ? payload.nav : undefined,
        navDate: advisoryFormHasUnitNav ? payload.navDate : undefined,
        externalStrategyCode: advisoryForm.externalStrategyCode || undefined,
        dataProvider: advisoryForm.dataProvider || undefined,
        valuationModel: advisoryFormHasUnitNav ? 'unit_nav' : 'amount_value',
        managerName: advisoryForm.managerName || undefined,
        recommendedHoldingDuration: advisoryForm.recommendedHoldingDuration || undefined,
      });
      await refreshPortfolioData(eventPage);
      setAdvisoryForm((prev) => ({
        ...prev,
        amount: '',
        productName: advisoryEventRequiresExistingProduct ? prev.productName : '',
        productCode: advisoryEventRequiresExistingProduct ? prev.productCode : '',
        selectedProduct: advisoryEventRequiresExistingProduct ? prev.selectedProduct : '',
        nav: '',
        navDate: '',
        quantity: '',
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
      await refreshPortfolioData(eventPage);
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
      await refreshPortfolioData(eventPage);
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
      await refreshPortfolioData(eventPage);
      setInsuranceLedgerForm((prev) => ({ ...prev, amount: '', note: '' }));
      showPortfolioToast(
        '保险流水已记录',
        `${selectedInsurancePolicy.policyName} · ${formatInsuranceEventType(insuranceLedgerForm.eventType)} ${formatMoney(Number(insuranceLedgerForm.amount), selectedInsurancePolicy.currency || 'CNY')}。`,
      );
    } catch (err) {
      setError(getParsedApiError(err));
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
      await refreshPortfolioData(nextPage);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setDeleteLoading(false);
    }
  };

  const openAccountEdit = () => {
    if (!writableAccount) return;
    setAccountEditId(writableAccount.id);
    setAccountEditForm({
      name: writableAccount.name,
      broker: writableAccount.broker || '',
    });
    setAccountEditError(null);
  };

  const closeAccountEdit = () => {
    if (accountUpdating) return;
    setAccountEditId(null);
    setAccountEditError(null);
  };

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setAccountEditError('请先选择具体账户。');
      return;
    }
    const name = accountEditForm.name.trim();
    if (!name) {
      setAccountEditError('账户名称不能为空。');
      return;
    }
    try {
      setAccountUpdating(true);
      setAccountEditError(null);
      await portfolioApi.updateAccount(writableAccountId, {
        name,
        broker: accountEditForm.broker.trim(),
      });
      setAccountEditId(null);
      setWriteWarning(null);
      showPortfolioToast('账户已更新', `${name} 的账户信息已保存。`);
      await Promise.all([loadAccounts(), loadSnapshot({ refreshPrices: false })]);
    } catch (err) {
      const parsed = getParsedApiError(err);
      setAccountEditError(parsed.message || '更新账户失败，请稍后重试。');
    } finally {
      setAccountUpdating(false);
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
    if (!hasAccounts || snapshotRefreshing) {
      return;
    }

    const requestedViewKey = refreshViewKey;
    const requestedAccountId = queryAccountId;
    const requestedCostMethod = costMethod;
    const requestedRequestId = snapshotRefreshContextRef.current.requestId + 1;
    snapshotRefreshContextRef.current = {
      viewKey: requestedViewKey,
      requestId: requestedRequestId,
    };

    try {
      setSnapshotRefreshing(true);
      setSnapshotRefreshTask(null);
      setError(null);
      const accepted = await portfolioApi.startSnapshotRefreshTask({
        accountId: requestedAccountId,
        costMethod: requestedCostMethod,
      });
      if (!isActiveSnapshotRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      setSnapshotRefreshTask({
        taskId: accepted.taskId,
        status: accepted.status,
        progress: accepted.progress,
        message: accepted.message,
        canRetry: accepted.canRetry,
      });

      let currentTask: PortfolioSnapshotRefreshTaskStatus | null = null;
      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 10 ? 1000 : 2000));
        if (!isActiveSnapshotRefreshContext(requestedViewKey, requestedRequestId)) {
          return;
        }
        currentTask = await portfolioApi.getSnapshotRefreshTask(accepted.taskId);
        if (!isActiveSnapshotRefreshContext(requestedViewKey, requestedRequestId)) {
          return;
        }
        setSnapshotRefreshTask(currentTask);
        if (currentTask.status === 'completed' || currentTask.status === 'failed') {
          break;
        }
      }

      if (!currentTask || currentTask.status !== 'completed') {
        throw new Error(currentTask?.error || currentTask?.message || '在线行情刷新未完成');
      }
      if (!currentTask.result) {
        throw new Error('在线行情刷新完成但未返回快照');
      }
      setSnapshot(currentTask.result);
      await Promise.all([loadAccounts(), loadEvents()]);
    } catch (err) {
      if (isActiveSnapshotRefreshContext(requestedViewKey, requestedRequestId)) {
        setError(getParsedApiError(err));
      }
    } finally {
      if (isActiveSnapshotRefreshContext(requestedViewKey, requestedRequestId)) {
        setSnapshotRefreshing(false);
      }
    }
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
        refreshPrices: false,
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
    if (!hasAccounts || isLoading || snapshotRefreshing || fxRefreshing) {
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
    if (!snapshot || !snapshotSignature || portfolioAnalysisLoading || portfolioAnalysisTaskChecking) {
      return;
    }
    const cacheKey = snapshotSignature
      ? `${PORTFOLIO_ANALYSIS_CACHE_PREFIX}:${selectedAccount === 'all' ? 'all' : selectedAccount}:${costMethod}:${PORTFOLIO_ANALYSIS_MODE}:${snapshotSignature}`
      : '';
    try {
      setPortfolioAnalysisLoading(true);
      setPortfolioAnalysisError(null);
      const task = await portfolioApi.startPortfolioAnalysisTask({
        accountId: queryAccountId,
        asOf: snapshot.asOf,
        costMethod,
        snapshotSignature,
        mode: PORTFOLIO_ANALYSIS_MODE,
      });
      const taskStatus: PortfolioAnalysisTaskStatus = {
        taskId: task.taskId,
        status: task.status,
        progress: task.progress,
        message: task.message,
        canRetry: task.canRetry,
      };
      setPortfolioAnalysisTask(taskStatus);
      saveStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey, task.taskId);
      if (task.status === 'completed') {
        const completed = await portfolioApi.getPortfolioAnalysisTask(task.taskId);
        setPortfolioAnalysisTask(completed);
        if (completed.result) {
          setPortfolioAnalysis(completed.result);
          saveCachedPortfolioAnalysis(cacheKey, completed.result);
          clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
        }
        setPortfolioAnalysisLoading(false);
      }
    } catch (err) {
      setPortfolioAnalysisError(getParsedApiError(err));
      setPortfolioAnalysisTask(null);
      clearStoredPortfolioAnalysisTaskId(portfolioAnalysisTaskKey);
      setPortfolioAnalysisLoading(false);
    }
  };

  return (
    <div className="portfolio-page min-h-[calc(100vh-5rem)] w-full min-w-0 space-y-4 pb-4 sm:min-h-[calc(100vh-5.5rem)] lg:min-h-[calc(100vh-2rem)]">
      <section className="space-y-3">
        <div className={PORTFOLIO_FORM_CLASS}>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">持仓管理</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            组合快照、手工录入与资产分析（支持全组合 / 单账户切换）
          </p>
        </div>
        {hasAccounts ? (
          <div className="rounded-xl border border-border bg-muted p-3">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px_280px] gap-2 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">账户视图</p>
                <SelectCompat
                  value={String(selectedAccount)}
                  onChange={(e) => {
                    setSelectedAccount(e.target.value === 'all' ? 'all' : Number(e.target.value));
                    setAccountEditId(null);
                    setAccountEditError(null);
                  }}
                  className={PORTFOLIO_SELECT_CLASS}
                >
                  <option value="all">全部账户</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} (#{account.id})
                    </option>
                  ))}
                </SelectCompat>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">成本口径</p>
                <SelectCompat
                  value={costMethod}
                  onChange={(e) => setCostMethod(e.target.value as PortfolioCostMethod)}
                  className={PORTFOLIO_SELECT_CLASS}
                >
                  <option value="fifo">先进先出（FIFO）</option>
                  <option value="avg">均价成本（AVG）</option>
                </SelectCompat>
              </div>
              <div className="flex gap-2">
                <ShadcnButton
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowCreateAccount((prev) => !prev);
                    setAccountCreateError(null);
                    setAccountCreateSuccess(null);
                  }}
                >
                  {showCreateAccount ? '收起新建' : '新建账户'}
                </ShadcnButton>
                <ShadcnButton
                  type="button"
                  variant="outline"
                  onClick={() => void handleRefresh()}
                  disabled={isLoading || snapshotRefreshing || fxRefreshing}
                  className="flex-1"
                >
                  {snapshotRefreshing
                    ? `刷新中${snapshotRefreshTask?.progress != null ? ` ${snapshotRefreshTask.progress}%` : '...'}`
                    : isLoading ? '加载中...' : '刷新数据'}
                </ShadcnButton>
              </div>
            </div>
          </div>
        ) : (
          <InlineAlert
            variant="warning"
            className="inline-block rounded-lg px-3 py-2 text-xs shadow-none"
            message="还没有可用账户，请先创建账户后再录入交易。"
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
        <Card padding="md">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">新建账户</h2>
            {hasAccounts ? (
              <ShadcnButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowCreateAccount(false);
                  setAccountCreateError(null);
                  setAccountCreateSuccess(null);
                }}
              >
                收起
              </ShadcnButton>
            ) : (
              <span className="text-xs text-muted-foreground">创建后自动切换到该账户</span>
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
            <SelectCompat
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
            </SelectCompat>
            <ShadcnButton type="submit" variant="outline" disabled={accountCreating}>
              {accountCreating ? '创建中...' : '创建账户'}
            </ShadcnButton>
          </form>
        </Card>
      ) : null}

      {selectedAccount !== 'all' && writableAccount ? (
        <div className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              当前账户：<span className="text-foreground">{writableAccount.name}</span>
              <span> · {writableAccount.broker || '未设置机构/平台'}</span>
              <span> · {formatMarketLabel(writableAccount.market)}</span>
              <span> · {writableAccount.baseCurrency}</span>
            </div>
            <ShadcnButton
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={accountEditOpen ? closeAccountEdit : openAccountEdit}
              disabled={accountUpdating}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              {accountEditOpen ? '收起编辑' : '编辑'}
            </ShadcnButton>
          </div>
          {accountEditOpen ? (
            <form className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={handleUpdateAccount}>
              {accountEditError ? (
                <InlineAlert
                  variant="danger"
                  className="md:col-span-3 rounded-lg px-2 py-1 text-xs shadow-none"
                  title="更新账户失败"
                  message={accountEditError}
                />
              ) : null}
              <PortfolioField label="账户名称">
                <input
                  className={PORTFOLIO_INPUT_CLASS}
                  value={accountEditForm.name}
                  onChange={(e) => setAccountEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={accountUpdating}
                />
              </PortfolioField>
              <PortfolioField label="机构/平台">
                <input
                  className={PORTFOLIO_INPUT_CLASS}
                  placeholder="可留空"
                  value={accountEditForm.broker}
                  onChange={(e) => setAccountEditForm((prev) => ({ ...prev, broker: e.target.value }))}
                  disabled={accountUpdating}
                />
              </PortfolioField>
              <div className="grid gap-1 self-end md:min-w-52">
                <div className="text-[11px] leading-none text-muted-foreground">
                  账户类型 {formatMarketLabel(writableAccount.market)} · 基准币 {writableAccount.baseCurrency}
                </div>
                <div className="flex gap-2">
                  <ShadcnButton type="button" variant="outline" className="flex-1" onClick={closeAccountEdit} disabled={accountUpdating}>
                    取消
                  </ShadcnButton>
                  <ShadcnButton type="submit" variant="outline" className="flex-1" disabled={accountUpdating}>
                    {accountUpdating ? '保存中...' : '保存'}
                  </ShadcnButton>
                </div>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card padding="md">
          <p className="text-xs text-muted-foreground">总权益</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatAggregateMoney(snapshot, snapshot?.totalEquity)}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-muted-foreground">总市值</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatAggregateMoney(snapshot, snapshot?.totalMarketValue)}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-muted-foreground">总现金</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatAggregateMoney(snapshot, snapshot?.totalCash)}</p>
        </Card>
        <Card padding="md">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">汇率状态</p>
            <ShadcnButton
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void handleRefreshFx()}
              disabled={!hasAccounts || isLoading || snapshotRefreshing || fxRefreshing}
            >
              {fxRefreshing ? '刷新中...' : '刷新汇率'}
            </ShadcnButton>
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
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">共 {positionRows.length} 项</span>
              {selectedAccount !== 'all' ? (
                <Tooltip
                  content={assetTransferOptions.length === 0 ? '当前账户暂无可转移资产' : '转移当前账户中的单个资产'}
                  contentClassName="max-w-xs"
                >
                  <ShadcnButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openAssetTransfer}
                    disabled={!writableAccountId || assetTransferOptions.length === 0}
                  >
                    <ArrowRightLeft data-icon="inline-start" aria-hidden="true" />
                    转移资产
                  </ShadcnButton>
                </Tooltip>
              ) : null}
            </div>
          </div>
          {positionRows.length === 0 ? (
            <EmptyState
              title="当前无持仓数据"
              description="录入交易或导入流水后，这里会展示按账户汇总的持仓明细。"
              className="border-none bg-transparent px-4 py-8 shadow-none"
            />
          ) : (
            <div className="min-w-0">
              <Table className="table-fixed">
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[22%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[12%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>类型/账户</TableHead>
                    <TableHead>资产</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">成本价</TableHead>
                    <TableHead className="text-right">现价</TableHead>
                    <TableHead className="text-right">市值</TableHead>
                    <TableHead className="text-right">未实现盈亏</TableHead>
                    <TableHead className="text-right">收益率</TableHead>
                    <TableHead className="text-right">年化</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positionRows.map((row) => {
                    const assetName = getPositionDisplayName(row);
                    const secondaryLine = getPositionSecondaryLine(row, assetNameMaps);
                    const tagLabel = row.tagName || '+标签';
                    const matchedTagIndex = row.tagName
                      ? portfolioTags.findIndex((tag) => (row.tagId != null ? tag.id === row.tagId : tag.name === row.tagName))
                      : -1;
                    const matchedTag = matchedTagIndex >= 0 ? portfolioTags[matchedTagIndex] : undefined;
                    const tagFillColor = row.tagName
                      ? resolvePortfolioTagColor(matchedTag?.color ?? row.tagColor, matchedTagIndex)
                      : undefined;
                    const assetType = getPositionAssetType(row, assetNameMaps);
                    return (
                    <TableRow key={`${row.accountId}-${row.symbol}-${row.market}-${row.productName || ''}`}>
                      <TableCell data-label="类型/账户">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <Tooltip content={assetType} className="w-full min-w-0" contentClassName="max-w-xs">
                            <span className="block max-w-full truncate text-sm font-medium text-foreground">
                              {assetType}
                            </span>
                          </Tooltip>
                          <Tooltip content={row.accountName} className="w-full min-w-0" contentClassName="max-w-xs">
                            <span className="block max-w-full truncate text-xs text-muted-foreground">
                              {row.accountName}
                            </span>
                          </Tooltip>
                        </div>
                      </TableCell>
                      <TableCell data-label="资产">
                        <div className="flex min-w-0 flex-col gap-1">
                          <Tooltip content={assetName} className="w-full min-w-0" contentClassName="max-w-xs">
                            <span className={`block max-w-full truncate text-foreground ${row.market === 'bank' || row.market === 'advisory' ? '' : 'font-mono'}`}>
                              {assetName}
                            </span>
                          </Tooltip>
                          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <ShadcnBadge
                              asChild
                              variant={row.tagName ? 'secondary' : 'outline'}
                              className="max-w-[5rem] cursor-pointer"
                              style={tagFillColor ? { backgroundColor: tagFillColor } : undefined}
                            >
                              <button
                            type="button"
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
                                <Tag data-icon="inline-start" aria-hidden="true" />
                                <span className="truncate">{tagUpdatingKey === row.productKey ? '保存中' : tagLabel}</span>
                              </button>
                            </ShadcnBadge>
                            {secondaryLine ? (
                              <Tooltip content={secondaryLine} className="min-w-0 flex-1" contentClassName="max-w-xs">
                                <span className="block min-w-0 truncate">{secondaryLine}</span>
                              </Tooltip>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-right"
                        data-label="数量"
                      >
                        <Tooltip content={formatPositionQuantityTitle(row)} className="w-full min-w-0 justify-end" contentClassName="max-w-xs">
                          <span className="block max-w-full truncate">{formatPositionQuantity(row)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right" data-label="成本价">
                        {formatPositionCostPrice(row)}
                      </TableCell>
                      <TableCell className="text-right" data-label="现价">
                        <div className="truncate">{formatPositionPrice(row)}</div>
                        <div className={`text-xs ${hasPositionPrice(row) ? 'text-muted-foreground' : 'text-amber-600'}`}>
                          <Tooltip content={getPositionPriceLabel(row)} className="w-full min-w-0 justify-end" contentClassName="max-w-xs">
                            <span className="block max-w-full truncate">{getPositionPriceLabel(row)}</span>
                          </Tooltip>
                        </div>
                      </TableCell>
                      <TableCell className="truncate text-right" data-label="市值">{formatPositionMoney(row.marketValueBase, row)}</TableCell>
                      <TableCell
                        data-label="未实现盈亏"
                        className={`truncate text-right ${getChinaPnlColorClass(
                          row.unrealizedPnlBase,
                          (row.market !== 'bank' || isBankWealthPosition(row)) && hasPositionPrice(row),
                        )}`}
                      >
                        {row.market === 'bank' && !isBankWealthPosition(row) ? '-' : formatPositionMoney(row.unrealizedPnlBase, row)}
                      </TableCell>
                      <TableCell
                        data-label="收益率"
                        className={`truncate text-right ${getChinaPnlColorClass(
                          row.unrealizedPnlPct,
                          (row.market !== 'bank' || isBankWealthPosition(row))
                            && hasPositionPrice(row)
                            && row.unrealizedPnlPct !== null
                            && row.unrealizedPnlPct !== undefined,
                        )}`}
                      >
                        {row.market === 'bank' && !isBankWealthPosition(row) ? '-' : formatSignedPct(row.unrealizedPnlPct)}
                      </TableCell>
                      <TableCell
                        data-label="年化"
                        className={`truncate text-right ${getChinaPnlColorClass(
                          row.annualizedReturnPct,
                          row.annualizedReturnPct !== null && row.annualizedReturnPct !== undefined,
                        )}`}
                      >
                        {formatSignedPct(row.annualizedReturnPct)}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-3">
        <Card padding="md" className="flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">资产分布</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {assetBreakdownView === 'tag' ? '按资产属性查看，不含现金' : '按资产类型查看全账户结构'}
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs">
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 transition-colors ${assetBreakdownView === 'tag' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setAssetBreakdownView('tag')}
              >
                资产属性
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 transition-colors ${assetBreakdownView === 'type' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
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
          <div className="mt-4 grid min-h-[260px] gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
            {hasAssetDistributionData && !snapshot?.fxMissing ? (
              <div className="flex min-w-0 items-center justify-center rounded-lg border border-border bg-muted/40 px-3 py-4">
                <ChartContainer
                  config={assetDistributionChartConfig}
                  className="mx-auto aspect-square h-[220px] max-h-[240px] w-full"
                  aria-label="资产分布饼图"
                >
                  <PieChart accessibilityLayer>
                    <ChartTooltip
                      cursor={false}
                      content={(
                        <ChartTooltipContent
                          hideLabel
                          nameKey="chartKey"
                          formatter={(value, _name, item) => {
                            const payload = item.payload as AssetDistributionDatum | undefined;
                            return (
                              <div className="flex min-w-36 flex-1 items-center justify-between gap-4">
                                <span className="text-muted-foreground">{payload?.label}</span>
                                <span className="font-mono font-medium text-foreground tabular-nums">
                                  {formatMoney(Number(payload?.amount || value || 0), snapshot?.currency || 'CNY')}
                                  <span className="ml-2 text-muted-foreground">
                                    {formatPct(payload?.percentage ?? null)}
                                  </span>
                                </span>
                              </div>
                            );
                          }}
                        />
                      )}
                    />
                    <Pie
                      data={assetDistributionRows}
                      dataKey="absoluteAmount"
                      nameKey="chartKey"
                      innerRadius={58}
                      outerRadius={88}
                      stroke="0"
                    >
                      <Label
                        content={({ viewBox }) => {
                          if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null;
                          return (
                            <text
                              x={viewBox.cx}
                              y={viewBox.cy}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              <tspan
                                x={viewBox.cx}
                                y={viewBox.cy}
                                className="fill-foreground text-sm font-semibold"
                              >
                                {formatPct(100)}
                              </tspan>
                              <tspan
                                x={viewBox.cx}
                                y={(viewBox.cy || 0) + 18}
                                className="fill-muted-foreground text-[11px]"
                              >
                                {assetBreakdownView === 'tag' ? '资产属性' : '资产类型'}
                              </tspan>
                            </text>
                          );
                        }}
                      />
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </div>
            ) : (
              <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
                {snapshot?.fxMissing
                  ? '汇率缺失，暂不可计算资产分布。'
                  : assetBreakdownView === 'tag' ? '暂无资产属性分布数据' : '暂无资产分布数据'}
              </div>
            )}

            <div className="min-w-0 space-y-1.5">
              {assetDistributionRows.length > 0 ? assetDistributionRows.map((item) => (
                <div
                  key={`${assetBreakdownView}-${item.key}`}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)_3.5rem] items-center gap-3 text-xs leading-6"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: item.color }}
                    />
                    <span className="truncate font-medium text-foreground">{item.label}</span>
                  </div>
                  <span className="min-w-0 truncate text-right font-mono text-muted-foreground tabular-nums">
                    {snapshot?.fxMissing ? '不可计算' : formatMoney(item.amount, snapshot?.currency || 'CNY')}
                  </span>
                  <span className="text-right font-mono text-muted-foreground tabular-nums">
                    {snapshot?.fxMissing ? '--' : formatPct(item.percentage)}
                  </span>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  {assetBreakdownView === 'tag' ? '暂无资产属性分布数据' : '暂无资产分布数据'}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card padding="md" className="flex flex-col">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">资产分析</h2>
              <p className="mt-1 text-xs text-muted-foreground">
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
                    className="flex min-h-10 items-start gap-3 rounded-md border border-border bg-muted px-3 py-2"
                  >
                    <span className="mt-0.5 w-6 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <p className="min-w-0 flex-1 text-sm leading-5 text-foreground">{point}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted px-4 py-8 text-sm leading-6 text-muted-foreground">
                点击“{portfolioAnalysisButtonLabel}”生成组合要点；结果会按当前持仓快照缓存在本地。
              </div>
            )}
          </div>

          {portfolioAnalysisError ? (
            <ApiErrorAlert error={portfolioAnalysisError} className="mt-3" />
          ) : null}

          {portfolioAnalysisLoading || portfolioAnalysisTaskChecking || portfolioAnalysisTask ? (
            <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {portfolioAnalysisTaskChecking
                    ? '正在检查是否已有后台分析任务...'
                    : portfolioAnalysisTaskText}
                </span>
                {portfolioAnalysisTask?.status === 'pending' || portfolioAnalysisTask?.status === 'processing' ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="后台分析中" />
                ) : null}
              </div>
              {portfolioAnalysisTask?.status === 'failed' ? (
                <p className="mt-1 text-destructive">任务已失败或超时，可重新生成。</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {portfolioAnalysis ? (
              <ShadcnButton
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setPortfolioAnalysisDrawerOpen(true)}
              >
                查看报告
              </ShadcnButton>
            ) : null}
            <ShadcnButton
              type="button"
              variant="outline"
              className="flex-1"
              disabled={portfolioAnalysisButtonDisabled}
              onClick={() => void handleAnalyzePortfolio()}
            >
              {portfolioAnalysisTaskChecking
                ? '检查中...'
                : portfolioAnalysisLoading
                  ? '后台分析中...'
                  : portfolioAnalysisButtonLabel}
            </ShadcnButton>
          </div>
        </Card>
      </section>

      {!writeBlocked && selectedEntryPanel ? (
        <section>
          <Card padding="sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">录入流水</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {writableAccount.name} · {formatMarketLabel(writableAccount.market)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entryPanelOptions.map((item) => (
                  <ShadcnButton
                    key={item.value}
                    type="button"
                    aria-pressed={selectedEntryPanel === item.value}
                    variant={selectedEntryPanel === item.value ? 'default' : 'outline'}
                    size="sm"
                    className={
                      selectedEntryPanel === item.value
                        ? ''
                        : 'opacity-80 hover:opacity-100'
                    }
                    onClick={() => setActiveEntryPanel(item.value)}
                  >
                    {item.label}
                  </ShadcnButton>
                ))}
              </div>
            </div>

            <div className="mt-2 border-t border-border pt-2">
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={tradeForm.side}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, side: e.target.value as PortfolioSide }))}>
                      <option value="buy">{isFundAccount ? '申购' : '买入'}</option>
                      <option value="sell">{isFundAccount ? '赎回' : '卖出'}</option>
                    </SelectCompat>
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={cashForm.direction}
                      onChange={(e) => setCashForm((prev) => ({ ...prev, direction: e.target.value as PortfolioCashDirection }))}>
                      <option value="in">入金</option>
                      <option value="out">出金</option>
                    </SelectCompat>
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={corpForm.actionType}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, actionType: e.target.value as PortfolioCorporateActionType }))}>
                      <option value="cash_dividend">现金分红</option>
                      <option value="split_adjustment">拆并股调整</option>
                    </SelectCompat>
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.assetKind}
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
                    </SelectCompat>
                  </PortfolioField>
                  {bankForm.assetKind === 'wealth' ? (
                    <PortfolioField label="操作类型">
                      <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.wealthAction}
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
                      </SelectCompat>
                    </PortfolioField>
                  ) : (
                    <PortfolioField label="资金方向">
                      <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.direction}
                        onChange={(e) => setBankForm((prev) => ({
                          ...prev,
                          direction: e.target.value as PortfolioCashDirection,
                          linkedEntryId: '',
                          registrationCode: '',
                        }))}>
                        <option value="in">存入/买入</option>
                        <option value="out">取出/赎回</option>
                      </SelectCompat>
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
                        <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.linkedEntryId}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, linkedEntryId: e.target.value }))} required>
                          <option value="">选择要取出的定期产品</option>
                          {bankDepositOptions.map((item) => (
                            <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                          ))}
                        </SelectCompat>
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
                          <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.linkedEntryId}
                            onChange={(e) => setBankForm((prev) => ({ ...prev, linkedEntryId: e.target.value, nav: '', quantity: '' }))} required>
                            <option value="">选择要赎回的理财产品</option>
                            {bankWealthOptions.map((item) => (
                              <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                            ))}
                          </SelectCompat>
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
                          <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.linkedEntryId}
                            onChange={(e) => setBankForm((prev) => ({ ...prev, linkedEntryId: e.target.value, nav: '', quantity: '' }))} required>
                            <option value="">选择要追加的理财产品</option>
                            {bankWealthOptions.map((item) => (
                              <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                            ))}
                          </SelectCompat>
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
	                        <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.investmentNature}
	                          onChange={(e) => setBankForm((prev) => ({ ...prev, investmentNature: e.target.value as '' | PortfolioBankInvestmentNature }))}>
                          <option value="">选填</option>
                          <option value="fixed_income">固定收益类</option>
                          <option value="mixed">混合类</option>
                          <option value="equity">权益类</option>
                          <option value="commodity_derivative">商品及金融衍生品类</option>
                          <option value="cash_management">现金管理类</option>
                          <option value="other">其他</option>
                        </SelectCompat>
                      </PortfolioField>
                      <PortfolioField label="风险等级">
                        <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.riskLevel}
                          onChange={(e) => setBankForm((prev) => ({ ...prev, riskLevel: e.target.value as '' | PortfolioBankRiskLevel }))}>
                          <option value="">选填</option>
                          <option value="R1">R1</option>
                          <option value="R2">R2</option>
                          <option value="R3">R3</option>
                          <option value="R4">R4</option>
                          <option value="R5">R5</option>
                        </SelectCompat>
                      </PortfolioField>
                    </div>
                    <div className={PORTFOLIO_FORM_GRID_CLASS}>
	                      <PortfolioField label="收益方式">
	                        <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankForm.incomeMode}
	                          onChange={(e) => setBankForm((prev) => ({ ...prev, incomeMode: e.target.value as PortfolioBankIncomeMode }))}>
	                          <option value="reinvest">滚存</option>
	                          <option value="dividend">派息</option>
	                        </SelectCompat>
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={bankNavForm.selectedProduct}
                      onChange={(e) => setBankNavForm((prev) => ({ ...prev, selectedProduct: e.target.value }))} required>
                      <option value="">选择要更新价值的理财产品</option>
                      {bankWealthOptions.map((item) => (
                        <option key={item.optionValue} value={item.optionValue}>{formatBankPositionOption(item)}</option>
                      ))}
                    </SelectCompat>
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
                      onChange={(e) => {
                        const nextDate = e.target.value;
                        const strategyCode = advisoryForm.externalStrategyCode;
                        setAdvisoryForm((prev) => ({ ...prev, eventDate: nextDate, nav: '', navDate: '', quantity: '' }));
                        if (strategyCode && advisoryForm.productType === 'advisory_combo') {
                          void applyAdvisoryNav(strategyCode, nextDate);
                        }
                      }} required />
                  </PortfolioField>
                  <PortfolioField label="产品类型">
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={advisoryForm.productType}
                      onChange={(e) => setAdvisoryForm((prev) => ({
                        ...prev,
                        selectedProduct: '',
                        productType: e.target.value as PortfolioAdvisoryProductType,
                        eventType: e.target.value === 'dca_plan' ? 'initial_buy' : 'buy',
                        productCode: '',
                        productName: '',
                        amount: '',
                        nav: '',
                        navDate: '',
                        quantity: '',
                        externalStrategyCode: '',
                        dataProvider: '',
                        managerName: '',
                        recommendedHoldingDuration: '',
                      }))}>
                      <option value="advisory_combo">投顾组合</option>
                      <option value="dca_plan">定投计划</option>
                    </SelectCompat>
                  </PortfolioField>
                  <PortfolioField label="操作类型">
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={advisoryForm.eventType}
                      onChange={(e) => setAdvisoryForm((prev) => ({
                        ...prev,
                        selectedProduct: '',
                        eventType: e.target.value as AdvisoryFormEventType,
                        amount: '',
                        nav: '',
                        navDate: '',
                        quantity: '',
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
                    </SelectCompat>
                  </PortfolioField>
                  <PortfolioField label={advisoryForm.eventType === 'redeem' ? '到账金额' : '投入金额'}>
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01"
                      placeholder={advisoryForm.eventType === 'redeem' ? '赎回/止盈到账金额' : '投入金额'}
                      value={advisoryForm.amount}
                      onChange={(e) => setAdvisoryForm((prev) => ({
                        ...prev,
                        amount: e.target.value,
                        quantity: calculateAdvisoryQuantity(e.target.value, prev.nav),
                      }))} required />
                  </PortfolioField>
                </div>
                {advisoryEventRequiresExistingProduct ? (
                  <div className={PORTFOLIO_FORM_GRID_CLASS}>
                    <PortfolioField label="投顾产品" className={PORTFOLIO_FORM_SPAN_2_CLASS}>
                      <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={advisoryForm.selectedProduct}
                        onChange={(e) => {
                          const option = advisoryFormProductOptions.find((item) => item.optionValue === e.target.value);
                          void applyExistingAdvisoryProduct(option);
                        }} required>
                        <option value="">{advisoryProductSelectPlaceholder}</option>
                        {advisoryFormProductOptions.map((item) => (
                          <option key={item.optionValue} value={item.optionValue}>{formatAdvisoryPositionOption(item)}</option>
                        ))}
                      </SelectCompat>
                    </PortfolioField>
                    <div className="lg:col-span-2">
                      <span className={PORTFOLIO_FIELD_LABEL_CLASS}>当前价值</span>
                      <div className="flex h-8 items-center rounded-lg border border-border bg-muted px-2.5 text-xs text-muted-foreground">
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
                    <PortfolioField
                      label="产品名称"
                      className={PORTFOLIO_FORM_SPAN_2_CLASS}
                      action={(
                        <button type="button" className="portfolio-field-link" onClick={handleAdvisoryProductSearch} disabled={advisorySearchLoading}>
                          {advisorySearchLoading ? '查询中' : '查询产品'}
                        </button>
                      )}
                    >
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
                  {advisoryForm.productType === 'advisory_combo' && (advisoryNavLoading || Number(advisoryForm.nav) > 0) ? (
                    <>
                      <PortfolioField label={advisoryForm.navDate ? `单位净值 ${advisoryForm.navDate}` : '单位净值'}>
                        <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001"
                          placeholder={advisoryNavLoading ? '历史净值查询中' : '流水日期单位净值'}
                          value={advisoryForm.nav}
                          onChange={(e) => setAdvisoryForm((prev) => ({
                            ...prev,
                            nav: e.target.value,
                            quantity: calculateAdvisoryQuantity(prev.amount, e.target.value),
                          }))}
                          disabled={advisoryNavLoading} />
                      </PortfolioField>
                      <PortfolioField label="确定份额">
                        <input className={PORTFOLIO_INPUT_CLASS} value={advisoryForm.quantity} readOnly />
                      </PortfolioField>
                    </>
                  ) : null}
                  <div>
                    <button type="submit" className={PORTFOLIO_FORM_ACTION_CLASS} disabled={!writableAccountId || advisoryNavLoading}>
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={advisoryNavForm.selectedProduct}
                      onChange={(e) => setAdvisoryNavForm((prev) => ({ ...prev, selectedProduct: e.target.value }))} required>
                      <option value="">选择要更新价值的投顾产品</option>
                      {advisoryOptions.map((item) => (
                        <option key={item.optionValue} value={item.optionValue}>{formatAdvisoryPositionOption(item)}</option>
                      ))}
                    </SelectCompat>
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={insurancePolicyForm.insuranceKind}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, insuranceKind: e.target.value as PortfolioInsuranceKind }))}>
                      <option value="annuity">年金险</option>
                      <option value="whole_life">终身寿险</option>
                      <option value="endowment">两全保险</option>
                      <option value="universal">万能险</option>
                      <option value="unit_linked">投连险</option>
                      <option value="other">其他保险</option>
                    </SelectCompat>
                  </PortfolioField>
                  <PortfolioField label="设计类型">
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={insurancePolicyForm.designType}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, designType: e.target.value as PortfolioInsuranceDesignType }))}>
                      <option value="ordinary">普通型</option>
                      <option value="participating">分红型</option>
                      <option value="universal">万能型</option>
                      <option value="unit_linked">投资连结型</option>
                      <option value="other">其他</option>
                    </SelectCompat>
                  </PortfolioField>
                  <PortfolioField label="缴费方式">
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={insurancePolicyForm.paymentMode}
                      onChange={(e) => setInsurancePolicyForm((prev) => ({ ...prev, paymentMode: e.target.value as PortfolioInsurancePaymentMode }))}>
                      <option value="single">趸交</option>
                      <option value="annual">年交</option>
                      <option value="semiannual">半年交</option>
                      <option value="quarterly">季交</option>
                      <option value="monthly">月交</option>
                      <option value="irregular">不定期</option>
                    </SelectCompat>
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
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={insuranceLedgerForm.policyId}
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
                    </SelectCompat>
                  </PortfolioField>
                  <PortfolioField label="流水日期">
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={insuranceLedgerForm.eventDate}
                      onChange={(e) => setInsuranceLedgerForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                  </PortfolioField>
                  <PortfolioField label="事件类型">
                    <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={insuranceLedgerForm.eventType}
                      onChange={(e) => setInsuranceLedgerForm((prev) => ({ ...prev, eventType: e.target.value as PortfolioInsuranceEventType }))} disabled={!selectedInsurancePolicy}>
                      {insuranceLedgerEventOptions.length === 0 ? (
                        <option value={insuranceLedgerForm.eventType}>{selectedInsurancePolicy ? '保单已终止' : '先选择保单'}</option>
                      ) : insuranceLedgerEventOptions.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </SelectCompat>
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

      <section className="grid grid-cols-1 gap-3">
        <Card padding="md">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">事件记录</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                共 {eventTotal} 条{writeBlocked ? ' · 单账户视图可删除修正' : ' · 可删除错误流水'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
              <SelectCompat className={`${PORTFOLIO_SELECT_CLASS} md:w-36`} value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
                <option value="trade">交易流水</option>
                <option value="cash">资金流水</option>
                {isStockAccount || selectedAccount === 'all' ? <option value="corporate">公司行为</option> : null}
                {isBankAccount || selectedAccount === 'all' ? <option value="bank">银行流水</option> : null}
                {isAdvisoryAccount || selectedAccount === 'all' ? <option value="advisory">投顾流水</option> : null}
                {isInsuranceAccount || selectedAccount === 'all' ? <option value="insurance">保险流水</option> : null}
              </SelectCompat>
              <ShadcnButton
                type="button"
                variant="outline"
                className={showEventFilters || hasEventFilters ? 'border-primary/50 bg-primary/10 text-foreground' : ''}
                onClick={() => setShowEventFilters((prev) => !prev)}
              >
                {hasEventFilters ? `筛选 ${eventFilterChips.length}` : '筛选'}
              </ShadcnButton>
              <ShadcnButton type="button" variant="outline" className="col-span-2 md:col-span-1" onClick={() => void loadEvents()} disabled={eventLoading}>
                {eventLoading ? '加载中...' : '刷新'}
              </ShadcnButton>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {hasEventFilters ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {eventFilterChips.map((chip) => (
                  <span key={chip} className="rounded-full border border-border bg-muted px-2 py-1 text-muted-foreground">
                    {chip}
                  </span>
                ))}
                <ShadcnButton type="button" variant="outline" size="xs" onClick={clearEventFilters}>
                  清空
                </ShadcnButton>
              </div>
            ) : null}
            {(showEventFilters || hasEventFilters) ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted p-2 md:grid-cols-4">
                <input className={PORTFOLIO_INPUT_CLASS} type="date" value={eventDateFrom} onChange={(e) => setEventDateFrom(e.target.value)} />
                <input className={PORTFOLIO_INPUT_CLASS} type="date" value={eventDateTo} onChange={(e) => setEventDateTo(e.target.value)} />
                {(eventType === 'trade' || eventType === 'corporate') ? (
                  <input className={`${PORTFOLIO_INPUT_CLASS} col-span-2 md:col-span-1`} placeholder="代码" value={eventSymbol}
                    onChange={(e) => setEventSymbol(e.target.value)} />
                ) : null}
                {eventType === 'trade' ? (
                  <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={eventSide} onChange={(e) => setEventSide(e.target.value as '' | PortfolioSide)}>
                    <option value="">全部方向</option>
                    <option value="buy">买入</option>
                    <option value="sell">卖出</option>
                  </SelectCompat>
                ) : null}
                {eventType === 'cash' ? (
                  <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={eventDirection}
                    onChange={(e) => setEventDirection(e.target.value as '' | PortfolioCashDirection)}>
                    <option value="">全部方向</option>
                    <option value="in">流入</option>
                    <option value="out">流出</option>
                  </SelectCompat>
                ) : null}
                {eventType === 'corporate' ? (
                  <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={eventActionType}
                    onChange={(e) => setEventActionType(e.target.value as '' | PortfolioCorporateActionType)}>
                    <option value="">全部公司行为</option>
                    <option value="cash_dividend">现金分红</option>
                    <option value="split_adjustment">拆并股调整</option>
                  </SelectCompat>
                ) : null}
                {eventType === 'bank' ? (
                  <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={eventBankAssetKind}
                    onChange={(e) => setEventBankAssetKind(e.target.value as '' | PortfolioBankAssetKind)}>
                    <option value="">全部银行资产</option>
                    <option value="demand">活期/现金</option>
                    <option value="deposit">定期存款</option>
                    <option value="wealth">银行理财</option>
                  </SelectCompat>
                ) : null}
                {eventType === 'advisory' ? (
                  <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={eventAdvisoryDirection}
                    onChange={(e) => setEventAdvisoryDirection(e.target.value as '' | PortfolioAdvisoryEventType)}>
                    <option value="">全部投顾事件</option>
                    <option value="buy">买入/追加</option>
                    <option value="initial_buy">首次买入</option>
                    <option value="follow_buy">跟投</option>
                    <option value="redeem">赎回/止盈</option>
                  </SelectCompat>
                ) : null}
                {eventType === 'insurance' ? (
                  <SelectCompat className={PORTFOLIO_SELECT_CLASS} value={eventInsuranceEventType}
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
                  </SelectCompat>
                ) : null}
              </div>
            ) : null}
            <div className="max-h-64 overflow-auto rounded-lg border border-border p-2">
              {eventType === 'trade' && tradeEvents.map((item) => (
                <div key={`t-${item.id}`} className="flex items-start justify-between gap-3 border-b border-border py-2 text-xs text-muted-foreground">
                  <div className="min-w-0">
                    {item.tradeDate} {formatSideLabel(item.side)} {item.symbol} 数量={formatTradeQuantity(item)} 价格={item.price}
                  </div>
                  {!writeBlocked ? (
                    <ShadcnButton
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      onClick={() => openDeleteDialog({
                        eventType: 'trade',
                        id: item.id,
                        message: `确认删除 ${item.tradeDate} 的${formatSideLabel(item.side)}流水 ${item.symbol}（数量 ${formatTradeQuantity(item)}，价格 ${item.price}）吗？`,
                      })}
                    >
                      删除
                    </ShadcnButton>
                  ) : null}
                </div>
              ))}
              {eventType === 'cash' && cashEvents.map((item) => (
                <div key={`c-${item.id}`} className="flex items-start justify-between gap-3 border-b border-border py-2 text-xs text-muted-foreground">
                  <div className="min-w-0">
                    {item.eventDate} {formatCashDirectionLabel(item.direction)} {item.amount} {item.currency}
                  </div>
                  {!writeBlocked ? (
                    <ShadcnButton
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      onClick={() => openDeleteDialog({
                        eventType: 'cash',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的资金流水（${formatCashDirectionLabel(item.direction)} ${item.amount} ${item.currency}）吗？`,
                      })}
                    >
                      删除
                    </ShadcnButton>
                  ) : null}
                </div>
              ))}
              {eventType === 'corporate' && corporateEvents.map((item) => (
                <div key={`ca-${item.id}`} className="flex items-start justify-between gap-3 border-b border-border py-2 text-xs text-muted-foreground">
                  <div className="min-w-0">
                    {item.effectiveDate} {formatCorporateActionLabel(item.actionType)} {item.symbol}
                  </div>
                  {!writeBlocked ? (
                    <ShadcnButton
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      onClick={() => openDeleteDialog({
                        eventType: 'corporate',
                        id: item.id,
                        message: `确认删除 ${item.effectiveDate} 的公司行为 ${formatCorporateActionLabel(item.actionType)}（${item.symbol}）吗？`,
                      })}
                    >
                      删除
                    </ShadcnButton>
                  ) : null}
                </div>
              ))}
              {eventType === 'bank' && bankEvents.map((item) => (
                <div key={`b-${item.id}`} className="flex items-start justify-between gap-3 border-b border-border py-2 text-xs text-muted-foreground">
                  <div className="min-w-0">
                    {item.eventDate} {formatBankAssetKind(item.assetKind)} {formatCashDirectionLabel(item.direction)} {item.amount} {item.currency} · {item.bankName}{item.productName ? ` · ${item.productName}` : ''}{item.productPublicCode ? ` · ${item.productPublicCode}` : ''}{item.registrationCode ? ` · ${item.registrationCode}` : ''}
                  </div>
                  {!writeBlocked ? (
                    <ShadcnButton
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      onClick={() => openDeleteDialog({
                        eventType: 'bank',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的银行流水（${formatBankAssetKind(item.assetKind)} ${formatCashDirectionLabel(item.direction)} ${item.amount} ${item.currency}）吗？`,
                      })}
                    >
                      删除
                    </ShadcnButton>
                  ) : null}
                </div>
              ))}
              {eventType === 'advisory' && advisoryEvents.map((item) => (
                <div key={`a-${item.id}`} className="flex items-start justify-between gap-3 border-b border-border py-2 text-xs text-muted-foreground">
                  <div className="min-w-0">
                    {item.eventDate} {formatAdvisoryProductTypeLabel(item.productType)} · {formatAdvisoryEventLabel(item.eventType || item.direction)} {item.productName}
                    {item.productCode ? ` · ${item.productCode}` : ''} · {item.platform} · 金额 {item.amount} {item.currency}
                  </div>
                  {!writeBlocked ? (
                    <ShadcnButton
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      onClick={() => openDeleteDialog({
                        eventType: 'advisory',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的投顾流水（${formatAdvisoryEventLabel(item.eventType || item.direction)} ${item.productName}）吗？`,
                      })}
                    >
                      删除
                    </ShadcnButton>
                  ) : null}
                </div>
              ))}
              {eventType === 'insurance' && insuranceEvents.map((item) => {
                const policy = insurancePolicies.find((candidate) => candidate.id === item.policyId);
                return (
                <div key={`i-${item.id}`} className="flex items-start justify-between gap-3 border-b border-border py-2 text-xs text-muted-foreground">
                  <div className="min-w-0">
                    {item.eventDate} {formatInsuranceEventType(item.eventType)} {policy?.policyName || `保单 #${item.policyId}`} · {item.amount} {item.currency}{item.periodNo ? ` · 第 ${item.periodNo} 期` : ''}
                  </div>
                  {!writeBlocked ? (
                    <ShadcnButton
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      onClick={() => openDeleteDialog({
                        eventType: 'insurance',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的保险流水（${formatInsuranceEventType(item.eventType)} ${policy?.policyName || `保单 #${item.policyId}` }）吗？`,
                      })}
                    >
                      删除
                    </ShadcnButton>
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
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>第 {eventPage} / {totalEventPages} 页</span>
              <div className="flex gap-2">
                <ShadcnButton type="button" variant="outline" size="sm" disabled={eventPage <= 1}
                  onClick={() => setEventPage((prev) => Math.max(1, prev - 1))}>
                  上一页
                </ShadcnButton>
                <ShadcnButton type="button" variant="outline" size="sm" disabled={eventPage >= totalEventPages}
                  onClick={() => setEventPage((prev) => Math.min(totalEventPages, prev + 1))}>
                  下一页
                </ShadcnButton>
              </div>
            </div>
          </div>
        </Card>
      </section>
      {portfolioToast ? (
        <ToastViewport className="bottom-auto right-auto left-1/2 top-1/2 w-[380px] -translate-x-1/2 -translate-y-1/2">
          <div
            role="status"
            className="pointer-events-auto rounded-xl border border-emerald-500/45 bg-card px-5 py-4 text-center text-foreground shadow-none ring-1 ring-success/15"
          >
            <p className="text-sm font-semibold text-emerald-600">{portfolioToast.title}</p>
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
      {assetTransferOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/62 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="asset-transfer-title"
          onClick={closeAssetTransfer}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border/70 bg-card px-5 py-4 text-foreground shadow-none"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="asset-transfer-title" className="text-sm font-semibold text-foreground">
                  转移资产
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {assetTransferStep === 'select' ? '选择当前账户中的一个资产和同类型目标账户。' : null}
                  {assetTransferStep === 'preview' ? '确认将迁移的源数据。' : null}
                  {assetTransferStep === 'result' ? '转移已完成。' : null}
                </p>
              </div>
              <ShadcnButton
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={closeAssetTransfer}
                disabled={assetTransferLoading}
              >
                关闭
              </ShadcnButton>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              {(['select', 'preview', 'result'] as AssetTransferStep[]).map((step, index) => (
                <div
                  key={step}
                  className={`rounded-lg border px-3 py-2 ${
                    assetTransferStep === step ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground'
                  }`}
                >
                  {index + 1}. {step === 'select' ? '选择资产' : step === 'preview' ? '数据概览' : '转移结果'}
                </div>
              ))}
            </div>

            {assetTransferError ? (
              <InlineAlert
                variant="danger"
                className="mt-4 rounded-lg px-3 py-2 text-xs shadow-none"
                title="资产转移失败"
                message={assetTransferError}
              />
            ) : null}

            {assetTransferStep === 'select' ? (
              <div className="mt-4 grid gap-4">
                <PortfolioField label="目标账户">
                  <SelectCompat
                    className={PORTFOLIO_SELECT_CLASS}
                    value={assetTransferTargetId}
                    onChange={(event) => setAssetTransferTargetId(event.target.value)}
                    disabled={assetTransferTargets.length === 0 || assetTransferLoading}
                  >
                    {assetTransferTargets.length === 0 ? (
                      <option value="">暂无同类型账户</option>
                    ) : null}
                    {assetTransferTargets.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.broker || '未设置机构/平台'}
                      </option>
                    ))}
                  </SelectCompat>
                </PortfolioField>

                <div className="grid gap-2">
                  <div className="text-xs font-medium text-muted-foreground">选择资产</div>
                  <div className="max-h-72 overflow-auto rounded-xl border border-border/70">
                    {assetTransferOptions.map((option) => {
                      const assetName = getPositionDisplayName(option.row);
                      const checked = option.key === assetTransferAssetKey;
                      return (
                        <label
                          key={option.key}
                          className={`flex cursor-pointer items-start gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 ${
                            checked ? 'bg-primary/10' : 'hover:bg-muted'
                          }`}
                        >
                          <input
                            type="radio"
                            className="mt-1"
                            name="asset-transfer-option"
                            value={option.key}
                            checked={checked}
                            onChange={(event) => setAssetTransferAssetKey(event.target.value)}
                            disabled={assetTransferLoading}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{assetName}</span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                              {getPositionAssetType(option.row, assetNameMaps)} · {option.row.currency} · 市值 {formatPositionMoney(option.row.marketValueBase, option.row)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                    {assetTransferOptions.length === 0 ? (
                      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                        当前账户暂无可转移资产。
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex justify-end">
                  <ShadcnButton
                    type="button"
                    onClick={() => void handlePreviewAssetTransfer()}
                    disabled={assetTransferLoading || !assetTransferAssetKey || !assetTransferTargetId}
                  >
                    {assetTransferLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                    下一步
                  </ShadcnButton>
                </div>
              </div>
            ) : null}

            {assetTransferStep === 'preview' && assetTransferPreview ? (
              <div className="mt-4 grid gap-4">
                <div className="rounded-xl border border-border/70 px-3 py-3 text-sm">
                  <div className="font-medium text-foreground">
                    {String(assetTransferPreview.asset.displayName || selectedAssetTransferOption?.asset.displayName || selectedAssetTransferOption?.row.symbol || '选中资产')}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {assetTransferPreview.sourceAccountName} <ArrowRight className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /> {assetTransferPreview.targetAccountName}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {assetTransferPreview.dateFrom || '--'} 至 {assetTransferPreview.dateTo || '--'} · 共 {assetTransferPreview.totalRecords} 条源数据
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(assetTransferPreview.transferredCounts || {}).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-border/70 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">{formatTransferCountLabel(key)}</span>
                      <span className="ml-2 font-semibold text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
                {assetTransferPreview.warnings?.length ? (
                  <InlineAlert
                    variant="warning"
                    className="rounded-lg px-3 py-2 text-xs shadow-none"
                    title="注意"
                    message={assetTransferPreview.warnings.join(' ')}
                  />
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <ShadcnButton
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setAssetTransferStep('select');
                      setAssetTransferPreview(null);
                      setAssetTransferError(null);
                    }}
                    disabled={assetTransferLoading}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    上一步
                  </ShadcnButton>
                  <ShadcnButton
                    type="button"
                    onClick={() => void handleConfirmAssetTransfer()}
                    disabled={assetTransferLoading}
                  >
                    {assetTransferLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />}
                    确定转移
                  </ShadcnButton>
                </div>
              </div>
            ) : null}

            {assetTransferStep === 'result' && assetTransferResult ? (
              <div className="mt-4 grid gap-4">
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
                  <div className="mt-2 text-sm font-semibold text-foreground">资产转移完成</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    已迁移 {assetTransferResult.totalRecords} 条源数据到 {assetTransferResult.targetAccountName}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(assetTransferResult.transferredCounts || {}).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-border/70 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">{formatTransferCountLabel(key)}</span>
                      <span className="ml-2 font-semibold text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <ShadcnButton type="button" onClick={closeAssetTransfer}>
                    完成
                  </ShadcnButton>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {activeTagTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/62 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portfolio-tag-picker-title"
          onClick={() => setActiveTagTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border/70 bg-card px-5 py-4 text-foreground shadow-none"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="portfolio-tag-picker-title" className="text-sm font-semibold text-foreground">
                  选择持仓标签
                </h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {getPositionDisplayName(activeTagTarget.row)}
                </p>
              </div>
              <ShadcnButton
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setActiveTagTarget(null)}
              >
                取消
              </ShadcnButton>
            </div>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${activeTagTarget.row.tagId == null ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground'}`}
                onClick={() => void handleProductTagChange(activeTagTarget.row, '')}
                disabled={tagUpdatingKey === activeTagTarget.productKey}
              >
                <span className="h-2.5 w-2.5 rounded-full border bg-transparent" />
                <span>无标签</span>
              </button>
              {portfolioTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${activeTagTarget.row.tagId === tag.id ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground'}`}
                  onClick={() => void handleProductTagChange(activeTagTarget.row, String(tag.id))}
                  disabled={tagUpdatingKey === activeTagTarget.productKey}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
                  <span>{tag.name}</span>
                </button>
              ))}
              {portfolioTags.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
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
          <div className="w-full max-w-xl rounded-xl border border-border/70 bg-card px-5 py-4 text-foreground shadow-none">
            {bankWealthSearchLoading ? (
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
                <h3 id="bank-wealth-search-title" className="mt-3 text-sm font-semibold text-foreground">
                  正在查询银行理财
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
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
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      确认后将填入产品信息，并继续查询交易日单位净值。
                    </p>
                  </div>
                  {bankWealthNavLoading ? (
                    <span className="shrink-0 text-xs text-muted-foreground">净值查询中...</span>
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
                            : 'border-border/70 bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
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
                  <ShadcnButton
                    type="button"
                    variant="outline"
                    className="w-24"
                    onClick={() => {
                      setBankWealthCandidateModalOpen(false);
                      setSelectedBankWealthCandidateKey('');
                    }}
                    disabled={bankWealthNavLoading}
                  >
                    取消
                  </ShadcnButton>
                  <ShadcnButton
                    type="button"
                    className="w-24"
                    onClick={() => void handleConfirmBankWealthCandidate()}
                    disabled={bankWealthNavLoading || !selectedBankWealthCandidateKey}
                  >
                    {bankWealthNavLoading ? '查询中...' : '确定'}
                  </ShadcnButton>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {advisorySearchLoading || advisoryCandidateModalOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/62 px-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="advisory-search-title"
        >
          <div className="w-full max-w-xl rounded-xl border border-border/70 bg-card px-5 py-4 text-foreground shadow-none">
            {advisorySearchLoading ? (
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
                <h3 id="advisory-search-title" className="mt-3 text-sm font-semibold text-foreground">
                  正在查询投顾产品
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  正在通过盈米匹配产品信息，请稍候。
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 id="advisory-search-title" className="text-sm font-semibold text-foreground">
                      选择投顾产品
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      确认后将填入产品信息；投顾组合会继续按流水日期查询历史净值。
                    </p>
                  </div>
                  {advisoryNavLoading ? (
                    <span className="shrink-0 text-xs text-muted-foreground">历史净值查询中...</span>
                  ) : null}
                </div>
                <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {advisorySearchResults.map((product, index) => {
                    const candidateKey = getAdvisoryCandidateKey(product, index);
                    const selected = selectedAdvisoryCandidateKey === candidateKey;
                    return (
                      <button
                        key={candidateKey}
                        type="button"
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'border-primary bg-primary/8 text-foreground'
                            : 'border-border/70 bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                        }`}
                        onClick={() => setSelectedAdvisoryCandidateKey(candidateKey)}
                        disabled={advisoryNavLoading}
                      >
                        <span className="block truncate text-sm font-medium">{product.productName}</span>
                        <span className="mt-1 block text-xs leading-5">
                          {[
                            product.strategyCode,
                            product.managerName,
                            product.riskLevel,
                            product.annualizedReturn ? `年化 ${product.annualizedReturn}` : '',
                            product.latestNav != null ? `最新净值 ${product.latestNav}` : '',
                          ].filter(Boolean).join(' · ') || '暂无更多信息'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <ShadcnButton
                    type="button"
                    variant="outline"
                    className="w-24"
                    onClick={() => {
                      setAdvisoryCandidateModalOpen(false);
                      setSelectedAdvisoryCandidateKey('');
                    }}
                    disabled={advisoryNavLoading}
                  >
                    取消
                  </ShadcnButton>
                  <ShadcnButton
                    type="button"
                    className="w-24"
                    onClick={() => void handleConfirmAdvisoryCandidate()}
                    disabled={advisoryNavLoading || !selectedAdvisoryCandidateKey}
                  >
                    {advisoryNavLoading ? '查询中...' : '确定'}
                  </ShadcnButton>
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
        width="!w-[min(92vw,920px)] !max-w-none"
        backdropClassName="bg-background/56 backdrop-blur-[2px]"
      >
        <div className="space-y-4">
            <div className="border-b pb-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">资产分析报告</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {portfolioAnalysis
                  ? `${portfolioAnalysis.asOf} · ${portfolioAnalysis.modelUsed || 'LLM'}`
                  : '尚未生成当前快照的资产分析'}
              </p>
            </div>
          </div>

          {portfolioAnalysis ? (
            <div
              className="prose prose-sm max-w-none
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
