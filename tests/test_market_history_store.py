"""Tests for the DuckDB-backed market history store."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class MarketHistoryStoreTestCase(unittest.TestCase):
    def test_normalize_adjustment(self):
        from src.services.market_history_store import normalize_adjustment

        self.assertEqual(normalize_adjustment("qfq"), "qfq")
        self.assertEqual(normalize_adjustment("raw"), "raw")
        self.assertEqual(normalize_adjustment("other"), "qfq")

    @patch("src.services.market_history_store.get_config")
    def test_disabled_store_returns_disabled(self, mock_get_config):
        from src.services.market_history_store import load_market_history_df

        mock_get_config.return_value = type(
            "Cfg",
            (),
            {
                "market_history_enabled": False,
                "market_history_duckdb_path": "./missing.duckdb",
                "market_history_default_adjustment": "qfq",
            },
        )()

        df, source = load_market_history_df("600519", start=date(2026, 5, 1), end=date(2026, 5, 14))

        self.assertIsNone(df)
        self.assertEqual(source, "market_history_disabled")

    @patch("src.services.market_history_store.get_config")
    @unittest.skipUnless(importlib.util.find_spec("duckdb") is not None, "duckdb is not installed")
    def test_store_reads_dataframe_when_duckdb_available(self, mock_get_config):
        duckdb = __import__("duckdb")
        from src.services.market_history_store import MarketHistoryStore

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "history.duckdb"
            with duckdb.connect(str(db_path)) as conn:
                conn.execute(
                    """
                    CREATE TABLE stock_daily_history (
                        adjustment VARCHAR,
                        trade_date DATE,
                        code VARCHAR,
                        open DOUBLE,
                        high DOUBLE,
                        low DOUBLE,
                        close DOUBLE,
                        volume DOUBLE,
                        amount DOUBLE,
                        pct_chg DOUBLE,
                        ma5 DOUBLE,
                        ma10 DOUBLE,
                        ma20 DOUBLE,
                        volume_ratio DOUBLE
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO stock_daily_history VALUES
                    ('qfq', '2026-05-13', '600519', 10, 11, 9, 10.5, 100, 1000, 1.2, 10, 10, 10, 1.1),
                    ('qfq', '2026-05-14', '600519', 10.5, 11.2, 10.1, 11.0, 120, 1200, 2.4, 10.2, 10.1, 10.0, 1.2)
                    """
                )

            mock_get_config.return_value = type(
                "Cfg",
                (),
                {
                    "market_history_enabled": True,
                    "market_history_duckdb_path": str(db_path),
                    "market_history_default_adjustment": "qfq",
                },
            )()

            store = MarketHistoryStore(str(db_path))
            df, source = store.get_daily_data("600519", start=date(2026, 5, 1), end=date(2026, 5, 14))

            self.assertIsInstance(df, pd.DataFrame)
            self.assertEqual(source, "market_history_qfq")
            self.assertEqual(len(df), 2)
            self.assertEqual(df.iloc[-1]["close"], 11.0)
            self.assertEqual(df.iloc[-1]["date"], date(2026, 5, 14))


if __name__ == "__main__":
    unittest.main()
