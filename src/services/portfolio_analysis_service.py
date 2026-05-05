# -*- coding: utf-8 -*-
"""LLM-backed portfolio asset analysis service."""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from src.analyzer import GeminiAnalyzer
from src.config import (
    Config,
    get_config,
    normalize_yingmi_fund_analysis_depth,
    normalize_yingmi_fund_data_strategy,
)
from src.services.portfolio_risk_service import PortfolioRiskService
from src.services.portfolio_service import PortfolioService


PORTFOLIO_ANALYSIS_PROMPT_KEYS = {
    "all_standard": "PORTFOLIO_ANALYSIS_PROMPT_ALL_QUICK",
    "all_quick": "PORTFOLIO_ANALYSIS_PROMPT_ALL_QUICK",
    "all_deep": "PORTFOLIO_ANALYSIS_PROMPT_ALL_DEEP",
    "all_wealth_report": "PORTFOLIO_ANALYSIS_PROMPT_ALL_WEALTH_REPORT",
    "stock": "PORTFOLIO_ANALYSIS_PROMPT_STOCK",
    "fund": "PORTFOLIO_ANALYSIS_PROMPT_FUND",
    "advisory": "PORTFOLIO_ANALYSIS_PROMPT_ADVISORY",
    "bank": "PORTFOLIO_ANALYSIS_PROMPT_BANK",
    "insurance_basic": "PORTFOLIO_ANALYSIS_PROMPT_INSURANCE_BASIC",
}

logger = logging.getLogger(__name__)

PORTFOLIO_ANALYSIS_DEFAULT_PROMPTS: Dict[str, str] = {
    "all_standard": (
        "以家庭总资产视角生成一份资产分析报告。先判断大类资产配置、现金/负债、账户和币种分布、"
        "集中度、流动性和收益风险画像；再把基金/投顾等适用资产的盈米专业诊断作为专项输入整合进报告。"
        "盈米只负责其适用的基金/投顾部分，其他资产基于本地持仓快照和风险指标判断。保险只按资产属性做基础判断。"
    ),
    "all_quick": (
        "以家庭总资产视角分析当前全部账户。重点判断资产配置是否均衡、现金与银行资产是否足够、"
        "股票/基金/投顾/保险/数字货币之间是否存在明显集中或流动性问题。保险只按已录入现金价值、"
        "已交保费和返还流水做资产层面的基础判断，不做保障责任适配。数字货币只作为高波动另类资产风险敞口。"
    ),
    "all_deep": (
        "以家庭总资产体检视角做深度诊断。先分析资产配置、账户分布、币种暴露、现金流动性和集中度，"
        "再结合专业投顾诊断中的基金/投顾组合风险、资产配置、相关性或回测信息。对未被专业数据覆盖的资产，"
        "只基于本地持仓快照判断，并明确说明数据覆盖不足。"
    ),
    "all_wealth_report": (
        "生成适合留档的家庭财富报告。报告应覆盖总资产结构、账户和币种分布、主要风险来源、流动性、"
        "基金/投顾专业诊断摘要、保险基础资产情况和后续观察事项。语气正式、克制，不承诺收益，不给直接交易指令。"
    ),
    "stock": (
        "只分析股票账户。重点关注单一持仓集中度、市场和币种暴露、股票行业集中度、盈亏结构和回撤风险。"
        "不要强行分析基金、银行、保险或数字货币逻辑，不给明确买卖指令。"
    ),
    "fund": (
        "只分析场外基金账户。重点关注基金组合的资产配置、风险等级、收益波动、基金集中度和是否适合作为核心/卫星配置。"
        "如果存在盈米专业数据，优先使用专业诊断；否则使用净值、表现和本地风险指标。"
    ),
    "advisory": (
        "只分析投顾组合账户。重点关注投顾产品风格、风险等级、持仓金额集中度、净值更新情况和组合适配性。"
        "如存在盈米投顾策略数据，优先作为专业判断依据。"
    ),
    "bank": (
        "只分析银行账户。重点关注活期、定期和银行理财的占比，期限分布，年化利率，风险等级，现金冗余和到期流动性。"
        "不要用股票或基金的收益波动框架硬套银行资产。"
    ),
    "insurance_basic": (
        "只分析保险账户的资产属性。重点关注已交保费、当前现金价值、返还/年金/分红流水、未来缴费压力和流动性。"
        "不要评价疾病、身故、医疗等保障责任是否充足；如数据不足，明确说明保险专项分析能力暂未接入。"
    ),
}


def get_portfolio_analysis_default_prompt(prompt_key: str) -> str:
    return PORTFOLIO_ANALYSIS_DEFAULT_PROMPTS.get(prompt_key, PORTFOLIO_ANALYSIS_DEFAULT_PROMPTS["all_quick"])


class PortfolioAnalysisError(ValueError):
    """Raised when portfolio analysis cannot be generated."""


class PortfolioAnalysisService:
    """Generate concise multi-asset portfolio analysis from snapshot + risk data."""

    def __init__(
        self,
        *,
        portfolio_service: Optional[PortfolioService] = None,
        risk_service: Optional[PortfolioRiskService] = None,
        analyzer: Optional[GeminiAnalyzer] = None,
        config: Optional[Config] = None,
    ) -> None:
        self.config = config or get_config()
        self.portfolio_service = portfolio_service or PortfolioService()
        self.risk_service = risk_service or PortfolioRiskService(portfolio_service=self.portfolio_service)
        self.analyzer = analyzer or GeminiAnalyzer(config=self.config)

    def analyze(
        self,
        *,
        account_id: Optional[int] = None,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
        snapshot_signature: str = "",
        mode: str = "quick",
    ) -> Dict[str, Any]:
        if not self.analyzer.is_available():
            raise PortfolioAnalysisError("LLM API Key 未配置，无法生成资产分析。")

        started_at = time.perf_counter()
        requested_mode = mode if mode in {"standard", "quick", "deep", "wealth_report"} else "standard"
        analysis_mode = "standard"
        as_of_date = as_of or date.today()
        logger.info(
            "持仓资产分析开始: scope=%s mode=%s as_of=%s cost_method=%s signature=%s",
            "all" if account_id is None else account_id,
            requested_mode,
            as_of_date.isoformat(),
            cost_method,
            snapshot_signature[:12],
        )
        snapshot = self.portfolio_service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=as_of_date,
            cost_method=cost_method,
        )
        risk = self.risk_service.get_risk_report(
            account_id=account_id,
            as_of=as_of_date,
            cost_method=cost_method,
        )
        compact_payload = self._build_compact_payload(
            snapshot=snapshot,
            risk=risk,
            account_id=account_id,
            snapshot_signature=snapshot_signature,
        )
        compact_payload["资产专项分析"] = self._build_asset_specialist_analysis(compact_payload.get("主要持仓") or [])
        provider_status: List[Dict[str, Any]] = []
        strategy = normalize_yingmi_fund_data_strategy(getattr(self.config, "yingmi_fund_data_strategy", None))
        if strategy == "basic_only":
            professional = {
                "data": {},
                "providerStatus": [
                    {
                        "provider": "yingmi_stargate",
                        "stage": "configure",
                        "available": False,
                        "message": "基金数据策略为仅基础数据，已跳过盈米基金/投顾专项诊断。",
                    }
                ],
            }
        else:
            professional = self._build_professional_analysis(self._flatten_positions(snapshot))
        compact_payload["专业投顾诊断"] = professional.get("data") or {}
        provider_status = professional.get("providerStatus") or []
        compact_payload["专业数据调用状态"] = provider_status
        compact_payload["analysisMode"] = analysis_mode
        prompt = self._build_prompt(compact_payload, mode=analysis_mode, account_id=account_id)
        max_tokens = 4800
        raw_text = self.analyzer.generate_text(
            prompt,
            max_tokens=max_tokens,
            temperature=0.25,
            call_type="portfolio_analysis",
        )
        if not raw_text:
            raise PortfolioAnalysisError("LLM 未返回资产分析结果。")

        try:
            parsed = self._parse_llm_json(raw_text)
        except PortfolioAnalysisError as exc:
            logger.warning(
                "持仓资产分析 LLM JSON 解析失败，尝试 Markdown 兜底: mode=%s response_chars=%s error=%s tail=%r",
                analysis_mode,
                len(raw_text),
                exc,
                raw_text[-240:],
            )
            parsed = self._parse_llm_markdown(raw_text)
        summary_points = self._normalize_summary_points(parsed.get("summary_points"))
        full_markdown = self._sanitize_markdown(str(parsed.get("full_markdown") or "").strip())
        if not summary_points or not full_markdown:
            raise PortfolioAnalysisError("LLM 返回的资产分析结构不完整。")

        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        yingmi_ok = sum(1 for item in provider_status if item.get("available") is True)
        yingmi_failed = sum(1 for item in provider_status if item.get("available") is False)
        logger.info(
            "持仓资产分析完成: scope=%s mode=%s positions=%s prompt_chars=%s response_chars=%s "
            "yingmi_ok=%s yingmi_failed=%s elapsed_ms=%s",
            "all" if account_id is None else account_id,
            analysis_mode,
            compact_payload.get("持仓数量"),
            len(prompt),
            len(raw_text),
            yingmi_ok,
            yingmi_failed,
            elapsed_ms,
        )
        return {
            "as_of": str(snapshot.get("as_of") or as_of_date.isoformat()),
            "snapshot_signature": snapshot_signature,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "summary_points": summary_points,
            "full_markdown": full_markdown,
            "model_used": (getattr(self.config, "litellm_model", "") or None),
            "analysis_mode": analysis_mode,
            "provider_status": provider_status,
        }

    def _build_compact_payload(
        self,
        *,
        snapshot: Dict[str, Any],
        risk: Dict[str, Any],
        account_id: Optional[int],
        snapshot_signature: str,
    ) -> Dict[str, Any]:
        positions = self._flatten_positions(snapshot)
        total_equity = float(snapshot.get("total_equity") or 0.0)
        total_cash = float(snapshot.get("total_cash") or 0.0)
        cash_pct = total_cash / total_equity * 100.0 if abs(total_equity) > 1e-8 else None
        report_currency = str(snapshot.get("currency") or "CNY").strip().upper() or "CNY"

        return {
            "asOf": snapshot.get("as_of"),
            "accountId": account_id,
            "costMethod": snapshot.get("cost_method"),
            "snapshotSignature": snapshot_signature,
            "报告币种": report_currency,
            "accountCount": snapshot.get("account_count"),
            "totals": {
                "totalEquity": snapshot.get("total_equity"),
                "totalMarketValue": snapshot.get("total_market_value"),
                "totalCash": snapshot.get("total_cash"),
                "cashPct": round(cash_pct, 4) if cash_pct is not None else None,
                "unrealizedPnl": snapshot.get("unrealized_pnl"),
                "realizedPnl": snapshot.get("realized_pnl"),
            },
            "fx": {
                "stale": bool(snapshot.get("fx_stale")),
                "missing": bool(snapshot.get("fx_missing")),
                "missingPairs": snapshot.get("missing_fx_pairs") or [],
            },
            "金额口径说明": (
                "组合汇总、资产分布、市场分布、风险指标均为报告币种金额；"
                "主要持仓同时提供账户本位币金额和报告币种折算金额，不应直接比较不同币种裸数字。"
            ),
            "按资产类型汇总": self._format_breakdown(snapshot.get("asset_breakdown") or {}),
            "按账户汇总": self._build_account_breakdown(snapshot),
            "按市场汇总": self._build_breakdown(positions, "market"),
            "按币种汇总": self._build_breakdown(positions, "currency"),
            "持仓数量": len(positions),
            "缺价持仓数量": sum(1 for item in positions if item.get("priceAvailable") is False),
            "现金是否为负": total_cash < 0,
            "主要持仓": positions[:10],
            "风险指标": {
                "最大单一持仓权重百分比": (risk.get("concentration") or {}).get("top_weight_pct"),
                "是否触发集中度告警": (risk.get("concentration") or {}).get("alert"),
                "主要持仓集中度": self._format_risk_positions(
                    (risk.get("concentration") or {}).get("top_positions") or [],
                    report_currency=report_currency,
                ),
                "股票行业集中度": risk.get("sector_concentration") or {},
                "回撤指标": risk.get("drawdown") or {},
                "止损预警": risk.get("stop_loss") or {},
            },
        }

    def _flatten_positions(self, snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        as_of_date = self._parse_snapshot_date(snapshot.get("as_of"))
        report_currency = str(snapshot.get("currency") or "CNY").strip().upper() or "CNY"
        for account in snapshot.get("accounts") or []:
            account_currency = str(account.get("base_currency") or report_currency).strip().upper() or report_currency
            for pos in account.get("positions") or []:
                market_value_account = float(pos.get("market_value_base") or 0.0)
                total_cost_account = float(pos.get("total_cost") or 0.0)
                unrealized_pnl_account = float(pos.get("unrealized_pnl_base") or 0.0)
                market_value_report = self._convert_position_amount(
                    market_value_account,
                    from_currency=account_currency,
                    to_currency=report_currency,
                    as_of_date=as_of_date,
                )
                total_cost_report = self._convert_position_amount(
                    total_cost_account,
                    from_currency=account_currency,
                    to_currency=report_currency,
                    as_of_date=as_of_date,
                )
                unrealized_pnl_report = self._convert_position_amount(
                    unrealized_pnl_account,
                    from_currency=account_currency,
                    to_currency=report_currency,
                    as_of_date=as_of_date,
                )
                rows.append(
                    {
                        "accountId": account.get("account_id"),
                        "accountName": account.get("account_name"),
                        "symbol": pos.get("symbol"),
                        "displayName": pos.get("display_name"),
                        "market": pos.get("market"),
                        "currency": pos.get("currency"),
                        "账户本位币": account_currency,
                        "报告币种": report_currency,
                        "quantity": pos.get("quantity"),
                        "avgCost": pos.get("avg_cost"),
                        "市值_账户本位币": round(market_value_account, 6),
                        "市值_报告币种": round(market_value_report, 6) if market_value_report is not None else None,
                        "成本_账户本位币": round(total_cost_account, 6),
                        "成本_报告币种": round(total_cost_report, 6) if total_cost_report is not None else None,
                        "浮盈亏_账户本位币": round(unrealized_pnl_account, 6),
                        "浮盈亏_报告币种": (
                            round(unrealized_pnl_report, 6) if unrealized_pnl_report is not None else None
                        ),
                        "unrealizedPnlPct": pos.get("unrealized_pnl_pct"),
                        "priceAvailable": pos.get("price_available"),
                        "priceSource": pos.get("price_source"),
                    }
                )
        rows.sort(key=lambda item: float(item.get("市值_报告币种") or 0.0), reverse=True)
        return rows

    def _parse_snapshot_date(self, value: Any) -> date:
        try:
            return date.fromisoformat(str(value))
        except (TypeError, ValueError):
            return date.today()

    def _convert_position_amount(
        self,
        amount: float,
        *,
        from_currency: str,
        to_currency: str,
        as_of_date: date,
    ) -> Optional[float]:
        if not hasattr(self.portfolio_service, "convert_amount"):
            return float(amount) if from_currency == to_currency else None
        converted, _, _ = self.portfolio_service.convert_amount(
            amount=amount,
            from_currency=from_currency,
            to_currency=to_currency,
            as_of_date=as_of_date,
        )
        return converted

    def _format_breakdown(self, breakdown: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = [
            {"key": str(key), "value": float(value or 0.0)}
            for key, value in breakdown.items()
            if abs(float(value or 0.0)) > 1e-8
        ]
        rows.sort(key=lambda item: item["value"], reverse=True)
        return rows

    def _build_account_breakdown(self, snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = []
        total_equity = float(snapshot.get("total_equity") or 0.0)
        for account in snapshot.get("accounts") or []:
            equity = float(account.get("total_equity") or 0.0)
            rows.append(
                {
                    "accountId": account.get("account_id"),
                    "accountName": account.get("account_name"),
                    "market": account.get("market"),
                    "totalEquity": equity,
                    "weightPct": round(equity / total_equity * 100.0, 4) if abs(total_equity) > 1e-8 else None,
                }
            )
        rows.sort(key=lambda item: item["totalEquity"], reverse=True)
        return rows

    def _build_breakdown(self, positions: List[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
        totals: Dict[str, float] = {}
        for item in positions:
            group = str(item.get(key) or "unknown")
            totals[group] = totals.get(group, 0.0) + float(item.get("市值_报告币种") or 0.0)
        return self._format_breakdown(totals)

    def _format_risk_positions(self, rows: List[Dict[str, Any]], *, report_currency: str) -> List[Dict[str, Any]]:
        formatted: List[Dict[str, Any]] = []
        for item in rows:
            formatted.append(
                {
                    "symbol": item.get("symbol"),
                    "市值_报告币种": item.get("market_value_base"),
                    "报告币种": report_currency,
                    "weightPct": item.get("weight_pct"),
                    "isAlert": item.get("is_alert"),
                }
            )
        return formatted

    def _build_asset_specialist_analysis(self, positions: List[Dict[str, Any]]) -> Dict[str, Any]:
        data: Dict[str, Any] = {}
        equity_items = [
            item for item in positions
            if str(item.get("market") or "").strip().lower() in {"cn", "hk", "us"}
        ]
        if equity_items:
            data["权益资产趋势"] = self._build_equity_specialist_analysis(equity_items[:5])
        return data

    def _build_equity_specialist_analysis(self, positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for item in positions:
            symbol = str(item.get("symbol") or "").strip()
            if not symbol:
                continue
            row: Dict[str, Any] = {
                "symbol": symbol,
                "displayName": item.get("displayName") or symbol,
                "market": item.get("market"),
                "isEtfOrIndex": self._is_etf_or_index_position(item),
                "市值_报告币种": item.get("市值_报告币种"),
                "报告币种": item.get("报告币种"),
            }
            try:
                from src.agent.tools.analysis_tools import _handle_analyze_trend

                trend = _handle_analyze_trend(symbol)
                row["trend"] = self._compact_specialist_value(trend)
            except Exception as exc:
                row["trend"] = {"error": str(exc)}
            rows.append(row)
        return rows

    @staticmethod
    def _is_etf_or_index_position(item: Dict[str, Any]) -> bool:
        symbol = str(item.get("symbol") or "").strip().upper()
        name = str(item.get("displayName") or "").strip().lower()
        if "etf" in name or "lof" in name or "指数" in name:
            return True
        code = symbol[-6:] if "." in symbol else symbol
        return code.isdigit() and code.startswith(("15", "16", "18", "50", "51", "52", "56", "58"))

    def _compact_specialist_value(self, value: Any) -> Any:
        return self._compact_json_value(value, depth=3, max_list_items=8, max_text_length=500)

    def _build_professional_analysis(self, positions: List[Dict[str, Any]]) -> Dict[str, Any]:
        provider_status: List[Dict[str, Any]] = []
        data: Dict[str, Any] = {}
        fund_positions = self._extract_yingmi_fund_positions(positions)
        advisory_positions = [item for item in positions if item.get("market") == "advisory"]

        try:
            from src.services.yingmi_stargate_client import YingmiStargateClient, YingmiStargateError

            client = YingmiStargateClient(timeout=12.0)
        except Exception as exc:
            return {
                "data": data,
                "providerStatus": [
                    {
                        "provider": "yingmi_stargate",
                        "stage": "configure",
                        "available": False,
                        "message": str(exc),
                    }
                ],
            }

        if fund_positions:
            depth = normalize_yingmi_fund_analysis_depth(getattr(self.config, "yingmi_fund_analysis_depth", None))
            fund_list = [
                {
                    "fundCode": item["fundCode"],
                    "fundName": item.get("fundName"),
                    "amount": item.get("amount"),
                }
                for item in fund_positions
            ]
            total_amount = sum(float(item.get("amount") or 0.0) for item in fund_positions)
            holdings = [
                {
                    "fundCode": item["fundCode"],
                    "weight": round(float(item.get("amount") or 0.0) / total_amount, 6) if total_amount > 0 else 0,
                }
                for item in fund_positions
            ]
            calls = [
                ("asset_allocation", lambda: client.get_asset_allocation(fund_list)),
                ("fund_diagnosis", lambda: self._build_fund_diagnosis_map(client, fund_positions)),
            ]
            if depth != "fast":
                calls.append(("portfolio_risk", lambda: client.analyze_portfolio_risk(holdings)))
                calls.append(("fund_risk", lambda: client.analyze_fund_risk([item["fundCode"] for item in fund_positions])))
            if depth == "deep":
                calls.append(("funds_backtest", lambda: client.get_funds_backtest(fund_list)))
            if depth == "deep" and len(fund_positions) >= 2:
                calls.append(("funds_correlation", lambda: client.get_funds_correlation([item["fundCode"] for item in fund_positions])))
            for stage, caller in calls:
                self._call_yingmi_stage(data, provider_status, stage, caller, YingmiStargateError)
        else:
            provider_status.append(
                {
                    "provider": "yingmi_stargate",
                    "stage": "fund_portfolio",
                    "available": False,
                    "message": "当前持仓没有可用于盈米组合诊断的场外基金。",
                }
            )

        for item in advisory_positions[:3]:
            keyword = str(item.get("displayName") or item.get("symbol") or "").strip()
            if not keyword:
                continue
            self._call_yingmi_stage(
                data,
                provider_status,
                f"strategy_search:{keyword}",
                lambda keyword=keyword: client.search_strategies(keyword, page_size=5),
                YingmiStargateError,
            )

        return {"data": data, "providerStatus": provider_status}

    def _build_fund_diagnosis_map(self, client: Any, fund_positions: List[Dict[str, Any]]) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        for item in fund_positions[:5]:
            code = str(item.get("fundCode") or "").strip()
            if not code:
                continue
            result[code] = self._compact_specialist_value(client.get_fund_diagnosis(code))
        return result

    def _call_yingmi_stage(
        self,
        data: Dict[str, Any],
        provider_status: List[Dict[str, Any]],
        stage: str,
        caller: Any,
        error_cls: Any,
    ) -> None:
        try:
            data[stage] = caller()
            provider_status.append(
                {
                    "provider": "yingmi_stargate",
                    "stage": stage,
                    "available": True,
                    "message": "ok",
                }
            )
        except error_cls as exc:
            provider_status.append(
                {
                    "provider": "yingmi_stargate",
                    "stage": stage,
                    "available": False,
                    "message": str(exc),
                }
            )
        except Exception as exc:
            provider_status.append(
                {
                    "provider": "yingmi_stargate",
                    "stage": stage,
                    "available": False,
                    "message": str(exc),
                }
            )

    def _compact_json_value(
        self,
        value: Any,
        *,
        depth: int = 3,
        max_list_items: int = 8,
        max_text_length: int = 500,
    ) -> Any:
        if depth <= 0:
            return self._truncate_scalar(value, max_text_length=max_text_length)
        if isinstance(value, dict):
            return {
                str(key): self._compact_json_value(
                    item,
                    depth=depth - 1,
                    max_list_items=max_list_items,
                    max_text_length=max_text_length,
                )
                for key, item in list(value.items())[:30]
            }
        if isinstance(value, list):
            return [
                self._compact_json_value(
                    item,
                    depth=depth - 1,
                    max_list_items=max_list_items,
                    max_text_length=max_text_length,
                )
                for item in value[:max_list_items]
            ]
        return self._truncate_scalar(value, max_text_length=max_text_length)

    @staticmethod
    def _truncate_scalar(value: Any, *, max_text_length: int) -> Any:
        if isinstance(value, str):
            return value[:max_text_length]
        if isinstance(value, (int, float, bool)) or value is None:
            return value
        return str(value)[:max_text_length]

    def _extract_yingmi_fund_positions(self, positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        for item in positions:
            symbol = str(item.get("symbol") or "").strip()
            if item.get("market") != "fund" or not re.fullmatch(r"\d{6}", symbol):
                continue
            amount = float(item.get("市值_报告币种") or item.get("marketValueBase") or 0.0)
            if amount <= 0:
                amount = max(float(item.get("成本_报告币种") or item.get("totalCost") or 0.0), 0.0)
            if amount <= 0:
                continue
            result.append(
                {
                    "fundCode": symbol,
                    "fundName": item.get("displayName") or symbol,
                    "amount": amount,
                }
            )
        return result

    def _resolve_prompt_key(self, payload: Dict[str, Any], *, mode: str, account_id: Optional[int]) -> str:
        if account_id is None:
            return "all_standard"

        account_rows = payload.get("按账户汇总") or []
        account_market = ""
        if account_rows:
            account_market = str(account_rows[0].get("market") or "").strip().lower()
        if account_market in {"cn", "hk", "us"}:
            return "stock"
        if account_market in {"fund", "advisory", "bank"}:
            return account_market
        if account_market == "insurance":
            return "insurance_basic"
        return "all_quick"

    def _get_prompt_instruction(self, prompt_key: str) -> str:
        env_key = PORTFOLIO_ANALYSIS_PROMPT_KEYS.get(prompt_key, "")
        configured = str(getattr(self.config, env_key.lower(), "") or "").strip() if env_key else ""
        return configured or get_portfolio_analysis_default_prompt(prompt_key)

    def _build_prompt(
        self,
        payload: Dict[str, Any],
        *,
        mode: str = "quick",
        account_id: Optional[int] = None,
    ) -> str:
        prompt_key = self._resolve_prompt_key(payload, mode=mode, account_id=account_id)
        scenario_instruction = self._get_prompt_instruction(prompt_key)
        mode_instruction = self._get_mode_instruction(mode)
        output_template = self._get_output_template(mode)
        return (
            "你是一名面向个人投资者的多资产组合分析师。请基于用户当前持仓快照，生成简洁、专业、非交易指令式的资产分析。\n\n"
            f"本次分析场景：{scenario_instruction}\n\n"
            f"本次模式要求：\n{mode_instruction}\n\n"
            "重要要求：\n"
            "- 只分析组合结构与风险画像，不给具体买入/卖出指令。\n"
            "- 不预测短期涨跌，不承诺收益。\n"
            "- 必须使用中文。\n"
            "- 结论必须基于输入数据；数据缺失时说明“不足以判断”，不要编造。\n"
            "- 简要要点只能输出 3 条，每条不超过 45 个中文字符。\n"
            "- 完整分析用 Markdown 输出，控制在 1000-1400 字；每个章节用 1-3 个紧凑段落。\n"
            "- 行业/主题集中度只用于股票类资产；基金、银行和数字货币不要强行归入股票行业。\n\n"
            "专业数据使用要求：\n"
            "- 盈米只用于基金/投顾等适用资产的专项分析，不得把 ETH、银行理财、定期存款、股票 ETF、现金或保险资产交给盈米解释。\n"
            "- 当存在“专业投顾诊断”时，基金和投顾组合部分优先采用盈米专业诊断、组合风险、资产配置、相关性和回测信息。\n"
            "- 当存在“资产专项分析”时，股票 ETF、个股等权益资产应结合趋势、均线、量能和价格数据判断，不要因为它不是个股行业资产就忽略。\n"
            "- 必须阅读“专业数据调用状态”，说明哪些专业能力成功、失败或未覆盖；不要把失败的专业数据当成事实依据。\n"
            "- 最终报告必须由你整合全部资产完成：盈米结果只作为基金/投顾专项输入，其他资产使用本地快照、价格、现金、风险指标和汇率口径判断。\n"
            "- 当盈米数据缺失、失败或只覆盖部分基金/投顾时，要明确写出覆盖不足，并继续完成整体组合分析。\n\n"
            "金额口径要求：\n"
            "- 报告中的组合级总资产、资产分布、市场分布、风险指标都按“报告币种”理解。\n"
            "- 主要持仓里的“账户本位币”金额只用于说明原账户口径；跨账户、跨资产比较必须使用“报告币种”金额。\n"
            "- 禁止把同一资产的账户本位币金额和报告币种金额误判为重复计算、数据冲突或未列明资产。\n\n"
            "表达要求：\n"
            "- 面向普通用户写作，禁止在报告正文中出现任何输入 JSON 字段名、代码式变量名或英文 camelCase 标识。\n"
            "- 不要写“assetTypeBreakdown、marketBreakdown、topPositions、risk.topPositions、sectorConcentration、drawdown、stopLoss”等字段名。\n"
            "- 如果发现不同汇总口径不一致，用中文说“不同统计口径存在差异”，不要引用字段名。\n\n"
            "分析框架：\n"
            "1. 资产配置结构：判断组合偏权益、偏固收、偏现金、偏另类资产，说明主要资产类型占比。\n"
            "2. 风险暴露与集中度：检查单一资产、账户、市场、币种、行业/主题集中；行业只用于股票类资产。\n"
            "3. 收益风险画像：判断组合风格为进攻型/均衡型/防守型/现金型，说明收益来源和波动来源。\n\n"
            f"完整分析 Markdown 必须使用以下章节模板，不要增删一级章节：\n{output_template}\n\n"
            "输出必须是严格 JSON，不要添加 JSON 之外的解释：\n"
            "{\n"
            '  "summary_points": ["要点1", "要点2", "要点3"],\n'
            '  "full_markdown": "按指定 Markdown 章节模板输出完整分析"\n'
            "}\n\n"
            f"持仓快照数据：{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"
        )

    def _get_mode_instruction(self, mode: str) -> str:
        return (
            "- 本报告只有一个标准模式，必须保持完整质量。\n"
            "- 按资产属性动态展开：基金/投顾用盈米专项输入，股票 ETF、银行、现金、加密货币和保险使用各自合适的本地口径。\n"
            "- 不通过降低某些模式质量来制造差异，重点是把外部专业结果和本地多资产快照整合成一份一致报告。"
        )

    def _get_output_template(self, mode: str) -> str:
        return (
            "## 数据覆盖与口径\n"
            "说明本次本地快照、风险指标、盈米专项能力的覆盖范围；明确未覆盖或只适用于部分资产的地方。\n"
            "## 资产配置结构\n"
            "分析大类资产、账户、币种和现金/负债结构。\n"
            "## 风险暴露与集中度\n"
            "分析主要集中风险、流动性、缺价和止损预警。\n"
            "## 基金与投顾专项\n"
            "仅对基金/投顾资产整合盈米结果和本地持仓；若占比较低或无覆盖，要说明其对整体报告的影响有限。\n"
            "## ETF与权益专项\n"
            "对 ETF/股票资产使用趋势、价格和风险暴露数据分析；ETF 不做个股行业板块归因。\n"
            "## 收益风险画像\n"
            "归因收益来源、波动来源和组合风格。\n"
            "## 后续观察事项\n"
            "给出非交易指令式的结构优化方向和后续需要跟踪或修正的数据事项。"
        )

    def _sanitize_markdown(self, markdown: str) -> str:
        replacements = {
            "assetTypeBreakdown": "按资产类型汇总",
            "marketBreakdown": "按市场汇总",
            "currencyBreakdown": "按币种汇总",
            "accountBreakdown": "按账户汇总",
            "topPositions": "主要持仓",
            "risk.topPositions": "主要持仓风险数据",
            "risk.topPositionWeightPct": "最大单一持仓权重",
            "sectorConcentration": "股票行业集中度",
            "drawdown": "回撤指标",
            "stopLoss": "止损预警",
            "positionCount": "持仓数量",
            "missingPriceCount": "缺价持仓数量",
            "negativeCash": "现金为负",
        }
        sanitized = markdown
        for raw, label in replacements.items():
            sanitized = sanitized.replace(raw, label)
        sanitized = re.sub(r"`([^`]*(?:Breakdown|Positions|Concentration|drawdown|stopLoss)[^`]*)`", r"\1", sanitized)
        return sanitized

    def _parse_llm_json(self, text: str) -> Dict[str, Any]:
        match = re.search(r"\{.*\}", text, flags=re.S)
        if not match:
            raise PortfolioAnalysisError("LLM 返回不是有效 JSON。")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise PortfolioAnalysisError(f"LLM JSON 解析失败: {exc}") from exc
        if not isinstance(parsed, dict):
            raise PortfolioAnalysisError("LLM JSON 根节点不是对象。")
        return parsed

    def _parse_llm_markdown(self, text: str) -> Dict[str, Any]:
        markdown = self._extract_markdown_body(text)
        if not markdown:
            raise PortfolioAnalysisError("LLM 返回不是有效 JSON，且未找到可用 Markdown 正文。")
        summary_points = self._derive_summary_points(markdown)
        if not summary_points:
            raise PortfolioAnalysisError("LLM Markdown 兜底失败，无法提取摘要要点。")
        logger.info(
            "持仓资产分析已使用 Markdown 兜底解析: response_chars=%s markdown_chars=%s",
            len(text),
            len(markdown),
        )
        return {
            "summary_points": summary_points,
            "full_markdown": markdown,
        }

    def _extract_markdown_body(self, text: str) -> str:
        cleaned = str(text or "").strip()
        if not cleaned:
            return ""
        cleaned = re.sub(r"^```(?:json|markdown|md)?\s*", "", cleaned, flags=re.I)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        markdown_match = re.search(r"(##\s+.+)", cleaned, flags=re.S)
        if markdown_match:
            cleaned = markdown_match.group(1).strip()
        heading_count = len(re.findall(r"^##\s+", cleaned, flags=re.M))
        if heading_count < 2:
            return ""
        return self._sanitize_markdown(cleaned)

    def _derive_summary_points(self, markdown: str) -> List[str]:
        points: List[str] = []
        for raw_line in markdown.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            line = re.sub(r"^[\-*]\s+", "", line)
            line = re.sub(r"^\*\*(.+?)\*\*[：:]\s*", r"\1：", line)
            line = re.sub(r"\*\*", "", line)
            line = re.sub(r"`", "", line)
            if len(line) < 8:
                continue
            sentence = re.split(r"[。；;]", line, maxsplit=1)[0].strip()
            if sentence:
                points.append(sentence[:60])
            if len(points) >= 3:
                break
        return points

    def _normalize_summary_points(self, value: Any) -> List[str]:
        if not isinstance(value, list):
            return []
        points = []
        for item in value:
            text = str(item or "").strip()
            if text:
                points.append(text[:60])
            if len(points) >= 3:
                break
        return points
