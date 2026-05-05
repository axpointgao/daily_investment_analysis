import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiError, createParsedApiError } from '../../api/error';
import PortfolioPage from '../PortfolioPage';

const {
  getAccounts,
  getSnapshot,
  refreshFx,
  analyzePortfolio,
  listImportBrokers,
  listTrades,
  listCashLedger,
  listCorporateActions,
  createTrade,
  deleteTrade,
  createCashLedger,
  deleteCashLedger,
  createCorporateAction,
  deleteCorporateAction,
  parseCsvImport,
  commitCsvImport,
  createAccount,
} = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getSnapshot: vi.fn(),
  refreshFx: vi.fn(),
  analyzePortfolio: vi.fn(),
  listImportBrokers: vi.fn(),
  listTrades: vi.fn(),
  listCashLedger: vi.fn(),
  listCorporateActions: vi.fn(),
  createTrade: vi.fn(),
  deleteTrade: vi.fn(),
  createCashLedger: vi.fn(),
  deleteCashLedger: vi.fn(),
  createCorporateAction: vi.fn(),
  deleteCorporateAction: vi.fn(),
  parseCsvImport: vi.fn(),
  commitCsvImport: vi.fn(),
  createAccount: vi.fn(),
}));

vi.mock('../../api/portfolio', () => ({
  portfolioApi: {
    getAccounts,
    getSnapshot,
    refreshFx,
    analyzePortfolio,
    listImportBrokers,
    listTrades,
    listCashLedger,
    listCorporateActions,
    createTrade,
    deleteTrade,
    createCashLedger,
    deleteCashLedger,
    createCorporateAction,
    deleteCorporateAction,
    parseCsvImport,
    commitCsvImport,
    createAccount,
  },
}));

type AccountItem = {
  id: number;
  name: string;
  market?: 'cn' | 'hk' | 'us' | 'crypto';
  baseCurrency?: string;
};

function makeAccounts(items: AccountItem[] = [{ id: 1, name: 'Main' }]) {
  return {
    accounts: items.map((item) => ({
      id: item.id,
      name: item.name,
      broker: 'Demo',
      market: item.market ?? 'us',
      baseCurrency: item.baseCurrency ?? 'CNY',
      isActive: true,
      ownerId: null,
      createdAt: '2026-03-19T00:00:00Z',
      updatedAt: '2026-03-19T00:00:00Z',
    })),
  };
}

function makeSnapshot(options: {
  accountId?: number;
  fxStale?: boolean;
  accountCount?: number;
  positions?: Array<Record<string, unknown>>;
  assetBreakdown?: Record<string, number>;
} = {}) {
  const accountId = options.accountId ?? 1;
  return {
    asOf: '2026-03-19',
    costMethod: 'fifo' as const,
    currency: 'CNY',
    accountCount: options.accountCount ?? 1,
    totalCash: 1000,
    totalMarketValue: 2000,
    totalEquity: 3000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feeTotal: 0,
    taxTotal: 0,
    fxStale: options.fxStale ?? true,
    assetBreakdown: options.assetBreakdown ?? {
      stock: 2000,
      cash: 1000,
    },
    accounts: [
      {
        accountId,
        accountName: `Account ${accountId}`,
        ownerId: null,
        broker: 'Demo',
        market: 'us',
        baseCurrency: 'CNY',
        asOf: '2026-03-19',
        costMethod: 'fifo' as const,
        totalCash: 1000,
        totalMarketValue: 2000,
        totalEquity: 3000,
        realizedPnl: 0,
        unrealizedPnl: 0,
        feeTotal: 0,
        taxTotal: 0,
        fxStale: options.fxStale ?? true,
        positions: options.positions ?? [],
      },
    ],
  };
}

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForInitialLoad() {
  await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(listTrades).toHaveBeenCalledTimes(1));
}

describe('PortfolioPage FX refresh', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('stocks.index.json')) {
        return new Response(JSON.stringify([
          ['00700.HK', '00700', '腾讯控股', '', '', [], 'HK', 'stock', true, 100],
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('funds.index.json')) {
        return new Response(JSON.stringify([
          { fundCode: '510050', fundName: '上证50ETF华夏', active: true, popularity: 100 },
          { fundCode: '000290', fundName: '鹏华全球高收益债(QDII)', active: true, popularity: 100 },
          { fundCode: '006285', fundName: '鹏华全球高收益债(QDII)', active: true, popularity: 100 },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    getAccounts.mockResolvedValue(makeAccounts());
    getSnapshot.mockImplementation(async ({ accountId }: { accountId?: number } = {}) => makeSnapshot({ accountId, fxStale: true }));
    analyzePortfolio.mockResolvedValue({
      asOf: '2026-03-19',
      snapshotSignature: 'v1:test',
      generatedAt: '2026-03-19T10:00:00',
      summaryPoints: ['权益资产占比较高', '单一资产集中度可关注', '组合波动主要来自股票'],
      fullMarkdown: '## 资产配置结构\n权益资产占比较高。',
      modelUsed: 'test-model',
    });
    refreshFx.mockResolvedValue({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: true,
      disabledReason: null,
      pairCount: 1,
      updatedCount: 1,
      staleCount: 0,
      errorCount: 0,
    });
    listImportBrokers.mockResolvedValue({
      brokers: [{ broker: 'huatai', aliases: [], displayName: '华泰' }],
    });
    listTrades.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    listCashLedger.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    listCorporateActions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    createTrade.mockResolvedValue({ id: 1 });
    deleteTrade.mockResolvedValue({ deleted: 1 });
    createCashLedger.mockResolvedValue({ id: 1 });
    deleteCashLedger.mockResolvedValue({ deleted: 1 });
    createCorporateAction.mockResolvedValue({ id: 1 });
    deleteCorporateAction.mockResolvedValue({ deleted: 1 });
    parseCsvImport.mockResolvedValue({ broker: 'huatai', recordCount: 0, skippedCount: 0, errorCount: 0, records: [], errors: [] });
    commitCsvImport.mockResolvedValue({
      accountId: 1,
      recordCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      dryRun: true,
      errors: [],
    });
    createAccount.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders stale FX status with a manual refresh button', async () => {
    render(<PortfolioPage />);

    await waitForInitialLoad();

    expect(screen.getByText('组合快照、手工录入、CSV 导入与资产分析（支持全组合 / 单账户切换）')).toBeInTheDocument();
    expect(screen.queryByText(/风险分析/)).not.toBeInTheDocument();
    expect(await screen.findByText('过期')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新汇率' })).toBeInTheDocument();
  });

  it('localizes stock and cash labels in asset distribution', async () => {
    getSnapshot.mockResolvedValueOnce(makeSnapshot({
      assetBreakdown: {
        stock: 2000,
        cash: 1000,
      },
    }));

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const assetDistribution = screen.getByText('资产分布').closest('.terminal-card');
    expect(assetDistribution).not.toBeNull();
    expect(within(assetDistribution as HTMLElement).getByText('股票')).toBeInTheDocument();
    expect(within(assetDistribution as HTMLElement).getByText('现金')).toBeInTheDocument();
    expect(within(assetDistribution as HTMLElement).queryByText('stock')).not.toBeInTheDocument();
    expect(within(assetDistribution as HTMLElement).queryByText('cash')).not.toBeInTheDocument();
  });

  it('refreshes FX for a single selected account and only reloads snapshot', async () => {
    getSnapshot
      .mockResolvedValueOnce(makeSnapshot({ fxStale: true }))
      .mockResolvedValueOnce(makeSnapshot({ accountId: 1, fxStale: true }))
      .mockResolvedValueOnce(makeSnapshot({ accountId: 1, fxStale: false }));

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const accountSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(accountSelect, { target: { value: '1' } });

    await waitFor(() => {
      expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo', refreshPrices: false });
    });

    const snapshotCallsBeforeRefresh = getSnapshot.mock.calls.length;
    const tradeCallsBeforeRefresh = listTrades.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));

    await waitFor(() => expect(refreshFx).toHaveBeenCalledWith({ accountId: 1 }));
    expect(await screen.findByText('汇率已刷新，共更新 1 对。')).toBeInTheDocument();
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsBeforeRefresh + 1));
    expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo', refreshPrices: true });
    expect(listTrades).toHaveBeenCalledTimes(tradeCallsBeforeRefresh);
    expect(listCashLedger).not.toHaveBeenCalled();
    expect(listCorporateActions).not.toHaveBeenCalled();
    expect(screen.getByText('最新')).toBeInTheDocument();
  });

  it('refreshes FX for the full portfolio without sending accountId and shows neutral feedback when no pair exists', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: true,
      disabledReason: null,
      pairCount: 0,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));

    await waitFor(() => expect(refreshFx).toHaveBeenCalledWith({ accountId: undefined }));
    expect(await screen.findByText('当前范围无可刷新的汇率对。')).toBeInTheDocument();
  });

  it('shows disabled feedback when FX online refresh is disabled even without a disabled reason', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: false,
      pairCount: 1,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));

    expect(await screen.findByText('汇率在线刷新已被禁用。')).toBeInTheDocument();
  });

  it('renders backend-provided position valuation fields, Chinese pnl colors and stale missing-price hint', async () => {
    getSnapshot.mockResolvedValueOnce(makeSnapshot({ fxStale: true, positions: [
      { symbol: 'HK00700', displayName: '腾讯控股', market: 'hk', currency: 'HKD', quantity: 10, avgCost: 400, totalCost: 4000, lastPrice: 420, marketValueBase: 4200, unrealizedPnlBase: 200, unrealizedPnlPct: 5, valuationCurrency: 'HKD', priceSource: 'history_close', priceDate: '2026-03-18', priceStale: true, priceAvailable: true },
      { symbol: 'AAPL', market: 'us', currency: 'USD', quantity: 5, avgCost: 100, totalCost: 500, lastPrice: 90, marketValueBase: 450, unrealizedPnlBase: -50, unrealizedPnlPct: -10, valuationCurrency: 'USD', priceSource: 'realtime_quote', priceDate: '2026-03-19', priceStale: false, priceAvailable: true },
      { symbol: 'MSFT', market: 'us', currency: 'USD', quantity: 5, avgCost: 100, totalCost: 500, lastPrice: 0, marketValueBase: 0, unrealizedPnlBase: 0, unrealizedPnlPct: null, valuationCurrency: 'USD', priceSource: 'missing', priceDate: null, priceStale: true, priceAvailable: false },
    ] }));

    render(<PortfolioPage />);

    await waitForInitialLoad();

    expect(await screen.findByText('HK00700')).toBeInTheDocument();
    expect(screen.getByText('港股')).toBeInTheDocument();
    expect(screen.getByText('腾讯控股')).toBeInTheDocument();
    expect(screen.getByText('420.0000')).toBeInTheDocument();
    expect(screen.getByText('HKD 4,200.00')).toBeInTheDocument();
    expect(screen.getByText('+5.00%')).toBeInTheDocument();
    expect(screen.getByText('-10.00%')).toBeInTheDocument();
    expect(screen.getByText('收盘价 · 2026-03-18')).toBeInTheDocument();
    expect(screen.getByText('缺价')).toBeInTheDocument();
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(2);

    const hkRow = screen.getByText('HK00700').closest('tr');
    const aaplRow = screen.getByText('AAPL').closest('tr');
    const msftRow = screen.getByText('MSFT').closest('tr');
    expect(hkRow).not.toBeNull();
    expect(aaplRow).not.toBeNull();
    expect(msftRow).not.toBeNull();

    const hkRowCells = within(hkRow as HTMLTableRowElement).getAllByRole('cell');
    const aaplRowCells = within(aaplRow as HTMLTableRowElement).getAllByRole('cell');
    const msftRowCells = within(msftRow as HTMLTableRowElement).getAllByRole('cell');
    expect(hkRowCells.at(-2)).toHaveClass('text-danger');
    expect(hkRowCells.at(-1)).toHaveClass('text-danger');
    expect(aaplRowCells.at(-2)).toHaveClass('text-success');
    expect(aaplRowCells.at(-1)).toHaveClass('text-success');
    expect(msftRowCells.at(-1)).toHaveClass('text-secondary');
  });

  it('keeps crypto quantities at up to 8 decimals in display and entry controls', async () => {
    getAccounts.mockResolvedValueOnce(makeAccounts([
      { id: 1, name: 'Crypto', market: 'crypto', baseCurrency: 'USD' },
    ]));
    const cryptoSnapshot = makeSnapshot({ positions: [
      { symbol: 'BTC', market: 'crypto', currency: 'USD', quantity: 0.12345678, avgCost: 60000, totalCost: 7407.4068, lastPrice: 65000, marketValueBase: 8024.6907, unrealizedPnlBase: 617.2839, unrealizedPnlPct: 8.33, valuationCurrency: 'USD', priceSource: 'crypto_price', priceProvider: 'okx', priceDate: '2026-03-19', priceStale: false, priceAvailable: true },
    ] });
    getSnapshot.mockResolvedValue(cryptoSnapshot);
    listTrades.mockResolvedValue({
      items: [{
        id: 1,
        accountId: 1,
        symbol: 'BTC',
        market: 'crypto',
        currency: 'USD',
        tradeDate: '2026-03-19',
        side: 'buy',
        quantity: 0.12345678,
        price: 60000,
        fee: 0,
        tax: 0,
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });

    expect(await screen.findByText('0.12345678')).toBeInTheDocument();
    expect(screen.getByText(/数量=0.12345678/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('成交数量（币）')).toHaveAttribute('step', '0.00000001');
  });

  it('generates portfolio analysis only from the explicit analysis button and shows report drawer', async () => {
    getSnapshot.mockResolvedValueOnce(makeSnapshot({ fxStale: false, positions: [
      { symbol: '510050', market: 'cn', currency: 'CNY', quantity: 100, avgCost: 2.5, totalCost: 250, lastPrice: 2.8, marketValueBase: 280, unrealizedPnlBase: 30, unrealizedPnlPct: 12, valuationCurrency: 'CNY', priceSource: 'history_close', priceDate: '2026-03-18', priceStale: false, priceAvailable: true },
      { symbol: '000290', market: 'fund', currency: 'CNY', quantity: 100, avgCost: 1.1, totalCost: 110, lastPrice: 1.2, marketValueBase: 120, unrealizedPnlBase: 10, unrealizedPnlPct: 9.09, valuationCurrency: 'CNY', priceSource: 'fund_nav', priceDate: '2026-03-18', priceStale: false, priceAvailable: true },
    ] }));

    render(<PortfolioPage />);

    await waitForInitialLoad();

    expect(screen.getByText('资产分析')).toBeInTheDocument();
    expect(await screen.findByText('上证50ETF华夏')).toBeInTheDocument();
    expect(screen.getAllByText('ETF').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('鹏华全球高收益债(QDII)')).toBeInTheDocument();
    expect(screen.getByText('场外基金')).toBeInTheDocument();
    expect(analyzePortfolio).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '生成分析' }));

    expect(await screen.findByText('权益资产占比较高')).toBeInTheDocument();
    expect(analyzePortfolio).toHaveBeenCalledTimes(1);
    expect(analyzePortfolio).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'quick' }));

    fireEvent.click(screen.getByRole('button', { name: '查看报告' }));
    expect(await screen.findByText('资产配置结构')).toBeInTheDocument();
  });

  it('uses selected wealth report mode when generating portfolio analysis', async () => {
    getSnapshot.mockResolvedValueOnce(makeSnapshot({ fxStale: false, positions: [
      { symbol: '510050', market: 'cn', currency: 'CNY', quantity: 100, avgCost: 2.5, totalCost: 250, lastPrice: 2.8, marketValueBase: 280, unrealizedPnlBase: 30, unrealizedPnlPct: 12, valuationCurrency: 'CNY', priceSource: 'history_close', priceDate: '2026-03-18', priceStale: false, priceAvailable: true },
    ] }));

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: '财富报告' }));
    fireEvent.click(screen.getByRole('button', { name: '生成财富报告' }));

    await waitFor(() => {
      expect(analyzePortfolio).toHaveBeenCalledWith(expect.objectContaining({ mode: 'wealth_report' }));
    });
  });

  it('prefers disabled feedback over empty-pair feedback when refresh is disabled', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: false,
      disabledReason: 'portfolio_fx_update_disabled',
      pairCount: 0,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));

    expect(await screen.findByText('汇率在线刷新已被禁用。')).toBeInTheDocument();
    expect(screen.queryByText('当前范围无可刷新的汇率对。')).not.toBeInTheDocument();
  });

  it('shows warning feedback when FX refresh still falls back to stale rates', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      pairCount: 2,
      updatedCount: 1,
      staleCount: 1,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));

    expect(await screen.findByText(/stale\/fallback 汇率/)).toBeInTheDocument();
  });

  it('shows warning feedback when FX refresh returns online errors without stale pairs', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      pairCount: 1,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 1,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const snapshotCallsBeforeRefresh = getSnapshot.mock.calls.length;
    const tradeCallsBeforeRefresh = listTrades.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));

    expect(await screen.findByText(/在线刷新未完全成功/)).toBeInTheDocument();
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsBeforeRefresh + 1));
    expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: undefined, costMethod: 'fifo', refreshPrices: true });
    expect(listTrades).toHaveBeenCalledTimes(tradeCallsBeforeRefresh);
    expect(listCashLedger).not.toHaveBeenCalled();
    expect(listCorporateActions).not.toHaveBeenCalled();
  });

  it('restores the button state and shows the existing error alert when FX refresh fails', async () => {
    refreshFx.mockRejectedValueOnce(
      createApiError(
        createParsedApiError({
          title: '刷新失败',
          message: '汇率服务暂时不可用',
        }),
      ),
    );

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const refreshButton = screen.getByRole('button', { name: '刷新汇率' });
    fireEvent.click(refreshButton);

    const fxAlertTitle = await screen.findByText('刷新失败');
    expect(fxAlertTitle.closest('[role="alert"]')).toHaveTextContent('汇率服务暂时不可用');
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新汇率' })).not.toBeDisabled());
  });

  it('does not keep success feedback when snapshot reload fails after FX refresh succeeds', async () => {
    getSnapshot
      .mockResolvedValueOnce(makeSnapshot({ fxStale: true }))
      .mockRejectedValueOnce(
        createApiError(
          createParsedApiError({
            title: '快照刷新失败',
            message: '无法加载最新持仓快照',
          }),
        ),
      );

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));

    const fxAlertTitle = await screen.findByText('快照刷新失败');
    expect(fxAlertTitle.closest('[role="alert"]')).toHaveTextContent('无法加载最新持仓快照');
    await waitFor(() => expect(screen.queryByText('汇率已刷新，共更新 1 对。')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新汇率' })).not.toBeDisabled());
  });

  it('drops late FX refresh results after switching to another account scope', async () => {
    getAccounts.mockResolvedValueOnce(makeAccounts([{ id: 1, name: 'Main' }, { id: 2, name: 'Alt' }]));
    getSnapshot.mockImplementation(async ({ accountId }: { accountId?: number } = {}) => {
      if (accountId === 2) {
        return makeSnapshot({ accountId: 2, fxStale: false });
      }
      return makeSnapshot({ accountId: accountId ?? 1, fxStale: true, accountCount: accountId ? 1 : 2 });
    });

    const pendingRefresh = deferredPromise<{
      asOf: string;
      accountCount: number;
      pairCount: number;
      updatedCount: number;
      staleCount: number;
      errorCount: number;
    }>();
    refreshFx.mockImplementationOnce(() => pendingRefresh.promise);

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const accountSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(accountSelect, { target: { value: '1' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo', refreshPrices: false }));

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));
    expect(await screen.findByRole('button', { name: '刷新中...' })).toBeDisabled();

    fireEvent.change(accountSelect, { target: { value: '2' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 2, costMethod: 'fifo', refreshPrices: false }));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新汇率' })).not.toBeDisabled());

    const snapshotCallsAfterSwitch = getSnapshot.mock.calls.length;

    await act(async () => {
      pendingRefresh.resolve({
        asOf: '2026-03-19',
        accountCount: 1,
        pairCount: 1,
        updatedCount: 1,
        staleCount: 0,
        errorCount: 0,
      });
      await pendingRefresh.promise;
    });

    expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsAfterSwitch);
    expect(screen.queryByText('汇率已刷新，共更新 1 对。')).not.toBeInTheDocument();
  });

  it('drops late FX refresh results after switching cost method', async () => {
    const pendingRefresh = deferredPromise<{
      asOf: string;
      accountCount: number;
      pairCount: number;
      updatedCount: number;
      staleCount: number;
      errorCount: number;
    }>();
    refreshFx.mockImplementationOnce(() => pendingRefresh.promise);

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const costMethodSelect = screen.getAllByRole('combobox')[1];

    fireEvent.click(screen.getByRole('button', { name: '刷新汇率' }));
    expect(await screen.findByRole('button', { name: '刷新中...' })).toBeDisabled();

    fireEvent.change(costMethodSelect, { target: { value: 'avg' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: undefined, costMethod: 'avg', refreshPrices: false }));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新汇率' })).not.toBeDisabled());

    const snapshotCallsAfterSwitch = getSnapshot.mock.calls.length;

    await act(async () => {
      pendingRefresh.resolve({
        asOf: '2026-03-19',
        accountCount: 1,
        pairCount: 1,
        updatedCount: 1,
        staleCount: 0,
        errorCount: 0,
      });
      await pendingRefresh.promise;
    });

    expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsAfterSwitch);
    expect(screen.queryByText('汇率已刷新，共更新 1 对。')).not.toBeInTheDocument();
  });
});
