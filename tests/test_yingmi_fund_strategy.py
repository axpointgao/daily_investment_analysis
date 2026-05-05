# -*- coding: utf-8 -*-
"""Regression tests for Yingmi fund/advisory runtime strategy switches."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tests.litellm_stub import ensure_litellm_stub

ensure_litellm_stub()

from src.config import Config, get_config, setup_env
from src.agent.tools.fund_tools import _handle_yingmi_get_fund_diagnosis
from src.services.fund_analysis_service import FundAnalysisService
from src.services.portfolio_analysis_service import PortfolioAnalysisService


YINGMI_ENV_KEYS = [
    "YINGMI_API_KEY",
    "YINGMI_ENABLED",
    "YINGMI_STARGATE_BASE_URL",
    "YINGMI_FUND_ANALYSIS_DEPTH",
    "YINGMI_FUND_DATA_STRATEGY",
    "YINGMI_MCP_DAILY_LIMIT",
    "YINGMI_SKILL_DAILY_LIMIT",
]


class YingmiFundStrategyTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.env_path = Path(self.temp_dir.name) / ".env"
        os.environ["ENV_FILE"] = str(self.env_path)
        for key in YINGMI_ENV_KEYS:
            os.environ.pop(key, None)
        Config.reset_instance()

    def tearDown(self) -> None:
        Config.reset_instance()
        os.environ.pop("ENV_FILE", None)
        self.temp_dir.cleanup()

    def _write_env(self, *lines: str) -> None:
        self.env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        Config.reset_instance()
        setup_env(override=True)

    def test_home_fund_basic_only_skips_yingmi(self) -> None:
        self._write_env("YINGMI_API_KEY=dummy", "YINGMI_FUND_DATA_STRATEGY=basic_only")

        result = FundAnalysisService()._fetch_yingmi_professional_data("000001", "测试基金")

        self.assertEqual(result["data"], {})
        self.assertIn("仅基础数据", result["providerStatus"][0]["message"])

    def test_home_fund_fast_depth_skips_extra_fund_risk(self) -> None:
        self._write_env("YINGMI_API_KEY=dummy", "YINGMI_FUND_ANALYSIS_DEPTH=fast")
        client = SimpleNamespace(
            get_fund_diagnosis=lambda value: {"diagnosis": value},
            analyze_fund_risk=lambda codes: {"risk": codes},
        )

        with patch("src.services.yingmi_stargate_client.YingmiStargateClient", return_value=client):
            result = FundAnalysisService()._fetch_yingmi_professional_data("000001", "测试基金")

        self.assertIn("fund_diagnosis", result["data"])
        self.assertNotIn("fund_risk", result["data"])

    def test_web_saved_yingmi_strategy_overrides_stale_loaded_env(self) -> None:
        os.environ["YINGMI_FUND_ANALYSIS_DEPTH"] = "fast"

        self._write_env("YINGMI_API_KEY=dummy", "YINGMI_FUND_ANALYSIS_DEPTH=deep")
        config = get_config()

        self.assertEqual(config.yingmi_fund_analysis_depth, "deep")

    def test_fund_agent_basic_only_skips_yingmi_tool_call(self) -> None:
        self._write_env("YINGMI_API_KEY=dummy", "YINGMI_FUND_DATA_STRATEGY=basic_only")

        result = _handle_yingmi_get_fund_diagnosis("000001")

        self.assertEqual(result["provider"], "yingmi_stargate")
        self.assertEqual(result["method"], "get_fund_diagnosis")
        self.assertIn("仅基础数据", result["error"])

    def test_portfolio_fast_depth_only_calls_asset_allocation(self) -> None:
        positions = [{"symbol": "000001", "displayName": "测试基金", "market": "fund", "marketValueBase": 100.0}]
        client = SimpleNamespace(
            get_asset_allocation=lambda fund_list: {"asset": fund_list},
            analyze_portfolio_risk=lambda holdings: {"risk": holdings},
            get_funds_backtest=lambda fund_list: {"backtest": fund_list},
            get_funds_correlation=lambda codes: {"correlation": codes},
        )

        self._write_env("YINGMI_API_KEY=dummy", "YINGMI_FUND_ANALYSIS_DEPTH=fast")
        with patch("src.services.yingmi_stargate_client.YingmiStargateClient", return_value=client):
            result = PortfolioAnalysisService(
                analyzer=SimpleNamespace(is_available=lambda: True),
                config=get_config(),
            )._build_professional_analysis(positions)

        self.assertIn("asset_allocation", result["data"])
        self.assertNotIn("portfolio_risk", result["data"])
        self.assertNotIn("funds_backtest", result["data"])

    def test_portfolio_deep_depth_adds_risk_and_backtest(self) -> None:
        positions = [{"symbol": "000001", "displayName": "测试基金", "market": "fund", "marketValueBase": 100.0}]
        client = SimpleNamespace(
            get_asset_allocation=lambda fund_list: {"asset": fund_list},
            analyze_portfolio_risk=lambda holdings: {"risk": holdings},
            get_funds_backtest=lambda fund_list: {"backtest": fund_list},
            get_funds_correlation=lambda codes: {"correlation": codes},
        )

        self._write_env("YINGMI_API_KEY=dummy", "YINGMI_FUND_ANALYSIS_DEPTH=deep")
        with patch("src.services.yingmi_stargate_client.YingmiStargateClient", return_value=client):
            result = PortfolioAnalysisService(
                analyzer=SimpleNamespace(is_available=lambda: True),
                config=get_config(),
            )._build_professional_analysis(positions)

        self.assertIn("asset_allocation", result["data"])
        self.assertIn("portfolio_risk", result["data"])
        self.assertIn("funds_backtest", result["data"])


if __name__ == "__main__":
    unittest.main()
