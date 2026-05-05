import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fundAnalysisApi } from '../../api/fundAnalysis';
import { useDashboardLifecycle } from '../useDashboardLifecycle';
import { useTaskStream } from '../useTaskStream';

vi.mock('../useTaskStream', () => ({
  useTaskStream: vi.fn(),
}));

vi.mock('../../api/fundAnalysis', () => ({
  fundAnalysisApi: {
    getTaskStatus: vi.fn(),
    getTaskStreamUrl: vi.fn(() => '/api/v1/fund-analysis/tasks/stream'),
  },
}));

const createTask = () => ({
  taskId: 'task-1',
  stockCode: '600519',
  stockName: '贵州茅台',
  status: 'completed' as const,
  progress: 100,
  reportType: 'detailed',
  createdAt: '2026-03-18T08:00:00Z',
});

describe('useDashboardLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads history, refreshes on interval, and reacts to visibility changes', () => {
    const loadInitialHistory = vi.fn().mockResolvedValue(undefined);
    const refreshHistory = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useDashboardLifecycle({
        loadInitialHistory,
        refreshHistory,
        syncTaskCreated: vi.fn(),
        syncTaskUpdated: vi.fn(),
        syncTaskFailed: vi.fn(),
        removeTask: vi.fn(),
      }),
    );

    expect(loadInitialHistory).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(refreshHistory).toHaveBeenCalledWith(true);

    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(refreshHistory).toHaveBeenCalledTimes(2);
  });

  it('cleans pending task removal timers on unmount', () => {
    const removeTask = vi.fn();

    const { unmount } = renderHook(() =>
      useDashboardLifecycle({
        loadInitialHistory: vi.fn().mockResolvedValue(undefined),
        refreshHistory: vi.fn().mockResolvedValue(undefined),
        syncTaskCreated: vi.fn(),
        syncTaskUpdated: vi.fn(),
        syncTaskFailed: vi.fn(),
        removeTask,
      }),
    );

    const taskStreamOptions = vi.mocked(useTaskStream).mock.calls[0]?.[0];
    expect(taskStreamOptions).toBeDefined();

    act(() => {
      taskStreamOptions?.onTaskCompleted?.(createTask());
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(removeTask).not.toHaveBeenCalled();
  });

  it('refreshes history and removes completed tasks after the grace window', () => {
    const refreshHistory = vi.fn().mockResolvedValue(undefined);
    const syncTaskUpdated = vi.fn();
    const removeTask = vi.fn();

    renderHook(() =>
      useDashboardLifecycle({
        loadInitialHistory: vi.fn().mockResolvedValue(undefined),
        refreshHistory,
        syncTaskCreated: vi.fn(),
        syncTaskUpdated,
        syncTaskFailed: vi.fn(),
        removeTask,
      }),
    );

    const taskStreamOptions = vi.mocked(useTaskStream).mock.calls[0]?.[0];
    const completedTask = createTask();

    act(() => {
      taskStreamOptions?.onTaskCompleted?.(completedTask);
    });

    expect(syncTaskUpdated).toHaveBeenCalledWith(completedTask);
    expect(refreshHistory).toHaveBeenCalledWith(true);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(removeTask).toHaveBeenCalledWith(completedTask.taskId);
  });

  it('forwards task progress updates to the task sync handler', () => {
    const syncTaskUpdated = vi.fn();

    renderHook(() =>
      useDashboardLifecycle({
        loadInitialHistory: vi.fn().mockResolvedValue(undefined),
        refreshHistory: vi.fn().mockResolvedValue(undefined),
        syncTaskCreated: vi.fn(),
        syncTaskUpdated,
        syncTaskFailed: vi.fn(),
        removeTask: vi.fn(),
      }),
    );

    const taskStreamOptions = vi.mocked(useTaskStream).mock.calls[0]?.[0];
    const progressTask = {
      ...createTask(),
      status: 'processing' as const,
      progress: 72,
      message: 'LLM 正在生成分析结果',
    };

    act(() => {
      taskStreamOptions?.onTaskProgress?.(progressTask);
    });

    expect(syncTaskUpdated).toHaveBeenCalledWith(progressTask);
  });

  it('polls active fund task status when the SSE stream is delayed', async () => {
    const syncTaskUpdated = vi.fn();
    const refreshHistory = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fundAnalysisApi.getTaskStatus).mockResolvedValue({
      taskId: 'fund-task-1',
      status: 'processing',
      progress: 55,
      message: '正在获取历史净值',
      fundName: '华夏成长混合',
    });

    renderHook(() =>
      useDashboardLifecycle({
        activeTasks: [
          {
            taskId: 'fund-task-1',
            type: 'fund',
            fundCode: '000001',
            status: 'pending',
            progress: 0,
            message: '基金分析任务已提交',
            reportType: 'detailed',
            createdAt: '2026-03-18T08:00:00Z',
          },
        ],
        loadInitialHistory: vi.fn().mockResolvedValue(undefined),
        refreshHistory,
        syncTaskCreated: vi.fn(),
        syncTaskUpdated,
        syncTaskFailed: vi.fn(),
        removeTask: vi.fn(),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(fundAnalysisApi.getTaskStatus).toHaveBeenCalledWith('fund-task-1');
    expect(syncTaskUpdated).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'fund-task-1',
      type: 'fund',
      fundCode: '000001',
      status: 'processing',
      progress: 55,
      message: '正在获取历史净值',
      fundName: '华夏成长混合',
    }));
  });

  it('reports failed tasks and removes them after the failure grace window', () => {
    const syncTaskFailed = vi.fn();
    const removeTask = vi.fn();

    renderHook(() =>
      useDashboardLifecycle({
        loadInitialHistory: vi.fn().mockResolvedValue(undefined),
        refreshHistory: vi.fn().mockResolvedValue(undefined),
        syncTaskCreated: vi.fn(),
        syncTaskUpdated: vi.fn(),
        syncTaskFailed,
        removeTask,
      }),
    );

    const taskStreamOptions = vi.mocked(useTaskStream).mock.calls[0]?.[0];
    const failedTask = {
      ...createTask(),
      status: 'failed' as const,
      error: '分析失败',
    };

    act(() => {
      taskStreamOptions?.onTaskFailed?.(failedTask);
    });

    expect(syncTaskFailed).toHaveBeenCalledWith(failedTask);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(removeTask).toHaveBeenCalledWith(failedTask.taskId);
  });
});
