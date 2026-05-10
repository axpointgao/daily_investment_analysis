# -*- coding: utf-8 -*-
"""Background task queue for LLM portfolio asset analysis."""

from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Any, Dict, Optional, Tuple

from src.services.portfolio_analysis_service import PortfolioAnalysisError, PortfolioAnalysisService

logger = logging.getLogger(__name__)

PORTFOLIO_ANALYSIS_TASK_TIMEOUT_MINUTES = 30


class PortfolioAnalysisTaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class PortfolioAnalysisTaskInfo:
    task_id: str
    task_key: str
    account_id: Optional[int]
    as_of: Optional[date]
    cost_method: str
    snapshot_signature: str
    mode: str
    status: PortfolioAnalysisTaskStatus = PortfolioAnalysisTaskStatus.PENDING
    progress: int = 0
    message: str = "任务已加入队列"
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def copy(self) -> "PortfolioAnalysisTaskInfo":
        return PortfolioAnalysisTaskInfo(
            task_id=self.task_id,
            task_key=self.task_key,
            account_id=self.account_id,
            as_of=self.as_of,
            cost_method=self.cost_method,
            snapshot_signature=self.snapshot_signature,
            mode=self.mode,
            status=self.status,
            progress=self.progress,
            message=self.message,
            result=self.result,
            error=self.error,
            created_at=self.created_at,
            started_at=self.started_at,
            completed_at=self.completed_at,
        )


class PortfolioAnalysisTaskQueue:
    _instance: Optional["PortfolioAnalysisTaskQueue"] = None
    _instance_lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, max_workers: int = 1):
        if getattr(self, "_initialized", False):
            return
        self._max_workers = max_workers
        self._executor: Optional[ThreadPoolExecutor] = None
        self._tasks: Dict[str, PortfolioAnalysisTaskInfo] = {}
        self._active_by_key: Dict[str, str] = {}
        self._latest_by_key: Dict[str, str] = {}
        self._futures: Dict[str, Future] = {}
        self._data_lock = threading.RLock()
        self._max_history = 50
        self._timeout = timedelta(minutes=PORTFOLIO_ANALYSIS_TASK_TIMEOUT_MINUTES)
        self._initialized = True
        logger.info("[PortfolioAnalysisTaskQueue] 初始化完成，最大并发: %s", max_workers)

    @classmethod
    def reset_instance(cls) -> None:
        with cls._instance_lock:
            if cls._instance is not None:
                executor = getattr(cls._instance, "_executor", None)
                if executor is not None:
                    executor.shutdown(wait=False, cancel_futures=True)
                cls._instance = None

    @property
    def executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(
                max_workers=self._max_workers,
                thread_name_prefix="portfolio_analysis_task_",
            )
        return self._executor

    @staticmethod
    def build_task_key(
        *,
        account_id: Optional[int],
        as_of: Optional[date],
        cost_method: str,
        snapshot_signature: str,
        mode: str,
    ) -> str:
        scope = "all" if account_id is None else str(account_id)
        as_of_part = as_of.isoformat() if as_of else ""
        return "|".join([scope, as_of_part, cost_method, mode, snapshot_signature])

    def submit_task(
        self,
        *,
        account_id: Optional[int],
        as_of: Optional[date],
        cost_method: str,
        snapshot_signature: str,
        mode: str,
    ) -> Tuple[PortfolioAnalysisTaskInfo, bool]:
        task_key = self.build_task_key(
            account_id=account_id,
            as_of=as_of,
            cost_method=cost_method,
            snapshot_signature=snapshot_signature,
            mode=mode,
        )
        with self._data_lock:
            self._mark_stale_tasks_locked()
            active_task_id = self._active_by_key.get(task_key)
            if active_task_id:
                active_task = self._tasks.get(active_task_id)
                if active_task and active_task.status in (
                    PortfolioAnalysisTaskStatus.PENDING,
                    PortfolioAnalysisTaskStatus.PROCESSING,
                ):
                    return active_task.copy(), False

            task_id = uuid.uuid4().hex
            task = PortfolioAnalysisTaskInfo(
                task_id=task_id,
                task_key=task_key,
                account_id=account_id,
                as_of=as_of,
                cost_method=cost_method,
                snapshot_signature=snapshot_signature,
                mode=mode,
            )
            self._tasks[task_id] = task
            self._active_by_key[task_key] = task_id
            self._latest_by_key[task_key] = task_id
            future = self.executor.submit(self._execute_task, task_id)
            self._futures[task_id] = future
            return task.copy(), True

    def get_task(self, task_id: str) -> Optional[PortfolioAnalysisTaskInfo]:
        with self._data_lock:
            self._mark_stale_tasks_locked()
            task = self._tasks.get(task_id)
            return task.copy() if task else None

    def get_current_task(
        self,
        *,
        account_id: Optional[int],
        as_of: Optional[date],
        cost_method: str,
        snapshot_signature: str,
        mode: str,
    ) -> Optional[PortfolioAnalysisTaskInfo]:
        task_key = self.build_task_key(
            account_id=account_id,
            as_of=as_of,
            cost_method=cost_method,
            snapshot_signature=snapshot_signature,
            mode=mode,
        )
        with self._data_lock:
            self._mark_stale_tasks_locked()
            task_id = self._active_by_key.get(task_key) or self._latest_by_key.get(task_key)
            task = self._tasks.get(task_id or "")
            return task.copy() if task else None

    def _execute_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._data_lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            task.status = PortfolioAnalysisTaskStatus.PROCESSING
            task.started_at = datetime.now()
            task.progress = 15
            task.message = "后台资产分析正在生成..."
            snapshot = task.copy()

        try:
            service = PortfolioAnalysisService()
            with self._data_lock:
                current = self._tasks.get(task_id)
                if current:
                    current.progress = 35
                    current.message = "正在整合持仓、风险指标和专业诊断..."

            result = service.analyze(
                account_id=snapshot.account_id,
                as_of=snapshot.as_of,
                cost_method=snapshot.cost_method,
                snapshot_signature=snapshot.snapshot_signature,
                mode=snapshot.mode,
            )

            with self._data_lock:
                task = self._tasks.get(task_id)
                if task:
                    task.status = PortfolioAnalysisTaskStatus.COMPLETED
                    task.progress = 100
                    task.completed_at = datetime.now()
                    task.result = result
                    task.message = "资产分析完成"
                    self._active_by_key.pop(task.task_key, None)
            self._cleanup_old_tasks()
            return result
        except Exception as exc:
            error_msg = str(exc)
            logger.error("[PortfolioAnalysisTaskQueue] 任务失败: %s, 错误: %s", task_id, error_msg, exc_info=True)
            with self._data_lock:
                task = self._tasks.get(task_id)
                if task:
                    task.status = PortfolioAnalysisTaskStatus.FAILED
                    task.completed_at = datetime.now()
                    task.error = error_msg[:500]
                    task.message = (
                        str(exc)[:120]
                        if isinstance(exc, PortfolioAnalysisError)
                        else f"资产分析失败: {error_msg[:80]}"
                    )
                    self._active_by_key.pop(task.task_key, None)
            self._cleanup_old_tasks()
            return None

    def _mark_stale_tasks_locked(self) -> None:
        now = datetime.now()
        for task in self._tasks.values():
            if task.status not in (PortfolioAnalysisTaskStatus.PENDING, PortfolioAnalysisTaskStatus.PROCESSING):
                continue
            anchor = task.started_at or task.created_at
            if now - anchor <= self._timeout:
                continue
            task.status = PortfolioAnalysisTaskStatus.FAILED
            task.completed_at = now
            task.error = "资产分析任务超过 30 分钟未完成，已自动解锁。"
            task.message = task.error
            self._active_by_key.pop(task.task_key, None)

    def _cleanup_old_tasks(self) -> int:
        with self._data_lock:
            if len(self._tasks) <= self._max_history:
                return 0
            completed = sorted(
                [
                    task
                    for task in self._tasks.values()
                    if task.status in (PortfolioAnalysisTaskStatus.COMPLETED, PortfolioAnalysisTaskStatus.FAILED)
                ],
                key=lambda item: item.created_at,
            )
            removed = 0
            for task in completed[: len(self._tasks) - self._max_history]:
                self._tasks.pop(task.task_id, None)
                self._futures.pop(task.task_id, None)
                if self._latest_by_key.get(task.task_key) == task.task_id:
                    self._latest_by_key.pop(task.task_key, None)
                removed += 1
            return removed


def get_portfolio_analysis_task_queue() -> PortfolioAnalysisTaskQueue:
    return PortfolioAnalysisTaskQueue()
