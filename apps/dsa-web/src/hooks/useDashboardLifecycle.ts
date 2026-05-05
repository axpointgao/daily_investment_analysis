import { useCallback, useEffect, useRef } from 'react';
import type { TaskInfo } from '../types/analysis';
import { fundAnalysisApi } from '../api/fundAnalysis';
import { useTaskStream } from './useTaskStream';

type UseDashboardLifecycleOptions = {
  activeTasks?: TaskInfo[];
  loadInitialHistory: () => Promise<void>;
  refreshHistory: (silent?: boolean) => Promise<void>;
  syncTaskCreated: (task: TaskInfo) => void;
  syncTaskUpdated: (task: TaskInfo) => void;
  syncTaskFailed: (task: TaskInfo) => void;
  removeTask: (taskId: string) => void;
  enabled?: boolean;
};

export function useDashboardLifecycle({
  activeTasks = [],
  loadInitialHistory,
  refreshHistory,
  syncTaskCreated,
  syncTaskUpdated,
  syncTaskFailed,
  removeTask,
  enabled = true,
}: UseDashboardLifecycleOptions): void {
  const removalTimeoutsRef = useRef<number[]>([]);
  const activeTasksRef = useRef(new Map<string, TaskInfo>());

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void loadInitialHistory();
  }, [enabled, loadInitialHistory]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshHistory(true);
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, [enabled, refreshHistory]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshHistory(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, refreshHistory]);

  useEffect(() => {
    return () => {
      removalTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      removalTimeoutsRef.current = [];
    };
  }, []);

  const scheduleTaskRemoval = useCallback((taskId: string, delayMs: number) => {
    const timeoutId = window.setTimeout(() => {
      removeTask(taskId);
      removalTimeoutsRef.current = removalTimeoutsRef.current.filter((item) => item !== timeoutId);
    }, delayMs);

    removalTimeoutsRef.current.push(timeoutId);
  }, [removeTask]);

  useEffect(() => {
    const activeTaskIds = new Set<string>();
    activeTasks.forEach((task) => {
      if (task.status === 'pending' || task.status === 'processing') {
        activeTaskIds.add(task.taskId);
        activeTasksRef.current.set(task.taskId, task);
      }
    });
    activeTasksRef.current.forEach((_task, taskId) => {
      if (!activeTaskIds.has(taskId)) {
        activeTasksRef.current.delete(taskId);
      }
    });
  }, [activeTasks]);

  const syncAndTrackTask = useCallback((task: TaskInfo) => {
    syncTaskUpdated(task);
    if (task.status === 'pending' || task.status === 'processing') {
      activeTasksRef.current.set(task.taskId, task);
    } else {
      activeTasksRef.current.delete(task.taskId);
    }
  }, [syncTaskUpdated]);

  const trackCreatedTask = useCallback((task: TaskInfo) => {
    syncTaskCreated(task);
    if (task.status === 'pending' || task.status === 'processing') {
      activeTasksRef.current.set(task.taskId, task);
    }
  }, [syncTaskCreated]);

  useEffect(() => {
    if (!enabled) {
      activeTasksRef.current.clear();
      return;
    }

    const intervalId = window.setInterval(() => {
      const fundTasks = Array.from(activeTasksRef.current.values()).filter((task) => task.type === 'fund');
      fundTasks.forEach((task) => {
        void fundAnalysisApi.getTaskStatus(task.taskId)
          .then((status) => {
            const updatedTask: TaskInfo = {
              ...task,
              status: status.status,
              progress: status.progress ?? task.progress,
              message: status.error || status.message || task.message,
              error: status.error,
              fundName: status.fundName || task.fundName,
              notificationError: status.notificationError || task.notificationError,
            };
            syncAndTrackTask(updatedTask);
            if (updatedTask.status === 'completed') {
              void refreshHistory(true);
              scheduleTaskRemoval(updatedTask.taskId, 2_000);
            } else if (updatedTask.status === 'failed') {
              syncTaskFailed(updatedTask);
              scheduleTaskRemoval(updatedTask.taskId, 5_000);
            }
          })
          .catch(() => {
            // SSE still owns the primary path; polling failures should not create noisy user errors.
          });
      });
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [enabled, refreshHistory, scheduleTaskRemoval, syncAndTrackTask, syncTaskFailed]);

  useTaskStream({
    onTaskCreated: syncTaskCreated,
    onTaskStarted: syncTaskUpdated,
    onTaskProgress: syncTaskUpdated,
    onTaskCompleted: (task) => {
      syncTaskUpdated(task);
      void refreshHistory(true);
      scheduleTaskRemoval(task.taskId, 2_000);
    },
    onTaskFailed: (task) => {
      syncTaskFailed(task);
      scheduleTaskRemoval(task.taskId, 5_000);
    },
    onError: () => {
      console.warn('SSE connection disconnected, reconnecting...');
    },
    enabled,
  });

  useTaskStream({
    streamUrl: fundAnalysisApi.getTaskStreamUrl(),
    onTaskCreated: trackCreatedTask,
    onTaskStarted: syncAndTrackTask,
    onTaskProgress: syncAndTrackTask,
    onTaskCompleted: (task) => {
      activeTasksRef.current.delete(task.taskId);
      syncTaskUpdated(task);
      void refreshHistory(true);
      scheduleTaskRemoval(task.taskId, 2_000);
    },
    onTaskFailed: (task) => {
      activeTasksRef.current.delete(task.taskId);
      syncTaskFailed(task);
      scheduleTaskRemoval(task.taskId, 5_000);
    },
    onError: () => {
      console.warn('Fund SSE connection disconnected, reconnecting...');
    },
    enabled,
  });
}

export default useDashboardLifecycle;
