import { create } from 'zustand';
import { agentApi } from '../api/agent';
import type { ChatSessionItem, ChatStreamRequest } from '../api/agent';
import {
  getParsedApiError,
  isApiRequestError,
  isParsedApiError,
  type ParsedApiError,
} from '../api/error';
import { generateUUID } from '../utils/uuid';

export type AgentAssetType = 'stock' | 'fund';

const STORAGE_KEY_SESSION = 'dsa_chat_session_id';
const STORAGE_KEY_FUND_SESSION = 'dsa_fund_chat_session_id';

const getStorageKey = (assetType: AgentAssetType = 'stock') =>
  assetType === 'fund' ? STORAGE_KEY_FUND_SESSION : STORAGE_KEY_SESSION;

const normalizeSessionId = (sessionId: string, assetType: AgentAssetType = 'stock') => {
  if (assetType === 'fund') {
    return sessionId.startsWith('fund_') ? sessionId : `fund_${sessionId}`;
  }
  return sessionId;
};

export interface ProgressStep {
  type: string;
  step?: number;
  tool?: string;
  display_name?: string;
  success?: boolean;
  duration?: number;
  message?: string;
  content?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  skills?: string[];
  skill?: string;
  skillNames?: string[];
  skillName?: string;
  thinkingSteps?: ProgressStep[];
}

export interface StreamMeta {
  skillNames?: string[];
  skillName?: string;
}

type StreamFailureEvent = {
  type: string;
  success?: boolean;
  content?: string;
  error?: unknown;
  message?: unknown;
};

function getFirstMeaningfulStreamError(...candidates: Array<unknown>): unknown {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      if (candidate.trim() !== '') {
        return candidate;
      }
      continue;
    }

    if (candidate != null) {
      return candidate;
    }
  }

  return undefined;
}

function getStreamFailureError(
  event: StreamFailureEvent,
  fallbackMessage: string,
): ParsedApiError {
  return getParsedApiError(
    getFirstMeaningfulStreamError(
      event.error,
      event.message,
      event.content,
      fallbackMessage,
    ),
  );
}

function isFailureAssistantMessage(content: string): boolean {
  return /^\s*\[分析失败\]/.test(content || '');
}

interface AgentChatState {
  messages: Message[];
  loading: boolean;
  progressSteps: ProgressStep[];
  sessionId: string;
  sessions: ChatSessionItem[];
  sessionsLoading: boolean;
  chatError: ParsedApiError | null;
  currentRoute: string;
  completionBadge: boolean;
  stockCompletionBadge: boolean;
  fundCompletionBadge: boolean;
  hasInitialLoad: boolean;
  activeAssetType: AgentAssetType;
  abortController: AbortController | null;
}

interface AgentChatActions {
  setCurrentRoute: (path: string) => void;
  clearCompletionBadge: (assetType?: AgentAssetType) => void;
  loadSessions: (assetType?: AgentAssetType) => Promise<void>;
  loadInitialSession: (assetType?: AgentAssetType) => Promise<void>;
  switchSession: (targetSessionId: string, assetType?: AgentAssetType) => Promise<void>;
  startNewChat: (assetType?: AgentAssetType) => void;
  startStream: (payload: ChatStreamRequest, meta?: StreamMeta) => Promise<void>;
}

const getInitialSessionId = (): string =>
  typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY_SESSION) || localStorage.getItem(STORAGE_KEY_FUND_SESSION) || generateUUID()
    : generateUUID();

export const useAgentChatStore = create<AgentChatState & AgentChatActions>((set, get) => ({
  messages: [],
  loading: false,
  progressSteps: [],
  sessionId: getInitialSessionId(),
  sessions: [],
  sessionsLoading: false,
  chatError: null,
  currentRoute: '',
  completionBadge: false,
  stockCompletionBadge: false,
  fundCompletionBadge: false,
  hasInitialLoad: false,
  activeAssetType: 'stock',
  abortController: null,

  setCurrentRoute: (path) => set({ currentRoute: path }),

  clearCompletionBadge: (assetType = 'stock') => set((state) => {
    const stockCompletionBadge = assetType === 'stock' ? false : state.stockCompletionBadge;
    const fundCompletionBadge = assetType === 'fund' ? false : state.fundCompletionBadge;
    return {
      stockCompletionBadge,
      fundCompletionBadge,
      completionBadge: stockCompletionBadge || fundCompletionBadge,
    };
  }),

  loadSessions: async (assetType = 'stock') => {
    set({ sessionsLoading: true });
    try {
      const sessions = await agentApi.getChatSessions(50, assetType);
      set({ sessions });
    } catch {
      // Ignore load errors
    } finally {
      set({ sessionsLoading: false });
    }
  },

  loadInitialSession: async (assetType = 'stock') => {
    const { hasInitialLoad, activeAssetType, abortController } = get();
    const storageKey = getStorageKey(assetType);
    if (hasInitialLoad && activeAssetType === assetType) return;
    if (activeAssetType !== assetType) {
      abortController?.abort();
    }
    set({
      activeAssetType: assetType,
      hasInitialLoad: true,
      sessionsLoading: true,
      messages: [],
      progressSteps: [],
      chatError: null,
      loading: false,
      abortController: null,
    });

    try {
      const sessionList = await agentApi.getChatSessions(50, assetType);
      set({ sessions: sessionList });

      const savedId = localStorage.getItem(storageKey);
      if (savedId) {
        const normalizedSavedId = normalizeSessionId(savedId, assetType);
        const sessionExists = sessionList.some((s) => s.session_id === normalizedSavedId);
        if (sessionExists) {
          set({ sessionId: normalizedSavedId });
          const msgs = await agentApi.getChatSessionMessages(normalizedSavedId);
          set({
            messages: msgs.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
            })),
          });
        } else {
          const newId = normalizeSessionId(generateUUID(), assetType);
          set({ sessionId: newId });
          localStorage.setItem(storageKey, newId);
        }
      } else {
        const currentSessionId = get().sessionId;
        const canReuseCurrentSessionId =
          Boolean(currentSessionId) &&
          (assetType === 'fund' ? currentSessionId.startsWith('fund_') : !currentSessionId.startsWith('fund_'));
        const newId = normalizeSessionId(canReuseCurrentSessionId ? currentSessionId : generateUUID(), assetType);
        set({ sessionId: newId });
        localStorage.setItem(storageKey, newId);
      }
    } catch {
      // Ignore
    } finally {
      set({ sessionsLoading: false });
    }
  },

  switchSession: async (targetSessionId, assetType = 'stock') => {
    const { sessionId, messages, abortController } = get();
    if (targetSessionId === sessionId && messages.length > 0) return;

    abortController?.abort();
    set({ abortController: null });

    set({ messages: [], sessionId: targetSessionId });
    localStorage.setItem(getStorageKey(assetType), targetSessionId);

    try {
      const msgs = await agentApi.getChatSessionMessages(targetSessionId);
      set({
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      });
    } catch {
      // Ignore
    }
  },

  startNewChat: (assetType = 'stock') => {
    // Abort any in-flight stream so the old request does not keep running
    get().abortController?.abort();
    const newId = normalizeSessionId(generateUUID(), assetType);
    set({
      sessionId: newId,
      messages: [],
      loading: false,
      progressSteps: [],
      chatError: null,
      abortController: null,
    });
    localStorage.setItem(getStorageKey(assetType), newId);
  },

  startStream: async (payload, meta) => {
    if (get().loading) return;
    const { abortController: prevAc, sessionId: storeSessionId } = get();
    prevAc?.abort();

    const ac = new AbortController();
    set({ abortController: ac });

    const assetType = payload.asset_type === 'fund' ? 'fund' : 'stock';
    const streamSessionId = normalizeSessionId(payload.session_id || storeSessionId, assetType);
    const streamPayload: ChatStreamRequest = {
      ...payload,
      asset_type: assetType,
      session_id: streamSessionId,
    };
    const skillNames = meta?.skillNames?.length
      ? meta.skillNames
      : [meta?.skillName ?? '通用'];
    const skillName = skillNames.join('、');

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: payload.message,
      skills: streamPayload.skills,
      skill: streamPayload.skills?.[0],
      skillNames,
      skillName,
    };

    set((s) => ({
      messages: [...s.messages, userMessage],
      loading: true,
      progressSteps: [],
      chatError: null,
      sessions: s.sessions.some((x) => x.session_id === streamSessionId)
        ? s.sessions
        : [
            {
              session_id: streamSessionId,
              title: payload.message.slice(0, 60),
              message_count: 1,
              created_at: new Date().toISOString(),
              last_active: new Date().toISOString(),
            },
            ...s.sessions,
          ],
    }));

    try {
      const response = await agentApi.chatStream(streamPayload, { signal: ac.signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalContent: string | null = null;
      let streamHadEvents = false;
      const currentProgressSteps: ProgressStep[] = [];
      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;

        streamHadEvents = true;
        const event = JSON.parse(line.slice(6)) as ProgressStep;
        if (event.type === 'done') {
          const doneEvent = event as unknown as StreamFailureEvent;
          if (doneEvent.success === false) {
            throw getStreamFailureError(doneEvent, '分析未完成，请稍后查看会话历史或重试');
          }
          finalContent = doneEvent.content ?? '';
          return;
        }

        if (event.type === 'error') {
          throw getStreamFailureError(event as unknown as StreamFailureEvent, '分析出错');
        }

        currentProgressSteps.push(event);
        set((s) => ({ progressSteps: [...s.progressSteps, event] }));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          try {
            processLine(line);
          } catch (parseErr: unknown) {
            if (isParsedApiError(parseErr) || isApiRequestError(parseErr)) {
              throw parseErr;
            }
          }
        }
      }

      if (buf.trim().startsWith('data: ')) {
        try {
          processLine(buf.trim());
        } catch (parseErr: unknown) {
          if (isParsedApiError(parseErr) || isApiRequestError(parseErr)) {
            throw parseErr;
          }
        }
      }

      if (!finalContent && streamHadEvents && !ac.signal.aborted) {
        const persistedMessages = await agentApi.getChatSessionMessages(streamSessionId).catch(() => []);
        const latestAssistant = [...persistedMessages]
          .reverse()
          .find((message) => message.role === 'assistant' && !isFailureAssistantMessage(message.content));
        if (latestAssistant?.content) {
          finalContent = latestAssistant.content;
        }
      }

      const { sessionId: currentSessionId, currentRoute } = get();
      const shouldAppend =
        currentSessionId === streamSessionId && !ac.signal.aborted;

      if (shouldAppend) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: finalContent || '（无内容）',
              skills: streamPayload.skills,
              skill: streamPayload.skills?.[0],
              skillNames,
              skillName,
              thinkingSteps: [...currentProgressSteps],
            },
          ],
        }));
      }

      const activeRoute = assetType === 'fund' ? '/fund-chat' : '/chat';
      if (currentRoute !== activeRoute) {
        set((state) => {
          const stockCompletionBadge = assetType === 'stock' ? true : state.stockCompletionBadge;
          const fundCompletionBadge = assetType === 'fund' ? true : state.fundCompletionBadge;
          return {
            stockCompletionBadge,
            fundCompletionBadge,
            completionBadge: stockCompletionBadge || fundCompletionBadge,
          };
        });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User-initiated abort: silent, no badge
      } else {
        const persistedMessages = await agentApi.getChatSessionMessages(streamSessionId).catch(() => []);
        const latestAssistant = [...persistedMessages]
          .reverse()
          .find((message) => message.role === 'assistant' && !isFailureAssistantMessage(message.content));
        if (latestAssistant?.content && get().sessionId === streamSessionId) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: latestAssistant.id,
                role: 'assistant',
                content: latestAssistant.content,
                skills: streamPayload.skills,
                skill: streamPayload.skills?.[0],
                skillNames,
                skillName,
              },
            ],
            chatError: null,
          }));
        } else {
          set({ chatError: getParsedApiError(error) });
        }
        const { currentRoute } = get();
        const activeRoute = assetType === 'fund' ? '/fund-chat' : '/chat';
        if (currentRoute !== activeRoute) {
          set((state) => {
            const stockCompletionBadge = assetType === 'stock' ? true : state.stockCompletionBadge;
            const fundCompletionBadge = assetType === 'fund' ? true : state.fundCompletionBadge;
            return {
              stockCompletionBadge,
              fundCompletionBadge,
              completionBadge: stockCompletionBadge || fundCompletionBadge,
            };
          });
        }
      }
    } finally {
      const { abortController: currentAc } = get();
      if (currentAc === ac) {
        set({
          loading: false,
          progressSteps: [],
          abortController: null,
        });
      }
      await get().loadSessions(assetType);
    }
  },
}));
