# -*- coding: utf-8 -*-
"""Regression tests for portfolio analysis prompt selection."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from tests.litellm_stub import ensure_litellm_stub

ensure_litellm_stub()

from src.services.portfolio_analysis_service import (  # noqa: E402
    PortfolioAnalysisService,
    get_portfolio_analysis_default_prompt,
)


class PortfolioAnalysisPromptTestCase(unittest.TestCase):
    def _build_service(self, **config_overrides: str) -> PortfolioAnalysisService:
        config_values = {
            "portfolio_analysis_prompt_all_quick": "",
            "portfolio_analysis_prompt_all_deep": "",
            "portfolio_analysis_prompt_all_wealth_report": "",
            "portfolio_analysis_prompt_stock": "",
            "portfolio_analysis_prompt_fund": "",
            "portfolio_analysis_prompt_advisory": "",
            "portfolio_analysis_prompt_bank": "",
            "portfolio_analysis_prompt_insurance_basic": "",
        }
        config_values.update(config_overrides)
        config = SimpleNamespace(**config_values)
        return PortfolioAnalysisService(
            portfolio_service=SimpleNamespace(),
            risk_service=SimpleNamespace(),
            analyzer=SimpleNamespace(is_available=lambda: True),
            config=config,
        )

    def test_all_account_quick_uses_builtin_default_prompt(self) -> None:
        prompt = self._build_service()._build_prompt(
            {"按账户汇总": [{"market": "fund"}], "analysisMode": "quick"},
            mode="quick",
            account_id=None,
        )

        self.assertIn(get_portfolio_analysis_default_prompt("all_quick"), prompt)
        self.assertNotIn(get_portfolio_analysis_default_prompt("fund"), prompt)

    def test_all_account_wealth_report_uses_wealth_report_prompt(self) -> None:
        prompt = self._build_service()._build_prompt(
            {"按账户汇总": [{"market": "fund"}], "analysisMode": "wealth_report"},
            mode="wealth_report",
            account_id=None,
        )

        self.assertIn(get_portfolio_analysis_default_prompt("all_wealth_report"), prompt)

    def test_single_fund_account_uses_custom_prompt_override(self) -> None:
        custom_prompt = "按我的家庭基金检视口径输出，先看核心仓再看卫星仓。"

        prompt = self._build_service(portfolio_analysis_prompt_fund=custom_prompt)._build_prompt(
            {"按账户汇总": [{"accountId": 6, "market": "fund"}], "analysisMode": "deep"},
            mode="deep",
            account_id=6,
        )

        self.assertIn(custom_prompt, prompt)
        self.assertNotIn(get_portfolio_analysis_default_prompt("fund"), prompt)

    def test_single_insurance_account_uses_basic_insurance_prompt(self) -> None:
        prompt = self._build_service()._build_prompt(
            {"按账户汇总": [{"accountId": 7, "market": "insurance"}], "analysisMode": "quick"},
            mode="quick",
            account_id=7,
        )

        self.assertIn(get_portfolio_analysis_default_prompt("insurance_basic"), prompt)

    def test_analyze_records_portfolio_analysis_call_type(self) -> None:
        snapshot = {
            "as_of": "2026-05-05",
            "cost_method": "fifo",
            "currency": "CNY",
            "account_count": 1,
            "total_equity": 10000.0,
            "total_market_value": 8000.0,
            "total_cash": 2000.0,
            "asset_breakdown": {"stock": 8000.0, "cash": 2000.0},
            "accounts": [
                {
                    "account_id": 1,
                    "account_name": "测试账户",
                    "market": "cn",
                    "total_equity": 10000.0,
                    "positions": [
                        {
                            "symbol": "510050",
                            "display_name": "上证50ETF",
                            "market": "cn",
                            "currency": "CNY",
                            "quantity": 1000,
                            "market_value_base": 8000.0,
                            "price_available": True,
                        }
                    ],
                }
            ],
        }
        risk = {"concentration": {}, "sector_concentration": {}, "drawdown": {}, "stop_loss": {}}
        calls = []
        analyzer = SimpleNamespace(
            is_available=lambda: True,
            generate_text=lambda prompt, **kwargs: calls.append(kwargs)
            or '{"summary_points":["现金充足","权益为主","集中度可控"],"full_markdown":"## 资产配置结构\\n权益为主。"}',
        )
        service = PortfolioAnalysisService(
            portfolio_service=SimpleNamespace(get_portfolio_snapshot=lambda **kwargs: snapshot),
            risk_service=SimpleNamespace(get_risk_report=lambda **kwargs: risk),
            analyzer=analyzer,
            config=SimpleNamespace(),
        )

        result = service.analyze(snapshot_signature="sig")

        self.assertEqual(result["analysis_mode"], "quick")
        self.assertEqual(calls[0]["call_type"], "portfolio_analysis")


if __name__ == "__main__":
    unittest.main()
