import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clock3, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentApi } from '../api/agent';
import { ApiErrorAlert, Badge, Button, ConfirmDialog, EmptyState, InlineAlert, ScrollArea, Tooltip } from '../components/common';
import { getParsedApiError } from '../api/error';
import type { SkillInfo } from '../api/agent';
import { DashboardStateBlock } from '../components/dashboard';
import {
  useAgentChatStore,
  type AgentAssetType,
  type Message,
  type ProgressStep,
} from '../stores/agentChatStore';
import { downloadSession, formatSessionAsMarkdown } from '../utils/chatExport';
import type { ChatFollowUpContext } from '../utils/chatFollowUp';
import {
  buildFollowUpPrompt,
  parseFollowUpRecordId,
  resolveChatFollowUpContext,
  sanitizeFollowUpStockCode,
  sanitizeFollowUpStockName,
} from '../utils/chatFollowUp';
import type { FundChatFollowUpContext } from '../utils/fundChatFollowUp';
import {
  buildFundFollowUpPrompt,
  resolveFundChatFollowUpContext,
  sanitizeFollowUpFundCode,
  sanitizeFollowUpFundName,
} from '../utils/fundChatFollowUp';
import { isNearBottom } from '../utils/chatScroll';
import { getReportText } from '../utils/reportLanguage';

// Quick question examples shown on empty state
const QUICK_QUESTIONS = [
  { label: '用缠论分析茅台', skill: 'chan_theory' },
  { label: '波浪理论看宁德时代', skill: 'wave_theory' },
  { label: '分析比亚迪趋势', skill: 'bull_trend' },
  { label: '箱体震荡技能看中芯国际', skill: 'box_oscillation' },
  { label: '分析腾讯 hk00700', skill: 'bull_trend' },
  { label: '用情绪周期分析东方财富', skill: 'emotion_cycle' },
];

const FUND_QUICK_QUESTIONS = [
  { label: '诊断 000001 这只基金', skill: 'fund_general' },
  { label: '易方达蓝筹适合定投吗', skill: 'fund_dca' },
  { label: '帮我筛选稳健型基金', skill: 'fund_risk_return' },
  { label: '分析一只基金的持仓风格', skill: 'fund_holding_style' },
  { label: '这只基金适合做核心仓位吗', skill: 'fund_core_satellite' },
];

type FollowUpContext = ChatFollowUpContext | FundChatFollowUpContext;

type QuickQuestion = {
  label: string;
  skill: string;
};

type ChatPageProps = {
  assetType?: AgentAssetType;
};

const MAX_SELECTED_SKILLS = 3;

const getMessageSkillNames = (msg: Message): string[] => {
  if (msg.skillNames?.length) return msg.skillNames;
  if (msg.skillName) return [msg.skillName];
  if (msg.skills?.length) return msg.skills;
  if (msg.skill) return [msg.skill];
  return [];
};

const getMessageSkillLabel = (msg: Message): string => getMessageSkillNames(msg).join('、');

const ChatPage: React.FC<ChatPageProps> = ({ assetType = 'stock' }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isFundMode = assetType === 'fund';
  const pageTitle = isFundMode ? '诊基' : '问股';
  const pageDescription = isFundMode
    ? '向 AI 询问基金诊断，获取基于基金策略视角的风险收益与配置建议。'
    : '向 AI 询问个股分析，获取基于技能视角的交易建议与实时决策报告。';
  const emptyTitle = isFundMode ? '开始诊基' : '开始问股';
  const emptyDescription = isFundMode
    ? '输入「诊断 000001」或「易方达蓝筹适合定投吗」，AI 将调用基金数据工具生成诊断建议。'
    : '输入「分析 600519」或「茅台现在能买吗」，AI 将调用实时数据工具为您生成决策报告。';
  const inputPlaceholder = isFundMode
    ? '例如：诊断 000001 / 易方达蓝筹适合定投吗？ (Enter 发送, Shift+Enter 换行)'
    : '例如：分析 600519 / 茅台现在适合买入吗？ (Enter 发送, Shift+Enter 换行)';
  const [input, setInput] = useState('');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [showSkillDesc, setShowSkillDesc] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [isFollowUpContextLoading, setIsFollowUpContextLoading] = useState(false);
  const [sendToast, setSendToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [copiedMessages, setCopiedMessages] = useState<Set<string>>(new Set());
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const copyResetTimerRef = useRef<Partial<Record<string, number>>>({});
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const sendToastTimerRef = useRef<number | null>(null);
  const followUpHydrationTokenRef = useRef(0);
  const followUpContextRef = useRef<FollowUpContext | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');

  // Get localized text (default to Chinese)
  const text = getReportText('zh');

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = copyResetTimerRef.current;
    return () => {
      if (sendToastTimerRef.current !== null) {
        window.clearTimeout(sendToastTimerRef.current);
      }
      Object.values(timers).forEach((timerId) => {
        if (timerId !== undefined) {
          window.clearTimeout(timerId);
        }
      });
    };
  }, []);

  // Set page title
  useEffect(() => {
    document.title = `${pageTitle} - DSA`;
  }, [pageTitle]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const {
    messages,
    loading,
    progressSteps,
    sessionId,
    sessions,
    sessionsLoading,
    chatError,
    loadSessions,
    loadInitialSession,
    switchSession,
    startStream,
    clearCompletionBadge,
  } = useAgentChatStore();

  const syncScrollState = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const nearBottom = isNearBottom({
      scrollTop: viewport.scrollTop,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
    });
    shouldStickToBottomRef.current = nearBottom;
    setShowJumpToBottom((prev) => (nearBottom ? false : prev));
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const requestScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    shouldStickToBottomRef.current = true;
    pendingScrollBehaviorRef.current = behavior;
    setShowJumpToBottom(false);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    syncScrollState();
  }, [syncScrollState]);

  useEffect(() => {
    syncScrollState();
  }, [syncScrollState, sessionId]);

  useEffect(() => {
    const behavior = pendingScrollBehaviorRef.current;
    const shouldAutoScroll = shouldStickToBottomRef.current;
    if (!shouldAutoScroll) {
      if (messages.length > 0 || progressSteps.length > 0 || loading) {
        setShowJumpToBottom(true);
      }
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(behavior);
      pendingScrollBehaviorRef.current = loading ? 'auto' : 'smooth';
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, progressSteps, loading, sessionId, scrollToBottom]);

  useEffect(() => {
    if (!loading) {
      pendingScrollBehaviorRef.current = 'smooth';
    }
  }, [loading]);

  useEffect(() => {
    clearCompletionBadge(assetType);
  }, [assetType, clearCompletionBadge]);

  useEffect(() => {
    loadInitialSession(assetType);
  }, [assetType, loadInitialSession]);

  useEffect(() => {
    agentApi.getSkills(assetType)
      .then((res) => {
        setSkills(res.skills);
        const defaultId =
          res.default_skill_id ||
          res.skills[0]?.id ||
          '';
        setSelectedSkillIds(defaultId ? [defaultId] : []);
      })
      .catch((error) => {
        console.error('Failed to load chat skills:', error);
      });
  }, [assetType]);

  const availableSkillIds = new Set(skills.map((skill) => skill.id));
  const quickQuestionSource = isFundMode ? FUND_QUICK_QUESTIONS : QUICK_QUESTIONS;
  const quickQuestions = quickQuestionSource.filter((question) => availableSkillIds.size === 0 || availableSkillIds.has(question.skill));
  const selectedSkillIdSet = new Set(selectedSkillIds);
  const skillLimitReached = selectedSkillIds.length >= MAX_SELECTED_SKILLS;

  const getSkillNames = useCallback(
    (skillIds: string[]) => skillIds.map((id) => skills.find((s) => s.id === id)?.name || id),
    [skills],
  );

  const normalizeSelectedSkillIds = useCallback((skillIds: string[]) => {
    const normalized: string[] = [];
    for (const skillId of skillIds) {
      const cleaned = skillId.trim();
      if (cleaned && !normalized.includes(cleaned)) {
        normalized.push(cleaned);
      }
    }
    return normalized.slice(0, MAX_SELECTED_SKILLS);
  }, []);

  const toggleSkillSelection = useCallback((skillId: string) => {
    setSelectedSkillIds((prev) => {
      if (prev.includes(skillId)) {
        return prev.filter((id) => id !== skillId);
      }
      if (prev.length >= MAX_SELECTED_SKILLS) {
        return prev;
      }
      return [...prev, skillId];
    });
  }, []);

  const handleStartNewChat = useCallback(() => {
    followUpContextRef.current = null;
    requestScrollToBottom('auto');
    useAgentChatStore.getState().startNewChat(assetType);
    setSidebarOpen(false);
  }, [assetType, requestScrollToBottom]);

  const handleSwitchSession = useCallback((targetSessionId: string) => {
    requestScrollToBottom('auto');
    switchSession(targetSessionId, assetType);
    setSidebarOpen(false);
  }, [assetType, requestScrollToBottom, switchSession]);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    agentApi.deleteChatSession(deleteConfirmId)
      .then(() => {
        loadSessions(assetType);
        if (deleteConfirmId === sessionId) {
          handleStartNewChat();
        }
      })
      .catch((error) => {
        console.error('Failed to delete chat session:', error);
    });
    setDeleteConfirmId(null);
  }, [assetType, deleteConfirmId, sessionId, loadSessions, handleStartNewChat]);

  // Handle follow-up from report page.
  useEffect(() => {
    if (isFundMode) {
      const fundCode = sanitizeFollowUpFundCode(searchParams.get('fundCode'));
      const fundName = sanitizeFollowUpFundName(searchParams.get('fundName'));
      const recordId = parseFollowUpRecordId(searchParams.get('recordId'));

      if (!fundCode) {
        if (searchParams.toString()) {
          setSearchParams({}, { replace: true });
        }
        return;
      }

      const hydrationToken = ++followUpHydrationTokenRef.current;
      setInput(buildFundFollowUpPrompt(fundCode, fundName));
      followUpContextRef.current = {
        fund_code: fundCode,
        fund_name: fundName,
      };
      if (recordId !== undefined) {
        setIsFollowUpContextLoading(true);
      }
      void resolveFundChatFollowUpContext({
        fundCode,
        fundName,
        recordId,
      }).then((context) => {
        if (!isMountedRef.current || followUpHydrationTokenRef.current !== hydrationToken) {
          return;
        }
        followUpContextRef.current = context;
      }).catch(() => {
        if (!isMountedRef.current || followUpHydrationTokenRef.current !== hydrationToken) {
          return;
        }
        followUpContextRef.current = {
          fund_code: fundCode,
          fund_name: fundName,
          context_error: '基金历史上下文加载失败，请基于基金代码继续诊断并说明数据缺口。',
        };
      }).finally(() => {
        if (isMountedRef.current && followUpHydrationTokenRef.current === hydrationToken) {
          setIsFollowUpContextLoading(false);
        }
      });
      setSearchParams({}, { replace: true });
      return;
    }

    const stock = sanitizeFollowUpStockCode(searchParams.get('stock'));
    const name = sanitizeFollowUpStockName(searchParams.get('name'));
    const recordId = parseFollowUpRecordId(searchParams.get('recordId'));

    if (!stock) {
      setSearchParams({}, { replace: true });
      return;
    }

    const hydrationToken = ++followUpHydrationTokenRef.current;
    setInput(buildFollowUpPrompt(stock, name));
    followUpContextRef.current = {
      stock_code: stock,
      stock_name: name,
    };
    if (recordId !== undefined) {
      setIsFollowUpContextLoading(true);
    }
    void resolveChatFollowUpContext({
      stockCode: stock,
      stockName: name,
      recordId,
    }).then((context) => {
      if (!isMountedRef.current || followUpHydrationTokenRef.current !== hydrationToken) {
        return;
      }
      followUpContextRef.current = context;
    }).finally(() => {
      if (isMountedRef.current && followUpHydrationTokenRef.current === hydrationToken) {
        setIsFollowUpContextLoading(false);
      }
    });
    setSearchParams({}, { replace: true });
  }, [isFundMode, searchParams, setSearchParams]);

  const handleSend = useCallback(
    async (overrideMessage?: string, overrideSkillIds?: string[]) => {
      const msgText = (overrideMessage ?? input).trim();
      if (!msgText || loading) return;
      const usedSkillIds = normalizeSelectedSkillIds(overrideSkillIds ?? selectedSkillIds);
      const usedSkillNames = usedSkillIds.length > 0 ? getSkillNames(usedSkillIds) : ['通用'];

      const payload = {
        message: msgText,
        session_id: sessionId,
        asset_type: assetType,
        ...(usedSkillIds.length > 0 ? { skills: usedSkillIds } : {}),
        context: followUpContextRef.current ?? undefined,
      };
      followUpHydrationTokenRef.current += 1;
      followUpContextRef.current = null;
      setIsFollowUpContextLoading(false);

      setInput('');
      requestScrollToBottom('smooth');
      await startStream(payload, {
        skillNames: usedSkillNames,
        skillName: usedSkillNames.join('、'),
      });
    },
    [assetType, getSkillNames, input, loading, normalizeSelectedSkillIds, requestScrollToBottom, selectedSkillIds, sessionId, startStream],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickQuestion = (q: QuickQuestion) => {
    setSelectedSkillIds([q.skill]);
    handleSend(q.label, [q.skill]);
  };

  const showSendFeedback = useCallback((nextToast: { type: 'success' | 'error'; message: string }, durationMs: number) => {
    if (sendToastTimerRef.current !== null) {
      window.clearTimeout(sendToastTimerRef.current);
    }
    setSendToast(nextToast);
    sendToastTimerRef.current = window.setTimeout(() => {
      setSendToast(null);
      sendToastTimerRef.current = null;
    }, durationMs);
  }, []);

  const toggleThinking = (msgId: string) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const copyMessageToClipboard = async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessages((prev) => new Set(prev).add(msgId));
      const existingTimer = copyResetTimerRef.current[msgId];
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      copyResetTimerRef.current[msgId] = window.setTimeout(() => {
        setCopiedMessages((prev) => {
          const next = new Set(prev);
          next.delete(msgId);
          return next;
        });
        delete copyResetTimerRef.current[msgId];
      }, 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const downloadMessageAsMarkdown = useCallback((msg: Message) => {
    const skillLabel = getMessageSkillLabel(msg);
    const heading = msg.role === 'user' ? '# 用户消息' : `# AI 回复${skillLabel ? ` · ${skillLabel}` : ''}`;
    const content = [heading, '', msg.content].join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${msg.role === 'user' ? 'user' : 'assistant'}-message-${msg.id}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const getCurrentStage = (steps: ProgressStep[]): string => {
    if (steps.length === 0) return '正在连接...';
    const last = steps[steps.length - 1];
    if (last.type === 'thinking') return last.message || 'AI 正在思考...';
    if (last.type === 'tool_start')
      return `${last.display_name || last.tool}...`;
    if (last.type === 'tool_done')
      return `${last.display_name || last.tool} 完成`;
    if (last.type === 'generating')
      return last.message || '正在生成最终分析...';
    return '处理中...';
  };

  const renderThinkingBlock = (msg: Message) => {
    if (!msg.thinkingSteps || msg.thinkingSteps.length === 0) return null;
    const isExpanded = expandedThinking.has(msg.id);
    const toolSteps = msg.thinkingSteps.filter((s) => s.type === 'tool_done');
    const totalDuration = toolSteps.reduce(
      (sum, s) => sum + (s.duration || 0),
      0,
    );
    const summary = `${toolSteps.length} 个工具调用 · ${totalDuration.toFixed(1)}s`;

    return (
      <button
        onClick={() => toggleThinking(msg.id)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-muted-foreground transition-colors mb-2 w-full text-left"
      >
        <svg
          className={`w-3 h-3 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span className="flex items-center gap-1.5">
          <span className="opacity-60">思考过程</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="opacity-50">{summary}</span>
        </span>
      </button>
    );
  };

  const renderThinkingDetails = (steps: ProgressStep[]) => (
    <div className="mb-3 pl-5 border-l border-border/40 space-y-1.5 animate-fade-in">
      {steps.map((step, idx) => {
        let statusClass = 'chat-progress-item-muted';
        let iconClass = 'chat-progress-dot-muted';
        let text = '';
        if (step.type === 'thinking') {
          text = step.message || `第 ${step.step} 步：思考`;
          statusClass = 'chat-progress-item-thinking';
          iconClass = 'chat-progress-dot-thinking';
        } else if (step.type === 'tool_start') {
          text = `${step.display_name || step.tool}...`;
          statusClass = 'chat-progress-item-tool';
          iconClass = 'chat-progress-dot-tool';
        } else if (step.type === 'tool_done') {
          text = `${step.display_name || step.tool} (${step.duration}s)`;
          statusClass = step.success ? 'chat-progress-item-success' : 'chat-progress-item-danger';
          iconClass = step.success ? 'chat-progress-dot-success' : 'chat-progress-dot-danger';
        } else if (step.type === 'generating') {
          text = step.message || '生成分析';
          statusClass = 'chat-progress-item-generating';
          iconClass = 'chat-progress-dot-generating';
        }
        return (
          <div
            key={idx}
            className={cn('chat-progress-item', statusClass)}
          >
            <span className={cn('chat-progress-dot', iconClass)} />
            <span className="leading-relaxed">{text}</span>
          </div>
        );
      })}
    </div>
  );

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between border-b border-border bg-muted/40 p-3.5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MessageSquareText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          历史对话
        </h2>
        <button
          onClick={handleStartNewChat}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          aria-label="开启新对话"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ScrollArea testId="chat-session-list-scroll" viewportClassName="px-3 py-3 pr-5">
        {sessionsLoading ? (
          <DashboardStateBlock
            loading
            compact
            title="加载对话中..."
            className="rounded-xl border border-dashed border-border/50 bg-card/30"
          />
        ) : sessions.length === 0 ? (
          <DashboardStateBlock
            compact
            title="暂无历史对话"
            description="开始提问后，这里会保留会话记录。"
            className="rounded-xl border border-dashed border-border/50 bg-card/30"
          />
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.session_id}
                className={cn(
                  'group/session relative overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10 transition-colors',
                  'hover:bg-muted/40 hover:ring-foreground/15 focus-within:ring-ring/45',
                  s.session_id === sessionId && 'bg-muted ring-ring/45'
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSwitchSession(s.session_id)}
                  className="grid w-full min-w-0 grid-cols-[0.5rem_minmax(0,1fr)] gap-3 rounded-xl py-3 pl-3 pr-10 text-left outline-none"
                  aria-label={`切换到对话 ${s.title}`}
                  aria-current={s.session_id === sessionId ? 'page' : undefined}
                >
                  <span
                    className={cn(
                      'mt-1 h-2 w-2 shrink-0 rounded-full bg-border',
                      s.session_id === sessionId && 'bg-primary'
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 overflow-hidden">
                    <span className="block max-w-full truncate text-sm font-medium leading-5 text-foreground">
                      {s.title}
                    </span>
                    <span className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                      <Badge variant="default" size="sm" className="h-5 px-2 text-[11px] font-normal">
                        {s.message_count} 条对话
                      </Badge>
                      {s.last_active && (
                        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {new Date(s.last_active).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                          </span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 group-hover/session:opacity-100"
                  onClick={() => {
                    setDeleteConfirmId(s.session_id);
                  }}
                  aria-label={`删除对话 ${s.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </>
  );

  return (
    <div
      data-testid="chat-workspace"
      className="flex h-[calc(100vh-5rem)] w-full min-w-0 gap-4 overflow-hidden sm:h-[calc(100vh-5.5rem)] lg:h-[calc(100vh-2rem)]"
    >
      {/* Desktop sidebar */}
      <div className="hidden h-full w-64 flex-shrink-0 flex-col overflow-hidden rounded-xl border bg-card md:flex">
        {sidebarContent}
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <div className="page-drawer-overlay absolute inset-0" />
          <div
            className="absolute bottom-0 left-0 top-0 flex w-72 flex-col overflow-hidden border-r bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteConfirmId)}
        title="删除对话"
        message="删除后，该对话将不可恢复，确认删除吗？"
        confirmText="删除"
        cancelText="取消"
        isDanger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />

      {/* Main chat area */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mb-4 flex-shrink-0 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="历史对话"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
              <svg
                className="w-6 h-6 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              {pageTitle}
            </h1>
            {messages.length > 0 && (
              <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                <Tooltip content="导出会话为 Markdown 文件">
                  <span className="inline-flex">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => downloadSession(messages)}
                      aria-label="导出会话为 Markdown 文件"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      导出会话
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip content="发送到已配置的通知机器人/邮箱">
                  <span className="inline-flex">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={sending}
                      onClick={async () => {
                        if (sending) return;
                        setSending(true);
                        setSendToast(null);
                        try {
                          const content = formatSessionAsMarkdown(messages);
                          await agentApi.sendChat(content);
                          showSendFeedback({ type: 'success', message: '已发送到通知渠道' }, 3000);
                        } catch (err) {
                          const parsed = getParsedApiError(err);
                          showSendFeedback({
                            type: 'error',
                            message: parsed.message || '发送失败',
                          }, 5000);
                        } finally {
                          setSending(false);
                        }
                      }}
                      aria-label="发送到已配置的通知机器人/邮箱"
                    >
                      {sending ? (
                        <svg
                          className="w-4 h-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                          />
                        </svg>
                      )}
                      发送
                    </Button>
                  </span>
                </Tooltip>
              </div>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {pageDescription}
          </p>
          {sendToast ? (
            <InlineAlert
              variant={sendToast.type === 'success' ? 'success' : 'danger'}
              title={sendToast.type === 'success' ? '发送成功' : '发送失败'}
              message={sendToast.message}
              className="max-w-md rounded-xl px-3 py-2 text-xs shadow-none"
            />
          ) : null}
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
          {/* Messages */}
          <ScrollArea
            className="relative z-10 flex-1"
            viewportRef={messagesViewportRef}
            onScroll={handleMessagesScroll}
            viewportClassName="space-y-6 p-4 md:p-6"
            testId="chat-message-scroll"
          >
            {messages.length === 0 && !loading ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  title={emptyTitle}
                  description={emptyDescription}
                  className="max-w-2xl border-dashed bg-card/55"
                  icon={(
                    <svg
                      className="h-8 w-8"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                  )}
                  action={(
                    <div className="flex max-w-lg flex-wrap justify-center gap-2">
                      {quickQuestions.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => handleQuickQuestion(q)}
                          className="quick-question-btn"
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  )}
                />
              </div>
            ) : (
              messages.map((msg) => {
                const skillLabel = getMessageSkillLabel(msg);
                return (
                <div
                  key={msg.id}
                  className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold shadow-sm transition-all',
                      msg.role === 'user' ? 'chat-avatar-user' : 'chat-avatar-ai'
                    )}
                  >
                    {msg.role === 'user' ? 'U' : 'AI'}
                  </div>
                  <div
                    className={cn(
                      'group/message min-w-0 w-fit max-w-[min(100%,48rem)] overflow-hidden px-5 py-3.5 transition-colors',
                      msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'
                    )}
                  >
                    {msg.role === 'assistant' && skillLabel && (
                      <div className="mb-2">
                        <Badge variant="info" className="chat-skill-badge shadow-none" aria-label={`技能 ${skillLabel}`}>
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          </svg>
                          {skillLabel}
                        </Badge>
                      </div>
                    )}
                    {msg.role === 'assistant' && renderThinkingBlock(msg)}
                    {msg.role === 'assistant' &&
                      expandedThinking.has(msg.id) &&
                      msg.thinkingSteps &&
                      renderThinkingDetails(msg.thinkingSteps)}
                    {msg.role === 'assistant' ? (
                      <div className="relative">
                        <div className="chat-message-actions">
                          <button
                            type="button"
                            onClick={() => copyMessageToClipboard(msg.id, msg.content)}
                            className="chat-copy-btn"
                            aria-label={copiedMessages.has(msg.id) ? text.copied : text.copy}
                          >
                            {copiedMessages.has(msg.id) ? text.copied : text.copy}
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadMessageAsMarkdown(msg)}
                            className="chat-copy-btn"
                            aria-label="导出此条消息为 Markdown"
                          >
                            导出
                          </button>
                        </div>
                        <div className="chat-prose pr-20 sm:pr-24">
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </Markdown>
                        </div>
                      </div>
                    ) : (
                      msg.content
                        .split('\n')
                        .map((line, i) => (
                          <p
                            key={i}
                            className="mb-1 last:mb-0 leading-relaxed"
                          >
                            {line || '\u00A0'}
                          </p>
                        ))
                    )}
                  </div>
                </div>
                );
              })
            )}

            {loading && (
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-card text-foreground flex items-center justify-center flex-shrink-0 text-xs font-bold">
                  AI
                </div>
                <div className="min-w-[200px] max-w-[min(100%,48rem)] overflow-hidden rounded-xl rounded-tl-sm border border-border bg-card/72 px-5 py-4">
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <div className="relative w-4 h-4 flex-shrink-0">
                      <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                      <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    </div>
                    <span className="text-muted-foreground">
                      {getCurrentStage(progressSteps)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </ScrollArea>

          {showJumpToBottom && (
            <div className="pointer-events-none absolute bottom-[5.75rem] right-4 z-20 md:bottom-24 md:right-6">
              <button
                type="button"
                className="pointer-events-auto chat-copy-btn shadow-none"
                onClick={() => {
                  requestScrollToBottom('smooth');
                  scrollToBottom('smooth');
                }}
                aria-label="查看最新消息"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
                有新消息
              </button>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-border bg-card/88 p-4 md:p-6 relative z-20">
            <div className="space-y-3">
              {chatError ? <ApiErrorAlert error={chatError} /> : null}
              {isFollowUpContextLoading ? (
                <InlineAlert
                  variant="info"
                  title="追问上下文加载中"
                  message="正在加载历史分析上下文；现在可直接发送追问。"
                  className="rounded-xl px-3 py-2 text-xs shadow-none"
                />
              ) : null}
            {skills.length > 0 && (
              <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex-shrink-0 mt-1">
                  策略
                </span>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer group mt-0.5">
                  <input
                    type="checkbox"
                    name="general-analysis"
                    value=""
                    checked={selectedSkillIds.length === 0}
                    onChange={() => setSelectedSkillIds([])}
                    className="chat-skill-checkbox"
                  />
                  <span
                    className={`transition-colors text-sm ${selectedSkillIds.length === 0 ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground'}`}
                  >
                    通用分析
                  </span>
                </label>
                {skills.map((s) => {
                  const checked = selectedSkillIdSet.has(s.id);
                  const disabled = !checked && skillLimitReached;
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center gap-1.5 cursor-pointer group relative mt-0.5 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                      onMouseEnter={() => setShowSkillDesc(s.id)}
                      onMouseLeave={() => setShowSkillDesc(null)}
                    >
                      <input
                        type="checkbox"
                        name="skills"
                        value={s.id}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleSkillSelection(s.id)}
                        className="chat-skill-checkbox"
                      />
                      <span
                        className={`transition-colors text-sm ${checked ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground'}`}
                      >
                        {s.name}
                      </span>
                      {showSkillDesc === s.id && s.description && (
                        <div className="skill-desc-tooltip">
                          <p className="skill-title">{s.name}</p>
                          <p>{s.description}</p>
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

              <div className="flex items-end gap-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={inputPlaceholder}
                  disabled={loading}
                  rows={1}
                  className="flex-1 min-h-[44px] max-h-[200px] rounded-xl border bg-transparent px-4 py-2.5 text-sm transition-all focus:outline-none resize-none disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    t.style.height = 'auto';
                    t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
                  }}
                />
                <Button
                  variant="primary"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                  isLoading={loading}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground flex-shrink-0"
                >
                  发送
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
