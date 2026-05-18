# -*- coding: utf-8 -*-
"""Helpers for extracting analysis-time price fields from persisted records."""

from __future__ import annotations

from typing import Any, Optional, Tuple


def extract_price_fields(raw_result: dict, context_snapshot: Optional[dict] = None) -> Tuple[Any, Any, Any]:
    """Extract price/change/date fields from close-price records and legacy realtime snapshots."""
    current_price = raw_result.get("current_price") if isinstance(raw_result, dict) else None
    change_pct = raw_result.get("change_pct") if isinstance(raw_result, dict) else None
    price_date = raw_result.get("price_date") if isinstance(raw_result, dict) else None

    if not isinstance(context_snapshot, dict):
        return current_price, change_pct, price_date

    enhanced_context = context_snapshot.get("enhanced_context")
    if not isinstance(enhanced_context, dict):
        enhanced_context = {}

    today = enhanced_context.get("today")
    if isinstance(today, dict):
        if current_price is None:
            current_price = today.get("close")
        if change_pct is None:
            change_pct = today.get("pct_chg")
        if price_date is None:
            price_date = today.get("date")

    latest_close_quote = context_snapshot.get("latest_close_quote")
    if not isinstance(latest_close_quote, dict):
        latest_close_quote = enhanced_context.get("latest_close_quote")
    if isinstance(latest_close_quote, dict):
        if current_price is None:
            current_price = latest_close_quote.get("close")
        if current_price is None:
            current_price = latest_close_quote.get("price")
        if change_pct is None:
            change_pct = latest_close_quote.get("change_pct")
        if change_pct is None:
            change_pct = latest_close_quote.get("pct_chg")
        if price_date is None:
            price_date = latest_close_quote.get("date")

    realtime = enhanced_context.get("realtime")
    if isinstance(realtime, dict):
        if current_price is None:
            current_price = realtime.get("price")
        if change_pct is None:
            change_pct = realtime.get("change_pct")

    realtime_quote_raw = context_snapshot.get("realtime_quote_raw")
    if isinstance(realtime_quote_raw, dict):
        if current_price is None:
            current_price = realtime_quote_raw.get("price")
        if change_pct is None:
            change_pct = realtime_quote_raw.get("change_pct")
        if change_pct is None:
            change_pct = realtime_quote_raw.get("pct_chg")

    return current_price, change_pct, price_date
