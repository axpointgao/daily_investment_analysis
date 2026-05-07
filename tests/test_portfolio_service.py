# -*- coding: utf-8 -*-
"""Unit tests for portfolio replay service (P0 PR1 scope)."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
from unittest.mock import patch

import pandas as pd
from sqlalchemy.exc import OperationalError
from sqlalchemy import select

from src.config import Config
from src.repositories.portfolio_repo import PortfolioBusyError, PortfolioRepository
from src.services.portfolio_service import _AvgState, _ResolvedPositionPrice, PortfolioConflictError, PortfolioOversellError, PortfolioService
from src.storage import DatabaseManager, PortfolioDailySnapshot, PortfolioPosition, PortfolioPositionLot, PortfolioTrade


class PortfolioServiceTestCase(unittest.TestCase):
    """Portfolio service replay tests for FIFO/AVG and corporate actions."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.db_path = Path(self.temp_dir.name) / "portfolio_test.db"
        self.env_path.write_text(
            "\n".join(
                [
                    "STOCK_LIST=600519",
                    "GEMINI_API_KEY=test",
                    "ADMIN_AUTH_ENABLED=false",
                    f"DATABASE_PATH={self.db_path}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        os.environ["ENV_FILE"] = str(self.env_path)
        os.environ["DATABASE_PATH"] = str(self.db_path)
        Config.reset_instance()
        DatabaseManager.reset_instance()

        self.db = DatabaseManager.get_instance()
        self.service = PortfolioService()

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()
        Config.reset_instance()
        os.environ.pop("ENV_FILE", None)
        os.environ.pop("DATABASE_PATH", None)
        self.temp_dir.cleanup()

    def _save_close(self, symbol: str, on_date: date, close: float) -> None:
        df = pd.DataFrame(
            [
                {
                    "date": on_date,
                    "open": close,
                    "high": close,
                    "low": close,
                    "close": close,
                    "volume": 1.0,
                    "amount": close,
                    "pct_chg": 0.0,
                }
            ]
        )
        self.db.save_daily_data(df, code=symbol, data_source="unit-test")

    def _create_account_with_position(
        self,
        *,
        market: str,
        currency: str,
        symbol: str,
        quantity: float = 10.0,
        price: float = 100.0,
        close: Optional[float] = None,
        close_date: Optional[date] = None,
    ) -> int:
        account = self.service.create_account(name=f"{market}-account", broker="Demo", market=market, base_currency=currency)
        aid = account["id"]
        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=100000,
            currency=currency,
        )
        self.service.record_trade(
            account_id=aid,
            symbol=symbol,
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=quantity,
            price=price,
            market=market,
            currency=currency,
        )
        if close is not None:
            self._save_close(self.service._normalize_symbol(symbol), close_date or date(2026, 1, 3), close)
        return aid

    def test_current_snapshot_uses_realtime_price_when_close_missing(self) -> None:
        today = date.today()
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=today,
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )

        with patch.object(PortfolioService, "_fetch_realtime_position_price", return_value=(125.0, "unit-test")):
            snapshot = self.service.get_portfolio_snapshot(
                account_id=aid,
                as_of=today,
                cost_method="fifo",
                refresh_prices=True,
            )

        pos = snapshot["accounts"][0]["positions"][0]
        self.assertAlmostEqual(pos["last_price"], 125.0, places=6)
        self.assertAlmostEqual(pos["market_value_base"], 1250.0, places=6)
        self.assertAlmostEqual(pos["unrealized_pnl_base"], 250.0, places=6)

    def test_snapshot_adds_product_tags_breakdown_and_annualized_return(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 1),
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", date(2027, 1, 1), 110)

        initial = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2027, 1, 1), cost_method="fifo")
        position = initial["accounts"][0]["positions"][0]
        self.assertTrue(position["product_key"])
        self.assertIsNone(position["tag_id"])
        self.assertEqual(position["valuation_model"], "unit_price")
        self.assertEqual(position["cost_display_value"], 100.0)
        self.assertEqual(position["price_display_value"], 110.0)
        self.assertAlmostEqual(position["annualized_return_pct"], 10.0, places=1)

        tag = self.service.create_tag(name="长期核心", color="hsl(var(--primary))")
        self.service.set_product_tag(product_key=position["product_key"], tag_id=tag["id"])
        tagged = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2027, 1, 1), cost_method="fifo")
        tagged_position = tagged["accounts"][0]["positions"][0]

        self.assertEqual(tagged_position["tag_name"], "长期核心")
        self.assertEqual(tagged["tag_breakdown"][0]["tag_name"], "长期核心")
        self.assertAlmostEqual(tagged["tag_breakdown"][0]["amount"], 1100.0, places=6)
        self.assertNotIn("__cash__", {item["key"] for item in tagged["tag_breakdown"]})

    def test_current_snapshot_uses_close_before_realtime_fallback(self) -> None:
        today = date.today()
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=today,
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", today, 118.0)

        with patch.object(
            PortfolioService,
            "_fetch_realtime_position_price",
            side_effect=AssertionError("close price should be used before realtime fallback"),
        ):
            snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=today, cost_method="fifo")

        pos = snapshot["accounts"][0]["positions"][0]
        self.assertAlmostEqual(pos["last_price"], 118.0, places=6)
        self.assertAlmostEqual(pos["market_value_base"], 1180.0, places=6)
        self.assertAlmostEqual(pos["unrealized_pnl_base"], 180.0, places=6)
        self.assertEqual(pos["price_source"], "history_close")
        self.assertTrue(pos["price_available"])

    def test_current_snapshot_defaults_to_skip_online_realtime_price(self) -> None:
        today = date.today()
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=today,
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )

        with patch.object(
            PortfolioService,
            "_fetch_realtime_position_price",
            side_effect=AssertionError("default snapshot should not fetch online quote"),
        ):
            snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=today, cost_method="fifo")

        pos = snapshot["accounts"][0]["positions"][0]
        self.assertEqual(pos["price_source"], "missing")
        self.assertFalse(pos["price_available"])

    def test_cached_snapshot_is_used_when_prices_are_not_refreshed(self) -> None:
        today = date.today()
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=today,
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )

        with patch.object(PortfolioService, "_fetch_realtime_position_price", return_value=(125.0, "unit-test")):
            refreshed = self.service.get_portfolio_snapshot(
                account_id=aid,
                as_of=today,
                cost_method="fifo",
                refresh_prices=True,
            )

        with patch.object(
            PortfolioService,
            "_replay_account",
            side_effect=AssertionError("cached snapshot should avoid replay"),
        ):
            cached = self.service.get_portfolio_snapshot(account_id=aid, as_of=today, cost_method="fifo")

        self.assertEqual(cached["accounts"][0]["positions"][0]["price_source"], "realtime_quote")
        self.assertEqual(cached["accounts"][0]["positions"][0]["price_provider"], "unit-test")
        self.assertAlmostEqual(
            cached["accounts"][0]["total_market_value"],
            refreshed["accounts"][0]["total_market_value"],
            places=6,
        )

    def test_fund_display_name_does_not_use_stock_data_manager(self) -> None:
        with patch.object(
            PortfolioService,
            "_get_data_manager",
            side_effect=AssertionError("fund display name should not use stock data manager"),
        ):
            self.assertIsNone(self.service._resolve_position_display_name(symbol="000274", market="fund"))

    def test_service_initializes_data_manager_lazily(self) -> None:
        self.assertIsNone(self.service._data_manager)
        with patch("src.services.portfolio_service.DataFetcherManager", return_value=object()) as manager:
            self.assertIs(self.service._get_data_manager(), self.service._data_manager)
        manager.assert_called_once()

    def test_historical_snapshot_marks_missing_price_without_cost_fallback(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 1),
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )

        with patch.object(
            PortfolioService,
            "_fetch_realtime_position_price",
            side_effect=AssertionError("historical snapshot should not fetch realtime quote"),
        ):
            snapshot = self.service.get_portfolio_snapshot(
                account_id=aid,
                as_of=date(2026, 1, 2),
                cost_method="fifo",
            )

        pos = snapshot["accounts"][0]["positions"][0]
        self.assertEqual(pos["last_price"], 0.0)
        self.assertEqual(pos["market_value_base"], 0.0)
        self.assertEqual(pos["unrealized_pnl_base"], 0.0)
        self.assertEqual(pos["price_source"], "missing")
        self.assertFalse(pos["price_available"])
        self.assertTrue(pos["price_stale"])
        self.assertEqual(snapshot["accounts"][0]["total_market_value"], 0.0)
        self.assertEqual(snapshot["accounts"][0]["unrealized_pnl"], 0.0)

    def test_snapshot_fifo_vs_avg_on_partial_sell(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=100000,
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=100,
            price=10,
            fee=10,
            tax=0,
            market="cn",
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 3),
            side="buy",
            quantity=100,
            price=20,
            fee=10,
            tax=0,
            market="cn",
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 4),
            side="sell",
            quantity=150,
            price=30,
            fee=10,
            tax=5,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", date(2026, 1, 5), 25)

        fifo = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 5), cost_method="fifo")
        avg = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 5), cost_method="avg")

        fifo_acc = fifo["accounts"][0]
        avg_acc = avg["accounts"][0]
        self.assertAlmostEqual(fifo_acc["total_equity"], avg_acc["total_equity"], places=6)

        self.assertAlmostEqual(fifo_acc["realized_pnl"], 2470.0, places=6)
        self.assertAlmostEqual(avg_acc["realized_pnl"], 2220.0, places=6)
        self.assertAlmostEqual(fifo_acc["unrealized_pnl"], 245.0, places=6)
        self.assertAlmostEqual(avg_acc["unrealized_pnl"], 495.0, places=6)

        self.assertEqual(len(fifo_acc["positions"]), 1)
        self.assertEqual(len(avg_acc["positions"]), 1)
        self.assertAlmostEqual(fifo_acc["positions"][0]["quantity"], 50.0, places=6)
        self.assertAlmostEqual(avg_acc["positions"][0]["quantity"], 50.0, places=6)

    def test_snapshot_position_price_metadata_uses_backend_values_for_cn_hk_us(self) -> None:
        for market, currency, symbol, close, expected_symbol in [
            ("cn", "CNY", "600519", 12.5, "600519"),
            ("hk", "HKD", "hk700", 420.0, "HK00700"),
            ("us", "USD", "aapl", 210.0, "AAPL"),
        ]:
            with self.subTest(market=market):
                aid = self._create_account_with_position(market=market, currency=currency, symbol=symbol, close=close)
                position = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 3), cost_method="fifo")["accounts"][0]["positions"][0]

                self.assertEqual(position["symbol"], expected_symbol)
                self.assertEqual(position["price_source"], "history_close")
                self.assertEqual(position["price_date"], "2026-01-03")
                self.assertFalse(position["price_stale"])
                self.assertTrue(position["price_available"])
                self.assertAlmostEqual(position["last_price"], close, places=6)
                self.assertAlmostEqual(position["market_value_base"], close * 10, places=6)
                self.assertAlmostEqual(position["unrealized_pnl_base"], close * 10 - 1000, places=6)
                self.assertAlmostEqual(position["unrealized_pnl_pct"], (close * 10 - 1000) / 1000 * 100, places=6)

    def test_snapshot_marks_stale_close_and_missing_price(self) -> None:
        aid = self._create_account_with_position(
            market="cn",
            currency="CNY",
            symbol="600519",
            close=110,
            close_date=date(2026, 1, 2),
        )
        self.service.record_trade(
            account_id=aid,
            symbol="000001",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=5,
            price=20,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", date(2026, 1, 2), 110)

        snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 3), cost_method="fifo")
        positions = {item["symbol"]: item for item in snapshot["accounts"][0]["positions"]}

        stale_close = positions["600519"]
        self.assertEqual(stale_close["price_source"], "history_close")
        self.assertEqual(stale_close["price_date"], "2026-01-02")
        self.assertTrue(stale_close["price_stale"])
        self.assertTrue(stale_close["price_available"])
        self.assertAlmostEqual(stale_close["last_price"], 110.0, places=6)
        self.assertAlmostEqual(stale_close["unrealized_pnl_pct"], 10.0, places=6)

        missing = positions["000001"]
        self.assertEqual(missing["price_source"], "missing")
        self.assertIsNone(missing["price_date"])
        self.assertTrue(missing["price_stale"])
        self.assertFalse(missing["price_available"])
        self.assertAlmostEqual(missing["last_price"], 0.0, places=6)
        self.assertAlmostEqual(missing["market_value_base"], 0.0, places=6)
        self.assertAlmostEqual(missing["unrealized_pnl_base"], 0.0, places=6)
        self.assertIsNone(missing["unrealized_pnl_pct"])

    def test_build_positions_handles_zero_cost_without_division(self) -> None:
        account = SimpleNamespace(base_currency="CNY")

        positions, _, _, _, _ = self.service._build_positions(
            account=SimpleNamespace(id=1, base_currency="CNY"),
            as_of_date=date(2026, 1, 3),
            cost_method="avg",
            fifo_lots={},
            avg_state={("AAPL", "us", "USD"): _AvgState(quantity=10.0, total_cost=0.0)},
            refresh_prices=False,
        )

        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["price_source"], "missing")
        self.assertIsNone(positions[0]["unrealized_pnl_pct"])
        self.assertAlmostEqual(positions[0]["last_price"], 0.0, places=6)

    def test_symbol_filter_matches_legacy_prefix_suffix_variants(self) -> None:
        account = self.service.create_account(name="Legacy", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        for symbol in ["600519", "SH600519", "600519.SH", "600519.SS"]:
            self.service.repo.add_trade(
                account_id=aid,
                trade_uid=None,
                symbol=symbol,
                market="cn",
                currency="CNY",
                trade_date=date(2026, 1, 2),
                side="buy",
                quantity=1,
                price=10,
                fee=0,
                tax=0,
            )

        rows = self.service.list_trade_events(account_id=aid, symbol="600519", page=1, page_size=20)["items"]
        self.assertEqual({row["symbol"] for row in rows}, {"600519", "SH600519", "600519.SH", "600519.SS"})

    def test_symbol_filter_matches_legacy_hk_variants(self) -> None:
        account = self.service.create_account(name="Legacy HK", broker="Demo", market="hk", base_currency="HKD")
        aid = account["id"]
        for symbol in ["HK00700", "HK700", "00700.HK", "700.HK"]:
            self.service.repo.add_trade(
                account_id=aid,
                trade_uid=None,
                symbol=symbol,
                market="hk",
                currency="HKD",
                trade_date=date(2026, 1, 2),
                side="buy",
                quantity=1,
                price=10,
                fee=0,
                tax=0,
            )

        rows = self.service.list_trade_events(account_id=aid, symbol="HK00700", page=1, page_size=20)["items"]
        self.assertEqual({row["symbol"] for row in rows}, {"HK00700", "HK700", "00700.HK", "700.HK"})

    def test_explicit_exchange_symbol_filter_does_not_match_other_exchanges(self) -> None:
        account = self.service.create_account(name="Mixed", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        for symbol in ["SH000001", "SZ000001", "000001.SH", "000001.SZ"]:
            self.service.repo.add_trade(
                account_id=aid,
                trade_uid=None,
                symbol=symbol,
                market="cn",
                currency="CNY",
                trade_date=date(2026, 1, 2),
                side="buy",
                quantity=1,
                price=10,
                fee=0,
                tax=0,
            )

        rows = self.service.list_trade_events(account_id=aid, symbol="SH000001", page=1, page_size=20)["items"]
        self.assertEqual({row["symbol"] for row in rows}, {"SH000001", "000001.SH"})

    def test_explicit_exchange_symbols_are_preserved_in_position_snapshot_and_validation(self) -> None:
        account = self.service.create_account(name="Explicit", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=10000,
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="SH000001",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=1,
            price=10,
            currency="CNY",
            market="cn",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="000001.SZ",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=1,
            price=10,
            currency="CNY",
            market="cn",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="BJ920748",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=1,
            price=10,
            currency="CNY",
            market="cn",
        )

        sh_trades = self.service.list_trade_events(account_id=aid, symbol="SH000001", page=1, page_size=20)["items"]
        sz_trades = self.service.list_trade_events(account_id=aid, symbol="000001.SZ", page=1, page_size=20)["items"]
        bj_trades = self.service.list_trade_events(account_id=aid, symbol="BJ920748", page=1, page_size=20)["items"]
        self.assertEqual(sh_trades[0]["symbol"], "SH000001")
        self.assertEqual(sz_trades[0]["symbol"], "000001.SZ")
        self.assertEqual(bj_trades[0]["symbol"], "BJ920748")

        snapshot = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 4),
            cost_method="fifo",
        )
        symbols = {item["symbol"] for item in snapshot["accounts"][0]["positions"]}
        self.assertEqual(symbols, {"SH000001", "SZ000001", "BJ920748"})

        with self.assertRaises(PortfolioOversellError):
            self.service.record_trade(
                account_id=aid,
                symbol="SZ000001",
                trade_date=date(2026, 1, 5),
                side="sell",
                quantity=2,
                price=10,
                market="cn",
                currency="CNY",
            )

    def test_corporate_actions_dividend_and_split(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=10000,
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=100,
            price=10,
            fee=0,
            tax=0,
            market="cn",
            currency="CNY",
        )
        self.service.record_corporate_action(
            account_id=aid,
            symbol="600519",
            effective_date=date(2026, 1, 3),
            action_type="cash_dividend",
            market="cn",
            currency="CNY",
            cash_dividend_per_share=1.0,
        )
        self.service.record_corporate_action(
            account_id=aid,
            symbol="600519",
            effective_date=date(2026, 1, 4),
            action_type="split_adjustment",
            market="cn",
            currency="CNY",
            split_ratio=2.0,
        )
        self._save_close("600519", date(2026, 1, 5), 6.0)

        snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 5), cost_method="fifo")
        acc = snapshot["accounts"][0]
        pos = acc["positions"][0]

        self.assertAlmostEqual(acc["total_cash"], 9100.0, places=6)
        self.assertAlmostEqual(acc["total_market_value"], 1200.0, places=6)
        self.assertAlmostEqual(acc["total_equity"], 10300.0, places=6)
        self.assertAlmostEqual(pos["quantity"], 200.0, places=6)
        self.assertAlmostEqual(pos["avg_cost"], 5.0, places=6)

    def test_normalize_symbol_preserves_cn_exchange_prefix_and_suffix(self) -> None:
        self.assertEqual(self.service._normalize_symbol("sh600519"), "SH600519")
        self.assertEqual(self.service._normalize_symbol("600519.SH"), "SH600519")
        self.assertEqual(self.service._normalize_symbol("SZ000001"), "SZ000001")
        self.assertEqual(self.service._normalize_symbol("000001.SZ"), "SZ000001")

    def test_explicit_exchange_position_valuation_uses_exchange_qualified_symbol(self) -> None:
        account = self.service.create_account(name="Explicit Valuation", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=20000,
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="SH600519",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=1,
            price=10,
            currency="CNY",
            market="cn",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="000001.SZ",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=2,
            price=8,
            currency="CNY",
            market="cn",
        )
        self._save_close(self.service._normalize_symbol("SH600519"), date(2026, 1, 3), 12.0)
        self._save_close(self.service._normalize_symbol("000001.SZ"), date(2026, 1, 3), 9.0)

        snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 3), cost_method="fifo")
        positions = {item["symbol"]: item for item in snapshot["accounts"][0]["positions"]}
        self.assertEqual(set(positions), {"SH600519", "SZ000001"})
        self.assertEqual(positions["SH600519"]["price_source"], "history_close")
        self.assertAlmostEqual(positions["SH600519"]["last_price"], 12.0, places=6)
        self.assertEqual(positions["SZ000001"]["price_source"], "history_close")
        self.assertAlmostEqual(positions["SZ000001"]["last_price"], 9.0, places=6)

    def test_same_day_dividend_processed_before_trade(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=2000,
            currency="CNY",
        )
        self.service.record_corporate_action(
            account_id=aid,
            symbol="600519",
            effective_date=date(2026, 1, 2),
            action_type="cash_dividend",
            market="cn",
            currency="CNY",
            cash_dividend_per_share=1.0,
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=100,
            price=10,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", date(2026, 1, 2), 10.0)

        snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 2), cost_method="fifo")
        acc = snapshot["accounts"][0]

        self.assertAlmostEqual(acc["total_cash"], 1000.0, places=6)
        self.assertAlmostEqual(acc["total_market_value"], 1000.0, places=6)
        self.assertAlmostEqual(acc["total_equity"], 2000.0, places=6)

    def test_same_day_split_processed_before_trade(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=2000,
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 1),
            side="buy",
            quantity=100,
            price=10,
            market="cn",
            currency="CNY",
        )
        self.service.record_corporate_action(
            account_id=aid,
            symbol="600519",
            effective_date=date(2026, 1, 2),
            action_type="split_adjustment",
            market="cn",
            currency="CNY",
            split_ratio=2.0,
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="sell",
            quantity=100,
            price=6,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", date(2026, 1, 2), 6.0)

        snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 2), cost_method="fifo")
        acc = snapshot["accounts"][0]
        pos = acc["positions"][0]

        self.assertAlmostEqual(acc["realized_pnl"], 100.0, places=6)
        self.assertAlmostEqual(acc["total_cash"], 1600.0, places=6)
        self.assertAlmostEqual(pos["quantity"], 100.0, places=6)
        self.assertAlmostEqual(pos["avg_cost"], 5.0, places=6)

    def test_sell_oversell_rejected_before_write(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=10,
            price=10,
            market="cn",
            currency="CNY",
        )

        with self.assertRaises(PortfolioOversellError):
            self.service.record_trade(
                account_id=aid,
                symbol="600519",
                trade_date=date(2026, 1, 3),
                side="sell",
                quantity=20,
                price=11,
                market="cn",
                currency="CNY",
            )

        trades = self.service.list_trade_events(account_id=aid, page=1, page_size=20)
        self.assertEqual(len(trades["items"]), 1)
        self.assertEqual(trades["items"][0]["side"], "buy")

    def test_duplicate_full_close_sell_keeps_conflict_semantics(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 1),
            side="buy",
            quantity=10,
            price=10,
            market="cn",
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="sell",
            quantity=10,
            price=11,
            market="cn",
            currency="CNY",
            trade_uid="sell-full-close-1",
        )

        with self.assertRaises(PortfolioConflictError) as ctx:
            self.service.record_trade(
                account_id=aid,
                symbol="600519",
                trade_date=date(2026, 1, 2),
                side="sell",
                quantity=10,
                price=11,
                market="cn",
                currency="CNY",
                trade_uid="sell-full-close-1",
            )

        self.assertIn("Duplicate trade_uid", str(ctx.exception))

    def test_backdated_trade_write_invalidates_future_cache(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=10000,
            currency="CNY",
        )
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 3),
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", date(2026, 1, 3), 100.0)
        self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 3), cost_method="fifo")

        with self.db.get_session() as session:
            snapshot_count = session.execute(
                select(PortfolioDailySnapshot).where(PortfolioDailySnapshot.account_id == aid)
            ).scalars().all()
            position_count = session.execute(
                select(PortfolioPosition).where(PortfolioPosition.account_id == aid)
            ).scalars().all()
            lot_count = session.execute(
                select(PortfolioPositionLot).where(PortfolioPositionLot.account_id == aid)
            ).scalars().all()
        self.assertEqual(len(snapshot_count), 1)
        self.assertEqual(len(position_count), 1)
        self.assertEqual(len(lot_count), 1)

        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=5,
            price=80,
            market="cn",
            currency="CNY",
        )

        with self.db.get_session() as session:
            snapshot_rows = session.execute(
                select(PortfolioDailySnapshot).where(PortfolioDailySnapshot.account_id == aid)
            ).scalars().all()
            position_rows = session.execute(
                select(PortfolioPosition).where(PortfolioPosition.account_id == aid)
            ).scalars().all()
            lot_rows = session.execute(
                select(PortfolioPositionLot).where(PortfolioPositionLot.account_id == aid)
            ).scalars().all()
        self.assertEqual(len(snapshot_rows), 0)
        self.assertEqual(len(position_rows), 0)
        self.assertEqual(len(lot_rows), 0)

    def test_delete_trade_invalidates_cache_and_removes_source_event(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.record_cash_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=10000,
            currency="CNY",
        )
        trade = self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )
        self._save_close("600519", date(2026, 1, 2), 100.0)
        self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 2), cost_method="fifo")

        self.assertTrue(self.service.delete_trade_event(trade["id"]))

        with self.db.get_session() as session:
            trade_rows = session.execute(
                select(PortfolioTrade).where(PortfolioTrade.account_id == aid)
            ).scalars().all()
            snapshot_rows = session.execute(
                select(PortfolioDailySnapshot).where(PortfolioDailySnapshot.account_id == aid)
            ).scalars().all()
            lot_rows = session.execute(
                select(PortfolioPositionLot).where(PortfolioPositionLot.account_id == aid)
            ).scalars().all()
        self.assertEqual(len(trade_rows), 0)
        self.assertEqual(len(snapshot_rows), 0)
        self.assertEqual(len(lot_rows), 0)

    def test_concurrent_sell_race_allows_only_one_write(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 1),
            side="buy",
            quantity=10,
            price=10,
            market="cn",
            currency="CNY",
        )

        barrier = threading.Barrier(3)
        results: list[str] = []
        errors: list[Exception] = []

        def _worker(uid: str) -> None:
            svc = PortfolioService()
            barrier.wait()
            try:
                svc.record_trade(
                    account_id=aid,
                    symbol="600519",
                    trade_date=date(2026, 1, 2),
                    side="sell",
                    quantity=10,
                    price=11,
                    market="cn",
                    currency="CNY",
                    trade_uid=uid,
                )
                results.append(uid)
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)

        threads = [
            threading.Thread(target=_worker, args=(f"sell-race-{idx}",), daemon=True)
            for idx in range(2)
        ]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()

        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], PortfolioOversellError)

        trades = self.service.list_trade_events(account_id=aid, page=1, page_size=20)
        sell_count = sum(1 for item in trades["items"] if item["side"] == "sell")
        self.assertEqual(sell_count, 1)

    def test_concurrent_duplicate_full_close_sell_keeps_conflict_semantics(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]
        self.service.record_trade(
            account_id=aid,
            symbol="600519",
            trade_date=date(2026, 1, 1),
            side="buy",
            quantity=10,
            price=10,
            market="cn",
            currency="CNY",
        )

        barrier = threading.Barrier(3)
        results: list[str] = []
        errors: list[Exception] = []

        def _worker() -> None:
            svc = PortfolioService()
            barrier.wait()
            try:
                svc.record_trade(
                    account_id=aid,
                    symbol="600519",
                    trade_date=date(2026, 1, 2),
                    side="sell",
                    quantity=10,
                    price=11,
                    market="cn",
                    currency="CNY",
                    trade_uid="dup-race-sell-1",
                )
                results.append("ok")
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)

        threads = [threading.Thread(target=_worker, daemon=True) for _ in range(2)]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()

        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], PortfolioConflictError)
        self.assertIn("Duplicate trade_uid", str(errors[0]))

    def test_event_symbol_filters_match_legacy_prefixed_symbols(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.repo.add_trade(
            account_id=aid,
            trade_uid="legacy-prefixed-trade",
            symbol="SH600519",
            market="cn",
            currency="CNY",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=10,
            price=100,
            fee=0,
            tax=0,
        )
        self.service.repo.add_corporate_action(
            account_id=aid,
            symbol="SH600519",
            market="cn",
            currency="CNY",
            effective_date=date(2026, 1, 3),
            action_type="cash_dividend",
            cash_dividend_per_share=1.0,
        )

        trades = self.service.list_trade_events(account_id=aid, symbol="600519", page=1, page_size=20)
        actions = self.service.list_corporate_action_events(account_id=aid, symbol="600519", page=1, page_size=20)

        self.assertEqual(trades["total"], 1)
        self.assertEqual(actions["total"], 1)
        self.assertEqual(trades["items"][0]["symbol"], "SH600519")
        self.assertEqual(actions["items"][0]["symbol"], "SH600519")

    def test_event_symbol_filters_match_legacy_suffix_symbols(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        aid = account["id"]

        self.service.repo.add_trade(
            account_id=aid,
            trade_uid="legacy-suffix-trade",
            symbol="600519.SH",
            market="cn",
            currency="CNY",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=10,
            price=100,
            fee=0,
            tax=0,
        )
        self.service.repo.add_corporate_action(
            account_id=aid,
            symbol="600519.SH",
            market="cn",
            currency="CNY",
            effective_date=date(2026, 1, 3),
            action_type="cash_dividend",
            cash_dividend_per_share=1.0,
        )

        trades = self.service.list_trade_events(account_id=aid, symbol="600519", page=1, page_size=20)
        actions = self.service.list_corporate_action_events(account_id=aid, symbol="600519", page=1, page_size=20)

        self.assertEqual(trades["total"], 1)
        self.assertEqual(actions["total"], 1)
        self.assertEqual(trades["items"][0]["symbol"], "600519.SH")
        self.assertEqual(actions["items"][0]["symbol"], "600519.SH")

    def test_event_symbol_filters_match_legacy_hk_variants(self) -> None:
        account = self.service.create_account(name="Main", broker="Demo", market="hk", base_currency="HKD")
        aid = account["id"]

        self.service.repo.add_trade(
            account_id=aid,
            trade_uid="legacy-hk-prefixed-trade",
            symbol="HK700",
            market="hk",
            currency="HKD",
            trade_date=date(2026, 1, 2),
            side="buy",
            quantity=10,
            price=400,
            fee=0,
            tax=0,
        )
        self.service.repo.add_trade(
            account_id=aid,
            trade_uid="legacy-hk-suffix-trade",
            symbol="00700.HK",
            market="hk",
            currency="HKD",
            trade_date=date(2026, 1, 3),
            side="buy",
            quantity=5,
            price=410,
            fee=0,
            tax=0,
        )
        self.service.repo.add_trade(
            account_id=aid,
            trade_uid="legacy-hk-short-suffix-trade",
            symbol="700.HK",
            market="hk",
            currency="HKD",
            trade_date=date(2026, 1, 4),
            side="buy",
            quantity=3,
            price=415,
            fee=0,
            tax=0,
        )
        self.service.repo.add_corporate_action(
            account_id=aid,
            symbol="HK700",
            market="hk",
            currency="HKD",
            effective_date=date(2026, 1, 4),
            action_type="cash_dividend",
            cash_dividend_per_share=1.0,
        )
        self.service.repo.add_corporate_action(
            account_id=aid,
            symbol="00700.HK",
            market="hk",
            currency="HKD",
            effective_date=date(2026, 1, 5),
            action_type="cash_dividend",
            cash_dividend_per_share=1.5,
        )
        self.service.repo.add_corporate_action(
            account_id=aid,
            symbol="700.HK",
            market="hk",
            currency="HKD",
            effective_date=date(2026, 1, 6),
            action_type="cash_dividend",
            cash_dividend_per_share=2.0,
        )

        trades = self.service.list_trade_events(account_id=aid, symbol="HK00700", page=1, page_size=20)
        actions = self.service.list_corporate_action_events(account_id=aid, symbol="HK00700", page=1, page_size=20)

        self.assertEqual(trades["total"], 3)
        self.assertEqual(actions["total"], 3)
        self.assertEqual({item["symbol"] for item in trades["items"]}, {"HK700", "00700.HK", "700.HK"})
        self.assertEqual({item["symbol"] for item in actions["items"]}, {"HK700", "00700.HK", "700.HK"})

    def test_portfolio_write_session_maps_sqlite_locked_error(self) -> None:
        repo = PortfolioRepository(db_manager=self.db)
        session = self.db.get_session()
        stmt_exc = OperationalError(
            "BEGIN IMMEDIATE",
            None,
            sqlite3.OperationalError("database is locked"),
        )

        with patch.object(self.db, "get_session", return_value=session):
            with patch.object(
                session.connection(),
                "exec_driver_sql",
                side_effect=stmt_exc,
            ):
                with self.assertRaises(PortfolioBusyError):
                    with repo.portfolio_write_session():
                        pass

    def test_bank_account_supports_demand_deposit_and_wealth_value_updates(self) -> None:
        account = self.service.create_account(name="Bank", broker="CMB", market="bank", base_currency="CNY")
        aid = account["id"]

        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            asset_kind="demand",
            direction="in",
            amount=10000,
            bank_name="招商银行",
            currency="CNY",
        )
        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 2),
            asset_kind="term",
            direction="in",
            amount=50000,
            bank_name="招商银行",
            currency="CNY",
            product_name="三个月定期",
            start_date=date(2026, 1, 2),
            maturity_date=date(2026, 4, 2),
            annual_rate=1.8,
        )
        wealth_buy = self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 3),
            asset_kind="wealth",
            direction="in",
            amount=100000,
            bank_name="招商银行",
            currency="CNY",
            product_name="稳健理财",
            investment_nature="fixed_income",
            risk_level="R2",
        )
        wealth_symbol = f"BANK:W:{wealth_buy['id']}"

        initial = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 3),
            refresh_prices=True,
        )
        bank_account = initial["accounts"][0]
        self.assertEqual(bank_account["cash_tracking_mode"], "asset_only")
        self.assertAlmostEqual(bank_account["total_cash"], 10000.0, places=6)
        self.assertAlmostEqual(bank_account["total_market_value"], 150000.0, places=6)
        positions = {item["product_name"]: item for item in bank_account["positions"]}
        self.assertEqual(positions["三个月定期"]["annual_rate"], 1.8)
        self.assertEqual(positions["三个月定期"]["start_date"], "2026-01-02")
        self.assertEqual(positions["稳健理财"]["symbol"], wealth_symbol)
        self.assertEqual(positions["稳健理财"]["price_source"], "bank_net_invested_estimate")
        self.assertEqual(positions["稳健理财"]["valuation_model"], "unit_nav")
        self.assertEqual(positions["三个月定期"]["valuation_model"], "amount_value")
        self.assertEqual(positions["稳健理财"]["quantity"], 1.0)
        self.assertAlmostEqual(positions["稳健理财"]["market_value_base"], 100000.0, places=6)

        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 4),
            asset_kind="wealth",
            direction="in",
            amount=20000,
            bank_name="招商银行",
            currency="CNY",
            product_name="稳健理财",
            linked_entry_id=wealth_buy["id"],
        )

        self.service.upsert_manual_price(
            account_id=aid,
            symbol=wealth_symbol,
            market="bank",
            price_date=date(2026, 1, 5),
            price=121000,
            currency="CNY",
        )
        updated = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 5),
            refresh_prices=True,
        )
        wealth = next(item for item in updated["accounts"][0]["positions"] if item.get("symbol") == wealth_symbol)
        self.assertEqual(wealth["price_source"], "bank_value_update")
        self.assertAlmostEqual(wealth["last_price"], 121000.0, places=6)
        self.assertAlmostEqual(wealth["market_value_base"], 121000.0, places=6)
        self.assertAlmostEqual(wealth["unrealized_pnl_base"], 1000.0, places=6)

        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 6),
            asset_kind="wealth",
            direction="out",
            amount=51000,
            bank_name="招商银行",
            currency="CNY",
            product_name="稳健理财",
            linked_entry_id=wealth_buy["id"],
        )
        redeemed = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 6),
            refresh_prices=True,
        )
        wealth_after_redeem = next(
            item for item in redeemed["accounts"][0]["positions"] if item.get("symbol") == wealth_symbol
        )
        self.assertAlmostEqual(wealth_after_redeem["quantity"], 1.0, places=6)
        self.assertAlmostEqual(wealth_after_redeem["total_cost"], 120000.0, places=6)
        self.assertAlmostEqual(wealth_after_redeem["market_value_base"], 70000.0, places=6)
        self.assertAlmostEqual(wealth_after_redeem["unrealized_pnl_base"], 1000.0, places=6)
        self.assertAlmostEqual(redeemed["accounts"][0]["total_cash"], 10000.0, places=6)

    def test_asset_account_can_opt_into_managed_cash_tracking(self) -> None:
        account = self.service.create_account(
            name="Managed Bank",
            broker="CMB",
            market="bank",
            base_currency="CNY",
            cash_tracking_mode="managed",
        )
        aid = account["id"]

        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            asset_kind="wealth",
            direction="in",
            amount=100000,
            bank_name="招商银行",
            currency="CNY",
            product_name="稳健理财",
        )

        snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 1, 1))
        account_snapshot = snapshot["accounts"][0]
        self.assertEqual(account_snapshot["cash_tracking_mode"], "managed")
        self.assertAlmostEqual(account_snapshot["total_cash"], -100000.0, places=6)
        self.assertAlmostEqual(account_snapshot["total_equity"], 0.0, places=6)

    def test_bank_wealth_supports_unit_nav_quantity(self) -> None:
        account = self.service.create_account(name="Bank", broker="BOC", market="bank", base_currency="CNY")
        aid = account["id"]

        wealth_buy = self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 3),
            asset_kind="wealth",
            direction="in",
            amount=102560,
            bank_name="中银理财",
            currency="CNY",
            product_name="中银理财-稳富全球配置7天持有期1号A",
            product_code="YH0662195.YH",
            product_public_code="CYQWFQQPZ7D1A",
            issuer_name="中银理财",
            unit_nav=1.0256,
            nav_date=date(2026, 1, 3),
        )

        snapshot = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 3),
            refresh_prices=False,
        )
        wealth = next(item for item in snapshot["accounts"][0]["positions"] if item.get("symbol") == f"BANK:W:{wealth_buy['id']}")
        self.assertEqual(wealth["price_source"], "bank_wealth_nav")
        self.assertEqual(wealth["price_provider"], "iwencai")
        self.assertEqual(wealth["product_code"], "YH0662195.YH")
        self.assertEqual(wealth["product_public_code"], "CYQWFQQPZ7D1A")
        self.assertAlmostEqual(wealth["quantity"], 100000.0, places=6)
        self.assertAlmostEqual(wealth["last_price"], 1.0256, places=6)
        self.assertAlmostEqual(wealth["market_value_base"], 102560.0, places=6)

        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 4),
            asset_kind="wealth",
            direction="out",
            amount=103000,
            bank_name="中银理财",
            currency="CNY",
            product_name="中银理财-稳富全球配置7天持有期1号A",
            linked_entry_id=wealth_buy["id"],
            unit_nav=1.03,
            nav_date=date(2026, 1, 4),
        )
        redeemed = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 4),
            refresh_prices=False,
        )
        self.assertEqual(redeemed["accounts"][0]["positions"], [])
        self.assertAlmostEqual(redeemed["accounts"][0]["total_cash"], 0.0, places=6)

    def test_bank_wealth_value_update_is_overridden_only_by_newer_nav(self) -> None:
        account = self.service.create_account(name="Bank", broker="BOC", market="bank", base_currency="CNY")
        aid = account["id"]
        wealth_buy = self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 3),
            asset_kind="wealth",
            direction="in",
            amount=100000,
            bank_name="中银理财",
            currency="CNY",
            product_name="中银理财-稳富全球配置7天持有期1号A",
            product_code="YH0662195.YH",
            product_public_code="CYQWFQQPZ7D1A",
            issuer_name="中银理财",
            unit_nav=1.0,
            nav_date=date(2026, 1, 3),
        )
        wealth_symbol = f"BANK:W:{wealth_buy['id']}"
        self.service.upsert_manual_price(
            account_id=aid,
            symbol=wealth_symbol,
            market="bank",
            price_date=date(2026, 1, 5),
            price=101000,
            currency="CNY",
        )

        with patch.object(
            PortfolioService,
            "_fetch_bank_wealth_nav",
            return_value=_ResolvedPositionPrice(
                price=1.02,
                source="bank_wealth_nav",
                price_date=date(2026, 1, 4),
                is_stale=True,
                is_available=True,
                provider="iwencai",
            ),
        ):
            stale_nav = self.service.get_portfolio_snapshot(
                account_id=aid,
                as_of=date(2026, 1, 5),
                refresh_prices=True,
            )

        stale_position = next(item for item in stale_nav["accounts"][0]["positions"] if item.get("symbol") == wealth_symbol)
        self.assertEqual(stale_position["price_source"], "bank_value_update")
        self.assertEqual(stale_position["price_date"], "2026-01-05")
        self.assertAlmostEqual(stale_position["market_value_base"], 101000.0, places=6)

        with patch.object(
            PortfolioService,
            "_fetch_bank_wealth_nav",
            return_value=_ResolvedPositionPrice(
                price=1.03,
                source="bank_wealth_nav",
                price_date=date(2026, 1, 6),
                is_stale=False,
                is_available=True,
                provider="iwencai",
            ),
        ):
            newer_nav = self.service.get_portfolio_snapshot(
                account_id=aid,
                as_of=date(2026, 1, 6),
                refresh_prices=True,
            )

        newer_position = next(item for item in newer_nav["accounts"][0]["positions"] if item.get("symbol") == wealth_symbol)
        self.assertEqual(newer_position["price_source"], "bank_wealth_nav")
        self.assertEqual(newer_position["price_date"], "2026-01-06")
        self.assertAlmostEqual(newer_position["last_price"], 1.03, places=6)
        self.assertAlmostEqual(newer_position["market_value_base"], 103000.0, places=6)

    def test_bank_snapshot_cache_does_not_reuse_previous_day(self) -> None:
        account = self.service.create_account(name="Bank", broker="BOC", market="bank", base_currency="CNY")
        aid = account["id"]

        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 3),
            asset_kind="wealth",
            direction="in",
            amount=100000,
            bank_name="中银理财",
            currency="CNY",
            product_name="稳健理财",
        )
        first = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 3),
            refresh_prices=False,
        )
        self.assertEqual(len(first["accounts"][0]["positions"]), 1)

        second = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 4),
            refresh_prices=False,
        )
        self.assertEqual(len(second["accounts"][0]["positions"]), 1)
        self.assertEqual(second["as_of"], "2026-01-04")

    def test_bank_deposit_with_same_terms_redeems_by_linked_entry(self) -> None:
        account = self.service.create_account(name="Bank", broker="CMB", market="bank", base_currency="CNY")
        aid = account["id"]

        first = self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            asset_kind="deposit",
            direction="in",
            amount=30000,
            bank_name="招商银行",
            currency="CNY",
            product_name="一年定期",
            start_date=date(2026, 1, 1),
            maturity_date=date(2027, 1, 1),
            annual_rate=2.0,
        )
        second = self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            asset_kind="deposit",
            direction="in",
            amount=50000,
            bank_name="招商银行",
            currency="CNY",
            product_name="一年定期",
            start_date=date(2026, 1, 1),
            maturity_date=date(2027, 1, 1),
            annual_rate=2.0,
        )

        initial = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 1),
            refresh_prices=True,
        )
        deposits = [
            item for item in initial["accounts"][0]["positions"]
            if item.get("product_name") == "一年定期"
        ]
        self.assertEqual(len(deposits), 2)
        self.assertEqual({item["linked_entry_id"] for item in deposits}, {first["id"], second["id"]})

        self.service.record_bank_ledger(
            account_id=aid,
            event_date=date(2026, 6, 1),
            asset_kind="deposit",
            direction="out",
            amount=10000,
            bank_name="招商银行",
            currency="CNY",
            linked_entry_id=first["id"],
        )
        redeemed = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 6, 1),
            refresh_prices=True,
        )
        remaining_by_entry = {
            item["linked_entry_id"]: item["market_value_base"]
            for item in redeemed["accounts"][0]["positions"]
            if item.get("product_name") == "一年定期"
        }
        self.assertAlmostEqual(remaining_by_entry[first["id"]], 20000.0, places=6)
        self.assertAlmostEqual(remaining_by_entry[second["id"]], 50000.0, places=6)
        self.assertAlmostEqual(redeemed["accounts"][0]["total_cash"], 0.0, places=6)

    def test_advisory_account_tracks_amount_value_and_redemption(self) -> None:
        account = self.service.create_account(name="Advisory", broker="且慢", market="advisory", base_currency="CNY")
        aid = account["id"]

        self.service.record_advisory_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            platform="且慢",
            product_name="我要稳稳的幸福",
            product_code=None,
            product_type="advisory_combo",
            event_type="buy",
            amount=100000,
            currency="CNY",
            risk_level="R3",
            investment_style="稳健",
        )
        initial = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 1),
            refresh_prices=True,
        )
        account_snapshot = initial["accounts"][0]
        self.assertEqual(account_snapshot["cash_tracking_mode"], "asset_only")
        self.assertAlmostEqual(account_snapshot["total_cash"], 0.0, places=6)
        self.assertAlmostEqual(account_snapshot["total_market_value"], 100000.0, places=6)
        position = account_snapshot["positions"][0]
        self.assertEqual(position["market"], "advisory")
        self.assertEqual(position["symbol"], position["symbol"].upper())
        self.assertEqual(position["platform"], "且慢")
        self.assertEqual(position["product_name"], "我要稳稳的幸福")
        self.assertIsNone(position["product_code"])
        self.assertEqual(position["product_type"], "advisory_combo")
        self.assertEqual(position["price_source"], "advisory_net_invested_estimate")
        self.assertEqual(position["valuation_model"], "amount_value")
        self.assertEqual(position["price_display_value"], 100000.0)
        self.assertAlmostEqual(position["invested_amount"], 100000.0, places=6)

        self.service.repo.upsert_manual_price(
            account_id=aid,
            symbol=position["symbol"].lower(),
            market="advisory",
            price_date=date(2026, 1, 2),
            price=105000,
            currency="CNY",
        )
        self.service.record_advisory_ledger(
            account_id=aid,
            event_date=date(2026, 1, 3),
            platform="且慢",
            product_name="我要稳稳的幸福",
            product_code=None,
            product_type="advisory_combo",
            event_type="buy",
            amount=10000,
            currency="CNY",
        )
        updated = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 3),
            refresh_prices=False,
        )
        updated_position = updated["accounts"][0]["positions"][0]
        self.assertEqual(updated_position["price_source"], "advisory_value_update")
        self.assertAlmostEqual(updated_position["market_value_base"], 115000.0, places=6)
        self.assertAlmostEqual(updated_position["unrealized_pnl_base"], 5000.0, places=6)
        self.assertAlmostEqual(updated["asset_breakdown"]["advisory"], 115000.0, places=6)

        self.service.record_advisory_ledger(
            account_id=aid,
            event_date=date(2026, 1, 4),
            platform="且慢",
            product_name="我要稳稳的幸福",
            product_code=None,
            product_type="advisory_combo",
            event_type="redeem",
            amount=60000,
            currency="CNY",
        )
        redeemed = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 4),
            refresh_prices=True,
        )
        redeemed_position = redeemed["accounts"][0]["positions"][0]
        self.assertAlmostEqual(redeemed_position["market_value_base"], 55000.0, places=6)
        self.assertAlmostEqual(redeemed_position["redeemed_amount"], 60000.0, places=6)
        self.assertAlmostEqual(redeemed["accounts"][0]["unrealized_pnl"], 5000.0, places=6)
        self.assertAlmostEqual(redeemed["accounts"][0]["total_cash"], 0.0, places=6)

    def test_advisory_short_holding_annualized_return_is_calculated(self) -> None:
        account = self.service.create_account(name="Advisory", broker="且慢", market="advisory", base_currency="CNY")
        aid = account["id"]
        self.service.record_advisory_ledger(
            account_id=aid,
            event_date=date(2026, 5, 6),
            platform="且慢",
            product_name="我要稳稳的幸福",
            product_code=None,
            product_type="advisory_combo",
            event_type="buy",
            amount=300000,
            currency="CNY",
        )
        self.service.repo.upsert_manual_price(
            account_id=aid,
            symbol="ADV:D3AC022A5278",
            market="advisory",
            price_date=date(2026, 5, 6),
            price=313000,
            currency="CNY",
        )

        snapshot = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 5, 7),
            refresh_prices=False,
        )
        position = snapshot["accounts"][0]["positions"][0]

        self.assertIsNotNone(position["annualized_return_pct"])
        self.assertGreater(position["annualized_return_pct"], 1000000)

    def test_advisory_account_tracks_dca_plan_events(self) -> None:
        account = self.service.create_account(name="Advisory", broker="且慢", market="advisory", base_currency="CNY")
        aid = account["id"]

        self.service.record_advisory_ledger(
            account_id=aid,
            event_date=date(2026, 1, 1),
            platform="且慢",
            product_name="长赢指数投资计划",
            product_code=None,
            product_type="dca_plan",
            event_type="initial_buy",
            amount=200000,
            currency="CNY",
        )
        self.service.record_advisory_ledger(
            account_id=aid,
            event_date=date(2026, 2, 1),
            platform="且慢",
            product_name="长赢指数投资计划",
            product_code=None,
            product_type="dca_plan",
            event_type="dca_buy",
            amount=1000,
            currency="CNY",
        )
        events = self.service.list_advisory_ledger_events(
            account_id=aid,
            direction="follow_buy",
        )
        self.assertEqual(events["total"], 1)
        self.assertEqual(events["items"][0]["event_type"], "dca_buy")

        snapshot = self.service.get_portfolio_snapshot(account_id=aid, as_of=date(2026, 2, 1))
        position = snapshot["accounts"][0]["positions"][0]
        self.assertEqual(position["product_type"], "dca_plan")
        self.assertAlmostEqual(position["invested_amount"], 201000.0, places=6)
        self.assertAlmostEqual(position["market_value_base"], 201000.0, places=6)

        with self.assertRaisesRegex(ValueError, "product_type cannot change"):
            self.service.record_advisory_ledger(
                account_id=aid,
                event_date=date(2026, 2, 2),
                platform="且慢",
                product_name="长赢指数投资计划",
                product_code=None,
                product_type="advisory_combo",
                event_type="buy",
                amount=1000,
                currency="CNY",
            )

    def test_advisory_orphan_value_update_does_not_create_position(self) -> None:
        account = self.service.create_account(name="Advisory", broker="且慢", market="advisory", base_currency="CNY")
        aid = account["id"]

        self.service.upsert_manual_price(
            account_id=aid,
            symbol="ADV:ORPHAN",
            market="advisory",
            price_date=date(2026, 1, 1),
            price=335328.59,
            currency="CNY",
        )

        snapshot = self.service.get_portfolio_snapshot(
            account_id=aid,
            as_of=date(2026, 1, 1),
            refresh_prices=True,
        )

        self.assertEqual(snapshot["accounts"][0]["positions"], [])
        self.assertAlmostEqual(snapshot["accounts"][0]["total_market_value"], 0.0, places=6)
        self.assertAlmostEqual(snapshot["asset_breakdown"]["advisory"], 0.0, places=6)

    def test_insurance_account_tracks_premium_returns_and_value(self) -> None:
        account = self.service.create_account(name="Insurance", broker="保险公司", market="insurance", base_currency="CNY")
        aid = account["id"]
        today = date.today()

        policy = self.service.create_insurance_policy(
            account_id=aid,
            policy_name="养老年金",
            insurer="示例保险",
            insurance_kind="annuity",
            design_type="participating",
            payment_mode="annual",
            premium_per_period=10000,
            first_payment_date=today,
            total_periods=3,
        )
        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=policy["id"],
            event_date=today,
            event_type="premium",
            amount=10000,
            period_no=1,
        )

        initial = self.service.get_portfolio_snapshot(account_id=aid, as_of=today, refresh_prices=True)
        account_snapshot = initial["accounts"][0]
        self.assertEqual(account_snapshot["cash_tracking_mode"], "asset_only")
        self.assertAlmostEqual(account_snapshot["total_cash"], 0.0, places=6)
        self.assertAlmostEqual(account_snapshot["total_market_value"], 10000.0, places=6)
        position = account_snapshot["positions"][0]
        self.assertEqual(position["market"], "insurance")
        self.assertEqual(position["valuation_model"], "insurance_cash_value")
        self.assertTrue(position["value_estimated"])
        self.assertIsNotNone(position["next_payment_date"])
        self.assertTrue(str(position["next_payment_date"]).startswith(str(today.year + 1)))

        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=policy["id"],
            event_date=today,
            event_type="value_update",
            amount=10500,
        )
        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=policy["id"],
            event_date=today,
            event_type="annuity_payment",
            amount=500,
        )
        updated = self.service.get_portfolio_snapshot(account_id=aid, as_of=today, refresh_prices=True)
        updated_position = updated["accounts"][0]["positions"][0]
        self.assertFalse(updated_position["value_estimated"])
        self.assertAlmostEqual(updated_position["market_value_base"], 10500.0, places=6)
        self.assertAlmostEqual(updated_position["received_amount"], 500.0, places=6)
        self.assertAlmostEqual(updated_position["unrealized_pnl_base"], 1000.0, places=6)
        self.assertAlmostEqual(updated["asset_breakdown"]["insurance"], 10500.0, places=6)

        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=policy["id"],
            event_date=today,
            event_type="surrender",
            amount=11000,
        )
        surrendered = self.service.get_portfolio_snapshot(account_id=aid, as_of=today, refresh_prices=True)
        self.assertEqual(surrendered["accounts"][0]["positions"][0]["market_value_base"], 0.0)
        self.assertAlmostEqual(surrendered["accounts"][0]["total_cash"], 0.0, places=6)

    def test_insurance_ledger_event_type_must_match_policy_type(self) -> None:
        account = self.service.create_account(name="Insurance", broker="保险公司", market="insurance", base_currency="CNY")
        aid = account["id"]

        annuity = self.service.create_insurance_policy(
            account_id=aid,
            policy_name="养老年金",
            insurance_kind="annuity",
            payment_mode="annual",
        )
        whole_life = self.service.create_insurance_policy(
            account_id=aid,
            policy_name="增额终身寿",
            insurance_kind="whole_life",
            payment_mode="annual",
        )

        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=annuity["id"],
            event_date=date(2026, 1, 1),
            event_type="annuity_payment",
            amount=1000,
        )
        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=whole_life["id"],
            event_date=date(2026, 1, 1),
            event_type="partial_withdrawal",
            amount=1000,
        )
        with self.assertRaisesRegex(ValueError, "event_type is not available"):
            self.service.record_insurance_ledger(
                account_id=aid,
                policy_id=whole_life["id"],
                event_date=date(2026, 1, 1),
                event_type="annuity_payment",
                amount=1000,
            )

    def test_insurance_ledger_rejects_events_after_terminal_event(self) -> None:
        account = self.service.create_account(name="Insurance", broker="保险公司", market="insurance", base_currency="CNY")
        aid = account["id"]
        policy = self.service.create_insurance_policy(
            account_id=aid,
            policy_name="增额终身寿",
            insurance_kind="whole_life",
            payment_mode="annual",
        )

        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=policy["id"],
            event_date=date(2026, 1, 1),
            event_type="surrender",
            amount=10000,
        )
        policies = self.service.list_insurance_policies(account_id=aid, include_inactive=True)["policies"]
        self.assertEqual(policies[0]["status"], "surrendered")
        with self.assertRaisesRegex(ValueError, "event_type is not available"):
            self.service.record_insurance_ledger(
                account_id=aid,
                policy_id=policy["id"],
                event_date=date(2026, 1, 2),
                event_type="premium",
                amount=1000,
            )

    def test_deleting_terminal_insurance_event_restores_active_policy(self) -> None:
        account = self.service.create_account(name="Insurance", broker="保险公司", market="insurance", base_currency="CNY")
        aid = account["id"]
        policy = self.service.create_insurance_policy(
            account_id=aid,
            policy_name="增额终身寿",
            insurance_kind="whole_life",
            payment_mode="annual",
        )

        terminal = self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=policy["id"],
            event_date=date(2026, 1, 1),
            event_type="surrender",
            amount=10000,
        )
        self.assertTrue(self.service.delete_insurance_ledger_event(terminal["id"]))
        policies = self.service.list_insurance_policies(account_id=aid, include_inactive=True)["policies"]
        self.assertEqual(policies[0]["status"], "active")

    def test_insurance_policy_update_locks_contract_fields_after_ledger_exists(self) -> None:
        account = self.service.create_account(name="Insurance", broker="保险公司", market="insurance", base_currency="CNY")
        aid = account["id"]
        policy = self.service.create_insurance_policy(
            account_id=aid,
            policy_name="养老年金",
            insurance_kind="annuity",
            design_type="ordinary",
            payment_mode="annual",
        )
        self.service.record_insurance_ledger(
            account_id=aid,
            policy_id=policy["id"],
            event_date=date(2026, 1, 1),
            event_type="premium",
            amount=1000,
        )

        updated = self.service.update_insurance_policy(policy["id"], policy_name="养老年金 A 款")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["policy_name"], "养老年金 A 款")

        with self.assertRaisesRegex(ValueError, "cannot be changed after ledger events exist"):
            self.service.update_insurance_policy(policy["id"], insurance_kind="whole_life")


if __name__ == "__main__":
    unittest.main()
