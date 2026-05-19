# -*- coding: utf-8 -*-
"""Tests for local screener service."""

from __future__ import annotations

import os
import sys
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services.screener_service import ScreenerService
from src.services.screener_service import _build_local_query_plan
from src.services.screener_strategy_library_service import ScreenerStrategyLibraryService


def _sample_history(days: int = 80) -> pd.DataFrame:
    rows = []
    for i in range(days):
        close = 10 + i * 0.12
        rows.append(
            {
                "date": f"2026-03-{(i % 28) + 1:02d}",
                "open": close - 0.08,
                "high": close + 0.2,
                "low": close - 0.2,
                "close": close,
                "volume": 1000000 + i * 10000,
                "amount": 10000000 + i * 100000,
            }
        )
    return pd.DataFrame(rows)


class TestScreenerService(unittest.TestCase):
    def test_run_uses_local_data_when_iwencai_has_no_query(self) -> None:
        manager = Mock()
        manager.get_stock_name.return_value = "测试股票"

        with (
            patch("src.services.screener_service.load_history_df", return_value=(_sample_history(), "unit-test")),
            patch("src.services.screener_service.get_config") as get_config,
            patch("data_provider.DataFetcherManager", return_value=manager),
        ):
            get_config.return_value.stock_list = ["600519"]
            result = ScreenerService().run(
                strategy_ids=["trend_follow", "breakout"],
                stock_codes=None,
                limit=10,
                include_fundamentals=False,
                use_iwencai=True,
            )

        self.assertEqual(result["total_input"], 1)
        self.assertEqual(result["iwencai_status"], "disabled")
        self.assertEqual(result["execution_mode"], "local_pool")
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["candidates"][0]["code"], "600519")
        self.assertIn("trend_follow", result["candidates"][0]["matched_strategies"])
        manager.get_stock_name.assert_called_once_with("600519", allow_realtime=False)
        manager.get_fundamental_context.assert_not_called()

    @patch("src.services.screener_service.MarketHistoryStore.is_enabled", return_value=True)
    def test_run_query_returns_import_required_for_unsupported_terms(self, _enabled) -> None:
        result = ScreenerService().run(
            strategy_ids=["trend_follow"],
            stock_codes=None,
            include_fundamentals=False,
            use_iwencai=False,
            iwencai_query="卖出信号;买入信号;",
        )

        self.assertFalse(result["local_executable"])
        self.assertTrue(result["import_required"])
        self.assertIn("卖出信号", result["unsupported_terms"])
        self.assertEqual(result["iwencai_status"], "disabled")

    def test_pe_pb_less_than_filters_exclude_non_positive_values(self) -> None:
        plan = _build_local_query_plan("PE小于25，PB小于3")

        self.assertIn("h.pe_ttm > 0", plan.where_clauses[0])
        self.assertIn("h.pb > 0", plan.where_clauses[1])

    @patch("src.services.screener_service.MarketHistoryStore.is_enabled", return_value=True)
    @patch("src.services.screener_service.MarketHistoryStore.run_latest_snapshot_query")
    def test_run_query_reports_history_store_unavailable(self, query_mock, _enabled) -> None:
        query_mock.return_value = (None, "market_history_unavailable")

        result = ScreenerService().run(
            strategy_ids=["trend_follow"],
            stock_codes=None,
            include_fundamentals=False,
            use_iwencai=False,
            iwencai_query="PE小于25，PB小于3，非ST",
        )

        self.assertFalse(result["local_executable"])
        self.assertTrue(result["import_required"])
        self.assertEqual(result["data_mode"], "market_history_unavailable")
        self.assertIn("本地历史库文件不可用", result["notes"][0])

    def test_import_iwencai_excel_converts_rows_to_candidates(self) -> None:
        buffer = BytesIO()
        df = pd.DataFrame([
            {
                "股票代码": "600519.SH",
                "股票简称": "贵州茅台",
                "涨跌幅(%)": 1.2,
                "收盘价:不复权(元)\n2026.05.19": 1688.0,
                "买入信号\n2026.05.19": "kdj金叉",
            }
        ])
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="选股结果")

        result = ScreenerService().import_iwencai_excel(buffer.getvalue(), filename="iwencai.xlsx")

        self.assertEqual(result["execution_mode"], "iwencai_import")
        self.assertEqual(result["candidates"][0]["code"], "600519")
        self.assertEqual(result["candidates"][0]["name"], "贵州茅台")
        self.assertEqual(result["candidates"][0]["latest_date"], "2026-05-19")
        self.assertIn("买入信号 2026.05.19", result["candidates"][0]["iwencai_fields"])

    def test_include_fundamentals_adds_quality_metrics(self) -> None:
        manager = Mock()
        manager.get_stock_name.return_value = "测试股票"
        manager.get_fundamental_context.return_value = {
            "valuation": {"data": {"pe_ttm": 18.5, "pb_ratio": 2.2}},
            "growth": {"data": {"roe": 13.2, "revenue_yoy": 8.1, "net_profit_yoy": 5.5}},
            "earnings": {"data": {}},
        }

        with (
            patch("src.services.screener_service.load_history_df", return_value=(_sample_history(), "unit-test")),
            patch("data_provider.DataFetcherManager", return_value=manager),
        ):
            result = ScreenerService().run(
                strategy_ids=["quality_value"],
                stock_codes=["600519"],
                include_fundamentals=True,
            )

        metrics = result["candidates"][0]["metrics"]
        self.assertEqual(metrics["pe_ratio"], 18.5)
        self.assertEqual(metrics["roe"], 13.2)
        self.assertIn("quality_value", result["candidates"][0]["matched_strategies"])
        manager.get_fundamental_context.assert_called_once_with("600519")


class TestScreenerStrategyLibraryService(unittest.TestCase):
    def test_library_creates_defaults_when_missing(self) -> None:
        from tempfile import TemporaryDirectory
        from pathlib import Path

        with TemporaryDirectory() as tmpdir:
            service = ScreenerStrategyLibraryService(Path(tmpdir) / "library.json")
            items = service.list_items()

        self.assertGreaterEqual(len(items), 1)
        self.assertIn("name", items[0])
        self.assertIn("query", items[0])
        self.assertEqual(items[0]["backtest_status"], "等待历史数据")

    def test_library_create_update_and_last_run(self) -> None:
        from tempfile import TemporaryDirectory
        from pathlib import Path

        with TemporaryDirectory() as tmpdir:
            service = ScreenerStrategyLibraryService(Path(tmpdir) / "library.json")
            item = service.create_item({
                "name": "KDJ MACD",
                "description": "双金叉策略",
                "query": "kdj金叉，macd金叉，非ST",
            })
            updated = service.update_item(item["id"], {
                "name": "KDJ MACD 优化",
                "description": "双金叉并过滤ST",
                "query": "kdj金叉，macd金叉，非ST，成交额大于2亿",
            })
            service.update_last_run(item["id"], "导入候选 12 只")
            items = service.list_items()

        saved = next(current for current in items if current["id"] == item["id"])
        self.assertEqual(updated["name"], "KDJ MACD 优化")
        self.assertEqual(saved["last_run_result"], "导入候选 12 只")


if __name__ == "__main__":
    unittest.main()
