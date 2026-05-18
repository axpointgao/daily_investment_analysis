# -*- coding: utf-8 -*-
"""Tests for background online portfolio price refresh tasks."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from unittest.mock import patch

from src.services.portfolio_refresh_task_service import (
    PortfolioRefreshTaskQueue,
    PortfolioRefreshTaskStatus,
)


def _snapshot() -> dict:
    return {
        "as_of": "2026-05-10",
        "cost_method": "fifo",
        "currency": "CNY",
        "account_count": 1,
        "total_cash": 0.0,
        "total_market_value": 100.0,
        "total_equity": 100.0,
        "realized_pnl": 0.0,
        "unrealized_pnl": 0.0,
        "fee_total": 0.0,
        "tax_total": 0.0,
        "fx_stale": False,
        "fx_missing": False,
        "missing_fx_pairs": [],
        "asset_breakdown": {},
        "tag_breakdown": [],
        "accounts": [],
    }


def _queue() -> PortfolioRefreshTaskQueue:
    PortfolioRefreshTaskQueue.reset_instance()
    return PortfolioRefreshTaskQueue(max_workers=1)


def test_submit_deduplicates_active_refresh_task() -> None:
    queue = _queue()
    with patch.object(queue.executor, "submit") as submit:
        first, created_first = queue.submit_task(account_id=None, as_of=date(2026, 5, 10), cost_method="fifo")
        second, created_second = queue.submit_task(account_id=None, as_of=date(2026, 5, 10), cost_method="fifo")

    assert created_first is True
    assert created_second is False
    assert first.task_id == second.task_id
    assert submit.call_count == 1


def test_completed_task_refreshes_online_prices_and_releases_key() -> None:
    queue = _queue()
    with patch("src.services.portfolio_refresh_task_service.PortfolioService") as service_cls:
        service_cls.return_value.get_portfolio_snapshot.return_value = _snapshot()
        task, created = queue.submit_task(account_id=1, as_of=date(2026, 5, 10), cost_method="fifo")
        queue._futures[task.task_id].result(timeout=2)

    completed = queue.get_task(task.task_id)
    assert created is True
    assert completed is not None
    assert completed.status == PortfolioRefreshTaskStatus.COMPLETED
    assert completed.result == _snapshot()
    service_cls.return_value.get_portfolio_snapshot.assert_called_once_with(
        account_id=1,
        as_of=date(2026, 5, 10),
        cost_method="fifo",
        refresh_prices=True,
    )

    with patch.object(queue.executor, "submit"):
        next_task, next_created = queue.submit_task(account_id=1, as_of=date(2026, 5, 10), cost_method="fifo")
    assert next_created is True
    assert next_task.task_id != task.task_id


def test_failed_task_releases_key() -> None:
    queue = _queue()
    with patch("src.services.portfolio_refresh_task_service.PortfolioService") as service_cls:
        service_cls.return_value.get_portfolio_snapshot.side_effect = RuntimeError("boom")
        task, _ = queue.submit_task(account_id=None, as_of=date(2026, 5, 10), cost_method="fifo")
        queue._futures[task.task_id].result(timeout=2)

    failed = queue.get_task(task.task_id)
    assert failed is not None
    assert failed.status == PortfolioRefreshTaskStatus.FAILED

    with patch.object(queue.executor, "submit"):
        _, created = queue.submit_task(account_id=None, as_of=date(2026, 5, 10), cost_method="fifo")
    assert created is True


def test_stale_task_auto_fails_and_unlocks() -> None:
    queue = _queue()
    with patch.object(queue.executor, "submit"):
        task, _ = queue.submit_task(account_id=None, as_of=date(2026, 5, 10), cost_method="fifo")

    with queue._data_lock:
        stored = queue._tasks[task.task_id]
        stored.status = PortfolioRefreshTaskStatus.PROCESSING
        stored.started_at = datetime.now() - timedelta(minutes=21)

    stale = queue.get_task(task.task_id)
    assert stale is not None
    assert stale.status == PortfolioRefreshTaskStatus.FAILED
    assert "超过 20 分钟" in (stale.error or "")
