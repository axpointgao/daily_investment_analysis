import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pie, PieChart, ResponsiveContainer, Tooltip, Legend, Cell } from 'recharts';
import { portfolioApi } from '../api/portfolio';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Card, Badge, ConfirmDialog, EmptyState, InlineAlert } from '../components/common';
import { toDateInputValue } from '../utils/format';
import type {
  PortfolioAccountItem,
  PortfolioBankAssetKind,
  PortfolioBankLedgerListItem,
  PortfolioCashDirection,
  PortfolioCashLedgerListItem,
  PortfolioCorporateActionListItem,
  PortfolioCorporateActionType,
  PortfolioCostMethod,
  PortfolioFxRefreshResponse,
  PortfolioImportBrokerItem,
  PortfolioImportCommitResponse,
  PortfolioImportParseResponse,
  PortfolioMarket,
  PortfolioPositionItem,
  PortfolioRiskResponse,
  PortfolioSide,
  PortfolioSnapshotResponse,
  PortfolioTradeListItem,
} from '../types/portfolio';

const PIE_COLORS = ['#00d4ff', '#00ff88', '#ffaa00', '#ff7a45', '#7f8cff', '#ff4466'];
const DEFAULT_PAGE_SIZE = 20;
const FALLBACK_BROKERS: PortfolioImportBrokerItem[] = [
  { broker: 'huatai', aliases: [], displayName: '华泰' },
  { broker: 'citic', aliases: ['zhongxin'], displayName: '中信' },
  { broker: 'cmb', aliases: ['cmbchina', 'zhaoshang'], displayName: '招商' },
];

type AccountOption = 'all' | number;
type EventType = 'trade' | 'cash' | 'corporate' | 'bank';
type EntryPanelType = 'trade' | 'cash' | 'corporate' | 'manualPrice' | 'bank';

type FlatPosition = PortfolioPositionItem & {
  accountId: number;
  accountName: string;
};

type PendingDelete =
  | { eventType: 'trade'; id: number; message: string }
  | { eventType: 'cash'; id: number; message: string }
  | { eventType: 'corporate'; id: number; message: string }
  | { eventType: 'bank'; id: number; message: string };

type FxRefreshFeedback = {
  tone: 'neutral' | 'success' | 'warning';
  text: string;
};

type FxRefreshContext = {
  viewKey: string;
  requestId: number;
};

type PortfolioAlertVariant = 'info' | 'success' | 'warning' | 'danger';

const PORTFOLIO_INPUT_CLASS =
  'input-surface input-focus-glow h-11 w-full rounded-xl border bg-transparent px-4 text-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const PORTFOLIO_SELECT_CLASS = `${PORTFOLIO_INPUT_CLASS} appearance-none pr-10`;
const PORTFOLIO_FILE_PICKER_CLASS =
  'input-surface input-focus-glow flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border bg-transparent px-4 text-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';

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

function formatPositionPrice(row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return row.lastPrice.toFixed(4);
}

function formatPositionMoney(value: number, row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return formatMoney(value, row.valuationCurrency);
}

function getPositionPriceLabel(row: PortfolioPositionItem): string {
  if (row.priceSource === 'manual_price') return row.market === 'fund' ? '手工净值' : '手工价格';
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
  return value === 'term' ? '定期/理财' : '活期/现金';
}

function getPositionDisplayName(row: PortfolioPositionItem): string {
  if (row.market === 'bank') {
    return row.productName || row.bankName || row.symbol;
  }
  return row.symbol;
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
  const [risk, setRisk] = useState<PortfolioRiskResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const [fxRefreshFeedback, setFxRefreshFeedback] = useState<FxRefreshFeedback | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [riskWarning, setRiskWarning] = useState<string | null>(null);
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
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventLoading, setEventLoading] = useState(false);
  const [tradeEvents, setTradeEvents] = useState<PortfolioTradeListItem[]>([]);
  const [cashEvents, setCashEvents] = useState<PortfolioCashLedgerListItem[]>([]);
  const [corporateEvents, setCorporateEvents] = useState<PortfolioCorporateActionListItem[]>([]);
  const [bankEvents, setBankEvents] = useState<PortfolioBankLedgerListItem[]>([]);
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
    amount: '',
    bankName: '',
    productName: '',
    maturityDate: '',
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
  const missingFxPairsText = formatMissingFxPairs(snapshot);
  const totalEventPages = Math.max(1, Math.ceil(eventTotal / DEFAULT_PAGE_SIZE));
  const currentEventCount = eventType === 'trade'
    ? tradeEvents.length
    : eventType === 'cash'
      ? cashEvents.length
      : eventType === 'corporate'
        ? corporateEvents.length
        : bankEvents.length;
  const entryPanelOptions = [
    ...((isStockAccount || isFundAccount || isCryptoAccount)
      ? [{ value: 'trade' as const, label: isFundAccount ? '基金' : isCryptoAccount ? '买卖' : '交易' }]
      : []),
    ...((isStockAccount || isFundAccount || isCryptoAccount)
      ? [{ value: 'cash' as const, label: '资金' }]
      : []),
    ...(isStockAccount ? [{ value: 'corporate' as const, label: '公司行为' }] : []),
    ...((isFundAccount || isCryptoAccount) ? [{ value: 'manualPrice' as const, label: '手工价格' }] : []),
    ...(isBankAccount ? [{ value: 'bank' as const, label: '银行' }] : []),
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
  ].filter(Boolean) as string[];
  const hasEventFilters = eventFilterChips.length > 0;

  const isActiveRefreshContext = (requestedViewKey: string, requestedRequestId: number) => {
    return (
      refreshContextRef.current.viewKey === requestedViewKey
      && refreshContextRef.current.requestId === requestedRequestId
    );
  };

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

  const loadSnapshotAndRisk = useCallback(async () => {
    setIsLoading(true);
    setRiskWarning(null);
    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: queryAccountId,
        costMethod,
      });
      setSnapshot(snapshotData);
      setError(null);

      try {
        const riskData = await portfolioApi.getRisk({
          accountId: queryAccountId,
          costMethod,
        });
        setRisk(riskData);
      } catch (riskErr) {
        setRisk(null);
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || '风险数据获取失败，已降级为仅展示快照数据。');
      }
    } catch (err) {
      setSnapshot(null);
      setRisk(null);
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
      } else {
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
      }
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setEventLoading(false);
    }
  }, [
    eventActionType,
    eventBankAssetKind,
    eventDateFrom,
    eventDateTo,
    eventDirection,
    eventSide,
    eventSymbol,
    eventType,
    queryAccountId,
  ]);

  const loadEvents = useCallback(async () => {
    await loadEventsPage(eventPage);
  }, [eventPage, loadEventsPage]);

  const refreshPortfolioData = useCallback(async (page = eventPage) => {
    await Promise.all([loadSnapshotAndRisk(), loadEventsPage(page)]);
  }, [eventPage, loadEventsPage, loadSnapshotAndRisk]);

  useEffect(() => {
    void loadAccounts();
    void loadBrokers();
  }, [loadAccounts, loadBrokers]);

  useEffect(() => {
    void loadSnapshotAndRisk();
  }, [loadSnapshotAndRisk]);

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
  }, [eventType, queryAccountId, eventDateFrom, eventDateTo, eventSymbol, eventSide, eventDirection, eventActionType, eventBankAssetKind]);

  useEffect(() => {
    if (selectedMarket === 'bank') {
      setEventType('bank');
      return;
    }
    if (selectedMarket === 'fund' || selectedMarket === 'crypto') {
      setEventType((prev) => (prev === 'corporate' || prev === 'bank' ? 'trade' : prev));
      return;
    }
    setEventType((prev) => (prev === 'bank' ? 'trade' : prev));
  }, [selectedMarket]);

  useEffect(() => {
    if (selectedMarket === 'bank') {
      setActiveEntryPanel('bank');
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

  const sectorPieData = useMemo(() => {
    const sectors = risk?.sectorConcentration?.topSectors || [];
    return sectors
      .slice(0, 6)
      .map((item) => ({
        name: item.sector,
        value: Number(item.weightPct || 0),
      }))
      .filter((item) => item.value > 0);
  }, [risk]);

  const positionFallbackPieData = useMemo(() => {
    if (!risk?.concentration?.topPositions?.length) {
      return [];
    }
    return risk.concentration.topPositions
      .slice(0, 6)
      .map((item) => ({
        name: item.symbol,
        value: Number(item.weightPct || 0),
      }))
      .filter((item) => item.value > 0);
  }, [risk]);

  const concentrationPieData = sectorPieData.length > 0 ? sectorPieData : positionFallbackPieData;
  const concentrationMode = sectorPieData.length > 0 ? 'sector' : 'position';
  const assetBreakdownRows = Object.entries(snapshot?.assetBreakdown || {})
    .filter(([, value]) => Math.abs(Number(value || 0)) > 0.000001)
    .map(([key, value]) => ({ key, value: Number(value || 0) }));

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
      await refreshPortfolioData();
      setTradeForm((prev) => ({ ...prev, symbol: '', tradeUid: '', note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
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
      await refreshPortfolioData();
      setCashForm((prev) => ({ ...prev, note: '' }));
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
      await refreshPortfolioData();
      setCorpForm((prev) => ({ ...prev, symbol: '', note: '' }));
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
      await refreshPortfolioData();
      setManualPriceForm((prev) => ({ ...prev, symbol: '', price: '', note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleBankLedgerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先选择具体银行账户。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createBankLedger({
        accountId: writableAccountId,
        eventDate: bankForm.eventDate,
        assetKind: bankForm.assetKind,
        direction: bankForm.direction,
        amount: Number(bankForm.amount),
        currency: writableAccount?.baseCurrency || 'CNY',
        bankName: bankForm.bankName,
        productName: bankForm.assetKind === 'term' ? bankForm.productName || undefined : undefined,
        maturityDate: bankForm.assetKind === 'term' ? bankForm.maturityDate || undefined : undefined,
        note: bankForm.note || undefined,
      });
      await refreshPortfolioData();
      setBankForm((prev) => ({ ...prev, amount: '', productName: '', maturityDate: '', note: '' }));
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
        await refreshPortfolioData();
      }
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
      } else {
        await portfolioApi.deleteBankLedger(pendingDelete.id);
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
    await Promise.all([loadAccounts(), loadSnapshotAndRisk(), loadEvents(), loadBrokers()]);
  };

  const clearEventFilters = () => {
    setEventDateFrom('');
    setEventDateTo('');
    setEventSymbol('');
    setEventSide('');
    setEventDirection('');
    setEventActionType('');
    setEventBankAssetKind('');
  };

  const reloadSnapshotAndRiskForScope = useCallback(async (
    requestedViewKey: string,
    requestedRequestId: number,
    requestedAccountId: number | undefined,
    requestedCostMethod: PortfolioCostMethod,
  ): Promise<boolean> => {
    if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
      return false;
    }

    setRiskWarning(null);

    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: requestedAccountId,
        costMethod: requestedCostMethod,
      });
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(snapshotData);
      setError(null);

      try {
        const riskData = await portfolioApi.getRisk({
          accountId: requestedAccountId,
          costMethod: requestedCostMethod,
        });
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        setRisk(riskData);
        setRiskWarning(null);
      } catch (riskErr) {
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        setRisk(null);
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || '风险数据获取失败，已降级为仅展示快照数据。');
      }
      return true;
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(null);
      setRisk(null);
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
      const reloaded = await reloadSnapshotAndRiskForScope(
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

  return (
    <div className="portfolio-page min-h-screen space-y-4 p-4 md:p-6">
      <section className="space-y-3">
        <div className="space-y-2">
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">持仓管理</h1>
          <p className="text-xs md:text-sm text-secondary">
            组合快照、手工录入、CSV 导入与风险分析（支持全组合 / 单账户切换）
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
      {riskWarning ? (
        <InlineAlert
          variant="warning"
          title="风险模块降级"
          message={riskWarning}
        />
      ) : null}
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
              placeholder="机构/平台（可选，如华泰、天天基金、Binance、招商银行）"
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

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Card className="xl:col-span-2" padding="md">
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-secondary border-b border-white/10">
                  <tr>
                    <th className="text-left py-2 pr-2">账户</th>
                    <th className="text-left py-2 pr-2">资产</th>
                    <th className="text-right py-2 pr-2">数量</th>
                    <th className="text-right py-2 pr-2">均价</th>
                    <th className="text-right py-2 pr-2">现价</th>
                    <th className="text-right py-2 pr-2">市值</th>
                    <th className="text-right py-2">未实现盈亏</th>
                    <th className="text-right py-2">收益率</th>
                  </tr>
                </thead>
                <tbody>
                  {positionRows.map((row) => (
                    <tr key={`${row.accountId}-${row.symbol}-${row.market}-${row.productName || ''}`} className="border-b border-white/5">
                      <td className="py-2 pr-2 text-secondary">{row.accountName}</td>
                      <td className="py-2 pr-2 text-foreground">
                        <div className={row.market === 'bank' ? '' : 'font-mono'}>{getPositionDisplayName(row)}</div>
                        <div className="text-[11px] text-secondary">
                          {formatMarketLabel(row.market)}{row.maturityDate ? ` · 到期 ${row.maturityDate}` : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-right">{row.market === 'bank' ? '-' : row.quantity.toFixed(4)}</td>
                      <td className="py-2 pr-2 text-right">{row.market === 'bank' ? '-' : row.avgCost.toFixed(4)}</td>
                      <td className="py-2 pr-2 text-right">
                        <div>{formatPositionPrice(row)}</div>
                        <div className={`text-[11px] ${hasPositionPrice(row) ? 'text-secondary' : 'text-warning'}`}>
                          {getPositionPriceLabel(row)}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-right">{formatPositionMoney(row.marketValueBase, row)}</td>
                      <td
                        className={`py-2 text-right ${
                          hasPositionPrice(row)
                            ? row.unrealizedPnlBase >= 0
                              ? 'text-success'
                              : 'text-danger'
                            : 'text-secondary'
                        }`}
                      >
                        {row.market === 'bank' ? '-' : formatPositionMoney(row.unrealizedPnlBase, row)}
                      </td>
                      <td
                        className={`py-2 text-right ${
                          hasPositionPrice(row) && row.unrealizedPnlPct !== null && row.unrealizedPnlPct !== undefined
                            ? row.unrealizedPnlPct >= 0
                              ? 'text-success'
                              : 'text-danger'
                            : 'text-secondary'
                        }`}
                      >
                        {row.market === 'bank' ? '-' : formatSignedPct(row.unrealizedPnlPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padding="md">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            {concentrationMode === 'sector' ? '行业集中度分布' : '持仓集中度'}
          </h2>
          {concentrationPieData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={concentrationPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                    {concentrationPieData.map((entry, index) => (
                      <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="暂无集中度数据"
              description="风险模块完成计算后，这里会展示行业或持仓维度的集中度分布。"
              className="border-none bg-transparent px-4 py-10 shadow-none"
            />
          )}
          <div className="mt-3 text-xs text-secondary space-y-1">
            <div>展示口径: {concentrationMode === 'sector' ? '行业维度' : '持仓维度（降级显示）'}</div>
            <div>集中度告警: {risk?.sectorConcentration?.alert || risk?.concentration?.alert ? '是' : '否'}</div>
            <div>Top1 权重: {formatPct(risk?.sectorConcentration?.topWeightPct ?? risk?.concentration?.topWeightPct)}</div>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-2">资产分布</h3>
          <div className="text-xs text-secondary space-y-1">
            {assetBreakdownRows.length > 0 ? assetBreakdownRows.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-3">
                <span>{formatMarketLabel(item.key)}</span>
                <span className="text-foreground">{snapshot?.fxMissing ? '不可计算' : formatMoney(item.value, snapshot?.currency || 'CNY')}</span>
              </div>
            )) : <div>暂无资产分布数据</div>}
          </div>
        </Card>
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-2">现金状态</h3>
          <div className="text-xs text-secondary space-y-1">
            <div>现金余额: {formatAggregateMoney(snapshot, snapshot?.totalCash)}</div>
            <div>现金占比: {snapshot && !snapshot.fxMissing && snapshot.totalCash != null && snapshot.totalEquity != null && Math.abs(snapshot.totalEquity) > 0 ? formatPct(snapshot.totalCash / snapshot.totalEquity * 100) : '--'}</div>
            {!snapshot?.fxMissing && (snapshot?.totalCash ?? 0) < 0 ? <div className="text-warning">现金为负，说明买入或申购已超过账户现金流水。</div> : null}
          </div>
        </Card>
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-2">口径</h3>
          <div className="text-xs text-secondary space-y-1">
            <div>账户数: {snapshot?.accountCount ?? 0}</div>
            <div>计价币种: {snapshot?.currency || 'CNY'}</div>
            <div>成本法: {(snapshot?.costMethod || costMethod).toUpperCase()}</div>
          </div>
        </Card>
      </section>

      {!writeBlocked && selectedEntryPanel ? (
        <section>
          <Card padding="md">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">录入流水</h3>
                <p className="mt-1 text-xs text-secondary">
                  {writableAccount.name} · {formatMarketLabel(writableAccount.market)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {entryPanelOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={selectedEntryPanel === item.value}
                    className={`btn-secondary !px-3.5 !py-1.5 !text-xs !font-medium ${
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

            <div className="mt-3 border-t border-white/10 pt-3">
              {selectedEntryPanel === 'trade' && (isStockAccount || isFundAccount || isCryptoAccount) ? (
              <form className="space-y-2" onSubmit={handleTradeSubmit}>
                <input
                  className={PORTFOLIO_INPUT_CLASS}
                  placeholder={isFundAccount ? '基金代码（例如 000001）' : isCryptoAccount ? '币种（BTC 或 ETH）' : '股票代码（例如 600519）'}
                  value={tradeForm.symbol}
                  onChange={(e) => setTradeForm((prev) => ({ ...prev, symbol: e.target.value }))}
                  required
                />
                <div className="grid grid-cols-2 gap-2">
                  <input className={PORTFOLIO_INPUT_CLASS} type="date" value={tradeForm.tradeDate}
                    onChange={(e) => setTradeForm((prev) => ({ ...prev, tradeDate: e.target.value }))} required />
                  <select className={PORTFOLIO_SELECT_CLASS} value={tradeForm.side}
                    onChange={(e) => setTradeForm((prev) => ({ ...prev, side: e.target.value as PortfolioSide }))}>
                    <option value="buy">{isFundAccount ? '申购' : '买入'}</option>
                    <option value="sell">{isFundAccount ? '赎回' : '卖出'}</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={isFundAccount ? '份额' : isCryptoAccount ? '数量' : '数量'} value={tradeForm.quantity}
                    onChange={(e) => setTradeForm((prev) => ({ ...prev, quantity: e.target.value }))} required />
                  <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={isFundAccount ? '成交净值' : isCryptoAccount ? '成交价（USD）' : '成交价'} value={tradeForm.price}
                    onChange={(e) => setTradeForm((prev) => ({ ...prev, price: e.target.value }))} required />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="手续费（可选）" value={tradeForm.fee}
                    onChange={(e) => setTradeForm((prev) => ({ ...prev, fee: e.target.value }))} />
                  {isStockAccount ? (
                    <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="税费（可选）" value={tradeForm.tax}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, tax: e.target.value }))} />
                  ) : (
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder={`币种：${selectedMarket ? getDefaultCurrencyForMarket(selectedMarket) : ''}`} disabled />
                  )}
                </div>
                <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>
                  {isFundAccount ? '提交基金流水' : isCryptoAccount ? '提交数字货币流水' : '提交交易'}
                </button>
              </form>
              ) : null}

              {selectedEntryPanel === 'cash' && (isStockAccount || isFundAccount || isCryptoAccount) ? (
              <form className="space-y-2" onSubmit={handleCashSubmit}>
                <div className="grid grid-cols-2 gap-2">
                  <input className={PORTFOLIO_INPUT_CLASS} type="date" value={cashForm.eventDate}
                    onChange={(e) => setCashForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                  <select className={PORTFOLIO_SELECT_CLASS} value={cashForm.direction}
                    onChange={(e) => setCashForm((prev) => ({ ...prev, direction: e.target.value as PortfolioCashDirection }))}>
                    <option value="in">入金</option>
                    <option value="out">出金</option>
                  </select>
                </div>
                <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="金额"
                  value={cashForm.amount} onChange={(e) => setCashForm((prev) => ({ ...prev, amount: e.target.value }))} required />
                <input className={PORTFOLIO_INPUT_CLASS} placeholder={`币种（默认 ${writableAccount?.baseCurrency || '账户基准币'}）`} value={cashForm.currency}
                  onChange={(e) => setCashForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))} />
                <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>提交资金流水</button>
              </form>
              ) : null}

              {selectedEntryPanel === 'corporate' && isStockAccount ? (
              <form className="space-y-2" onSubmit={handleCorporateSubmit}>
                <input className={PORTFOLIO_INPUT_CLASS} placeholder="股票代码" value={corpForm.symbol}
                  onChange={(e) => setCorpForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                <div className="grid grid-cols-2 gap-2">
                  <input className={PORTFOLIO_INPUT_CLASS} type="date" value={corpForm.effectiveDate}
                    onChange={(e) => setCorpForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} required />
                  <select className={PORTFOLIO_SELECT_CLASS} value={corpForm.actionType}
                    onChange={(e) => setCorpForm((prev) => ({ ...prev, actionType: e.target.value as PortfolioCorporateActionType }))}>
                    <option value="cash_dividend">现金分红</option>
                    <option value="split_adjustment">拆并股调整</option>
                  </select>
                </div>
                {corpForm.actionType === 'cash_dividend' ? (
                  <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.000001" placeholder="每股分红"
                    value={corpForm.cashDividendPerShare}
                    onChange={(e) => setCorpForm((prev) => ({ ...prev, cashDividendPerShare: e.target.value, splitRatio: '' }))} required />
                ) : (
                  <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.000001" placeholder="拆并股比例"
                    value={corpForm.splitRatio}
                    onChange={(e) => setCorpForm((prev) => ({ ...prev, splitRatio: e.target.value, cashDividendPerShare: '' }))} required />
                )}
                <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>提交公司行为</button>
              </form>
              ) : null}

              {selectedEntryPanel === 'manualPrice' && (isFundAccount || isCryptoAccount) ? (
              <form className="space-y-2" onSubmit={handleManualPriceSubmit}>
                <input className={PORTFOLIO_INPUT_CLASS} placeholder={isFundAccount ? '基金代码' : 'BTC 或 ETH'} value={manualPriceForm.symbol}
                  onChange={(e) => setManualPriceForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                <div className="grid grid-cols-2 gap-2">
                  <input className={PORTFOLIO_INPUT_CLASS} type="date" value={manualPriceForm.priceDate}
                    onChange={(e) => setManualPriceForm((prev) => ({ ...prev, priceDate: e.target.value }))} required />
                  <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={isFundAccount ? '最新净值' : '最新价格（USD）'} value={manualPriceForm.price}
                    onChange={(e) => setManualPriceForm((prev) => ({ ...prev, price: e.target.value }))} required />
                </div>
                <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>保存手工价格</button>
              </form>
              ) : null}

              {selectedEntryPanel === 'bank' && isBankAccount ? (
              <form className="space-y-2" onSubmit={handleBankLedgerSubmit}>
                <div className="grid grid-cols-2 gap-2">
                  <input className={PORTFOLIO_INPUT_CLASS} type="date" value={bankForm.eventDate}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                  <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.assetKind}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, assetKind: e.target.value as PortfolioBankAssetKind }))}>
                    <option value="demand">活期/现金</option>
                    <option value="term">定期/理财</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select className={PORTFOLIO_SELECT_CLASS} value={bankForm.direction}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, direction: e.target.value as PortfolioCashDirection }))}>
                    <option value="in">存入/买入</option>
                    <option value="out">取出/赎回</option>
                  </select>
                  <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01" placeholder="金额" value={bankForm.amount}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, amount: e.target.value }))} required />
                </div>
                <input className={PORTFOLIO_INPUT_CLASS} placeholder="银行名称" value={bankForm.bankName}
                  onChange={(e) => setBankForm((prev) => ({ ...prev, bankName: e.target.value }))} required />
                {bankForm.assetKind === 'term' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input className={PORTFOLIO_INPUT_CLASS} placeholder="产品名称" value={bankForm.productName}
                      onChange={(e) => setBankForm((prev) => ({ ...prev, productName: e.target.value }))} required />
                    <input className={PORTFOLIO_INPUT_CLASS} type="date" value={bankForm.maturityDate}
                      onChange={(e) => setBankForm((prev) => ({ ...prev, maturityDate: e.target.value }))} />
                  </div>
                ) : null}
                <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>提交银行流水</button>
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
          <div className="space-y-2">
            {brokerLoadWarning ? (
              <InlineAlert
                variant="warning"
                className="rounded-lg px-2 py-1 text-xs shadow-none"
                message={brokerLoadWarning}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-2">
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
                    <option value="term">定期/理财</option>
                  </select>
                ) : null}
              </div>
            ) : null}
            <div className="max-h-64 overflow-auto rounded-lg border border-white/10 p-2">
              {eventType === 'trade' && tradeEvents.map((item) => (
                <div key={`t-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.tradeDate} {formatSideLabel(item.side)} {item.symbol} 数量={item.quantity} 价格={item.price}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'trade',
                        id: item.id,
                        message: `确认删除 ${item.tradeDate} 的${formatSideLabel(item.side)}流水 ${item.symbol}（数量 ${item.quantity}，价格 ${item.price}）吗？`,
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
                    {item.eventDate} {formatBankAssetKind(item.assetKind)} {formatCashDirectionLabel(item.direction)} {item.amount} {item.currency} · {item.bankName}{item.productName ? ` · ${item.productName}` : ''}
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
              {!eventLoading
                && ((eventType === 'trade' && tradeEvents.length === 0)
                  || (eventType === 'cash' && cashEvents.length === 0)
                  || (eventType === 'corporate' && corporateEvents.length === 0)
                  || (eventType === 'bank' && bankEvents.length === 0)) ? (
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
    </div>
  );
};

export default PortfolioPage;
