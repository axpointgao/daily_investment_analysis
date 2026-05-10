# -*- coding: utf-8 -*-
"""Tests for background portfolio analysis tasks."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from unittest.mock import patch

from src.services.portfolio_analysis_task_service import (
    PortfolioAnalysisTaskQueue,
    PortfolioAnalysisTaskStatus,
)


def _result(signature: str = "sig") -> dict:
    return {
        "as_of": "2026-05-10",
        "snapshot_signature": signature,
        "generated_at": "2026-05-10T12:00:00",
        "summary_points": ["point"],
        "full_markdown": "report",
        "model_used": "test",
        "analysis_mode": "standard",
        "provider_status": [],
    }


def _queue() -> PortfolioAnalysisTaskQueue:
    PortfolioAnalysisTaskQueue.reset_instance()
    return PortfolioAnalysisTaskQueue(max_workers=1)


def test_submit_deduplicates_active_snapshot_task() -> None:
    queue = _queue()
    with patch.object(queue.executor, "submit") as submit:
        first, created_first = queue.submit_task(
            account_id=None,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )
        second, created_second = queue.submit_task(
            account_id=None,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )

    assert created_first is True
    assert created_second is False
    assert first.task_id == second.task_id
    assert submit.call_count == 1


def test_completed_task_releases_key_and_returns_result() -> None:
    queue = _queue()
    with patch("src.services.portfolio_analysis_task_service.PortfolioAnalysisService") as service_cls:
        service_cls.return_value.analyze.return_value = _result()
        task, created = queue.submit_task(
            account_id=None,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )
        queue._futures[task.task_id].result(timeout=2)

    completed = queue.get_task(task.task_id)
    assert created is True
    assert completed is not None
    assert completed.status == PortfolioAnalysisTaskStatus.COMPLETED
    assert completed.result == _result()

    with patch.object(queue.executor, "submit"):
        next_task, next_created = queue.submit_task(
            account_id=None,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )
    assert next_created is True
    assert next_task.task_id != task.task_id
    service_cls.return_value.analyze.assert_called_once_with(
        account_id=None,
        as_of=date(2026, 5, 10),
        cost_method="fifo",
        snapshot_signature="sig",
        mode="standard",
    )


def test_failed_task_releases_key() -> None:
    queue = _queue()
    with patch("src.services.portfolio_analysis_task_service.PortfolioAnalysisService") as service_cls:
        service_cls.return_value.analyze.side_effect = RuntimeError("boom")
        task, _ = queue.submit_task(
            account_id=1,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )
        queue._futures[task.task_id].result(timeout=2)

    failed = queue.get_task(task.task_id)
    assert failed is not None
    assert failed.status == PortfolioAnalysisTaskStatus.FAILED

    with patch.object(queue.executor, "submit"):
        _, created = queue.submit_task(
            account_id=1,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )
    assert created is True


def test_stale_task_auto_fails_and_unlocks() -> None:
    queue = _queue()
    with patch.object(queue.executor, "submit"):
        task, _ = queue.submit_task(
            account_id=None,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )

    with queue._data_lock:
        stored = queue._tasks[task.task_id]
        stored.status = PortfolioAnalysisTaskStatus.PROCESSING
        stored.started_at = datetime.now() - timedelta(minutes=31)

    stale = queue.get_task(task.task_id)
    assert stale is not None
    assert stale.status == PortfolioAnalysisTaskStatus.FAILED
    assert "超过 30 分钟" in (stale.error or "")

    with patch.object(queue.executor, "submit"):
        _, created = queue.submit_task(
            account_id=None,
            as_of=date(2026, 5, 10),
            cost_method="fifo",
            snapshot_signature="sig",
            mode="standard",
        )
    assert created is True
