import type React from 'react';
import { Badge, Card, StatusDot } from '../common';
import { DashboardPanelHeader } from '../dashboard';
import type { TaskInfo } from '../../types/analysis';

/**
 * 任务项组件属性
 */
interface TaskItemProps {
  task: TaskInfo;
}

type ActiveTaskStatus = 'pending' | 'processing';

const isActiveTask = (task: TaskInfo): task is TaskInfo & { status: ActiveTaskStatus } => (
  task.status === 'pending' || task.status === 'processing'
);

const getTaskStatusMeta = (status: ActiveTaskStatus) => {
  if (status === 'processing') {
    return {
      label: '分析中',
      badgeVariant: 'info' as const,
      tone: 'info' as const,
    };
  }

  return {
    label: '等待中',
    badgeVariant: 'default' as const,
    tone: 'neutral' as const,
  };
};

const getTaskDisplayInfo = (task: TaskInfo) => {
  if (task.type === 'fund') {
    return {
      code: task.fundCode,
      name: task.fundName,
    };
  }

  return {
    code: task.stockCode,
    name: task.stockName,
  };
};

const TaskItem: React.FC<TaskItemProps> = ({ task }) => {
  if (!isActiveTask(task)) {
    return null;
  }

  const statusMeta = getTaskStatusMeta(task.status);
  const progress = Math.max(0, Math.min(100, task.progress || 0));
  const displayInfo = getTaskDisplayInfo(task);

  return (
    <div className="rounded-lg border bg-card flex items-center gap-3 px-3 py-2.5">
      <div className="shrink-0">
        {task.status === 'processing' ? (
          <StatusDot tone="info" pulse className="h-2.5 w-2.5" aria-label="任务进行中" />
        ) : (
          <StatusDot tone="neutral" className="h-2.5 w-2.5" aria-label="任务等待中" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {displayInfo.name || displayInfo.code}
          </span>
          <span className="text-xs text-muted-foreground">
            {displayInfo.code}
          </span>
        </div>
        {(task.message || task.notificationError) && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {task.notificationError ? `通知失败：${task.notificationError}` : task.message}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {progress}%
          </span>
        </div>
      </div>

      <div className="flex-shrink-0">
        <Badge
          variant={statusMeta.badgeVariant}
          className="min-w-[4.75rem] justify-center gap-1.5 shadow-none"
          aria-label={`任务状态：${statusMeta.label}`}
        >
          <StatusDot tone={statusMeta.tone} pulse={task.status === 'processing'} className="h-1.5 w-1.5" />
          {statusMeta.label}
        </Badge>
      </div>
    </div>
  );
};

/**
 * 任务面板属性
 */
interface TaskPanelProps {
  /** 任务列表 */
  tasks: TaskInfo[];
  /** 是否显示 */
  visible?: boolean;
  /** 标题 */
  title?: string;
  /** 自定义类名 */
  className?: string;
}

/**
 * 任务面板组件
 * 显示进行中的分析任务列表
 */
export const TaskPanel: React.FC<TaskPanelProps> = ({
  tasks,
  visible = true,
  title = '分析任务',
  className = '',
}) => {
  const activeTasks = tasks.filter(isActiveTask);

  if (!visible || activeTasks.length === 0) {
    return null;
  }

  const pendingCount = activeTasks.filter((task) => task.status === 'pending').length;
  const processingCount = activeTasks.length - pendingCount;

  return (
    <Card
      variant="bordered"
      padding="none"
      className={` overflow-hidden ${className}`}
    >
      <div className="border-b border-border px-3 py-3">
        <DashboardPanelHeader
          className="mb-0"
          title={title}
          titleClassName="text-sm font-medium"
          leading={(
            <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          )}
          headingClassName="items-center"
          actions={(
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {processingCount > 0 && (
                <span className="flex items-center gap-1">
                  <StatusDot tone="info" pulse className="h-1.5 w-1.5" aria-label="进行中任务" />
                  {processingCount} 进行中
                </span>
              )}
              {pendingCount > 0 ? (
                <span className="flex items-center gap-1">
                  <StatusDot tone="neutral" className="h-1.5 w-1.5" aria-label="等待中任务" />
                  {pendingCount} 等待中
                </span>
              ) : null}
            </div>
          )}
        />
      </div>

      <div className="max-h-64 overflow-y-auto p-2">
        <div className="space-y-2">
          {activeTasks.map((task) => (
            <TaskItem key={task.taskId} task={task} />
          ))}
        </div>
      </div>
    </Card>
  );
};

export default TaskPanel;
