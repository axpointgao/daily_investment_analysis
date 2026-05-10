# -*- coding: utf-8 -*-
"""Regression tests for portfolio analysis prompt selection."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tests.litellm_stub import ensure_litellm_stub

ensure_litellm_stub()

from src.services.portfolio_analysis_service import (  # noqa: E402
    PORTFOLIO_ANALYSIS_SCHEMA_VERSION,
    PortfolioAnalysisError,
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

    def test_all_account_standard_uses_builtin_default_prompt(self) -> None:
        prompt = self._build_service()._build_prompt(
            {"按账户汇总": [{"market": "fund"}], "analysisMode": "standard"},
            mode="standard",
            account_id=None,
        )

        self.assertIn(get_portfolio_analysis_default_prompt("all_standard"), prompt)
        self.assertNotIn(get_portfolio_analysis_default_prompt("fund"), prompt)
        self.assertIn("## 数据覆盖与口径", prompt)
        self.assertIn("## 资产配置结构", prompt)
        self.assertIn("## 基金与投顾专项", prompt)

    def test_legacy_all_account_modes_use_standard_report_template(self) -> None:
        prompt = self._build_service()._build_prompt(
            {
                "按账户汇总": [{"market": "fund"}],
                "analysisMode": "deep",
                "专业数据调用状态": [
                    {"provider": "yingmi_stargate", "stage": "asset_allocation", "available": True}
                ],
            },
            mode="deep",
            account_id=None,
        )

        self.assertIn(get_portfolio_analysis_default_prompt("all_standard"), prompt)
        self.assertIn("## 数据覆盖与口径", prompt)
        self.assertNotIn("## 专业数据覆盖与可信度", prompt)
        self.assertIn("asset_allocation", prompt)

    def test_compact_payload_separates_account_and_report_currency_amounts(self) -> None:
        snapshot = {
            "as_of": "2026-05-05",
            "currency": "CNY",
            "cost_method": "fifo",
            "account_count": 1,
            "total_equity": 141429.05,
            "total_market_value": 141429.05,
            "total_cash": 0.0,
            "asset_breakdown": {"crypto": 141429.05},
            "accounts": [
                {
                    "account_id": 1,
                    "account_name": "数字货币账户",
                    "market": "crypto",
                    "base_currency": "USD",
                    "total_equity": 20715.83,
                    "positions": [
                        {
                            "symbol": "ETH",
                            "display_name": "ETH",
                            "market": "crypto",
                            "currency": "USD",
                            "quantity": 1,
                            "avg_cost": 10000.0,
                            "total_cost": 10000.0,
                            "market_value_base": 20715.83,
                            "unrealized_pnl_base": 10715.83,
                            "unrealized_pnl_pct": 107.1583,
                            "price_available": True,
                        }
                    ],
                }
            ],
        }
        risk = {
            "concentration": {
                "top_weight_pct": 45.1,
                "alert": True,
                "top_positions": [
                    {
                        "symbol": "ETH",
                        "market_value_base": 141429.05,
                        "weight_pct": 45.1,
                        "is_alert": True,
                    }
                ],
            },
            "sector_concentration": {},
            "drawdown": {},
            "stop_loss": {},
        }
        service = self._build_service()
        service.portfolio_service = SimpleNamespace(
            convert_amount=lambda amount, from_currency, to_currency, as_of_date: (
                amount * 6.8271 if from_currency == "USD" and to_currency == "CNY" else amount,
                False,
                "test",
            )
        )

        payload = service._build_compact_payload(
            snapshot=snapshot,
            risk=risk,
            account_id=None,
            snapshot_signature="sig",
        )

        eth = payload["主要持仓"][0]
        self.assertEqual(payload["报告币种"], "CNY")
        self.assertEqual(eth["账户本位币"], "USD")
        self.assertEqual(eth["报告币种"], "CNY")
        self.assertAlmostEqual(eth["市值_账户本位币"], 20715.83, places=2)
        self.assertAlmostEqual(eth["市值_报告币种"], 141429.05, places=0)
        self.assertEqual(payload["风险指标"]["主要持仓集中度"][0]["报告币种"], "CNY")
        self.assertAlmostEqual(payload["按市场汇总"][0]["value"], 141429.05, places=0)

    def test_compact_payload_includes_four_bucket_diagnosis_without_mutating_tags(self) -> None:
        snapshot = {
            "as_of": "2026-05-05",
            "currency": "CNY",
            "cost_method": "fifo",
            "account_count": 1,
            "total_equity": 100000.0,
            "total_market_value": 100000.0,
            "total_cash": 0.0,
            "asset_breakdown": {"crypto": 30000.0, "bank": 70000.0},
            "accounts": [
                {
                    "account_id": 1,
                    "account_name": "家庭账户",
                    "market": "crypto",
                    "base_currency": "CNY",
                    "total_equity": 100000.0,
                    "positions": [
                        {
                            "symbol": "ETH",
                            "display_name": "ETH",
                            "product_key": "crypto:ETH:CNY",
                            "tag_id": 3,
                            "tag_name": "稳健增强",
                            "tag_color": "hsl(var(--primary))",
                            "market": "crypto",
                            "currency": "CNY",
                            "quantity": 1,
                            "total_cost": 20000.0,
                            "market_value_base": 30000.0,
                            "unrealized_pnl_base": 10000.0,
                            "unrealized_pnl_pct": 50.0,
                            "price_available": True,
                        },
                        {
                            "symbol": "BANK001",
                            "display_name": "活期现金",
                            "product_key": "bank:BANK001:CNY",
                            "tag_id": 1,
                            "tag_name": "灵活备用",
                            "tag_color": "hsl(var(--muted))",
                            "market": "bank",
                            "currency": "CNY",
                            "quantity": 1,
                            "total_cost": 60000.0,
                            "market_value_base": 60000.0,
                            "price_available": True,
                        },
                        {
                            "symbol": "FUND001",
                            "display_name": "普通基金",
                            "product_key": "fund:FUND001:CNY",
                            "tag_id": 99,
                            "tag_name": "其他规划",
                            "tag_color": "hsl(var(--accent))",
                            "market": "fund",
                            "currency": "CNY",
                            "quantity": 1,
                            "total_cost": 10000.0,
                            "market_value_base": 10000.0,
                            "price_available": True,
                        },
                    ],
                }
            ],
        }
        risk = {"concentration": {}, "sector_concentration": {}, "drawdown": {}, "stop_loss": {}}

        payload = self._build_service()._build_compact_payload(
            snapshot=snapshot,
            risk=risk,
            account_id=None,
            snapshot_signature="sig",
        )

        eth = next(item for item in payload["主要持仓"] if item["symbol"] == "ETH")
        self.assertEqual(eth["productKey"], "crypto:ETH:CNY")
        self.assertEqual(eth["tagId"], 3)
        self.assertEqual(eth["tagName"], "稳健增强")

        diagnosis = payload["四笔钱配置诊断"]
        self.assertEqual(diagnosis["mapping"], "按现有持仓标签名称精确识别，不修改标签和持仓归属")
        enhanced = next(item for item in diagnosis["bucketSummary"] if item["name"] == "稳健增强")
        self.assertEqual(enhanced["targetPct"], 17.0)
        self.assertEqual(enhanced["status"], "偏多")
        finding = diagnosis["fitFindings"][0]
        self.assertEqual(finding["symbol"], "ETH")
        self.assertEqual(finding["currentBucket"], "稳健增强")
        self.assertEqual(finding["suggestedBucket"], "进取高增")
        self.assertIn("波动", finding["mismatchReason"])
        self.assertEqual(diagnosis["unclassifiedCount"], 1)
        self.assertEqual(diagnosis["unclassifiedPositions"][0]["tagName"], "其他规划")

    def test_four_bucket_prompt_requires_rationality_diagnosis_section(self) -> None:
        prompt = self._build_service()._build_prompt(
            {
                "按账户汇总": [{"market": "fund"}],
                "analysisMode": "standard",
                "四笔钱配置诊断": {"bucketSummary": [], "fitFindings": []},
            },
            mode="standard",
            account_id=None,
        )

        self.assertIn("## 四笔钱配置诊断", prompt)
        self.assertIn("这是配置合理性诊断，不是简单占比复述", prompt)
        self.assertIn("不得建议系统自动改标签", prompt)

    def test_saved_report_requires_current_analysis_schema_version(self) -> None:
        old_report = {"analysis_schema_version": PORTFOLIO_ANALYSIS_SCHEMA_VERSION - 1}
        current_report = {"analysis_schema_version": PORTFOLIO_ANALYSIS_SCHEMA_VERSION, "full_markdown": "report"}
        service = self._build_service()
        service.portfolio_service = SimpleNamespace(
            _normalize_cost_method=lambda method: method,
            repo=SimpleNamespace(get_analysis_report=lambda **kwargs: old_report),
        )

        self.assertIsNone(service.get_saved_report(snapshot_signature="sig"))

        service.portfolio_service.repo = SimpleNamespace(get_analysis_report=lambda **kwargs: current_report)
        self.assertEqual(service.get_saved_report(snapshot_signature="sig"), current_report)

    def test_all_account_analysis_fails_when_llm_omits_four_bucket_section(self) -> None:
        snapshot = {
            "as_of": "2026-05-05",
            "cost_method": "fifo",
            "currency": "CNY",
            "account_count": 1,
            "total_equity": 10000.0,
            "total_market_value": 10000.0,
            "total_cash": 0.0,
            "asset_breakdown": {"bank": 10000.0},
            "accounts": [
                {
                    "account_id": 1,
                    "account_name": "测试账户",
                    "market": "bank",
                    "base_currency": "CNY",
                    "total_equity": 10000.0,
                    "positions": [
                        {
                            "symbol": "CASH",
                            "display_name": "活期现金",
                            "product_key": "bank:CASH:CNY",
                            "tag_name": "灵活备用",
                            "market": "bank",
                            "currency": "CNY",
                            "quantity": 1,
                            "market_value_base": 10000.0,
                            "price_available": True,
                        }
                    ],
                }
            ],
        }
        risk = {"concentration": {}, "sector_concentration": {}, "drawdown": {}, "stop_loss": {}}
        analyzer = SimpleNamespace(
            is_available=lambda: True,
            generate_text=lambda prompt, **kwargs: (
                '{"summary_points":["现金充足","结构防守","风险较低"],'
                '"full_markdown":"## 数据覆盖与口径\\n本地快照可用。\\n\\n## 资产配置结构\\n现金为主。"}'
            ),
        )
        service = PortfolioAnalysisService(
            portfolio_service=SimpleNamespace(get_portfolio_snapshot=lambda **kwargs: snapshot),
            risk_service=SimpleNamespace(get_risk_report=lambda **kwargs: risk),
            analyzer=analyzer,
            config=SimpleNamespace(yingmi_fund_data_strategy="basic_only"),
        )
        service.save_report = lambda **kwargs: kwargs["payload"]

        with patch.object(service, "_build_asset_specialist_analysis", return_value={}):
            with self.assertRaisesRegex(PortfolioAnalysisError, "四笔钱配置诊断"):
                service.analyze(snapshot_signature="sig")

    def test_asset_specialist_analysis_includes_etf_trend_input(self) -> None:
        service = self._build_service()
        positions = [
            {
                "symbol": "510050",
                "displayName": "上证50ETF华夏",
                "market": "cn",
                "市值_报告币种": 30000.0,
                "报告币种": "CNY",
            }
        ]

        with patch(
            "src.agent.tools.analysis_tools._handle_analyze_trend",
            return_value={"trend_status": "bullish", "current_price": 3.0, "signal_score": 72},
        ):
            result = service._build_asset_specialist_analysis(positions)

        equity = result["权益资产趋势"][0]
        self.assertEqual(equity["symbol"], "510050")
        self.assertTrue(equity["isEtfOrIndex"])
        self.assertEqual(equity["trend"]["trend_status"], "bullish")

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
        self.assertIn("现金价值/已交保费比例", prompt)
        self.assertIn("不要做购买建议", prompt)

    def test_compact_payload_includes_insurance_asset_summary(self) -> None:
        snapshot = {
            "as_of": "2026-05-05",
            "currency": "CNY",
            "cost_method": "fifo",
            "account_count": 1,
            "total_equity": 90000.0,
            "total_market_value": 90000.0,
            "total_cash": 0.0,
            "asset_breakdown": {"insurance": 90000.0},
            "accounts": [
                {
                    "account_id": 7,
                    "account_name": "保险账户",
                    "market": "insurance",
                    "base_currency": "CNY",
                    "total_equity": 90000.0,
                    "positions": [
                        {
                            "symbol": "INS:1",
                            "display_name": "测试年金险",
                            "market": "insurance",
                            "currency": "CNY",
                            "quantity": 1.0,
                            "avg_cost": 100000.0,
                            "total_cost": 100000.0,
                            "last_price": 90000.0,
                            "market_value_base": 90000.0,
                            "unrealized_pnl_base": -10000.0,
                            "unrealized_pnl_pct": -10.0,
                            "price_available": True,
                            "price_source": "insurance_value_update",
                            "price_date": "2026-04-20",
                            "price_stale": True,
                            "policy_name": "测试年金险",
                            "insurer": "测试保险",
                            "insurance_kind": "annuity",
                            "design_type": "participating",
                            "policy_status": "active",
                            "payment_mode": "annual",
                            "premium_per_period": 20000.0,
                            "first_payment_date": "2024-04-20",
                            "total_periods": 5,
                            "paid_periods": 2,
                            "paid_premium": 100000.0,
                            "received_amount": 5000.0,
                            "cash_value": 90000.0,
                            "value_date": "2026-04-20",
                            "next_payment_date": "2027-04-20",
                            "value_estimated": False,
                        }
                    ],
                }
            ],
        }
        risk = {"concentration": {}, "sector_concentration": {}, "drawdown": {}, "stop_loss": {}}
        payload = self._build_service()._build_compact_payload(
            snapshot=snapshot,
            risk=risk,
            account_id=7,
            snapshot_signature="sig",
        )

        summary = payload["保险资产摘要"]
        self.assertEqual(summary["policyCount"], 1)
        self.assertEqual(summary["activePolicyCount"], 1)
        self.assertEqual(summary["paidPremiumTotal"], 100000.0)
        self.assertEqual(summary["cashValueTotal"], 90000.0)
        self.assertEqual(summary["receivedAmountTotal"], 5000.0)
        self.assertEqual(summary["cashValueToPaidPremiumPct"], 90.0)
        self.assertEqual(summary["staleValueCount"], 1)
        self.assertEqual(summary["nextPaymentDate"], "2027-04-20")
        self.assertEqual(summary["byInsuranceKind"][0]["key"], "annuity")

        position = payload["主要持仓"][0]
        self.assertEqual(position["insuranceKind"], "annuity")
        self.assertEqual(position["designType"], "participating")
        self.assertEqual(position["paidPremium"], 100000.0)
        self.assertEqual(position["cashValue"], 90000.0)
        self.assertEqual(position["nextPaymentDate"], "2027-04-20")

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
            or (
                '{"summary_points":["现金充足","权益为主","集中度可控"],'
                '"full_markdown":"## 数据覆盖与口径\\n本地快照可用。\\n\\n'
                '## 资产配置结构\\n权益为主。\\n\\n'
                '## 四笔钱配置诊断\\n当前标签下权益资产占比较高，需要结合四笔钱归属检查风险承受度。"}'
            ),
        )
        service = PortfolioAnalysisService(
            portfolio_service=SimpleNamespace(get_portfolio_snapshot=lambda **kwargs: snapshot),
            risk_service=SimpleNamespace(get_risk_report=lambda **kwargs: risk),
            analyzer=analyzer,
            config=SimpleNamespace(),
        )
        service.save_report = lambda **kwargs: kwargs["payload"]

        with patch.object(service, "_build_asset_specialist_analysis", return_value={}):
            result = service.analyze(snapshot_signature="sig")

        self.assertEqual(result["analysis_mode"], "standard")
        self.assertEqual(result["analysis_schema_version"], PORTFOLIO_ANALYSIS_SCHEMA_VERSION)
        self.assertEqual(calls[0]["call_type"], "portfolio_analysis")

    def test_analyze_rejects_markdown_when_llm_omits_json_wrapper(self) -> None:
        snapshot = {
            "as_of": "2026-05-05",
            "cost_method": "fifo",
            "currency": "CNY",
            "account_count": 1,
            "total_equity": 10000.0,
            "total_market_value": 8000.0,
            "total_cash": 2000.0,
            "asset_breakdown": {"fund": 8000.0, "cash": 2000.0},
            "accounts": [
                {
                    "account_id": 1,
                    "account_name": "测试基金账户",
                    "market": "fund",
                    "total_equity": 10000.0,
                    "positions": [
                        {
                            "symbol": "000290",
                            "display_name": "测试基金",
                            "market": "fund",
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
        markdown = (
            "## 专业数据覆盖与可信度\n"
            "盈米专业数据已覆盖基金部分，结论可作为基金专项参考。\n\n"
            "## 数据口径一致性检查\n"
            "不同统计口径基本一致，现金和基金市值可以用于组合判断。\n\n"
            "## 资产配置结构\n"
            "基金资产为主，现金提供一定流动性缓冲。\n\n"
            "## 四笔钱配置诊断\n"
            "当前基金资产需要结合四笔钱标签判断是否匹配稳健增强或长期压舱属性。"
        )
        analyzer = SimpleNamespace(
            is_available=lambda: True,
            generate_text=lambda prompt, **kwargs: markdown,
        )
        service = PortfolioAnalysisService(
            portfolio_service=SimpleNamespace(get_portfolio_snapshot=lambda **kwargs: snapshot),
            risk_service=SimpleNamespace(get_risk_report=lambda **kwargs: risk),
            analyzer=analyzer,
            config=SimpleNamespace(yingmi_fund_data_strategy="basic_only"),
        )
        service.save_report = lambda **kwargs: kwargs["payload"]

        with patch.object(service, "_build_asset_specialist_analysis", return_value={}):
            with self.assertRaisesRegex(PortfolioAnalysisError, "有效 JSON"):
                service.analyze(snapshot_signature="sig", mode="deep")


if __name__ == "__main__":
    unittest.main()
