import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiError, createParsedApiError } from '../../api/error';
import PortfolioPage from '../PortfolioPage';

const {
  getAccounts,
  getSnapshot,
  refreshFx,
  analyzePortfolio,
  listTags,
  listImportBrokers,
  listTrades,
  listCashLedger,
  listCorporateActions,
  listBankLedger,
  listAdvisoryLedger,
  listInsuranceLedger,
  listInsurancePolicies,
  createTrade,
  deleteTrade,
  createCashLedger,
  deleteCashLedger,
  createCorporateAction,
  deleteCorporateAction,
  createAdvisoryLedger,
  deleteAdvisoryLedger,
  upsertManualPrice,
  parseCsvImport,
  commitCsvImport,
  createAccount,
  updateAccount,
  previewAssetTransfer,
  transferAsset,
} = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getSnapshot: vi.fn(),
  refreshFx: vi.fn(),
  analyzePortfolio: vi.fn(),
  listTags: vi.fn(),
  listImportBrokers: vi.fn(),
  listTrades: vi.fn(),
  listCashLedger: vi.fn(),
  listCorporateActions: vi.fn(),
  listBankLedger: vi.fn(),
  listAdvisoryLedger: vi.fn(),
  listInsuranceLedger: vi.fn(),
  listInsurancePolicies: vi.fn(),
  createTrade: vi.fn(),
  deleteTrade: vi.fn(),
  createCashLedger: vi.fn(),
  deleteCashLedger: vi.fn(),
  createCorporateAction: vi.fn(),
  deleteCorporateAction: vi.fn(),
  createAdvisoryLedger: vi.fn(),
  deleteAdvisoryLedger: vi.fn(),
  upsertManualPrice: vi.fn(),
  parseCsvImport: vi.fn(),
  commitCsvImport: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  previewAssetTransfer: vi.fn(),
  transferAsset: vi.fn(),
}));

vi.mock('../../api/portfolio', () => ({
  portfolioApi: {
    getAccounts,
    getSnapshot,
    refreshFx,
    analyzePortfolio,
    listTags,
    listImportBrokers,
    listTrades,
    listCashLedger,
    listCorporateActions,
    listBankLedger,
    listAdvisoryLedger,
    listInsuranceLedger,
    listInsurancePolicies,
    createTrade,
    deleteTrade,
    createCashLedger,
    deleteCashLedger,
    createCorporateAction,
    deleteCorporateAction,
    createAdvisoryLedger,
    deleteAdvisoryLedger,
    upsertManualPrice,
    parseCsvImport,
    commitCsvImport,
    createAccount,
    updateAccount,
    previewAssetTransfer,
    transferAsset,
  },
}));

type AccountItem = {
  id: number;
  name: string;
  broker?: string;
  market?: 'cn' | 'hk' | 'us' | 'fund' | 'crypto' | 'bank' | 'advisory' | 'insurance';
  baseCurrency?: string;
};

function makeAccounts(items: AccountItem[] = [{ id: 1, name: 'Main' }]) {
  return {
    accounts: items.map((item) => ({
      id: item.id,
      name: item.name,
      broker: item.broker ?? 'Demo',
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
  accountMarket?: string;
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
        market: options.accountMarket ?? 'us',
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
    listTags.mockResolvedValue({ tags: [] });
    listImportBrokers.mockResolvedValue({
      brokers: [{ broker: 'huatai', aliases: [], displayName: '华泰' }],
    });
  listTrades.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listCashLedger.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listCorporateActions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listBankLedger.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listAdvisoryLedger.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listInsuranceLedger.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listInsurancePolicies.mockResolvedValue({ policies: [], total: 0, page: 1, pageSize: 20 });
  createTrade.mockResolvedValue({ id: 1 });
  deleteTrade.mockResolvedValue({ deleted: 1 });
  createCashLedger.mockResolvedValue({ id: 1 });
  deleteCashLedger.mockResolvedValue({ deleted: 1 });
  createCorporateAction.mockResolvedValue({ id: 1 });
  deleteCorporateAction.mockResolvedValue({ deleted: 1 });
  createAdvisoryLedger.mockResolvedValue({ id: 1 });
  deleteAdvisoryLedger.mockResolvedValue({ deleted: 1 });
  upsertManualPrice.mockResolvedValue({ id: 1 });
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
    updateAccount.mockResolvedValue({ id: 1, name: 'Main', broker: 'Demo', market: 'us', baseCurrency: 'CNY', isActive: true });
    previewAssetTransfer.mockResolvedValue({
      sourceAccountId: 1,
      targetAccountId: 2,
      sourceAccountName: 'Source',
      targetAccountName: 'Target',
      asset: { displayName: '600519' },
      transferredCounts: { trades: 1 },
      totalRecords: 1,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
      warnings: [],
      transferred: false,
    });
    transferAsset.mockResolvedValue({
      sourceAccountId: 1,
      targetAccountId: 2,
      sourceAccountName: 'Source',
      targetAccountName: 'Target',
      asset: { displayName: '600519' },
      transferredCounts: { trades: 1 },
      totalRecords: 1,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
      warnings: [],
      transferred: true,
    });
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
    fireEvent.click(within(assetDistribution as HTMLElement).getByRole('button', { name: '资产类型' }));
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

  it('edits only selected account name and broker from the current account strip', async () => {
    getAccounts
      .mockResolvedValueOnce(makeAccounts([{ id: 1, name: 'Main', broker: 'Demo', market: 'us', baseCurrency: 'USD' }]))
      .mockResolvedValueOnce(makeAccounts([{ id: 1, name: '长桥账户', broker: '长桥', market: 'us', baseCurrency: 'USD' }]));
    getSnapshot
      .mockResolvedValueOnce(makeSnapshot({ accountId: 1, accountMarket: 'us' }))
      .mockResolvedValueOnce(makeSnapshot({ accountId: 1, accountMarket: 'us' }))
      .mockResolvedValueOnce(makeSnapshot({ accountId: 1, accountMarket: 'us' }));
    updateAccount.mockResolvedValueOnce({
      id: 1,
      name: '长桥账户',
      broker: '长桥',
      market: 'us',
      baseCurrency: 'USD',
      cashTrackingMode: 'managed',
      isActive: true,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo', refreshPrices: false }));

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('账户名称'), { target: { value: ' 长桥账户 ' } });
    fireEvent.change(screen.getByLabelText('机构/平台'), { target: { value: ' 长桥 ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith(1, { name: '长桥账户', broker: '长桥' }));
    expect(updateAccount.mock.calls[0][1]).not.toHaveProperty('market');
    expect(updateAccount.mock.calls[0][1]).not.toHaveProperty('baseCurrency');
    await waitFor(() => expect(screen.getByText(/当前账户：/).textContent).toContain('长桥账户'));
    expect(screen.getByText(/当前账户：/).textContent).toContain('长桥');
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  it('keeps account edit local when the name is blank', async () => {
    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo', refreshPrices: false }));

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('账户名称'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('账户名称不能为空。')).toBeInTheDocument();
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it('transfers a selected asset from the portfolio header wizard', async () => {
    getAccounts.mockResolvedValue(makeAccounts([
      { id: 1, name: '源账户', broker: '券商A', market: 'us', baseCurrency: 'USD' },
      { id: 2, name: '目标账户', broker: '券商B', market: 'us', baseCurrency: 'USD' },
      { id: 3, name: '基金账户', broker: '平台C', market: 'fund', baseCurrency: 'CNY' },
    ]));
    getSnapshot.mockImplementation(async ({ accountId }: { accountId?: number } = {}) => makeSnapshot({
      accountId: accountId ?? 1,
      accountMarket: accountId === 3 ? 'fund' : 'us',
      positions: accountId === 1 ? [{
        symbol: 'AAPL',
        market: 'us',
        currency: 'USD',
        quantity: 3,
        avgCost: 100,
        totalCost: 300,
        lastPrice: 120,
        marketValueBase: 360,
        unrealizedPnlBase: 60,
        valuationCurrency: 'USD',
        priceSource: 'history_close',
      }] : [],
    }));
    previewAssetTransfer.mockResolvedValueOnce({
      sourceAccountId: 1,
      targetAccountId: 2,
      sourceAccountName: '源账户',
      targetAccountName: '目标账户',
      asset: { displayName: 'AAPL' },
      transferredCounts: { trades: 1 },
      totalRecords: 1,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
      warnings: ['不迁移无产品归属的现金流水；现金余额如需调整，请单独录入现金流水。'],
      transferred: false,
    }).mockResolvedValueOnce({
      sourceAccountId: 1,
      targetAccountId: 2,
      sourceAccountName: '源账户',
      targetAccountName: '目标账户',
      asset: { displayName: 'AAPL' },
      transferredCounts: { trades: 1 },
      totalRecords: 1,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
      warnings: [],
      transferred: false,
    });
    transferAsset.mockResolvedValueOnce({
      sourceAccountId: 1,
      targetAccountId: 2,
      sourceAccountName: '源账户',
      targetAccountName: '目标账户',
      asset: { displayName: 'AAPL' },
      transferredCounts: { trades: 1 },
      totalRecords: 1,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
      warnings: [],
      transferred: true,
    });

    render(<PortfolioPage />);
    await waitForInitialLoad();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo', refreshPrices: false }));

    fireEvent.click(screen.getByRole('button', { name: '转移资产' }));
    const dialog = screen.getByRole('dialog', { name: '转移资产' });
    expect(within(dialog).getByText('AAPL')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/目标账户/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/基金账户/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(previewAssetTransfer).toHaveBeenCalledWith(1, {
      targetAccountId: 2,
      asset: {
        market: 'us',
        symbol: 'AAPL',
        currency: 'USD',
        displayName: 'AAPL',
      },
    }));
    expect(await within(dialog).findByText('确认将迁移的源数据。')).toBeInTheDocument();
    expect(within(dialog).getByText(/共 1 条源数据/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '上一步' }));
    expect(within(dialog).getByText('选择当前账户中的一个资产和同类型目标账户。')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(previewAssetTransfer).toHaveBeenCalledTimes(2));

    fireEvent.click(await within(dialog).findByRole('button', { name: '确定转移' }));
    await waitFor(() => expect(transferAsset).toHaveBeenCalledWith(1, {
      targetAccountId: 2,
      asset: {
        market: 'us',
        symbol: 'AAPL',
        currency: 'USD',
        displayName: 'AAPL',
      },
    }));
    expect(await within(dialog).findByText('资产转移完成')).toBeInTheDocument();
    expect(within(dialog).getByText(/已迁移 1 条源数据到 目标账户/)).toBeInTheDocument();
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
    expect(hkRowCells.at(-3)).toHaveClass('text-danger');
    expect(hkRowCells.at(-2)).toHaveClass('text-danger');
    expect(aaplRowCells.at(-3)).toHaveClass('text-success');
    expect(aaplRowCells.at(-2)).toHaveClass('text-success');
    expect(msftRowCells.at(-2)).toHaveClass('text-secondary');
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

  it('requires existing same-type advisory products for follow-up entries and keeps zero-value products selectable', async () => {
    getAccounts.mockResolvedValueOnce(makeAccounts([
      { id: 1, name: 'Advisory', market: 'advisory', baseCurrency: 'CNY' },
    ]));
    getSnapshot.mockResolvedValue(makeSnapshot({
      accountId: 1,
      accountMarket: 'advisory',
      positions: [
        {
          symbol: 'ADV:COMBO000001',
          displayName: '稳稳幸福',
          market: 'advisory',
          currency: 'CNY',
          quantity: 1,
          avgCost: 100000,
          totalCost: 100000,
          lastPrice: 0,
          marketValueBase: 0,
          unrealizedPnlBase: -100000,
          unrealizedPnlPct: -100,
          valuationCurrency: 'CNY',
          priceSource: 'advisory_value_update',
          priceDate: '2026-03-19',
          priceStale: false,
          priceAvailable: true,
          platform: '且慢',
          productName: '稳稳幸福',
          productType: 'advisory_combo',
          investedAmount: 100000,
          redeemedAmount: 0,
          valueAmount: 0,
        },
        {
          symbol: 'ADV:DCA00000001',
          displayName: '长赢计划',
          market: 'advisory',
          currency: 'CNY',
          quantity: 1,
          avgCost: 200000,
          totalCost: 200000,
          lastPrice: 180000,
          marketValueBase: 180000,
          unrealizedPnlBase: -20000,
          unrealizedPnlPct: -10,
          valuationCurrency: 'CNY',
          priceSource: 'advisory_net_invested_estimate',
          priceDate: '2026-03-19',
          priceStale: false,
          priceAvailable: true,
          platform: '且慢',
          productName: '长赢计划',
          productType: 'dca_plan',
          investedAmount: 200000,
          redeemedAmount: 0,
          valueAmount: 180000,
        },
      ],
      assetBreakdown: { advisory: 180000 },
    }));

    render(<PortfolioPage />);

    await waitForInitialLoad();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo', refreshPrices: false }));

    expect(screen.getByText('稳稳幸福')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('买入'), { target: { value: 'append_buy' } });
    const comboSelect = screen.getByDisplayValue('选择投顾组合');
    expect(within(comboSelect).getByText(/稳稳幸福/)).toBeInTheDocument();
    expect(within(comboSelect).queryByText(/长赢计划/)).not.toBeInTheDocument();

    fireEvent.change(comboSelect, { target: { value: 'ADV:COMBO000001' } });
    fireEvent.change(screen.getByPlaceholderText('投入金额'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '提交投顾投入' }));

    await waitFor(() => expect(createAdvisoryLedger).toHaveBeenCalledWith(expect.objectContaining({
      productName: '稳稳幸福',
      productType: 'advisory_combo',
      eventType: 'buy',
      amount: 1000,
    })));

    fireEvent.change(screen.getByDisplayValue('投顾组合'), { target: { value: 'dca_plan' } });
    fireEvent.change(screen.getByDisplayValue('首次买入'), { target: { value: 'follow_buy' } });
    const dcaSelect = screen.getByDisplayValue('选择定投计划');
    expect(within(dcaSelect).getByText(/长赢计划/)).toBeInTheDocument();
    expect(within(dcaSelect).queryByText(/稳稳幸福/)).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: '生成资产分析报告' }));

    expect(await screen.findByText('权益资产占比较高')).toBeInTheDocument();
    expect(analyzePortfolio).toHaveBeenCalledTimes(1);
    expect(analyzePortfolio).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'standard' }));

    fireEvent.click(screen.getByRole('button', { name: '查看报告' }));
    expect(await screen.findByText('资产配置结构')).toBeInTheDocument();
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
