import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  Edit3,
  FileUp,
  FilePlus2,
  Library,
  Play,
  Save,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { screenerApi } from '../api/screener';
import type {
  ScreenerCandidate,
  ScreenerRunResponse,
  ScreenerStrategyId,
  ScreenerStrategyInfo,
  ScreenerStrategyLibraryItem,
  ScreenerStrategyLibraryUpsert,
} from '../api/screener';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Badge, Button, Card, EmptyState, InlineAlert } from '../components/common';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const DEFAULT_SCORING_STRATEGIES: ScreenerStrategyId[] = ['quality_value', 'multi_factor', 'trend_follow'];
const DEFAULT_QUERY = 'PE小于25，PB小于3，收盘价站上60日线，25日涨幅大于0，非ST，成交额大于2亿';

type ScreenerWorkspaceTab = 'candidates' | 'verification';

type StrategyFormState = {
  name: string;
  description: string;
  query: string;
};

const emptyForm: StrategyFormState = {
  name: '',
  description: '',
  query: '',
};

const metricLabels: Record<string, string> = {
  price: '价格',
  change_pct: '涨跌幅',
  ma20: 'MA20',
  ma60: 'MA60',
  bias_ma20_pct: '偏离MA20',
  volume_ratio_20d: '量比',
  pe_ratio: 'PE',
  pb_ratio: 'PB',
  roe: 'ROE',
  revenue_yoy: '营收同比',
  net_profit_yoy: '净利同比',
};

function formatMetric(key: string, value: number | null | undefined): string {
  if (value == null) return '--';
  if (key.includes('pct') || key.includes('yoy') || key === 'roe') return `${value.toFixed(1)}%`;
  if (key.includes('ratio') && key !== 'pe_ratio' && key !== 'pb_ratio') return `${value.toFixed(2)}x`;
  return Number(value).toFixed(value >= 100 ? 1 : 2);
}

function strategyTone(id: string): string {
  switch (id) {
    case 'iwencai_import':
      return 'border-purple-200 bg-purple-50 text-purple-800';
    case 'local_query':
      return 'border-slate-200 bg-slate-50 text-slate-800';
    case 'quality_value':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'multi_factor':
      return 'border-sky-200 bg-sky-50 text-sky-800';
    case 'trend_follow':
      return 'border-blue-200 bg-blue-50 text-blue-800';
    case 'pullback':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'breakout':
      return 'border-rose-200 bg-rose-50 text-rose-800';
    default:
      return '';
  }
}

function buildRunSummary(result: ScreenerRunResponse): string {
  const mode = result.executionMode === 'iwencai_import' ? '导入候选' : '本地选股';
  return `${mode} ${result.candidates.length} 只`;
}

function toUpsertPayload(item: StrategyFormState, previous?: ScreenerStrategyLibraryItem): ScreenerStrategyLibraryUpsert {
  return {
    name: item.name.trim(),
    description: item.description.trim(),
    query: item.query.trim(),
    backtestStatus: previous?.backtestStatus ?? '未回测',
    lastRunResult: previous?.lastRunResult ?? null,
  };
}

const CandidateRow: React.FC<{
  candidate: ScreenerCandidate;
  strategyNames: Map<string, string>;
}> = ({ candidate, strategyNames }) => {
  const visibleMetrics = ['price', 'change_pct', 'bias_ma20_pct', 'volume_ratio_20d', 'pe_ratio', 'roe']
    .filter((key) => candidate.metrics[key] != null);
  const iwencaiFields = Object.entries(candidate.iwencaiFields).slice(0, 8);

  const chatUrl = `/chat?stock=${encodeURIComponent(candidate.code)}&name=${encodeURIComponent(candidate.name || '')}`;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-foreground">{candidate.name || candidate.code}</span>
            <span className="font-mono text-sm text-muted-foreground">{candidate.code}</span>
            {candidate.latestDate ? <Badge variant="history">{candidate.latestDate}</Badge> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidate.matchedStrategies.map((id) => (
              <span key={id} className={cn('rounded-full border px-2 py-0.5 text-xs', strategyTone(id))}>
                {strategyNames.get(id) || id}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">综合分</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{candidate.score.toFixed(1)}</p>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to={chatUrl}>
              问股
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {visibleMetrics.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {visibleMetrics.map((key) => (
            <div key={key} className="rounded-md border bg-muted/30 px-2.5 py-2">
              <p className="truncate text-xs text-muted-foreground">{metricLabels[key] || key}</p>
              <p className="mt-1 font-mono text-sm text-foreground">{formatMetric(key, candidate.metrics[key])}</p>
            </div>
          ))}
        </div>
      ) : null}

      {iwencaiFields.length > 0 ? (
        <div className="mt-4 rounded-lg border bg-purple-50/40 p-3">
          <p className="mb-2 text-xs font-medium text-purple-900">问财字段</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {iwencaiFields.map(([key, value]) => (
              <div key={key} className="min-w-0">
                <p className="truncate text-xs text-purple-700/80">{key}</p>
                <p className="mt-0.5 truncate text-sm text-purple-950">{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">命中理由</p>
          <ul className="space-y-1.5 text-sm leading-6 text-foreground">
            {candidate.reasons.slice(0, 4).map((reason) => <li key={reason}>• {reason}</li>)}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">风险提示</p>
          {candidate.risks.length > 0 ? (
            <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
              {candidate.risks.slice(0, 4).map((risk) => <li key={risk}>• {risk}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">本地规则未发现明显硬伤，仍需结合公告、研报和持仓仓位确认。</p>
          )}
        </div>
      </div>
    </div>
  );
};

const StrategyForm: React.FC<{
  form: StrategyFormState;
  onChange: (next: StrategyFormState) => void;
}> = ({ form, onChange }) => (
  <div className="grid gap-3">
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">策略名称</span>
      <input
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.target.value })}
        className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        placeholder="例如：低估值趋势"
      />
    </label>
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">策略说明</span>
      <textarea
        value={form.description}
        onChange={(event) => onChange({ ...form, description: event.target.value })}
        rows={3}
        className="mt-1 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        placeholder="用直白的话说明这条策略想找什么股票、适合什么操作节奏。"
      />
    </label>
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">选股语句</span>
      <textarea
        value={form.query}
        onChange={(event) => onChange({ ...form, query: event.target.value })}
        rows={4}
        className="mt-1 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        placeholder="例如：KDJ金叉，MACD金叉，非ST，成交额大于2亿"
      />
    </label>
  </div>
);

const ScreenerPage: React.FC = () => {
  const [strategies, setStrategies] = useState<ScreenerStrategyInfo[]>([]);
  const [library, setLibrary] = useState<ScreenerStrategyLibraryItem[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [iwencaiQuery, setIwencaiQuery] = useState(DEFAULT_QUERY);
  const [limit, setLimit] = useState(30);
  const [result, setResult] = useState<ScreenerRunResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ScreenerStrategyLibraryItem | null>(null);
  const [form, setForm] = useState<StrategyFormState>(emptyForm);
  const [activeTab, setActiveTab] = useState<ScreenerWorkspaceTab>('candidates');
  const [selectedBacktestCode, setSelectedBacktestCode] = useState('');
  const [enhanceOptions, setEnhanceOptions] = useState({
    announcements: true,
    reports: true,
    fundamentals: true,
    news: false,
  });

  useEffect(() => {
    document.title = '策略选股 - DSA';
    Promise.all([screenerApi.getStrategies(), screenerApi.getLibrary()])
      .then(([strategyItems, libraryItems]) => {
        setStrategies(strategyItems);
        setLibrary(libraryItems);
        if (libraryItems.length > 0) {
          setSelectedLibraryId(libraryItems[0].id);
          setIwencaiQuery(libraryItems[0].query);
        }
      })
      .catch((error) => setPageError(getParsedApiError(error)));
  }, []);

  const strategyNames = useMemo(() => new Map(strategies.map((item) => [item.id, item.name])), [strategies]);
  const selectedStrategy = useMemo(
    () => library.find((item) => item.id === selectedLibraryId) ?? library[0] ?? null,
    [library, selectedLibraryId],
  );

  const queryDirty = selectedStrategy ? iwencaiQuery.trim() !== selectedStrategy.query.trim() : Boolean(iwencaiQuery.trim());
  const candidateRecords = result?.candidates ?? [];
  const selectedBacktestCandidate = candidateRecords.find((item) => item.code === selectedBacktestCode) ?? candidateRecords[0] ?? null;

  const openNewStrategy = (initialQuery = iwencaiQuery) => {
    setEditingItem(null);
    setForm({
      name: '',
      description: '',
      query: initialQuery,
    });
    setEditorOpen(true);
  };

  const openEditStrategy = (item: ScreenerStrategyLibraryItem) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      description: item.description,
      query: item.id === selectedStrategy?.id ? iwencaiQuery || item.query : item.query,
    });
    setEditorOpen(true);
  };

  const selectStrategy = (item: ScreenerStrategyLibraryItem) => {
    setSelectedLibraryId(item.id);
    setIwencaiQuery(item.query);
    setResult(null);
    setPickerOpen(false);
  };

  const saveStrategy = async () => {
    if (!form.name.trim() || !form.description.trim() || !form.query.trim()) {
      setPageError({ message: '策略名称、说明和选股语句都需要填写。' } as ParsedApiError);
      return;
    }
    setSaving(true);
    setPageError(null);
    try {
      const payload = toUpsertPayload(form, editingItem ?? undefined);
      const item = editingItem
        ? await screenerApi.updateLibraryItem(editingItem.id, payload)
        : await screenerApi.createLibraryItem(payload);
      setLibrary((prev) => {
        const exists = prev.some((current) => current.id === item.id);
        return exists ? prev.map((current) => (current.id === item.id ? item : current)) : [item, ...prev];
      });
      setSelectedLibraryId(item.id);
      setIwencaiQuery(item.query);
      setEditorOpen(false);
      setPickerOpen(false);
    } catch (error) {
      setPageError(getParsedApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const updateCurrentStrategyQuery = async () => {
    if (!selectedStrategy) {
      openNewStrategy(iwencaiQuery);
      return;
    }
    const nextQuery = iwencaiQuery.trim();
    if (!nextQuery) {
      setPageError({ message: '选股语句不能为空。' } as ParsedApiError);
      return;
    }
    setSaving(true);
    setPageError(null);
    try {
      const item = await screenerApi.updateLibraryItem(selectedStrategy.id, {
        name: selectedStrategy.name,
        description: selectedStrategy.description,
        query: nextQuery,
        backtestStatus: selectedStrategy.backtestStatus,
        lastRunResult: selectedStrategy.lastRunResult,
      });
      setLibrary((prev) => prev.map((current) => (current.id === item.id ? item : current)));
      setSelectedLibraryId(item.id);
      setIwencaiQuery(item.query);
    } catch (error) {
      setPageError(getParsedApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const runScreener = async () => {
    if (!iwencaiQuery.trim()) {
      setPageError({ message: '需要填写选股语句。' } as ParsedApiError);
      return;
    }
    setLoading(true);
    setPageError(null);
    try {
      const response = await screenerApi.run({
        strategyIds: DEFAULT_SCORING_STRATEGIES,
        stockCodes: undefined,
        iwencaiQuery: iwencaiQuery.trim(),
        iwencaiPage: 1,
        limit,
        includeFundamentals: false,
        useIwencai: false,
        strategyLibraryId: selectedStrategy?.id,
      });
      setResult(response);
      setSelectedBacktestCode(response.candidates[0]?.code ?? '');
      setActiveTab('candidates');
      if (selectedStrategy) {
        const summary = buildRunSummary(response);
        setLibrary((prev) => prev.map((item) => (
          item.id === selectedStrategy.id
            ? { ...item, lastRunResult: summary, updatedAt: new Date().toISOString() }
            : item
        )));
      }
    } catch (error) {
      setPageError(getParsedApiError(error));
    } finally {
      setLoading(false);
    }
  };

  const importIwencaiExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    setPageError(null);
    try {
      const response = await screenerApi.importIwencaiExcel({
        file,
        strategyQuery: iwencaiQuery.trim(),
        strategyLibraryId: selectedStrategy?.id,
        limit: 100,
      });
      setResult(response);
      setSelectedBacktestCode(response.candidates[0]?.code ?? '');
      setActiveTab('candidates');
      if (selectedStrategy) {
        const summary = `导入 ${response.candidates.length} 只候选`;
        setLibrary((prev) => prev.map((item) => (
          item.id === selectedStrategy.id
            ? { ...item, lastRunResult: summary, updatedAt: new Date().toISOString() }
            : item
        )));
      }
    } catch (error) {
      setPageError(getParsedApiError(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">策略选股</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              保存策略问句，本地能跑就直接筛候选；本地不能跑时，导入问财客户端导出的候选股。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:min-w-[360px]">
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">策略库</p>
              <p className="mt-1 text-sm font-medium">{library.length || '--'} 条</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">候选记录</p>
              <p className="mt-1 text-sm font-medium">{candidateRecords.length || '--'} 只</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">初筛模式</p>
              <p className="mt-1 text-sm font-medium">本地/导入</p>
            </div>
          </div>
        </div>
      </section>

      {pageError ? <ApiErrorAlert error={pageError} onDismiss={() => setPageError(null)} /> : null}

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card padding="md" className="rounded-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">当前策略</h2>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="gap-2">
                <Library className="h-4 w-4" />
                更换策略
              </Button>
            </div>

            {selectedStrategy ? (
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">{selectedStrategy.name}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedStrategy.description}</p>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState title="还没有策略" description="新建一条策略后，选股语句会自动填入下方输入框。" />
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">回测状态</p>
                <p className="mt-1 text-sm font-medium text-foreground">{selectedStrategy?.backtestStatus || '未回测'}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">最近一次运行</p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">{selectedStrategy?.lastRunResult || '暂无结果'}</p>
              </div>
            </div>
          </Card>

          <Card padding="md" className="rounded-xl">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">初筛选股</h2>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">策略选股语句</span>
                  {queryDirty ? <Badge variant="warning">未保存修改</Badge> : null}
                </span>
                <textarea
                  value={iwencaiQuery}
                  onChange={(event) => setIwencaiQuery(event.target.value)}
                  rows={5}
                  className="mt-1 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                  placeholder="例如：ROE大于10%，PE小于35，近20日站上MA20，非ST"
                />
              </label>
              {queryDirty ? (
                <div className="rounded-lg border bg-amber-50/70 p-3 text-xs leading-5 text-amber-950">
                  <p>你改的是本次运行语句，直接运行不会覆盖策略库。</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedStrategy ? (
                      <Button variant="outline" size="sm" onClick={updateCurrentStrategyQuery} isLoading={saving} loadingText="保存中..." className="gap-2">
                        <Save className="h-4 w-4" />
                        更新当前策略
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => openNewStrategy(iwencaiQuery)} className="gap-2">
                      <FilePlus2 className="h-4 w-4" />
                      另存为新策略
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">返回数量</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={limit}
                    onChange={(event) => setLimit(Math.max(1, Math.min(100, Number(event.target.value) || 30)))}
                    className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                  />
                </label>
              </div>

              <Button onClick={runScreener} isLoading={loading} loadingText="筛选中..." className="w-full gap-2">
                <Play className="h-4 w-4" />
                运行本地选股
              </Button>
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted/50">
                <FileUp className="h-4 w-4" />
                {importing ? '导入中...' : '导入问财候选 Excel'}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  disabled={importing}
                  onChange={importIwencaiExcel}
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                本地不能完整理解策略时，先去问财客户端运行并导出 Excel，再从这里导入候选股。
              </p>
            </div>
          </Card>

        </aside>

        <main className="space-y-4">
          <section className="rounded-xl border bg-card">
            <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">选股工作区</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  初筛只产出候选；增强分析和回测都需要你选择候选股后再执行。
                </p>
              </div>
              <div className="inline-flex rounded-lg border bg-muted/30 p-1">
                {([
                  ['candidates', '候选股', Sparkles],
                  ['verification', '回测验证', BarChart3],
                ] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                      activeTab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {activeTab === 'candidates' && result ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="info">模式 {result.executionMode === 'iwencai_import' ? '导入候选' : '本地选股'}</Badge>
                  <Badge variant="success">候选 {result.candidates.length}</Badge>
                  {result.importRequired ? <Badge variant="warning">需要导入</Badge> : null}
                  {result.skipped ? <Badge variant="warning">跳过 {result.skipped}</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">数据模式：{result.dataMode}</p>
              </div>

              {!result.localExecutable ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-950">本地暂不能完整执行这条策略</h3>
                    <p className="mt-1 text-xs leading-5 text-amber-900">
                      不会直接返回 0 误导你。请在问财客户端运行这条策略，导出 Excel 后导入候选股。
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border bg-background/70 p-3">
                      <p className="text-xs font-medium text-muted-foreground">本地已识别</p>
                      {result.supportedTerms.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {result.supportedTerms.map((term) => <Badge key={term} variant="success">{term}</Badge>)}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">暂无可本地执行条件</p>
                      )}
                    </div>
                    <div className="rounded-lg border bg-background/70 p-3">
                      <p className="text-xs font-medium text-muted-foreground">需要问财判断</p>
                      {result.unsupportedTerms.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {result.unsupportedTerms.map((term) => <Badge key={term} variant="warning">{term}</Badge>)}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">这条语句没有被识别为本地条件</p>
                      )}
                    </div>
                  </div>
                  <label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted/50">
                    <FileUp className="h-4 w-4" />
                    {importing ? '导入中...' : '导入问财候选 Excel'}
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      disabled={importing}
                      onChange={importIwencaiExcel}
                    />
                  </label>
                </div>
              ) : null}

              {result.iwencaiStatus === 'imported' ? (
                <div className="rounded-lg border bg-purple-50/40 px-4 py-3 text-xs leading-5 text-purple-950">
                  <p>导入来源：问财客户端 Excel</p>
                  <p>
                    已导入 {result.iwencaiReturnedCount ?? 0} 只候选
                    {result.iwencaiHasMore ? '，文件中还有更多行未展示。' : '。'}
                  </p>
                </div>
              ) : null}

              {result.notes.length > 0 ? (
                <div className="rounded-lg border bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground">
                  {result.notes.map((note) => <p key={note}>{note}</p>)}
                </div>
              ) : null}

              {result.candidates.length > 0 ? (
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">候选增强</h3>
                      <p className="mt-1 text-xs text-muted-foreground">先勾选能力，再对少量候选股做精选分析；这里不会在初筛时自动调用。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([
                        ['announcements', '公告'],
                        ['reports', '研报'],
                        ['fundamentals', '基本面'],
                        ['news', '新闻'],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="inline-flex h-8 items-center gap-2 rounded-lg border bg-muted/20 px-3 text-xs">
                          <input
                            type="checkbox"
                            checked={enhanceOptions[key]}
                            onChange={(event) => setEnhanceOptions((prev) => ({ ...prev, [key]: event.target.checked }))}
                            className="h-3.5 w-3.5"
                          />
                          {label}
                        </label>
                      ))}
                      <Button variant="outline" size="sm" disabled className="gap-2">
                        <Sparkles className="h-4 w-4" />
                        增强分析
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {result.candidates.length > 0 ? (
                <div className="space-y-3">
                  {result.candidates.map((candidate) => (
                    <CandidateRow key={candidate.code} candidate={candidate} strategyNames={strategyNames} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={result.importRequired ? '等待导入候选股' : '没有命中候选'}
                  description={result.importRequired ? '本地不能完整执行这条策略，请导入问财客户端导出的 Excel。' : '可以放宽选股语句，或换一个策略后重试。'}
                />
              )}
            </section>
          ) : null}

          {activeTab === 'candidates' && !result ? (
            <EmptyState
              title="运行一次策略选股"
              description="选择策略后会自动回填选股语句；你也可以直接修改语句再运行。"
            />
          ) : null}

          {activeTab === 'verification' ? (
            <section className="space-y-4 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">候选股本地回测</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    数据库完成后，这里会用本地历史库复验候选股在当前策略下的持有期表现。
                  </p>
                </div>
                <Badge variant="warning">等待历史库接入</Badge>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">回测候选股</span>
                    <select
                      value={selectedBacktestCandidate?.code ?? ''}
                      onChange={(event) => setSelectedBacktestCode(event.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {candidateRecords.length > 0 ? candidateRecords.map((candidate) => (
                        <option key={candidate.code} value={candidate.code}>
                          {candidate.name || candidate.code}（{candidate.code}）
                        </option>
                      )) : (
                        <option value="">先运行选股</option>
                      )}
                    </select>
                  </label>
                  {selectedBacktestCandidate ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md border bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">策略</p>
                        <p className="mt-1 truncate text-sm font-medium">{selectedStrategy?.name || '临时策略'}</p>
                      </div>
                      <div className="rounded-md border bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">综合分</p>
                        <p className="mt-1 font-mono text-sm font-medium">{selectedBacktestCandidate.score.toFixed(1)}</p>
                      </div>
                      <div className="rounded-md border bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">行情日期</p>
                        <p className="mt-1 text-sm font-medium">{selectedBacktestCandidate.latestDate || '--'}</p>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="暂无候选股" description="先运行一次策略选股，再选择候选股做本地回测。" />
                  )}
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground">第一版回测口径</p>
                  <div className="mt-3 space-y-2 text-sm text-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>持有周期</span>
                      <span className="font-medium">20 / 60 / 90 天</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>买入点</span>
                      <span className="font-medium">信号次日</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>输出</span>
                      <span className="font-medium">收益 / 回撤 / 胜率</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-dashed bg-background px-4 py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">历史库完成后启用</p>
                    <p className="mt-1 text-xs text-muted-foreground">这里会接入 DuckDB 历史行情，不调用问财额度，不自动交易。</p>
                  </div>
                  <Button variant="outline" disabled className="gap-2">
                    <BarChart3 className="h-4 w-4" />
                    运行本地回测
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">持仓策略验证</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      这是分支能力：当你想验证当前持仓是否符合某条策略时，再从这里进入。
                    </p>
                  </div>
                  <Badge variant="warning">待接入持仓</Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">验证对象</p>
                    <p className="mt-1 text-sm font-medium">持仓股票</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">验证内容</p>
                    <p className="mt-1 text-sm font-medium">是否命中策略 + 后续表现</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">交易方式</p>
                    <p className="mt-1 text-sm font-medium">仅辅助，手动下单</p>
                  </div>
                </div>
                <InlineAlert
                  variant="info"
                  title="分支流程"
                  message="持仓验证不是策略选股主路径；只有你决定用某个策略审视现有持仓时才需要使用。"
                />
              </div>
            </section>
          ) : null}
        </main>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>更换策略</DialogTitle>
            <DialogDescription>选择一条已保存策略，选股语句会回填到页面输入框。</DialogDescription>
          </DialogHeader>
          <div className="max-h-[56vh] space-y-2 overflow-y-auto pr-1">
            {library.map((item) => {
              const active = item.id === selectedStrategy?.id;
              return (
                <div key={item.id} className="rounded-lg">
                  <button
                    type="button"
                    onClick={() => selectStrategy(item)}
                    className={cn(
                      'flex w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition-colors',
                      active ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/40',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{item.name}</span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">{item.description}</span>
                    </span>
                    {active ? <Check className="mt-1 h-4 w-4 shrink-0 text-primary" /> : null}
                  </button>
                  <div className="-mt-2 flex justify-end px-2 pb-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditStrategy(item)}
                      className="gap-1.5 text-muted-foreground"
                    >
                      <Edit3 className="h-4 w-4" />
                      编辑名称/说明
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>关闭</Button>
            <Button onClick={() => openNewStrategy(iwencaiQuery)} className="gap-2">
              <FilePlus2 className="h-4 w-4" />
              新建策略
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? '编辑策略' : '新建策略'}</DialogTitle>
            <DialogDescription>保存经典策略或大师策略的完整问句，后续可以直接运行和回测。</DialogDescription>
          </DialogHeader>
          <StrategyForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>取消</Button>
            <Button onClick={saveStrategy} isLoading={saving} loadingText="保存中..." className="gap-2">
              <Save className="h-4 w-4" />
              保存策略
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ScreenerPage;
