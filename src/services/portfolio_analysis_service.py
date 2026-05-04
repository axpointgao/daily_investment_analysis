# -*- coding: utf-8 -*-
"""LLM-backed portfolio asset analysis service."""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from src.analyzer import GeminiAnalyzer
from src.config import Config, get_config
from src.services.portfolio_risk_service import PortfolioRiskService
from src.services.portfolio_service import PortfolioService


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
    ) -> Dict[str, Any]:
        if not self.analyzer.is_available():
            raise PortfolioAnalysisError("LLM API Key 未配置，无法生成资产分析。")

        as_of_date = as_of or date.today()
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
        prompt = self._build_prompt(compact_payload)
        raw_text = self.analyzer.generate_text(prompt, max_tokens=2400, temperature=0.25)
        if not raw_text:
            raise PortfolioAnalysisError("LLM 未返回资产分析结果。")

        parsed = self._parse_llm_json(raw_text)
        summary_points = self._normalize_summary_points(parsed.get("summary_points"))
        full_markdown = self._sanitize_markdown(str(parsed.get("full_markdown") or "").strip())
        if not summary_points or not full_markdown:
            raise PortfolioAnalysisError("LLM 返回的资产分析结构不完整。")

        return {
            "as_of": str(snapshot.get("as_of") or as_of_date.isoformat()),
            "snapshot_signature": snapshot_signature,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "summary_points": summary_points,
            "full_markdown": full_markdown,
            "model_used": (getattr(self.config, "litellm_model", "") or None),
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

        return {
            "asOf": snapshot.get("as_of"),
            "accountId": account_id,
            "costMethod": snapshot.get("cost_method"),
            "snapshotSignature": snapshot_signature,
            "currency": snapshot.get("currency"),
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
                "主要持仓集中度": (risk.get("concentration") or {}).get("top_positions") or [],
                "股票行业集中度": risk.get("sector_concentration") or {},
                "回撤指标": risk.get("drawdown") or {},
                "止损预警": risk.get("stop_loss") or {},
            },
        }

    def _flatten_positions(self, snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts") or []:
            for pos in account.get("positions") or []:
                rows.append(
                    {
                        "accountId": account.get("account_id"),
                        "accountName": account.get("account_name"),
                        "symbol": pos.get("symbol"),
                        "displayName": pos.get("display_name"),
                        "market": pos.get("market"),
                        "currency": pos.get("currency"),
                        "quantity": pos.get("quantity"),
                        "marketValueBase": pos.get("market_value_base"),
                        "unrealizedPnlBase": pos.get("unrealized_pnl_base"),
                        "unrealizedPnlPct": pos.get("unrealized_pnl_pct"),
                        "priceAvailable": pos.get("price_available"),
                        "priceSource": pos.get("price_source"),
                    }
                )
        rows.sort(key=lambda item: float(item.get("marketValueBase") or 0.0), reverse=True)
        return rows

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
            totals[group] = totals.get(group, 0.0) + float(item.get("marketValueBase") or 0.0)
        return self._format_breakdown(totals)

    def _build_prompt(self, payload: Dict[str, Any]) -> str:
        return (
            "你是一名面向个人投资者的多资产组合分析师。请基于用户当前持仓快照，生成简洁、专业、非交易指令式的资产分析。\n\n"
            "重要要求：\n"
            "- 只分析组合结构与风险画像，不给具体买入/卖出指令。\n"
            "- 不预测短期涨跌，不承诺收益。\n"
            "- 必须使用中文。\n"
            "- 结论必须基于输入数据；数据缺失时说明“不足以判断”，不要编造。\n"
            "- 简要要点只能输出 3 条，每条不超过 45 个中文字符。\n"
            "- 完整分析用 Markdown 输出，控制在 800-1200 字。\n"
            "- 行业/主题集中度只用于股票类资产；基金、银行和数字货币不要强行归入股票行业。\n\n"
            "表达要求：\n"
            "- 面向普通用户写作，禁止在报告正文中出现任何输入 JSON 字段名、代码式变量名或英文 camelCase 标识。\n"
            "- 不要写“assetTypeBreakdown、marketBreakdown、topPositions、risk.topPositions、sectorConcentration、drawdown、stopLoss”等字段名。\n"
            "- 如果发现不同汇总口径不一致，用中文说“不同统计口径存在差异”，不要引用字段名。\n\n"
            "分析框架：\n"
            "1. 资产配置结构：判断组合偏权益、偏固收、偏现金、偏另类资产，说明主要资产类型占比。\n"
            "2. 风险暴露与集中度：检查单一资产、账户、市场、币种、行业/主题集中；行业只用于股票类资产。\n"
            "3. 收益风险画像：判断组合风格为进攻型/均衡型/防守型/现金型，说明收益来源和波动来源。\n\n"
            "输出必须是严格 JSON，不要添加 JSON 之外的解释：\n"
            "{\n"
            '  "summary_points": ["要点1", "要点2", "要点3"],\n'
            '  "full_markdown": "## 资产配置结构\\n...\\n## 风险暴露与集中度\\n...\\n## 收益风险画像\\n...\\n## 调整建议\\n..."\n'
            "}\n\n"
            f"持仓快照数据：{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"
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
