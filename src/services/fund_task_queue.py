# -*- coding: utf-8 -*-
"""场外基金异步分析任务队列。"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from src.services.fund_analysis_service import normalize_fund_code

if TYPE_CHECKING:
    from asyncio import Queue as AsyncQueue

logger = logging.getLogger(__name__)


class FundTaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class FundTaskInfo:
    task_id: str
    fund_code: str
    fund_name: Optional[str] = None
    status: FundTaskStatus = FundTaskStatus.PENDING
    progress: int = 0
    message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    report_type: str = "detailed"
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "type": "fund",
            "fund_code": self.fund_code,
            "fund_name": self.fund_name,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "report_type": self.report_type,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
        }

    def copy(self) -> "FundTaskInfo":
        return FundTaskInfo(
            task_id=self.task_id,
            fund_code=self.fund_code,
            fund_name=self.fund_name,
            status=self.status,
            progress=self.progress,
            message=self.message,
            result=self.result,
            error=self.error,
            report_type=self.report_type,
            created_at=self.created_at,
            started_at=self.started_at,
            completed_at=self.completed_at,
        )


class DuplicateFundTaskError(Exception):
    def __init__(self, fund_code: str, existing_task_id: str):
        self.fund_code = fund_code
        self.existing_task_id = existing_task_id
        super().__init__(f"基金 {fund_code} 正在分析中 (task_id: {existing_task_id})")


class FundAnalysisTaskQueue:
    _instance: Optional["FundAnalysisTaskQueue"] = None
    _instance_lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, max_workers: int = 2):
        if getattr(self, "_initialized", False):
            return
        self._max_workers = max_workers
        self._executor: Optional[ThreadPoolExecutor] = None
        self._tasks: Dict[str, FundTaskInfo] = {}
        self._analyzing_funds: Dict[str, str] = {}
        self._futures: Dict[str, Future] = {}
        self._subscribers: List["AsyncQueue"] = []
        self._subscribers_lock = threading.Lock()
        self._main_loop: Optional[asyncio.AbstractEventLoop] = None
        self._data_lock = threading.RLock()
        self._max_history = 100
        self._initialized = True
        logger.info("[FundTaskQueue] 初始化完成，最大并发: %s", max_workers)

    @property
    def executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(
                max_workers=self._max_workers,
                thread_name_prefix="fund_analysis_task_",
            )
        return self._executor

    def submit_task(
        self,
        *,
        fund_code: str,
        fund_name: Optional[str] = None,
        report_type: str = "detailed",
        force_refresh: bool = False,
        notify: bool = True,
    ) -> FundTaskInfo:
        code = normalize_fund_code(fund_code)
        with self._data_lock:
            if code in self._analyzing_funds:
                raise DuplicateFundTaskError(code, self._analyzing_funds[code])

            task_id = uuid.uuid4().hex
            task = FundTaskInfo(
                task_id=task_id,
                fund_code=code,
                fund_name=fund_name,
                status=FundTaskStatus.PENDING,
                progress=0,
                message="任务已加入队列",
                report_type=report_type,
            )
            self._tasks[task_id] = task
            self._analyzing_funds[code] = task_id

            try:
                future = self.executor.submit(
                    self._execute_task,
                    task_id,
                    code,
                    fund_name,
                    report_type,
                    force_refresh,
                    notify,
                )
            except Exception:
                self._tasks.pop(task_id, None)
                self._analyzing_funds.pop(code, None)
                raise

            self._futures[task_id] = future
            self._broadcast_event("task_created", task.to_dict())
            return task.copy()

    def get_task(self, task_id: str) -> Optional[FundTaskInfo]:
        with self._data_lock:
            task = self._tasks.get(task_id)
            return task.copy() if task else None

    def list_pending_tasks(self) -> List[FundTaskInfo]:
        with self._data_lock:
            return [
                task.copy()
                for task in self._tasks.values()
                if task.status in (FundTaskStatus.PENDING, FundTaskStatus.PROCESSING)
            ]

    def list_all_tasks(self, limit: int = 50) -> List[FundTaskInfo]:
        with self._data_lock:
            tasks = sorted(self._tasks.values(), key=lambda item: item.created_at, reverse=True)
            return [task.copy() for task in tasks[:limit]]

    def get_task_stats(self) -> Dict[str, int]:
        with self._data_lock:
            stats = {"total": len(self._tasks), "pending": 0, "processing": 0, "completed": 0, "failed": 0}
            for task in self._tasks.values():
                stats[task.status.value] = stats.get(task.status.value, 0) + 1
            return stats

    def update_task_progress(self, task_id: str, progress: int, message: Optional[str] = None) -> Optional[FundTaskInfo]:
        with self._data_lock:
            task = self._tasks.get(task_id)
            if not task or task.status not in (FundTaskStatus.PENDING, FundTaskStatus.PROCESSING):
                return None
            task.progress = max(task.progress, max(0, min(99, int(progress))))
            if message is not None:
                task.message = message
            snapshot = task.copy()
        self._broadcast_event("task_progress", snapshot.to_dict())
        return snapshot

    def _execute_task(
        self,
        task_id: str,
        fund_code: str,
        fund_name: Optional[str],
        report_type: str,
        force_refresh: bool,
        notify: bool,
    ) -> Optional[Dict[str, Any]]:
        with self._data_lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            task.status = FundTaskStatus.PROCESSING
            task.started_at = datetime.now()
            task.progress = 10
            task.message = "正在分析中..."
            snapshot = task.copy()

        self._broadcast_event("task_started", snapshot.to_dict())

        try:
            from src.services.fund_analysis_service import FundAnalysisService

            service = FundAnalysisService()

            def on_progress(progress: int, message: str) -> None:
                self.update_task_progress(task_id, progress, message)

            result = service.analyze_fund(
                fund_code=fund_code,
                fund_name=fund_name,
                report_type=report_type,
                force_refresh=force_refresh,
                query_id=task_id,
                notify=notify,
                progress_callback=on_progress,
            )
            if not result:
                raise RuntimeError(service.last_error or "基金分析返回空结果")

            with self._data_lock:
                task = self._tasks.get(task_id)
                if task:
                    task.status = FundTaskStatus.COMPLETED
                    task.progress = 100
                    task.completed_at = datetime.now()
                    task.result = result
                    task.message = "分析完成"
                    task.fund_name = result.get("fund_name") or task.fund_name
                    self._analyzing_funds.pop(task.fund_code, None)
                    snapshot = task.copy()

            self._broadcast_event("task_completed", snapshot.to_dict())
            self._cleanup_old_tasks()
            return result
        except Exception as exc:
            error_msg = str(exc)
            logger.error("[FundTaskQueue] 任务失败: %s (%s), 错误: %s", task_id, fund_code, error_msg, exc_info=True)
            with self._data_lock:
                task = self._tasks.get(task_id)
                if task:
                    task.status = FundTaskStatus.FAILED
                    task.completed_at = datetime.now()
                    task.error = error_msg[:300]
                    task.message = f"分析失败: {error_msg[:50]}"
                    self._analyzing_funds.pop(task.fund_code, None)
                    snapshot = task.copy()
            self._broadcast_event("task_failed", snapshot.to_dict())
            self._cleanup_old_tasks()
            return None

    def _cleanup_old_tasks(self) -> int:
        with self._data_lock:
            if len(self._tasks) <= self._max_history:
                return 0
            completed = sorted(
                [
                    task
                    for task in self._tasks.values()
                    if task.status in (FundTaskStatus.COMPLETED, FundTaskStatus.FAILED)
                ],
                key=lambda item: item.created_at,
            )
            removed = 0
            for task in completed[: len(self._tasks) - self._max_history]:
                self._tasks.pop(task.task_id, None)
                self._futures.pop(task.task_id, None)
                removed += 1
            return removed

    def subscribe(self, queue: "AsyncQueue") -> None:
        with self._subscribers_lock:
            self._subscribers.append(queue)
            try:
                self._main_loop = asyncio.get_running_loop()
            except RuntimeError:
                try:
                    self._main_loop = asyncio.get_event_loop()
                except RuntimeError:
                    pass

    def unsubscribe(self, queue: "AsyncQueue") -> None:
        with self._subscribers_lock:
            if queue in self._subscribers:
                self._subscribers.remove(queue)

    def _broadcast_event(self, event_type: str, data: Dict[str, Any]) -> None:
        event = {"type": event_type, "data": data}
        with self._subscribers_lock:
            subscribers = self._subscribers.copy()
            loop = self._main_loop
        if not subscribers or loop is None:
            return
        for queue in subscribers:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:
                logger.debug("[FundTaskQueue] 广播事件跳过：事件循环已关闭")
            except Exception as exc:
                logger.warning("[FundTaskQueue] 广播事件失败: %s", exc)


def get_fund_task_queue() -> FundAnalysisTaskQueue:
    return FundAnalysisTaskQueue()
