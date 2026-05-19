# -*- coding: utf-8 -*-
"""DuckDB-backed historical A-share market data access."""

from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import Path
from typing import Optional, Tuple

import pandas as pd

from data_provider.base import canonical_stock_code, normalize_stock_code
from src.config import get_config

logger = logging.getLogger(__name__)

SUPPORTED_ADJUSTMENTS = {"qfq", "raw"}


def normalize_adjustment(value: Optional[str]) -> str:
    adjustment = (value or "qfq").strip().lower()
    return adjustment if adjustment in SUPPORTED_ADJUSTMENTS else "qfq"


def _coerce_date(value: date | datetime | str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


class MarketHistoryStore:
    """Read normalized daily bars from the optional large DuckDB history store."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        config = get_config()
        self.db_path = Path(db_path or config.market_history_duckdb_path)

    @staticmethod
    def is_enabled() -> bool:
        config = get_config()
        return bool(config.market_history_enabled and config.market_history_duckdb_path)

    def available(self) -> bool:
        return self.db_path.exists() and self.db_path.is_file()

    def get_daily_data(
        self,
        stock_code: str,
        *,
        start: date,
        end: date,
        adjustment: Optional[str] = None,
    ) -> Tuple[Optional[pd.DataFrame], str]:
        """Return daily bars for one stock code.

        The returned frame matches the columns expected by ``load_history_df``.
        Missing or disabled stores return ``(None, "market_history_unavailable")``.
        """
        if not self.available():
            return None, "market_history_unavailable"

        try:
            import duckdb
        except ImportError:
            logger.debug("DuckDB is not installed; market history store is unavailable")
            return None, "market_history_missing_duckdb"

        normalized_code = canonical_stock_code(normalize_stock_code(str(stock_code or "").strip()))
        if not normalized_code:
            return None, "market_history_bad_code"

        adjusted = normalize_adjustment(adjustment or get_config().market_history_default_adjustment)
        start_date = _coerce_date(start).isoformat()
        end_date = _coerce_date(end).isoformat()

        sql = """
            SELECT
                code,
                trade_date AS date,
                open,
                high,
                low,
                close,
                volume,
                amount,
                pct_chg,
                ma5,
                ma10,
                ma20,
                volume_ratio,
                'market_history_' || adjustment AS data_source
            FROM stock_daily_history
            WHERE code = ?
              AND adjustment = ?
              AND trade_date BETWEEN ? AND ?
            ORDER BY trade_date
        """
        try:
            with duckdb.connect(str(self.db_path), read_only=True) as conn:
                df = conn.execute(sql, [normalized_code, adjusted, start_date, end_date]).df()
        except Exception as exc:
            logger.debug("market history read failed for %s: %s", normalized_code, exc)
            return None, "market_history_error"

        if df.empty:
            return None, "market_history_empty"
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"]).dt.date
        return df, f"market_history_{adjusted}"

    def get_latest_snapshot(self, *, adjustment: Optional[str] = None) -> Tuple[Optional[pd.DataFrame], str]:
        """Return the latest full-market daily snapshot from DuckDB."""
        if not self.available():
            return None, "market_history_unavailable"

        try:
            import duckdb
        except ImportError:
            logger.debug("DuckDB is not installed; market history store is unavailable")
            return None, "market_history_missing_duckdb"

        adjusted = normalize_adjustment(adjustment or get_config().market_history_default_adjustment)
        sql = """
            SELECT *
            FROM stock_daily_history
            WHERE adjustment = ?
              AND trade_date = (
                  SELECT MAX(trade_date)
                  FROM stock_daily_history
                  WHERE adjustment = ?
              )
        """
        try:
            with duckdb.connect(str(self.db_path), read_only=True) as conn:
                df = conn.execute(sql, [adjusted, adjusted]).df()
        except Exception as exc:
            logger.debug("market history latest snapshot read failed: %s", exc)
            return None, "market_history_error"

        if df.empty:
            return None, "market_history_empty"
        return df, f"market_history_{adjusted}"

    def run_latest_snapshot_query(
        self,
        *,
        where_clauses: list[str],
        order_by: Optional[str] = None,
        limit: int = 30,
        adjustment: Optional[str] = None,
    ) -> Tuple[Optional[pd.DataFrame], str]:
        """Run a bounded full-market query against the latest daily snapshot."""
        if not self.available():
            return None, "market_history_unavailable"

        try:
            import duckdb
        except ImportError:
            logger.debug("DuckDB is not installed; market history store is unavailable")
            return None, "market_history_missing_duckdb"

        adjusted = normalize_adjustment(adjustment or get_config().market_history_default_adjustment)
        where_sql = " AND ".join([clause for clause in where_clauses if clause.strip()]) or "TRUE"
        order_sql = order_by or "total_mv DESC NULLS LAST"
        sql = f"""
            WITH latest AS (
                SELECT MAX(trade_date) AS trade_date
                FROM stock_daily_history
                WHERE adjustment = ?
            ),
            previous AS (
                SELECT
                    code,
                    ma60 AS prev_ma60,
                    ROW_NUMBER() OVER (PARTITION BY code ORDER BY trade_date DESC) AS rn
                FROM stock_daily_history
                WHERE adjustment = ?
                  AND trade_date < (SELECT trade_date FROM latest)
            )
            SELECT
                h.*,
                p.prev_ma60
            FROM stock_daily_history h
            LEFT JOIN previous p ON p.code = h.code AND p.rn = 1
            WHERE h.adjustment = ?
              AND h.trade_date = (SELECT trade_date FROM latest)
              AND {where_sql}
            ORDER BY {order_sql}
            LIMIT ?
        """
        try:
            with duckdb.connect(str(self.db_path), read_only=True) as conn:
                df = conn.execute(sql, [adjusted, adjusted, adjusted, max(1, int(limit))]).df()
        except Exception as exc:
            logger.debug("market history screener query failed: %s", exc)
            return None, "market_history_error"

        if df.empty:
            return None, "market_history_empty"
        return df, f"market_history_{adjusted}"


def load_market_history_df(
    stock_code: str,
    *,
    start: date,
    end: date,
    adjustment: Optional[str] = None,
) -> Tuple[Optional[pd.DataFrame], str]:
    """Convenience wrapper used by Agent/history paths."""
    if not MarketHistoryStore.is_enabled():
        return None, "market_history_disabled"
    return MarketHistoryStore().get_daily_data(
        stock_code,
        start=start,
        end=end,
        adjustment=adjustment,
    )
