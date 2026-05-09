import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Check, Minus, X } from 'lucide-react';
import { backtestApi } from '../api/backtest';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Card, Badge, EmptyState, Pagination, StatusDot, Tooltip } from '../components/common';
import type {
  BacktestResultItem,
  BacktestRunResponse,
  PerformanceMetrics,
} from '../types/backtest';

const BACKTEST_INPUT_CLASS =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50';
const BACKTEST_COMPACT_INPUT_CLASS =
  'h-8 min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50';

// ============ Helpers ============

function pct(value?: number | null): string {
  if (value == null) return '--';
  return `${value.toFixed(1)}%`;
}

function outcomeBadge(outcome?: string) {
  if (!outcome) return <Badge variant="default">--</Badge>;
  switch (outcome) {
    case 'win':
      return <Badge variant="success" glow>盈利</Badge>;
    case 'loss':
      return <Badge variant="danger" glow>亏损</Badge>;
    case 'neutral':
      return <Badge variant="warning">持平</Badge>;
    default:
      return <Badge variant="default">{outcome}</Badge>;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'completed':
      return <Badge variant="success">已完成</Badge>;
    case 'insufficient':
    case 'insufficient_data':
      return <Badge variant="warning">数据不足</Badge>;
    case 'error':
      return <Badge variant="danger">错误</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
}

function actualMovementBadge(movement?: string | null) {
  switch (movement) {
    case 'up':
      return <Badge variant="success">上涨</Badge>;
    case 'down':
      return <Badge variant="danger">下跌</Badge>;
    case 'flat':
      return <Badge variant="warning">持平</Badge>;
    default:
      return <Badge variant="default">--</Badge>;
  }
}

function directionExpectedLabel(direction?: string | null) {
  switch (direction) {
    case 'up':
      return '看涨';
    case 'down':
      return '看跌';
    case 'not_down':
      return '不看跌';
    case 'flat':
      return '震荡';
    case 'long':
      return '持仓';
    case 'cash':
      return '空仓';
    default:
      return direction || '';
  }
}

function boolIcon(value?: boolean | null) {
  if (value === true) {
    return (
      <span
        className="inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs-success"
        aria-label="是"
      >
        <StatusDot tone="success" className="inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs-dot" />
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }

  if (value === false) {
    return (
      <span
        className="inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs-danger"
        aria-label="否"
      >
        <StatusDot tone="danger" className="inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs-dot" />
        <X className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs-neutral"
      aria-label="未知"
    >
      <StatusDot tone="neutral" className="inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs-dot" />
      <Minus className="h-3.5 w-3.5" />
    </span>
  );
}

// ============ Metric Row ============

const MetricRow: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="flex items-center justify-between border-b py-2">
    <span className="label">{label}</span>
    <span className={`value ${accent ? 'accent' : ''}`}>{value}</span>
  </div>
);

// ============ Performance Card ============

const PerformanceCard: React.FC<{ metrics: PerformanceMetrics; title: string }> = ({ metrics, title }) => (
  <Card variant="gradient" padding="md" className="animate-fade-in">
    <div className="mb-3">
      <span className="text-xs font-medium uppercase text-muted-foreground">{title}</span>
    </div>
    <MetricRow label="方向准确率" value={pct(metrics.directionAccuracyPct)} accent />
    <MetricRow label="胜率" value={pct(metrics.winRatePct)} accent />
    <MetricRow label="平均模拟收益" value={pct(metrics.avgSimulatedReturnPct)} />
    <MetricRow label="平均标的收益" value={pct(metrics.avgStockReturnPct)} />
    <MetricRow label="止损触发率" value={pct(metrics.stopLossTriggerRate)} />
    <MetricRow label="止盈触发率" value={pct(metrics.takeProfitTriggerRate)} />
    <MetricRow label="平均命中天数" value={metrics.avgDaysToFirstHit != null ? metrics.avgDaysToFirstHit.toFixed(1) : '--'} />
    <div className="flex items-center justify-between border-t pt-2 mt-2">
      <span className="text-xs text-muted-foreground">评估数</span>
      <span className="text-xs text-muted-foreground font-mono">
        {Number(metrics.completedCount)} / {Number(metrics.totalEvaluations)}
      </span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">盈 / 亏 / 平</span>
      <span className="text-xs font-mono">
        <span className="text-emerald-600">{metrics.winCount}</span>
        {' / '}
        <span className="text-destructive">{metrics.lossCount}</span>
        {' / '}
        <span className="text-amber-600">{metrics.neutralCount}</span>
      </span>
    </div>
  </Card>
);

// ============ Run Summary ============

const RunSummary: React.FC<{ data: BacktestRunResponse }> = ({ data }) => (
  <div className="rounded-lg border bg-card animate-fade-in">
    <span className="label">已处理：<span className="value">{data.processed}</span></span>
    <span className="label">已保存：<span className="value primary">{data.saved}</span></span>
    <span className="label">已完成：<span className="value success">{data.completed}</span></span>
    <span className="label">数据不足：<span className="value warning">{data.insufficient}</span></span>
    {data.errors > 0 && (
      <span className="label">错误：<span className="value danger">{data.errors}</span></span>
    )}
  </div>
);

// ============ Main Page ============

const BacktestPage: React.FC = () => {
  // Set page title
  useEffect(() => {
    document.title = '策略回测 - DSA';
  }, []);

  // Input state
  const [codeFilter, setCodeFilter] = useState('');
  const [analysisDateFrom, setAnalysisDateFrom] = useState('');
  const [analysisDateTo, setAnalysisDateTo] = useState('');
  const [evalDays, setEvalDays] = useState('');
  const [forceRerun, setForceRerun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<BacktestRunResponse | null>(null);
  const [runError, setRunError] = useState<ParsedApiError | null>(null);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);

  // Results state
  const [results, setResults] = useState<BacktestResultItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const pageSize = 20;

  // Performance state
  const [overallPerf, setOverallPerf] = useState<PerformanceMetrics | null>(null);
  const [stockPerf, setStockPerf] = useState<PerformanceMetrics | null>(null);
  const [isLoadingPerf, setIsLoadingPerf] = useState(false);
  const effectiveWindowDays = evalDays ? parseInt(evalDays, 10) : overallPerf?.evalWindowDays;
  const isNextDayValidation = effectiveWindowDays === 1;
  const showNextDayActualColumns = isNextDayValidation;

  // Fetch results
  const fetchResults = useCallback(async (
    page = 1,
    code?: string,
    windowDays?: number,
    startDate?: string,
    endDate?: string,
  ) => {
    setIsLoadingResults(true);
    try {
      const response = await backtestApi.getResults({
        code: code || undefined,
        evalWindowDays: windowDays,
        analysisDateFrom: startDate || undefined,
        analysisDateTo: endDate || undefined,
        page,
        limit: pageSize,
      });
      setResults(response.items);
      setTotalResults(response.total);
      setCurrentPage(response.page);
      setPageError(null);
    } catch (err) {
      console.error('Failed to fetch backtest results:', err);
      setPageError(getParsedApiError(err));
    } finally {
      setIsLoadingResults(false);
    }
  }, []);

  // Fetch performance
  const fetchPerformance = useCallback(async (
    code?: string,
    windowDays?: number,
    startDate?: string,
    endDate?: string,
  ) => {
    setIsLoadingPerf(true);
    try {
      const overall = await backtestApi.getOverallPerformance({
        evalWindowDays: windowDays,
        analysisDateFrom: startDate || undefined,
        analysisDateTo: endDate || undefined,
      });
      setOverallPerf(overall);

      if (code) {
        const stock = await backtestApi.getStockPerformance(code, {
          evalWindowDays: windowDays,
          analysisDateFrom: startDate || undefined,
          analysisDateTo: endDate || undefined,
        });
        setStockPerf(stock);
      } else {
        setStockPerf(null);
      }
      setPageError(null);
    } catch (err) {
      console.error('Failed to fetch performance:', err);
      setPageError(getParsedApiError(err));
    } finally {
      setIsLoadingPerf(false);
    }
  }, []);

  // Initial load — fetch performance first, then filter results by its window
  useEffect(() => {
    const init = async () => {
      // Get latest performance (unfiltered returns most recent summary)
      const overall = await backtestApi.getOverallPerformance();
      setOverallPerf(overall);
      // Use the summary's eval_window_days to filter results consistently
      const windowDays = overall?.evalWindowDays;
      if (windowDays && !evalDays) {
        setEvalDays(String(windowDays));
      }
      fetchResults(1, undefined, windowDays, undefined, undefined);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Run backtest
  const handleRun = async () => {
    setIsRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const code = codeFilter.trim() || undefined;
      const evalWindowDays = evalDays ? parseInt(evalDays, 10) : undefined;
      const response = await backtestApi.run({
        code,
        force: forceRerun || undefined,
        minAgeDays: forceRerun ? 0 : undefined,
        evalWindowDays,
      });
      setRunResult(response);
      // Refresh data with same eval_window_days
      fetchResults(1, codeFilter.trim() || undefined, evalWindowDays, analysisDateFrom, analysisDateTo);
      fetchPerformance(codeFilter.trim() || undefined, evalWindowDays, analysisDateFrom, analysisDateTo);
    } catch (err) {
      setRunError(getParsedApiError(err));
    } finally {
      setIsRunning(false);
    }
  };

  // Filter by code
  const handleFilter = () => {
    const code = codeFilter.trim() || undefined;
    const windowDays = evalDays ? parseInt(evalDays, 10) : undefined;
    setCurrentPage(1);
    fetchResults(1, code, windowDays, analysisDateFrom, analysisDateTo);
    fetchPerformance(code, windowDays, analysisDateFrom, analysisDateTo);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFilter();
    }
  };

  const handleShowNextDay = () => {
    const code = codeFilter.trim() || undefined;
    setEvalDays('1');
    setCurrentPage(1);
    fetchResults(1, code, 1, analysisDateFrom, analysisDateTo);
    fetchPerformance(code, 1, analysisDateFrom, analysisDateTo);
  };

  // Pagination
  const totalPages = Math.ceil(totalResults / pageSize);
  const handlePageChange = (page: number) => {
    const windowDays = evalDays ? parseInt(evalDays, 10) : undefined;
    fetchResults(page, codeFilter.trim() || undefined, windowDays, analysisDateFrom, analysisDateTo);
  };

  return (
    <div className="flex min-h-[calc(100vh-5rem)] w-full min-w-0 flex-col bg-transparent pb-4 sm:min-h-[calc(100vh-5.5rem)] lg:min-h-[calc(100vh-2rem)]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border pb-3">
        <div className="flex max-w-5xl flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-[1_1_220px]">
            <input
              type="text"
              value={codeFilter}
              onChange={(e) => setCodeFilter(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="按股票代码筛选（留空查看全部）"
              disabled={isRunning}
              className={BACKTEST_INPUT_CLASS}
            />
          </div>
          <button
            type="button"
            onClick={handleFilter}
            disabled={isLoadingResults}
            className="inline-flex items-center justify-center rounded-lg border bg-background px-3 py-2 text-sm font-medium text-foreground flex items-center gap-1.5 whitespace-nowrap"
          >
            筛选
          </button>
          <div className="flex items-center gap-2 whitespace-nowrap lg:w-40 lg:justify-between">
            <span className="text-xs text-muted-foreground">窗口</span>
            <input
              type="number"
              min={1}
              max={120}
              value={evalDays}
              onChange={(e) => setEvalDays(e.target.value)}
              placeholder="10"
              disabled={isRunning}
              className={`${BACKTEST_COMPACT_INPUT_CLASS} w-24 text-center tabular-nums`}
            />
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-xs text-muted-foreground">开始</span>
            <input
              type="date"
              aria-label="分析日期开始"
              value={analysisDateFrom}
              onChange={(e) => setAnalysisDateFrom(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              className={`${BACKTEST_COMPACT_INPUT_CLASS} w-40 text-center tabular-nums`}
            />
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-xs text-muted-foreground">结束</span>
            <input
              type="date"
              aria-label="分析日期结束"
              value={analysisDateTo}
              onChange={(e) => setAnalysisDateTo(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              className={`${BACKTEST_COMPACT_INPUT_CLASS} w-40 text-center tabular-nums`}
            />
          </div>
          <button
            type="button"
            onClick={handleShowNextDay}
            disabled={isLoadingResults || isLoadingPerf}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${isNextDayValidation ? 'active' : ''}`}
          >
            <span className="dot" />
            次日验证
          </button>
          <button
            type="button"
            onClick={() => setForceRerun(!forceRerun)}
            disabled={isRunning}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${forceRerun ? 'active' : ''}`}
          >
            <span className="dot" />
            强制重跑
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground flex items-center gap-1.5 whitespace-nowrap"
          >
            {isRunning ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                运行中...
              </>
            ) : (
              '运行回测'
            )}
          </button>
        </div>
        {runResult && (
          <div className="mt-2 max-w-4xl">
            <RunSummary data={runResult} />
          </div>
        )}
        {runError && (
          <ApiErrorAlert error={runError} className="mt-2 max-w-4xl" />
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {isNextDayValidation
            ? '次日验证模式会将智能预测与下一个交易日收盘表现进行对比。'
            : '将窗口设为 1，可查看智能预测与下一个交易日收盘表现的对比。'}
        </p>
      </header>

      {/* Main content */}
      <main className="flex min-h-0 flex-1 flex-col gap-4 pt-3 lg:flex-row">
        {/* Left sidebar - Performance */}
        <div className="flex flex-col gap-3 lg:w-60 lg:flex-shrink-0">
          {isLoadingPerf ? (
            <div className="flex items-center justify-center py-8">
              <div className="rounded-full border-muted border-t-primary animate-spin sm" />
            </div>
          ) : overallPerf ? (
            <PerformanceCard metrics={overallPerf} title="整体表现" />
          ) : (
            <EmptyState
              title="暂无指标"
              description="运行回测后会生成组合层面的表现指标。"
              className="h-full min-h-[12rem] border-dashed bg-card/45 shadow-none"
            />
          )}

          {stockPerf && (
            <PerformanceCard metrics={stockPerf} title={`${stockPerf.code || codeFilter}`} />
          )}
        </div>

        {/* Right content - Results table */}
        <section className="min-h-0 flex-1">
          {pageError ? (
            <ApiErrorAlert error={pageError} className="mb-3" />
          ) : null}
          {isLoadingResults ? (
            <div className="flex flex-col items-center justify-center h-64">
              <div className="rounded-full border-muted border-t-primary animate-spin md" />
              <p className="mt-3 text-muted-foreground text-sm">正在加载结果...</p>
            </div>
          ) : results.length === 0 ? (
            <EmptyState
              title="暂无结果"
              description="运行回测以评估历史分析准确性。"
              className="flex h-64 flex-col items-center justify-center text-center border-dashed"
              icon={(
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              )}
            />
          ) : (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center justify-between gap-3 mb-3-meta">
                  <span className="text-xs font-medium uppercase text-muted-foreground">{isNextDayValidation ? '次日验证' : '结果集'}</span>
                  <span className="text-xs text-muted-foreground">
                    {codeFilter.trim() ? `筛选：${codeFilter.trim()}` : '全部股票'}
                    {evalDays ? ` · ${evalDays} 天窗口` : ''}
                    {analysisDateFrom ? ` · 起 ${analysisDateFrom}` : ''}
                    {analysisDateTo ? ` · 止 ${analysisDateTo}` : ''}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">小屏可横向滚动</span>
              </div>
              <div className="rounded-lg border bg-card overflow-x-auto">
                <table className="w-full caption-bottom min-w-[840px] w-full text-sm">
                  <thead className="bg-muted">
                    <tr className="text-left">
                      <th className="bg-muted-cell">股票</th>
                      <th className="bg-muted-cell">分析日期</th>
                      <th className="bg-muted-cell">智能预测</th>
                      <th className="bg-muted-cell">
                        {showNextDayActualColumns ? '实际表现' : '窗口收益'}
                      </th>
                      <th className="bg-muted-cell">
                        {showNextDayActualColumns ? '准确性' : '方向匹配'}
                      </th>
                      <th className="bg-muted-cell">结果</th>
                      <th className="bg-muted-cell">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr
                        key={row.analysisHistoryId}
                        className="border-b hover:bg-muted/50"
                      >
                        <td className="p-2 align-middle whitespace-nowrap w-full caption-bottom-code">
                          <div className="flex flex-col">
                            <span>{row.code}</span>
                            <span className="text-xs text-muted-foreground">{row.stockName || '--'}</span>
                          </div>
                        </td>
                        <td className="p-2 align-middle whitespace-nowrap text-muted-foreground">{row.analysisDate || '--'}</td>
                        <td className="p-2 align-middle whitespace-nowrap max-w-[220px] text-foreground">
                          {(row.trendPrediction || row.operationAdvice) ? (
                            <Tooltip
                              content={[row.trendPrediction, row.operationAdvice].filter(Boolean).join(' / ')}
                              focusable
                            >
                              <div className="flex flex-col gap-1">
                                <span className="block truncate">{row.trendPrediction || '--'}</span>
                                <span className="block truncate text-xs text-muted-foreground">{row.operationAdvice || '--'}</span>
                              </div>
                            </Tooltip>
                          ) : (
                            '--'
                          )}
                        </td>
                        <td className="p-2 align-middle whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {actualMovementBadge(row.actualMovement)}
                            <span className={
                              row.actualReturnPct != null
                                ? row.actualReturnPct > 0 ? 'text-emerald-600' : row.actualReturnPct < 0 ? 'text-destructive' : 'text-muted-foreground'
                                : 'text-muted-foreground'
                            }>
                              {pct(row.actualReturnPct)}
                            </span>
                          </div>
                        </td>
                        <td className="p-2 align-middle whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            {boolIcon(row.directionCorrect)}
                            <span className="text-muted-foreground">{directionExpectedLabel(row.directionExpected)}</span>
                          </span>
                        </td>
                        <td className="p-2 align-middle whitespace-nowrap">{outcomeBadge(row.outcome)}</td>
                        <td className="p-2 align-middle whitespace-nowrap">{statusBadge(row.evalStatus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="mt-4">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </div>

              <p className="text-xs text-muted-foreground text-center mt-2">
                共 {totalResults} 条结果 · 第 {currentPage} / {Math.max(totalPages, 1)} 页
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default BacktestPage;
