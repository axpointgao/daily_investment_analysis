import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useSystemConfig } from '../hooks';
import { createParsedApiError, getParsedApiError, type ParsedApiError } from '../api/error';
import { portfolioApi } from '../api/portfolio';
import { systemConfigApi } from '../api/systemConfig';
import { ApiErrorAlert, Button, ConfirmDialog, EmptyState } from '../components/common';
import {
  AuthSettingsCard,
  ChangePasswordCard,
  IntelligentImport,
  LLMChannelEditor,
  SettingsCategoryNav,
  SettingsAlert,
  SettingsField,
  SettingsLoading,
  SettingsSectionCard,
} from '../components/settings';
import { WEB_BUILD_INFO } from '../utils/constants';
import { getCategoryDescriptionZh } from '../utils/systemConfigI18n';
import type { ConfigValidationIssue, SystemConfigCategory } from '../types/systemConfig';
import type { SystemConfigItem, TestDataSourceResponse, TestDataSourceSource } from '../types/systemConfig';
import type { PortfolioTagItem } from '../types/portfolio';

type DesktopWindow = Window & {
  dsaDesktop?: {
    version?: unknown;
    getUpdateState?: () => Promise<RawDesktopUpdateState>;
    checkForUpdates?: () => Promise<RawDesktopUpdateState>;
    openReleasePage?: (releaseUrl?: string) => Promise<boolean>;
    onUpdateStateChange?: (listener: (state: RawDesktopUpdateState) => void) => (() => void) | void;
  };
};

type DesktopUpdateState = {
  status?: string;
  currentVersion?: string;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt?: string;
  publishedAt?: string;
  message?: string;
  releaseName?: string;
  tagName?: string;
};

type RawDesktopUpdateState = {
  status?: unknown;
  currentVersion?: unknown;
  latestVersion?: unknown;
  releaseUrl?: unknown;
  checkedAt?: unknown;
  publishedAt?: unknown;
  message?: unknown;
  releaseName?: unknown;
  tagName?: unknown;
};

type DataSourceTestState = {
  loading: boolean;
  result?: TestDataSourceResponse;
  error?: ParsedApiError;
};

const PORTFOLIO_TAG_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--color-purple))',
  'hsl(212 78% 54%)',
  'hsl(326 62% 58%)',
];

type AgentConfigGroup = {
  id: string;
  title: string;
  description: string;
  impact: string;
  keys: string[];
  collapsible?: boolean;
  defaultOpen?: boolean;
};

type PortfolioPromptGroup = {
  id: string;
  title: string;
  description: string;
  keys: string[];
};

const PORTFOLIO_DATA_SOURCE_TESTS: Array<{ source: TestDataSourceSource; label: string; description: string }> = [
  {
    source: 'tushare_third_party',
    label: '三方 Tushare',
    description: '验证三方 URL 与三方 Token 是否可用。',
  },
  {
    source: 'tiantian_fund',
    label: '天天基金',
    description: '验证场外基金净值接口是否可访问。',
  },
  {
    source: 'crypto_quote',
    label: '数字货币行情',
    description: '验证 Binance 与 OKX 免费行情是否可访问。',
  },
];

const AGENT_DATA_SOURCE_TESTS: Array<{ source: TestDataSourceSource; label: string; description: string }> = [
  {
    source: 'ttfund_skills',
    label: '天天基金 Skills',
    description: '验证基金搜索、基础资料、经理、持仓和交易规则等补充数据能力。',
  },
  {
    source: 'yingmi_stargate',
    label: '盈米 StarGate',
    description: '验证首页基金专业诊断、诊基专业分析、持仓组合诊断、投顾策略和财富规划能力。',
  },
  {
    source: 'iwencai',
    label: '问财 API',
    description: '验证银行理财产品搜索和净值查询能力。',
  },
];

const AGENT_CONFIG_GROUPS: AgentConfigGroup[] = [
  {
    id: 'fund-advisory',
    title: '基金投顾能力',
    description: '影响首页基金分析、诊基对话和持仓资产分析报告。盈米负责基金/投顾专业判断，天天基金负责基础资料补充。',
    impact: '建议优先配置盈米 StarGate；未配置时这些页面仍可运行，但基金投顾分析会退回本地指标和天天基金基础数据。',
    keys: ['YINGMI_ENABLED', 'YINGMI_API_KEY', 'YINGMI_FUND_ANALYSIS_DEPTH', 'YINGMI_FUND_DATA_STRATEGY', 'YINGMI_MCP_DAILY_LIMIT', 'YINGMI_SKILL_DAILY_LIMIT', 'TTFUND_APIKEY'],
    defaultOpen: true,
  },
  {
    id: 'bank-wealth',
    title: '银行理财能力',
    description: '影响持仓里的银行理财产品查询、确认日单位净值和刷新估值。',
    impact: '未配置问财时，银行理财仍可按金额流水和手动价值更新维护。',
    keys: ['IWENCAI_API_KEY', 'IWENCAI_BASE_URL'],
    defaultOpen: true,
  },
  {
    id: 'stock-chat',
    title: '股票问股策略',
    description: '影响问股/股票分析 Agent，不影响基金诊断、保险、银行和持仓账本。',
    impact: '普通使用通常只需要开启 Agent；策略列表、策略目录和多 Agent 架构属于进阶调参。',
    keys: ['AGENT_MODE', 'AGENT_MAX_STEPS', 'AGENT_SKILLS', 'AGENT_SKILL_DIR', 'AGENT_NL_ROUTING', 'AGENT_ARCH', 'AGENT_ORCHESTRATOR_MODE', 'AGENT_ORCHESTRATOR_TIMEOUT_S', 'AGENT_RISK_OVERRIDE'],
    defaultOpen: true,
  },
  {
    id: 'automation',
    title: '后台研究与自动化',
    description: '只影响后台深度研究、历史记忆、策略自动加权和事件监控。没有自动化需求时可以保持默认。',
    impact: '这些项会增加后台任务或模型调用成本；不确定含义时先不要开启。',
    keys: ['AGENT_DEEP_RESEARCH_BUDGET', 'AGENT_DEEP_RESEARCH_TIMEOUT', 'AGENT_MEMORY_ENABLED', 'AGENT_SKILL_AUTOWEIGHT', 'AGENT_SKILL_ROUTING', 'AGENT_EVENT_MONITOR_ENABLED', 'AGENT_EVENT_MONITOR_INTERVAL_MINUTES', 'AGENT_EVENT_ALERT_RULES_JSON'],
    collapsible: true,
    defaultOpen: false,
  },
];

const AGENT_GROUP_KEY_SET = new Set(AGENT_CONFIG_GROUPS.flatMap((group) => group.keys));
const AGENT_ALWAYS_HIDDEN_KEYS = new Set(['YINGMI_STARGATE_BASE_URL', 'IWENCAI_BASE_URL']);

const PORTFOLIO_PROMPT_GROUPS: PortfolioPromptGroup[] = [
  {
    id: 'all',
    title: '全部账户',
    description: '家庭资产视角，生成统一的资产分析报告。',
    keys: ['PORTFOLIO_ANALYSIS_PROMPT_ALL_QUICK'],
  },
  {
    id: 'stock',
    title: '股票',
    description: 'A 股、港股、美股账户的单账户分析。',
    keys: ['PORTFOLIO_ANALYSIS_PROMPT_STOCK'],
  },
  {
    id: 'fund',
    title: '基金',
    description: '场外基金账户，专业判断由系统自动接入盈米能力。',
    keys: ['PORTFOLIO_ANALYSIS_PROMPT_FUND'],
  },
  {
    id: 'advisory',
    title: '投顾',
    description: '投顾组合账户，策略数据由系统自动判断是否可用。',
    keys: ['PORTFOLIO_ANALYSIS_PROMPT_ADVISORY'],
  },
  {
    id: 'bank',
    title: '银行',
    description: '活期、定期和银行理财账户。',
    keys: ['PORTFOLIO_ANALYSIS_PROMPT_BANK'],
  },
  {
    id: 'insurance',
    title: '保险',
    description: '只做保单资产属性分析，不做保障专项建议。',
    keys: ['PORTFOLIO_ANALYSIS_PROMPT_INSURANCE_BASIC'],
  },
];

function trimDesktopRuntimeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDesktopRuntimeApi() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as DesktopWindow).dsaDesktop;
}

function getDesktopAppVersion() {
  return trimDesktopRuntimeString(getDesktopRuntimeApi()?.version);
}

function normalizeDesktopUpdateState(state: RawDesktopUpdateState | null | undefined) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  return {
    status: trimDesktopRuntimeString(state.status) || 'idle',
    currentVersion: trimDesktopRuntimeString(state.currentVersion),
    latestVersion: trimDesktopRuntimeString(state.latestVersion),
    releaseUrl: trimDesktopRuntimeString(state.releaseUrl),
    checkedAt: trimDesktopRuntimeString(state.checkedAt),
    publishedAt: trimDesktopRuntimeString(state.publishedAt),
    message: trimDesktopRuntimeString(state.message),
    releaseName: trimDesktopRuntimeString(state.releaseName),
    tagName: trimDesktopRuntimeString(state.tagName),
  };
}

function getDesktopUpdateNotice(state: DesktopUpdateState | null) {
  if (!state) {
    return null;
  }

  if (state.status === 'update-available') {
    const latestLabel = state.latestVersion || state.tagName || '最新版本';
    const currentLabel = state.currentVersion || getDesktopAppVersion() || '当前版本';
    return {
      title: '发现新版本',
      message: `当前 ${currentLabel}，最新 ${latestLabel}。${state.message || '可前往 GitHub Releases 下载更新。'}`,
      variant: 'warning' as const,
      actionLabel: '前往下载',
    };
  }

  if (state.status === 'up-to-date') {
    return {
      title: '已是最新版本',
      message: state.message || '当前桌面端已是最新版本。',
      variant: 'success' as const,
    };
  }

  if (state.status === 'checking') {
    return {
      title: '正在检查更新',
      message: state.message || '正在检查 GitHub Releases 中是否有可用新版本。',
      variant: 'warning' as const,
    };
  }

  if (state.status === 'error') {
    return {
      title: '检查更新失败',
      message: state.message || '无法完成更新检查，请稍后重试。',
      variant: 'error' as const,
    };
  }

  return null;
}

function formatDesktopEnvFilename() {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `dsa-desktop-env_${date}_${time}.env`;
}

function AgentFieldGroup({
  group,
  items,
  isSaving,
  issueByKey,
  onChange,
}: {
  group: AgentConfigGroup;
  items: SystemConfigItem[];
  isSaving: boolean;
  issueByKey: Record<string, ConfigValidationIssue[]>;
  onChange: (key: string, value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(group.defaultOpen !== false);
  if (!items.length) {
    return null;
  }

  const content = (
    <div className="space-y-3">
      {items.map((item) => (
        <SettingsField
          key={item.key}
          item={item}
          value={item.value}
          disabled={isSaving}
          onChange={onChange}
          issues={issueByKey[item.key] || []}
        />
      ))}
    </div>
  );

  return (
    <div className="rounded-2xl border settings-border bg-background/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-text">{group.description}</p>
          <p className="mt-2 text-xs leading-5 text-secondary-text">{group.impact}</p>
        </div>
        {group.collapsible ? (
          <Button
            type="button"
            variant="settings-secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setIsOpen((current) => !current)}
          >
            {isOpen ? '收起' : '展开'}
          </Button>
        ) : null}
      </div>
      {isOpen ? <div className="mt-4">{content}</div> : null}
    </div>
  );
}

function AgentSettingsSections({
  items,
  isSaving,
  issueByKey,
  onChange,
}: {
  items: SystemConfigItem[];
  isSaving: boolean;
  issueByKey: Record<string, ConfigValidationIssue[]>;
  onChange: (key: string, value: string) => void;
}) {
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const groupedKeys = new Set<string>();
  const groups = AGENT_CONFIG_GROUPS.map((group) => {
    const groupItems = group.keys
      .map((key) => itemByKey.get(key))
      .filter((item): item is SystemConfigItem => Boolean(item));
    groupItems.forEach((item) => groupedKeys.add(item.key));
    return { group, items: groupItems };
  });
  const otherItems = items.filter((item) => !groupedKeys.has(item.key) && !AGENT_ALWAYS_HIDDEN_KEYS.has(item.key));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border settings-border bg-background/35 p-4">
        <h3 className="text-sm font-semibold text-foreground">先看这三件事</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border settings-border bg-card/70 p-3">
            <p className="text-xs font-semibold text-foreground">基金分析更专业</p>
            <p className="mt-1 text-xs leading-5 text-muted-text">配置盈米后，首页基金分析、诊基和持仓资产分析报告会在基金/投顾部分优先使用盈米。</p>
          </div>
          <div className="rounded-xl border settings-border bg-card/70 p-3">
            <p className="text-xs font-semibold text-foreground">天天基金做补充</p>
            <p className="mt-1 text-xs leading-5 text-muted-text">天天基金 Skills 主要补搜索、净值、持仓、经理和交易规则。</p>
          </div>
          <div className="rounded-xl border settings-border bg-card/70 p-3">
            <p className="text-xs font-semibold text-foreground">高级项可以先不动</p>
            <p className="mt-1 text-xs leading-5 text-muted-text">多 Agent、深研、事件监控会影响成本、耗时或后台任务。</p>
          </div>
        </div>
      </div>

      {groups.map(({ group, items: groupItems }) => (
        <AgentFieldGroup
          key={group.id}
          group={group}
          items={groupItems}
          isSaving={isSaving}
          issueByKey={issueByKey}
          onChange={onChange}
        />
      ))}

      {otherItems.length ? (
        <AgentFieldGroup
          group={{
            id: 'other',
            title: '其他 Agent 配置',
            description: '暂未归入主流程的兼容字段。通常不需要修改。',
            impact: '保留给旧版本或特殊部署使用。',
            keys: [],
            collapsible: true,
            defaultOpen: false,
          }}
          items={otherItems}
          isSaving={isSaving}
          issueByKey={issueByKey}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function getDefaultPrompt(item: SystemConfigItem) {
  const raw = item.schema?.defaultValue;
  return typeof raw === 'string' ? raw : '';
}

function PromptEditorCard({
  item,
  isSaving,
  issueByKey,
  onChange,
}: {
  item: SystemConfigItem;
  isSaving: boolean;
  issueByKey: Record<string, ConfigValidationIssue[]>;
  onChange: (key: string, value: string) => void;
}) {
  const [showDefault, setShowDefault] = useState(false);
  const defaultPrompt = getDefaultPrompt(item);
  const value = String(item.value ?? '');
  const issues = issueByKey[item.key] || [];
  const hasError = issues.some((issue) => issue.severity === 'error');
  const isCustomized = value.trim().length > 0;
  const title = item.schema?.title || item.key;

  return (
    <div className={`rounded-2xl border p-4 transition-colors ${
      hasError ? 'border-danger/40 bg-danger/5' : 'settings-border bg-background/35'
    }`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
              isCustomized ? 'border-info/25 bg-info/10 text-info' : 'border-border/60 bg-background/40 text-muted-text'
            }`}>
              {isCustomized ? '已自定义' : '使用默认'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-text">
            {item.schema?.description || '留空时使用系统默认模板。'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="settings-secondary"
            size="sm"
            onClick={() => setShowDefault((current) => !current)}
          >
            {showDefault ? '收起默认' : '查看默认'}
          </Button>
          <Button
            type="button"
            variant="settings-secondary"
            size="sm"
            disabled={isSaving || !isCustomized}
            onClick={() => onChange(item.key, '')}
          >
            恢复默认
          </Button>
        </div>
      </div>

      {showDefault ? (
        <div className="mt-4 rounded-xl border settings-border bg-card/65 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">系统默认模板</p>
          <p className="whitespace-pre-wrap text-xs leading-6 text-secondary-text">{defaultPrompt || '暂无默认模板。'}</p>
        </div>
      ) : null}

      <label className="mt-4 block text-xs font-medium text-secondary-text" htmlFor={`prompt-${item.key}`}>
        自定义模板
      </label>
      <textarea
        id={`prompt-${item.key}`}
        className="input-surface input-focus-glow mt-2 min-h-[150px] w-full resize-y rounded-xl border bg-transparent px-4 py-3 text-sm leading-6 transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        value={value}
        disabled={isSaving}
        placeholder="留空则使用系统默认模板。只写你希望额外强调的分析口径，不需要重复输出格式要求。"
        onChange={(event) => onChange(item.key, event.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-text">
        <span>只影响报告写法，不改变账户识别、工具调用或失败降级。</span>
        <span>{value.length}/4000</span>
      </div>
      {issues.length ? (
        <div className="mt-2 space-y-1">
          {issues.map((issue, index) => (
            <p key={`${issue.key}-${issue.code}-${index}`} className={issue.severity === 'error' ? 'text-xs text-danger' : 'text-xs text-warning'}>
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PortfolioAnalysisPromptSections({
  items,
  isSaving,
  issueByKey,
  onChange,
}: {
  items: SystemConfigItem[];
  isSaving: boolean;
  issueByKey: Record<string, ConfigValidationIssue[]>;
  onChange: (key: string, value: string) => void;
}) {
  const [activeGroupId, setActiveGroupId] = useState('all');
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const activeGroup = PORTFOLIO_PROMPT_GROUPS.find((group) => group.id === activeGroupId) || PORTFOLIO_PROMPT_GROUPS[0];
  const activeItems = activeGroup.keys
    .map((key) => itemByKey.get(key))
    .filter((item): item is SystemConfigItem => Boolean(item));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border settings-border bg-background/35 p-4">
        <h3 className="text-sm font-semibold text-foreground">先确认边界</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border settings-border bg-card/70 p-3">
            <p className="text-xs font-semibold text-foreground">只改写法</p>
            <p className="mt-1 text-xs leading-5 text-muted-text">Prompt 不控制账户类型、工具调用和降级逻辑。</p>
          </div>
          <div className="rounded-xl border settings-border bg-card/70 p-3">
            <p className="text-xs font-semibold text-foreground">留空更稳</p>
            <p className="mt-1 text-xs leading-5 text-muted-text">没有明确偏好时留空，系统会使用内置模板。</p>
          </div>
          <div className="rounded-xl border settings-border bg-card/70 p-3">
            <p className="text-xs font-semibold text-foreground">安全约束保留</p>
            <p className="mt-1 text-xs leading-5 text-muted-text">系统仍会要求不编造、不承诺收益、不直接给交易指令。</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_1fr]">
        <div className="rounded-2xl border settings-border bg-background/35 p-2">
          {PORTFOLIO_PROMPT_GROUPS.map((group) => {
            const isActive = group.id === activeGroup.id;
            return (
              <button
                key={group.id}
                type="button"
                className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${
                  isActive ? 'bg-primary/10 text-foreground' : 'text-secondary-text hover:bg-background/50 hover:text-foreground'
                }`}
                onClick={() => setActiveGroupId(group.id)}
              >
                <p className="text-sm font-semibold">{group.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-text">{group.description}</p>
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          {activeItems.map((item) => (
            <PromptEditorCard
              key={item.key}
              item={item}
              isSaving={isSaving}
              issueByKey={issueByKey}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const SettingsPage: React.FC = () => {
  const { passwordChangeable } = useAuth();
  const [desktopActionError, setDesktopActionError] = useState<ParsedApiError | null>(null);
  const [desktopActionSuccess, setDesktopActionSuccess] = useState<string>('');
  const [isExportingEnv, setIsExportingEnv] = useState(false);
  const [isImportingEnv, setIsImportingEnv] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const [isCheckingDesktopUpdate, setIsCheckingDesktopUpdate] = useState(false);
  const [dataSourceTestState, setDataSourceTestState] = useState<Record<TestDataSourceSource, DataSourceTestState>>({
    tushare_third_party: { loading: false },
    tiantian_fund: { loading: false },
    crypto_quote: { loading: false },
    ttfund_skills: { loading: false },
    yingmi_stargate: { loading: false },
    iwencai: { loading: false },
  });
  const [portfolioTags, setPortfolioTags] = useState<PortfolioTagItem[]>([]);
  const [portfolioTagsLoading, setPortfolioTagsLoading] = useState(false);
  const [portfolioTagActionLoading, setPortfolioTagActionLoading] = useState<number | 'create' | null>(null);
  const [portfolioTagsError, setPortfolioTagsError] = useState<ParsedApiError | null>(null);
  const [portfolioTagsSuccess, setPortfolioTagsSuccess] = useState('');
  const [portfolioTagForm, setPortfolioTagForm] = useState({
    name: '',
    color: PORTFOLIO_TAG_COLORS[0],
  });
  const desktopImportRef = useRef<HTMLInputElement | null>(null);
  const desktopRuntimeApi = getDesktopRuntimeApi();
  const isDesktopRuntime = Boolean(desktopRuntimeApi);
  const canCheckDesktopUpdate = Boolean(
    desktopRuntimeApi?.getUpdateState && desktopRuntimeApi?.checkForUpdates && desktopRuntimeApi?.openReleasePage
  );
  const desktopAppVersion = getDesktopAppVersion();
  const shouldShowDesktopVersionCard = Boolean(desktopAppVersion);

  // Set page title
  useEffect(() => {
    document.title = '系统设置 - DSA';
  }, []);

  const {
    categories,
    itemsByCategory,
    issueByKey,
    activeCategory,
    setActiveCategory,
    hasDirty,
    dirtyCount,
    toast,
    clearToast,
    isLoading,
    isSaving,
    loadError,
    saveError,
    retryAction,
    load,
    retry,
    save,
    resetDraft,
    setDraftValue,
    refreshAfterExternalSave,
    configVersion,
    maskToken,
  } = useSystemConfig();

  useEffect(() => {
    void load();
  }, [load]);

  const loadPortfolioTags = async () => {
    setPortfolioTagsLoading(true);
    try {
      const response = await portfolioApi.listTags();
      setPortfolioTags(response.tags || []);
      setPortfolioTagsError(null);
    } catch (error: unknown) {
      setPortfolioTagsError(getParsedApiError(error));
    } finally {
      setPortfolioTagsLoading(false);
    }
  };

  useEffect(() => {
    void loadPortfolioTags();
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      clearToast();
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [clearToast, toast]);

  useEffect(() => {
    if (!canCheckDesktopUpdate) {
      setDesktopUpdateState(null);
      setIsCheckingDesktopUpdate(false);
      return;
    }

    let active = true;

    const syncDesktopUpdateState = async () => {
      try {
        const state = await desktopRuntimeApi?.getUpdateState?.();
        if (active) {
          setDesktopUpdateState(normalizeDesktopUpdateState(state));
        }
      } catch (error: unknown) {
        if (!active) {
          return;
        }
        setDesktopUpdateState({
          status: 'error',
          message: error instanceof Error ? error.message : '读取桌面端更新状态失败。',
        });
      }
    };

    void syncDesktopUpdateState();

    const unsubscribe = desktopRuntimeApi?.onUpdateStateChange?.((state) => {
      if (!active) {
        return;
      }
      setDesktopUpdateState(normalizeDesktopUpdateState(state));
      setIsCheckingDesktopUpdate(false);
    });

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [canCheckDesktopUpdate, desktopRuntimeApi]);

  const rawActiveItems = itemsByCategory[activeCategory] || [];
  const rawActiveItemMap = new Map(rawActiveItems.map((item) => [item.key, String(item.value ?? '')]));
  const hasConfiguredChannels = Boolean((rawActiveItemMap.get('LLM_CHANNELS') || '').trim());
  const hasLitellmConfig = Boolean((rawActiveItemMap.get('LITELLM_CONFIG') || '').trim());

  // Hide channel-managed and legacy provider-specific LLM keys from the
  // generic form only when channel config is the active runtime source.
  const LLM_CHANNEL_KEY_RE = /^LLM_[A-Z0-9]+_(PROTOCOL|BASE_URL|API_KEY|API_KEYS|MODELS|EXTRA_HEADERS|ENABLED)$/;
  const AI_MODEL_HIDDEN_KEYS = new Set([
    'LLM_CHANNELS',
    'LLM_TEMPERATURE',
    'LITELLM_MODEL',
    'AGENT_LITELLM_MODEL',
    'LITELLM_FALLBACK_MODELS',
    'AIHUBMIX_KEY',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_API_KEYS',
    'GEMINI_API_KEY',
    'GEMINI_API_KEYS',
    'GEMINI_MODEL',
    'GEMINI_MODEL_FALLBACK',
    'GEMINI_TEMPERATURE',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_API_KEYS',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_TEMPERATURE',
    'ANTHROPIC_MAX_TOKENS',
    'OPENAI_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'OPENAI_VISION_MODEL',
    'OPENAI_TEMPERATURE',
    'VISION_MODEL',
  ]);
  const SYSTEM_HIDDEN_KEYS = new Set([
    'ADMIN_AUTH_ENABLED',
  ]);
  const AGENT_HIDDEN_KEYS = AGENT_GROUP_KEY_SET;
  const activeItems =
    activeCategory === 'ai_model'
      ? rawActiveItems.filter((item) => {
        if (hasConfiguredChannels && LLM_CHANNEL_KEY_RE.test(item.key)) {
          return false;
        }
        if (hasConfiguredChannels && !hasLitellmConfig && AI_MODEL_HIDDEN_KEYS.has(item.key)) {
          return false;
        }
        return true;
      })
      : activeCategory === 'system'
        ? rawActiveItems.filter((item) => !SYSTEM_HIDDEN_KEYS.has(item.key))
      : activeCategory === 'agent'
        ? rawActiveItems.filter((item) => !AGENT_HIDDEN_KEYS.has(item.key))
      : rawActiveItems;
  const desktopActionDisabled = isLoading || isSaving || isExportingEnv || isImportingEnv;

  const downloadDesktopEnv = async () => {
    setDesktopActionError(null);
    setDesktopActionSuccess('');
    setIsExportingEnv(true);
    try {
      const payload = await systemConfigApi.exportDesktopEnv();
      const blob = new Blob([payload.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = formatDesktopEnvFilename();
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setDesktopActionSuccess('已导出当前已保存的 .env 备份。');
    } catch (error: unknown) {
      setDesktopActionError(getParsedApiError(error));
    } finally {
      setIsExportingEnv(false);
    }
  };

  const beginDesktopImport = () => {
    setDesktopActionError(null);
    setDesktopActionSuccess('');
    if (hasDirty) {
      setShowImportConfirm(true);
      return;
    }
    desktopImportRef.current?.click();
  };

  const handleDesktopImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setShowImportConfirm(false);
    if (!file) {
      return;
    }

    setDesktopActionError(null);
    setDesktopActionSuccess('');
    setIsImportingEnv(true);
    try {
      const content = await file.text();
      await systemConfigApi.importDesktopEnv({
        configVersion,
        content,
        reloadNow: true,
      });
      const reloaded = await load();
      if (!reloaded) {
        setDesktopActionError(createParsedApiError({
          title: '配置已导入但刷新失败',
          message: '备份已导入，但重新加载配置失败，请手动重载页面。',
          rawMessage: 'Desktop env import succeeded but config refresh failed',
          category: 'http_error',
        }));
        return;
      }
      setDesktopActionSuccess('已导入 .env 备份并重新加载配置。');
    } catch (error: unknown) {
      setDesktopActionError(getParsedApiError(error));
    } finally {
      setIsImportingEnv(false);
    }
  };

  const handleDesktopUpdateCheck = async () => {
    if (!desktopRuntimeApi?.checkForUpdates) {
      return;
    }

    setIsCheckingDesktopUpdate(true);
    setDesktopUpdateState((current) => ({
      ...(current || {}),
      status: 'checking',
      message: '正在检查 GitHub Releases 中是否有可用新版本。',
    }));

    try {
      const state = await desktopRuntimeApi.checkForUpdates();
      setDesktopUpdateState(normalizeDesktopUpdateState(state));
    } catch (error: unknown) {
      setDesktopUpdateState({
        status: 'error',
        message: error instanceof Error ? error.message : '检查更新失败，请稍后重试。',
      });
    } finally {
      setIsCheckingDesktopUpdate(false);
    }
  };

  const openDesktopReleasePage = async () => {
    if (!desktopRuntimeApi?.openReleasePage) {
      return;
    }

    await desktopRuntimeApi.openReleasePage(desktopUpdateState?.releaseUrl);
  };

  const createPortfolioTag = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = portfolioTagForm.name.trim();
    if (!name) {
      setPortfolioTagsError(createParsedApiError({
        title: '标签名称为空',
        message: '请填写标签名称。',
        rawMessage: 'Portfolio tag name is empty',
        category: 'missing_params',
      }));
      return;
    }
    setPortfolioTagActionLoading('create');
    setPortfolioTagsSuccess('');
    try {
      await portfolioApi.createTag({ name, color: portfolioTagForm.color });
      setPortfolioTagForm({ name: '', color: PORTFOLIO_TAG_COLORS[0] });
      await loadPortfolioTags();
      setPortfolioTagsSuccess('持仓标签已新增。');
    } catch (error: unknown) {
      setPortfolioTagsError(getParsedApiError(error));
    } finally {
      setPortfolioTagActionLoading(null);
    }
  };

  const updatePortfolioTag = async (tag: PortfolioTagItem, fields: { name?: string; color?: string }) => {
    setPortfolioTagActionLoading(tag.id);
    setPortfolioTagsSuccess('');
    try {
      await portfolioApi.updateTag(tag.id, fields);
      await loadPortfolioTags();
      setPortfolioTagsSuccess('持仓标签已更新。');
    } catch (error: unknown) {
      setPortfolioTagsError(getParsedApiError(error));
    } finally {
      setPortfolioTagActionLoading(null);
    }
  };

  const deletePortfolioTag = async (tag: PortfolioTagItem) => {
    if (!window.confirm(`删除标签「${tag.name}」？已绑定产品会变为未标签。`)) {
      return;
    }
    setPortfolioTagActionLoading(tag.id);
    setPortfolioTagsSuccess('');
    try {
      await portfolioApi.deleteTag(tag.id);
      await loadPortfolioTags();
      setPortfolioTagsSuccess('持仓标签已删除，相关产品已归入未标签。');
    } catch (error: unknown) {
      setPortfolioTagsError(getParsedApiError(error));
    } finally {
      setPortfolioTagActionLoading(null);
    }
  };

  const testDataSource = async (source: TestDataSourceSource) => {
    setDataSourceTestState((current) => ({
      ...current,
      [source]: { loading: true },
    }));
    try {
      const result = await systemConfigApi.testDataSource({ source });
      setDataSourceTestState((current) => ({
        ...current,
        [source]: { loading: false, result },
      }));
    } catch (error: unknown) {
      setDataSourceTestState((current) => ({
        ...current,
        [source]: { loading: false, error: getParsedApiError(error) },
      }));
    }
  };

  const desktopUpdateNotice = getDesktopUpdateNotice(desktopUpdateState);

  return (
    <div className="settings-page min-h-full px-4 pb-6 pt-4 md:px-6">
      <div className="mb-5 rounded-[1.5rem] border settings-border bg-card/94 px-5 py-5 shadow-soft-card-strong backdrop-blur-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">系统设置</h1>
            <p className="text-xs leading-6 text-muted-text">
              统一管理模型、数据源、通知、安全认证与导入能力。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="settings-secondary"
              onClick={resetDraft}
              disabled={isLoading || isSaving}
            >
              重置
            </Button>
            <Button
              type="button"
              variant="settings-primary"
              onClick={() => void save()}
              disabled={!hasDirty || isSaving || isLoading}
              isLoading={isSaving}
              loadingText="保存中..."
            >
              {isSaving ? '保存中...' : `保存配置${dirtyCount ? ` (${dirtyCount})` : ''}`}
            </Button>
          </div>
        </div>

        {saveError ? (
          <ApiErrorAlert
            className="mt-3"
            error={saveError}
            actionLabel={retryAction === 'save' ? '重试保存' : undefined}
            onAction={retryAction === 'save' ? () => void retry() : undefined}
          />
        ) : null}
      </div>

      {loadError ? (
        <ApiErrorAlert
          error={loadError}
          actionLabel={retryAction === 'load' ? '重试加载' : '重新加载'}
          onAction={() => void retry()}
          className="mb-4"
        />
      ) : null}

      {isLoading ? (
        <SettingsLoading />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <SettingsCategoryNav
              categories={categories}
              itemsByCategory={itemsByCategory}
              activeCategory={activeCategory}
              onSelect={setActiveCategory}
            />
          </aside>

          <section className="space-y-4">
            {activeCategory === 'system' ? <AuthSettingsCard /> : null}
            {activeCategory === 'system' ? (
              <SettingsSectionCard
                title="版本信息"
                description="用于确认当前 WebUI 静态资源是否已经切换到最新构建。"
              >
                <div
                  className={`grid grid-cols-1 gap-3 ${shouldShowDesktopVersionCard ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}
                >
                  <div className="rounded-2xl border settings-border bg-background/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">
                      WebUI 版本
                    </p>
                    <p className="mt-2 break-all font-mono text-sm text-foreground">
                      {WEB_BUILD_INFO.version}
                    </p>
                  </div>
                  <div className="rounded-2xl border settings-border bg-background/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">
                      构建标识
                    </p>
                    <p className="mt-2 break-all font-mono text-sm text-foreground">
                      {WEB_BUILD_INFO.buildId}
                    </p>
                  </div>
                  <div className="rounded-2xl border settings-border bg-background/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">
                      构建时间
                    </p>
                    <p className="mt-2 break-all font-mono text-sm text-foreground">
                      {WEB_BUILD_INFO.buildTime}
                    </p>
                  </div>
                  {shouldShowDesktopVersionCard ? (
                    <div className="rounded-2xl border settings-border bg-background/40 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">
                        桌面端版本
                      </p>
                      <p className="mt-2 break-all font-mono text-sm text-foreground">
                        {desktopAppVersion}
                      </p>
                    </div>
                  ) : null}
                </div>
                <p className="text-xs leading-6 text-muted-text">
                  重新执行前端构建或 Docker 镜像构建后，此处的构建标识和构建时间会更新，可用来确认当前页面资源是否已切换。
                </p>
                {canCheckDesktopUpdate ? (
                  <div className="mt-4 space-y-3 rounded-2xl border settings-border bg-background/30 px-4 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">桌面端更新</p>
                        <p className="text-xs leading-6 text-muted-text">
                          启动后会自动检查 GitHub Releases 最新正式版；发现更新时仅提醒并跳转下载页，不会静默下载或自动安装。
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="settings-secondary"
                        onClick={() => void handleDesktopUpdateCheck()}
                        disabled={isCheckingDesktopUpdate}
                        isLoading={isCheckingDesktopUpdate}
                        loadingText="检查中..."
                      >
                        检查更新
                      </Button>
                    </div>
                    {desktopUpdateNotice ? (
                      <SettingsAlert
                        title={desktopUpdateNotice.title}
                        message={desktopUpdateNotice.message}
                        variant={desktopUpdateNotice.variant}
                        actionLabel={desktopUpdateNotice.actionLabel}
                        onAction={desktopUpdateNotice.actionLabel ? () => {
                          void openDesktopReleasePage();
                        } : undefined}
                      />
                    ) : (
                      <p className="text-xs leading-6 text-muted-text">
                        当前尚无更新状态，应用启动后会在后台自动检查。
                      </p>
                    )}
                  </div>
                ) : null}
                {WEB_BUILD_INFO.isFallbackVersion ? (
                  <p className="text-xs leading-6 text-amber-700 dark:text-amber-300">
                    当前 package.json 仍为占位版本 0.0.0，页面已自动回退展示构建标识，避免误判旧资源仍在生效。
                  </p>
                ) : null}
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'system' && isDesktopRuntime ? (
              <SettingsSectionCard
                title="配置备份"
                description="导出当前已保存的 .env 备份，或从备份文件恢复桌面端配置。导入会覆盖备份中出现的键并立即重载。"
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="settings-secondary"
                      onClick={() => void downloadDesktopEnv()}
                      disabled={desktopActionDisabled}
                      isLoading={isExportingEnv}
                      loadingText="导出中..."
                    >
                      导出 .env
                    </Button>
                    <Button
                      type="button"
                      variant="settings-primary"
                      onClick={beginDesktopImport}
                      disabled={desktopActionDisabled}
                      isLoading={isImportingEnv}
                      loadingText="导入中..."
                    >
                      导入 .env
                    </Button>
                    <input
                      ref={desktopImportRef}
                      type="file"
                      accept=".env,.txt"
                      className="hidden"
                      onChange={(event) => {
                        void handleDesktopImportFile(event);
                      }}
                    />
                  </div>
                  <p className="text-xs leading-6 text-muted-text">
                    导出内容仅包含当前已保存配置，不包含页面上尚未保存的本地草稿。
                  </p>
                  {desktopActionError ? (
                    <ApiErrorAlert
                      error={desktopActionError}
                      actionLabel={desktopActionError.status === 409 ? '重新加载' : undefined}
                      onAction={desktopActionError.status === 409 ? () => void load() : undefined}
                    />
                  ) : null}
                  {!desktopActionError && desktopActionSuccess ? (
                    <SettingsAlert title="操作成功" message={desktopActionSuccess} variant="success" />
                  ) : null}
                </div>
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'base' ? (
              <SettingsSectionCard
                title="持仓标签"
                description="维护持仓明细中可选的全局产品标签，用于按标签查看资产分布。"
              >
                <div className="space-y-4">
                  <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_120px]" onSubmit={(event) => void createPortfolioTag(event)}>
                    <input
                      value={portfolioTagForm.name}
                      onChange={(event) => setPortfolioTagForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="例如 长期核心"
                      className="input-surface input-focus-glow h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
                      maxLength={32}
                    />
                    <select
                      value={portfolioTagForm.color}
                      onChange={(event) => setPortfolioTagForm((current) => ({ ...current, color: event.target.value }))}
                      className="input-surface input-focus-glow h-10 w-full appearance-none rounded-xl border bg-transparent px-3 pr-8 text-sm outline-none"
                    >
                      {PORTFOLIO_TAG_COLORS.map((color, index) => (
                        <option key={color} value={color}>颜色 {index + 1}</option>
                      ))}
                    </select>
                    <Button
                      type="submit"
                      variant="settings-primary"
                      size="md"
                      isLoading={portfolioTagActionLoading === 'create'}
                    >
                      新增标签
                    </Button>
                  </form>
                  {portfolioTagsError ? <ApiErrorAlert error={portfolioTagsError} /> : null}
                  {!portfolioTagsError && portfolioTagsSuccess ? (
                    <SettingsAlert title="操作成功" message={portfolioTagsSuccess} variant="success" />
                  ) : null}
                  {portfolioTagsLoading ? (
                    <p className="text-xs text-muted-text">正在加载持仓标签...</p>
                  ) : portfolioTags.length === 0 ? (
                    <EmptyState
                      title="暂无持仓标签"
                      description="新增标签后，可在持仓明细的资产说明行中为产品选择标签。"
                      className="border-dashed bg-transparent px-4 py-8 shadow-none"
                    />
                  ) : (
                    <div className="space-y-2">
                      {portfolioTags.map((tag) => (
                        <div key={tag.id} className="grid gap-2 rounded-xl border settings-border bg-background/30 p-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                          <input
                            defaultValue={tag.name}
                            className="input-surface input-focus-glow h-9 w-full rounded-lg border bg-transparent px-3 text-sm outline-none"
                            maxLength={32}
                            onBlur={(event) => {
                              const nextName = event.target.value.trim();
                              if (nextName && nextName !== tag.name) {
                                void updatePortfolioTag(tag, { name: nextName });
                              }
                            }}
                          />
                          <select
                            value={tag.color}
                            onChange={(event) => void updatePortfolioTag(tag, { color: event.target.value })}
                            className="input-surface input-focus-glow h-9 w-full appearance-none rounded-lg border bg-transparent px-3 pr-8 text-sm outline-none"
                            disabled={portfolioTagActionLoading === tag.id}
                          >
                            {PORTFOLIO_TAG_COLORS.map((color, index) => (
                              <option key={color} value={color}>颜色 {index + 1}</option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="danger-subtle"
                            size="sm"
                            onClick={() => void deletePortfolioTag(tag)}
                            disabled={portfolioTagActionLoading === tag.id}
                          >
                            删除
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'base' ? (
              <SettingsSectionCard
                title="智能导入"
                description="从图片、文件或剪贴板中提取股票代码，并合并到自选股列表。"
              >
                <IntelligentImport
                  stockListValue={
                    (activeItems.find((i) => i.key === 'STOCK_LIST')?.value as string) ?? ''
                  }
                  configVersion={configVersion}
                  maskToken={maskToken}
                  onMerged={async () => {
                    await refreshAfterExternalSave(['STOCK_LIST']);
                  }}
                  disabled={isSaving || isLoading}
                />
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'ai_model' ? (
              <SettingsSectionCard
                title="AI 模型接入"
                description="统一管理模型渠道、基础地址、API Key、主模型与备选模型。"
              >
                <LLMChannelEditor
                  items={rawActiveItems}
                  configVersion={configVersion}
                  maskToken={maskToken}
                  onSaved={async (updatedItems) => {
                    await refreshAfterExternalSave(updatedItems.map((item) => item.key));
                  }}
                  disabled={isSaving || isLoading}
                />
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'data_source' ? (
              <SettingsSectionCard
                title="资产数据源连通性"
                description="使用当前已保存配置检查新增资产数据源是否可用；未保存的草稿需先保存后再测试。"
              >
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  {PORTFOLIO_DATA_SOURCE_TESTS.map((item) => {
                    const state = dataSourceTestState[item.source];
                    const result = state.result;
                    const connected = Boolean(result?.success);
                    return (
                      <div key={item.source} className="rounded-2xl border settings-border bg-background/35 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{item.label}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-text">{item.description}</p>
                          </div>
                          <span
                            className={`inline-flex min-w-[4rem] shrink-0 items-center justify-center rounded-full border px-2.5 py-0.5 text-xs leading-5 whitespace-nowrap ${
                              result
                                ? connected
                                  ? 'border-success/20 bg-success/10 text-success'
                                  : 'border-danger/20 bg-danger/10 text-danger'
                                : 'border-border/50 bg-background/40 text-muted-text'
                            }`}
                          >
                            {result ? (connected ? '已连接' : '未连接') : '未测试'}
                          </span>
                        </div>
                        {result || state.error ? (
                          <p className={`mt-3 text-xs leading-5 ${connected ? 'text-success' : 'text-danger'}`}>
                            {result?.message || state.error?.message}
                            {result?.latencyMs != null ? ` · ${result.latencyMs}ms` : ''}
                          </p>
                        ) : null}
                        {result?.error ? <p className="mt-1 break-all text-xs leading-5 text-muted-text">{result.error}</p> : null}
                        <Button
                          type="button"
                          variant="settings-secondary"
                          size="sm"
                          className="mt-4 w-full"
                          onClick={() => void testDataSource(item.source)}
                          disabled={isSaving || isLoading}
                          isLoading={state.loading}
                          loadingText="测试中..."
                        >
                          测试连接
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'agent' ? (
              <SettingsSectionCard
                title="Agent 数据能力连通性"
                description="先保存配置，再测试外部能力是否可用。测试只验证连接，不会修改持仓或发起交易。"
              >
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  {AGENT_DATA_SOURCE_TESTS.map((item) => {
                    const state = dataSourceTestState[item.source];
                    const result = state.result;
                    const connected = Boolean(result?.success);
                    return (
                      <div key={item.source} className="rounded-2xl border settings-border bg-background/35 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{item.label}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-text">{item.description}</p>
                          </div>
                          <span
                            className={`inline-flex min-w-[4rem] shrink-0 items-center justify-center rounded-full border px-2.5 py-0.5 text-xs leading-5 whitespace-nowrap ${
                              result
                                ? connected
                                  ? 'border-success/20 bg-success/10 text-success'
                                  : 'border-danger/20 bg-danger/10 text-danger'
                                : 'border-border/50 bg-background/40 text-muted-text'
                            }`}
                          >
                            {result ? (connected ? '已连接' : '未连接') : '未测试'}
                          </span>
                        </div>
                        {result || state.error ? (
                          <p className={`mt-3 text-xs leading-5 ${connected ? 'text-success' : 'text-danger'}`}>
                            {result?.message || state.error?.message}
                            {result?.latencyMs != null ? ` · ${result.latencyMs}ms` : ''}
                          </p>
                        ) : null}
                        {result?.error ? <p className="mt-1 break-all text-xs leading-5 text-muted-text">{result.error}</p> : null}
                        <Button
                          type="button"
                          variant="settings-secondary"
                          size="sm"
                          className="mt-4 w-full"
                          onClick={() => void testDataSource(item.source)}
                          disabled={isSaving || isLoading}
                          isLoading={state.loading}
                          loadingText="测试中..."
                        >
                          测试连接
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'agent' ? (
              <SettingsSectionCard
                title="Agent 能力配置"
                description="按前端功能分组展示配置项。常用项放在前面，高成本或后台能力默认收起。"
              >
                <AgentSettingsSections
                  items={rawActiveItems}
                  isSaving={isSaving}
                  issueByKey={issueByKey}
                  onChange={setDraftValue}
                />
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'portfolio_analysis' ? (
              <SettingsSectionCard
                title="持仓分析配置"
                description="查看和调整资产分析报告的写作要求。账户类型和工具调用由系统自动选择。"
              >
                <PortfolioAnalysisPromptSections
                  items={rawActiveItems}
                  isSaving={isSaving}
                  issueByKey={issueByKey}
                  onChange={setDraftValue}
                />
              </SettingsSectionCard>
            ) : null}
            {activeCategory === 'system' && passwordChangeable ? (
              <ChangePasswordCard />
            ) : null}
            {activeCategory !== 'agent' && activeCategory !== 'portfolio_analysis' && activeItems.length ? (
              <SettingsSectionCard
                title="当前分类配置项"
                description={getCategoryDescriptionZh(activeCategory as SystemConfigCategory, '') || '使用统一字段卡片维护当前分类的系统配置。'}
              >
                {activeItems.map((item) => (
                  <SettingsField
                    key={item.key}
                    item={item}
                    value={item.value}
                    disabled={isSaving}
                    onChange={setDraftValue}
                    issues={issueByKey[item.key] || []}
                  />
                ))}
              </SettingsSectionCard>
            ) : activeCategory !== 'agent' && activeCategory !== 'portfolio_analysis' ? (
              <EmptyState
                title="当前分类下暂无配置项"
                description="当前分类没有可编辑字段；可切换左侧分类继续查看其它系统配置。"
                className="settings-surface-panel settings-border-strong border-none bg-transparent shadow-none"
              />
            ) : null}
          </section>
        </div>
      )}

      {toast ? (
        <div className="fixed bottom-5 right-5 z-50 w-[320px] max-w-[calc(100vw-24px)]">
          {toast.type === 'success'
            ? <SettingsAlert title="操作成功" message={toast.message} variant="success" />
            : <ApiErrorAlert error={toast.error} />}
        </div>
      ) : null}
      <ConfirmDialog
        isOpen={showImportConfirm}
        title="导入会覆盖当前草稿"
        message="当前页面还有未保存修改。继续导入会丢弃这些本地草稿，并立即用备份文件中的键值更新已保存配置。"
        confirmText="继续导入"
        cancelText="取消"
        onConfirm={() => {
          setShowImportConfirm(false);
          desktopImportRef.current?.click();
        }}
        onCancel={() => {
          setShowImportConfirm(false);
        }}
      />
    </div>
  );
};

export default SettingsPage;
