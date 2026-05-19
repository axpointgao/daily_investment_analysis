# -*- coding: utf-8 -*-
"""Persistent strategy query library for the stock screener."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

LIBRARY_PATH = Path("data/screener_strategies.json")


DEFAULT_LIBRARY_ITEMS: List[Dict[str, Any]] = [
    {
        "id": "classic-quality-trend",
        "name": "低估值趋势",
        "description": "先排除 ST 和高估值，再找仍在中期趋势上的股票，适合每周看一次。",
        "query": "PE小于25，PB小于3，收盘价站上60日线，25日涨幅大于0，非ST，成交额大于2亿",
        "backtest_status": "等待历史数据",
        "last_run_result": None,
    },
    {
        "id": "classic-pullback",
        "name": "缩量回踩",
        "description": "找趋势没有破坏、回调接近均线且抛压不重的股票，偏低频等待买点。",
        "query": "MA20大于MA60，收盘价接近MA20，非ST，成交额大于2亿，10日涨幅不过高",
        "backtest_status": "等待历史数据",
        "last_run_result": None,
    },
    {
        "id": "classic-breakout",
        "name": "放量突破",
        "description": "找近期突破并且成交量配合的股票，进攻性更强，波动也更大。",
        "query": "近20日新高，量比大于1.5，成交额大于5亿，非ST",
        "backtest_status": "等待历史数据",
        "last_run_result": None,
    },
    {
        "id": "classic-midcap-momentum",
        "name": "中盘动量",
        "description": "避开太小的股票，寻找流动性较好且近期走势转强的中盘股。",
        "query": "流通市值100亿到1000亿，25日涨幅大于0，成交额大于2亿，非ST",
        "backtest_status": "等待历史数据",
        "last_run_result": None,
    },
]


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return cleaned[:40] or uuid.uuid4().hex[:12]


def _normalize_item(raw: Dict[str, Any], *, now: Optional[str] = None) -> Dict[str, Any]:
    timestamp = now or _now()
    return {
        "id": str(raw.get("id") or uuid.uuid4().hex),
        "name": str(raw.get("name") or "未命名策略").strip()[:80],
        "description": str(raw.get("description") or "暂无说明").strip()[:400],
        "query": str(raw.get("query") or "").strip()[:1000],
        "backtest_status": str(raw.get("backtest_status") or "未回测").strip()[:80],
        "last_run_result": (
            str(raw.get("last_run_result")).strip()[:400]
            if raw.get("last_run_result") not in (None, "")
            else None
        ),
        "created_at": str(raw.get("created_at") or timestamp),
        "updated_at": str(raw.get("updated_at") or timestamp),
    }


class ScreenerStrategyLibraryService:
    """Store user-maintained natural-language screener strategies."""

    def __init__(self, path: Path = LIBRARY_PATH) -> None:
        self.path = path

    def list_items(self) -> List[Dict[str, Any]]:
        return self._read_items()

    def create_item(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        items = self._read_items()
        now = _now()
        base_id = _slug(payload.get("name") or "")
        existing_ids = {item["id"] for item in items}
        item_id = base_id
        suffix = 2
        while item_id in existing_ids:
            item_id = f"{base_id}-{suffix}"
            suffix += 1
        item = _normalize_item({**payload, "id": item_id}, now=now)
        items.append(item)
        self._write_items(items)
        return item

    def update_item(self, item_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        items = self._read_items()
        for index, item in enumerate(items):
            if item["id"] == item_id:
                updated = _normalize_item({**item, **payload, "id": item_id, "updated_at": _now()})
                items[index] = updated
                self._write_items(items)
                return updated
        raise KeyError(item_id)

    def update_last_run(self, item_id: Optional[str], summary: str) -> None:
        if not item_id:
            return
        try:
            items = self._read_items()
            for item in items:
                if item["id"] == item_id:
                    item["last_run_result"] = summary[:400]
                    item["updated_at"] = _now()
                    self._write_items(items)
                    return
        except Exception as exc:
            logger.warning("Failed to update screener strategy last run for %s: %s", item_id, exc)

    def _read_items(self) -> List[Dict[str, Any]]:
        if not self.path.exists():
            items = [_normalize_item(item, now=_now()) for item in DEFAULT_LIBRARY_ITEMS]
            self._write_items(items)
            return items
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(raw, list):
                raise ValueError("strategy library root must be a list")
            return [_normalize_item(item) for item in raw if isinstance(item, dict)]
        except Exception as exc:
            logger.warning("Failed to load screener strategy library, using defaults: %s", exc)
            return [_normalize_item(item, now=_now()) for item in DEFAULT_LIBRARY_ITEMS]

    def _write_items(self, items: List[Dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        normalized = [_normalize_item(item) for item in items]
        self.path.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
