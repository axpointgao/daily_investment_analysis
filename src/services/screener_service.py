# -*- coding: utf-8 -*-
"""Low-frequency stock screener with local query and iWencai Excel import paths."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from data_provider.base import canonical_stock_code, normalize_stock_code
from src.config import get_config
from src.services.history_loader import load_history_df
from src.services.market_history_store import MarketHistoryStore

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScreenerStrategy:
    id: str
    name: str
    description: str
    cadence: str
    data_scope: tuple[str, ...]
    iwencai_fit: str


STRATEGIES: Dict[str, ScreenerStrategy] = {
    "quality_value": ScreenerStrategy(
        id="quality_value",
        name="基本面质量",
        description="偏低频，优先寻找估值不过热、盈利质量较好的公司。",
        cadence="每周/每两周",
        data_scope=("估值", "盈利", "财务质量"),
        iwencai_fit="适合后续用问财补公告、研报和经营细节。",
    ),
    "multi_factor": ScreenerStrategy(
        id="multi_factor",
        name="多因子稳健",
        description="综合趋势、量能、估值和盈利质量，避免单一指标误判。",
        cadence="每周",
        data_scope=("趋势", "量能", "估值", "盈利"),
        iwencai_fit="适合用问财做复杂条件选股对照。",
    ),
    "trend_follow": ScreenerStrategy(
        id="trend_follow",
        name="趋势共振",
        description="寻找价格站上中期均线、短中期趋势同步转强的股票。",
        cadence="每周 1-2 次",
        data_scope=("日线", "均线", "量能"),
        iwencai_fit="通常本地行情即可完成，问财不是必需。",
    ),
    "pullback": ScreenerStrategy(
        id="pullback",
        name="缩量回踩",
        description="寻找上涨趋势中回调靠近均线、但没有明显破位的股票。",
        cadence="每周 1-2 次",
        data_scope=("日线", "均线", "量能"),
        iwencai_fit="通常本地行情即可完成，问财只做风险核验。",
    ),
    "breakout": ScreenerStrategy(
        id="breakout",
        name="放量突破",
        description="寻找突破近阶段高点且量能配合的股票，风险高于回踩策略。",
        cadence="每周 1-2 次",
        data_scope=("日线", "高低点", "量能"),
        iwencai_fit="可用问财补板块热度和公告催化。",
    ),
}


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pct(value: Optional[float]) -> Optional[float]:
    return round(value, 2) if value is not None else None


def _normalize_codes(codes: Optional[Iterable[str]]) -> List[str]:
    raw_codes = list(codes or get_config().stock_list or [])
    normalized: List[str] = []
    for code in raw_codes:
        cleaned = canonical_stock_code(normalize_stock_code(str(code or "").strip()))
        if cleaned and cleaned not in normalized:
            normalized.append(cleaned)
    return normalized


def _split_query_terms(query: str) -> List[str]:
    terms = re.split(r"[;；,，\n]+", str(query or ""))
    return [term.strip() for term in terms if term.strip()]


def _extract_number(text: str) -> Optional[float]:
    match = re.search(r"(-?\d+(?:\.\d+)?)", text)
    return float(match.group(1)) if match else None


def _normalize_excel_header(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _iwencai_value(row: Dict[str, Any], *keywords: str) -> Any:
    for key, value in row.items():
        normalized = _normalize_excel_header(key)
        if all(keyword in normalized for keyword in keywords):
            return value
    return None


def _stringify_iwencai_fields(raw: Dict[str, Any], max_fields: int = 16) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    for key, value in raw.items():
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        fields[str(key)] = text[:120]
        if len(fields) >= max_fields:
            break
    return fields


def _coerce_excel_date(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if re.fullmatch(r"\d{8}", text):
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return text[:20] or None


def _parse_header_date(value: str) -> Optional[str]:
    match = re.search(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})", value)
    if not match:
        return None
    year, month, day = match.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


def _parse_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _latest_name(code: str, manager: Any) -> str:
    try:
        return manager.get_stock_name(code, allow_realtime=False) or code
    except Exception:
        return code


def _prepare_history(df: pd.DataFrame) -> pd.DataFrame:
    work = df.copy()
    if "date" in work.columns:
        work = work.sort_values("date")
    return work.tail(120).reset_index(drop=True)


def _build_technical_metrics(df: pd.DataFrame) -> Dict[str, Optional[float]]:
    close = df["close"].astype(float)
    volume = df["volume"].astype(float) if "volume" in df.columns else pd.Series(dtype=float)
    current = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) >= 2 else current
    ma5 = float(close.tail(5).mean()) if len(close) >= 5 else None
    ma10 = float(close.tail(10).mean()) if len(close) >= 10 else None
    ma20 = float(close.tail(20).mean()) if len(close) >= 20 else None
    ma60 = float(close.tail(60).mean()) if len(close) >= 60 else None
    high_20 = float(df["high"].astype(float).iloc[-21:-1].max()) if len(df) >= 21 and "high" in df.columns else None
    avg_vol_5 = float(volume.tail(5).mean()) if len(volume) >= 5 else None
    avg_vol_20 = float(volume.tail(20).mean()) if len(volume) >= 20 else avg_vol_5
    latest_vol = float(volume.iloc[-1]) if len(volume) else None
    volume_ratio = latest_vol / avg_vol_20 if latest_vol and avg_vol_20 else None
    return {
        "price": round(current, 4),
        "change_pct": _pct((current - prev) / prev * 100 if prev else None),
        "ma5": _pct(ma5),
        "ma10": _pct(ma10),
        "ma20": _pct(ma20),
        "ma60": _pct(ma60),
        "bias_ma20_pct": _pct((current - ma20) / ma20 * 100 if ma20 else None),
        "high_20": _pct(high_20),
        "volume_ratio_20d": _pct(volume_ratio),
    }


def _extract_fundamental_metrics(context: Dict[str, Any]) -> Dict[str, Optional[float]]:
    valuation = ((context.get("valuation") or {}).get("data") or {})
    growth = ((context.get("growth") or {}).get("data") or {})
    earnings = ((context.get("earnings") or {}).get("data") or {})
    metrics = {
        "pe_ratio": _safe_float(valuation.get("pe_ttm") or valuation.get("pe_ratio")),
        "pb_ratio": _safe_float(valuation.get("pb_ratio")),
        "roe": _safe_float(growth.get("roe") or earnings.get("roe")),
        "revenue_yoy": _safe_float(growth.get("revenue_yoy")),
        "net_profit_yoy": _safe_float(growth.get("net_profit_yoy")),
    }
    return {key: _pct(value) for key, value in metrics.items()}


@dataclass(frozen=True)
class LocalQueryPlan:
    supported_terms: List[str]
    unsupported_terms: List[str]
    where_clauses: List[str]
    order_by: Optional[str]

    @property
    def executable(self) -> bool:
        return bool(self.supported_terms) and not self.unsupported_terms


def _build_local_query_plan(query: str) -> LocalQueryPlan:
    supported: List[str] = []
    unsupported: List[str] = []
    clauses: List[str] = []
    order_by: Optional[str] = None

    for term in _split_query_terms(query):
        normalized = re.sub(r"\s+", "", term).lower()
        number = _extract_number(term)

        if normalized in {"非st", "不是st"} or "非st" in normalized:
            supported.append(term)
            clauses.append("(h.is_st IS NULL OR h.is_st = FALSE)")
        elif "非创业板" in term:
            supported.append(term)
            clauses.append("h.code NOT LIKE '300%' AND h.code NOT LIKE '301%'")
        elif "非科创" in term or "非科创版" in term:
            supported.append(term)
            clauses.append("h.code NOT LIKE '688%'")
        elif "中证" in term or "成分股" in term or "所属指数" in term:
            unsupported.append(term)
        elif "上市" in term and "交易日" in term:
            unsupported.append(term)
        elif "上市" in term and "300" in term and "天" in term:
            supported.append(term)
            clauses.append("h.list_date IS NOT NULL AND date_diff('day', h.list_date, h.trade_date) >= 300")
        elif "60日" in term and ("线上移" in term or "均线上移" in term):
            supported.append(term)
            clauses.append("h.ma60 IS NOT NULL AND p.prev_ma60 IS NOT NULL AND h.ma60 > p.prev_ma60")
        elif "股价" in term and "ma5" in normalized and ">" in term:
            supported.append(term)
            clauses.append("h.close IS NOT NULL AND h.ma5 IS NOT NULL AND h.close > h.ma5")
        elif "收盘价" in term and "60日线" in term and ("站上" in term or "大于" in term or ">" in term):
            supported.append(term)
            clauses.append("h.close IS NOT NULL AND h.ma60 IS NOT NULL AND h.close > h.ma60")
        elif "成交额" in term and number is not None:
            supported.append(term)
            threshold = number * 100000000 if "亿" in term else number
            operator = "<=" if any(mark in term for mark in ["小于", "<"]) else ">="
            clauses.append(f"h.amount IS NOT NULL AND h.amount {operator} {threshold}")
        elif "30日涨幅" in term:
            unsupported.append(term)
        elif "25日涨幅" in term and number is not None:
            supported.append(term)
            operator = "<=" if any(mark in term for mark in ["小于", "<"]) else ">="
            clauses.append(f"h.pct_chg_25d IS NOT NULL AND h.pct_chg_25d {operator} {number}")
        elif "市值从小到大" in term:
            supported.append(term)
            order_by = "h.total_mv ASC NULLS LAST"
        elif "市值从大到小" in term:
            supported.append(term)
            order_by = "h.total_mv DESC NULLS LAST"
        elif "pe" in normalized and number is not None:
            supported.append(term)
            operator = "<=" if any(mark in term for mark in ["小于", "<"]) else ">="
            if operator == "<=":
                clauses.append(f"h.pe_ttm IS NOT NULL AND h.pe_ttm > 0 AND h.pe_ttm {operator} {number}")
            else:
                clauses.append(f"h.pe_ttm IS NOT NULL AND h.pe_ttm {operator} {number}")
        elif "pb" in normalized and number is not None:
            supported.append(term)
            operator = "<=" if any(mark in term for mark in ["小于", "<"]) else ">="
            if operator == "<=":
                clauses.append(f"h.pb IS NOT NULL AND h.pb > 0 AND h.pb {operator} {number}")
            else:
                clauses.append(f"h.pb IS NOT NULL AND h.pb {operator} {number}")
        else:
            unsupported.append(term)

    return LocalQueryPlan(
        supported_terms=supported,
        unsupported_terms=unsupported,
        where_clauses=clauses,
        order_by=order_by,
    )


def _candidate_from_snapshot_row(row: Dict[str, Any], *, source: str) -> Dict[str, Any]:
    code = canonical_stock_code(normalize_stock_code(str(row.get("code") or "").strip()))
    name = str(row.get("name") or code)
    latest_date = str(row.get("trade_date") or row.get("date") or "")[:10] or None
    metrics = {
        "price": _pct(_parse_float(row.get("close"))),
        "change_pct": _pct(_parse_float(row.get("pct_chg"))),
        "amplitude": _pct(_parse_float(row.get("amplitude"))),
        "amount": _pct(_parse_float(row.get("amount"))),
        "turnover_rate": _pct(_parse_float(row.get("turnover_rate"))),
        "volume": _pct(_parse_float(row.get("volume"))),
        "ma5": _pct(_parse_float(row.get("ma5"))),
        "ma10": _pct(_parse_float(row.get("ma10"))),
        "ma20": _pct(_parse_float(row.get("ma20"))),
        "ma30": _pct(_parse_float(row.get("ma30"))),
        "ma60": _pct(_parse_float(row.get("ma60"))),
        "ma120": _pct(_parse_float(row.get("ma120"))),
        "ma250": _pct(_parse_float(row.get("ma250"))),
        "volume_ratio_20d": _pct(_parse_float(row.get("volume_ratio"))),
        "pct_chg_3d": _pct(_parse_float(row.get("pct_chg_3d"))),
        "pct_chg_6d": _pct(_parse_float(row.get("pct_chg_6d"))),
        "pct_chg_10d": _pct(_parse_float(row.get("pct_chg_10d"))),
        "pct_chg_25d": _pct(_parse_float(row.get("pct_chg_25d"))),
        "pe_ratio": _pct(_parse_float(row.get("pe_ttm"))),
        "pb_ratio": _pct(_parse_float(row.get("pb"))),
        "ps_ttm": _pct(_parse_float(row.get("ps_ttm"))),
        "total_mv": _pct(_parse_float(row.get("total_mv"))),
        "float_mv": _pct(_parse_float(row.get("float_mv"))),
    }
    reasons = []
    if metrics.get("pe_ratio") is not None:
        reasons.append(f"PE(TTM) {metrics['pe_ratio']}")
    if metrics.get("pb_ratio") is not None:
        reasons.append(f"PB {metrics['pb_ratio']}")
    if metrics.get("price") is not None and metrics.get("ma60") is not None:
        relation = ">" if float(metrics["price"]) > float(metrics["ma60"]) else "<="
        reasons.append(f"收盘价 {metrics['price']} {relation} 60日线 {metrics['ma60']}")
    if metrics.get("pct_chg_25d") is not None:
        reasons.append(f"25日涨幅 {metrics['pct_chg_25d']}%")
    if metrics.get("amount") is not None:
        reasons.append(f"成交额 {float(metrics['amount']) / 100000000:.2f}亿")
    if row.get("is_st") is False or str(row.get("is_st")).lower() in {"false", "0"}:
        reasons.append("非ST")

    return {
        "code": code,
        "name": name,
        "score": 1.0,
        "matched_strategies": ["local_query"],
        "reasons": reasons or ["满足本地策略筛选条件。"],
        "risks": [],
        "metrics": {key: value for key, value in metrics.items() if value is not None},
        "iwencai_fields": {},
        "latest_date": latest_date,
        "data_source": source,
    }


def _candidate_from_iwencai_row(row: Dict[str, Any], *, latest_date: Optional[str]) -> Optional[Dict[str, Any]]:
    code = _iwencai_value(row, "股票代码") or _iwencai_value(row, "代码")
    normalized_code = canonical_stock_code(normalize_stock_code(str(code or "").strip()))
    if not normalized_code:
        return None
    name = _iwencai_value(row, "股票简称") or _iwencai_value(row, "股票名称") or normalized_code
    close = _parse_float(_iwencai_value(row, "收盘价"))
    change_pct = _parse_float(_iwencai_value(row, "涨跌幅"))
    ma5 = _parse_float(_iwencai_value(row, "5日均线"))
    metrics = {
        "price": _pct(close),
        "change_pct": _pct(change_pct),
        "ma5": _pct(ma5),
    }
    return {
        "code": normalized_code,
        "name": str(name),
        "score": 1.0,
        "matched_strategies": ["iwencai_import"],
        "reasons": ["从问财导出的选股结果导入，作为候选股。"],
        "risks": ["导入结果未做本地增强分析，建议勾选候选股后再精选。"],
        "metrics": {key: value for key, value in metrics.items() if value is not None},
        "iwencai_fields": _stringify_iwencai_fields(row),
        "latest_date": latest_date,
        "data_source": "iwencai_import",
    }


def _score_technical(strategy_id: str, metrics: Dict[str, Optional[float]]) -> tuple[float, List[str], List[str]]:
    score = 0.0
    reasons: List[str] = []
    risks: List[str] = []
    price = metrics.get("price")
    ma5 = metrics.get("ma5")
    ma10 = metrics.get("ma10")
    ma20 = metrics.get("ma20")
    ma60 = metrics.get("ma60")
    bias20 = metrics.get("bias_ma20_pct")
    high20 = metrics.get("high_20")
    vol_ratio = metrics.get("volume_ratio_20d")

    if strategy_id in {"trend_follow", "multi_factor"}:
        if price and ma5 and ma10 and ma20 and price > ma5 > ma10 > ma20:
            score += 28
            reasons.append("价格位于 MA5/MA10/MA20 上方，短中期趋势同步。")
        elif price and ma20 and price > ma20:
            score += 14
            reasons.append("价格仍在 MA20 上方，趋势未明显破坏。")
        if ma20 and ma60 and ma20 > ma60:
            score += 12
            reasons.append("MA20 高于 MA60，中期结构偏强。")
        if vol_ratio and vol_ratio >= 1.15:
            score += 8
            reasons.append("近期量能高于 20 日均量，趋势有成交配合。")

    if strategy_id == "pullback":
        if price and ma20 and bias20 is not None and -3 <= bias20 <= 5:
            score += 26
            reasons.append("价格贴近 MA20，具备低频回踩观察价值。")
        if price and ma20 and price >= ma20:
            score += 14
            reasons.append("回踩未跌破 MA20，结构仍可观察。")
        if vol_ratio and vol_ratio <= 0.95:
            score += 12
            reasons.append("回调阶段量能未明显放大，抛压暂未失控。")

    if strategy_id == "breakout":
        if price and high20 and price > high20:
            score += 28
            reasons.append("收盘价突破近 20 日高点。")
        if vol_ratio and vol_ratio >= 1.4:
            score += 18
            reasons.append("突破伴随放量，信号强度提高。")
        if bias20 is not None and bias20 > 12:
            risks.append("价格偏离 MA20 较远，追高风险上升。")
            score -= 8

    if price and ma20 and price < ma20:
        risks.append("价格低于 MA20，趋势确认不足。")
    if vol_ratio and vol_ratio >= 2.5:
        risks.append("异常放量，需要排查消息面或高位分歧。")
    return max(score, 0.0), reasons, risks


def _score_fundamentals(strategy_id: str, metrics: Dict[str, Optional[float]]) -> tuple[float, List[str], List[str]]:
    score = 0.0
    reasons: List[str] = []
    risks: List[str] = []
    pe = metrics.get("pe_ratio")
    pb = metrics.get("pb_ratio")
    roe = metrics.get("roe")
    revenue_yoy = metrics.get("revenue_yoy")
    profit_yoy = metrics.get("net_profit_yoy")

    if strategy_id in {"quality_value", "multi_factor"}:
        if roe is not None and roe >= 10:
            score += 16
            reasons.append("ROE 达到双位数，盈利质量有基础。")
        if profit_yoy is not None and profit_yoy > 0:
            score += 12
            reasons.append("归母净利润同比为正，盈利没有明显恶化。")
        if revenue_yoy is not None and revenue_yoy > 0:
            score += 8
            reasons.append("营收同比为正，业务增长仍有支撑。")
        if pe is not None and 0 < pe <= 35:
            score += 10
            reasons.append("PE 处于不过热区间。")
        if pb is not None and 0 < pb <= 4:
            score += 6
            reasons.append("PB 未明显偏高。")
        if pe is not None and pe > 60:
            risks.append("PE 偏高，需要确认成长性能否支撑估值。")
        if profit_yoy is not None and profit_yoy < 0:
            risks.append("净利润同比为负，基本面质量扣分。")

    return max(score, 0.0), reasons, risks


class ScreenerService:
    """Evaluate bounded stock pools with local low-frequency strategies."""

    def __init__(self) -> None:
        from data_provider import DataFetcherManager

        self.manager = DataFetcherManager()

    @staticmethod
    def list_strategies() -> List[Dict[str, Any]]:
        return [
            {
                "id": item.id,
                "name": item.name,
                "description": item.description,
                "cadence": item.cadence,
                "data_scope": list(item.data_scope),
                "iwencai_fit": item.iwencai_fit,
            }
            for item in STRATEGIES.values()
        ]

    def run(
        self,
        *,
        strategy_ids: List[str],
        stock_codes: Optional[List[str]],
        limit: int = 30,
        include_fundamentals: bool = False,
        use_iwencai: bool = False,
        iwencai_query: Optional[str] = None,
        iwencai_page: int = 1,
    ) -> Dict[str, Any]:
        if iwencai_query:
            return self.run_local_query(iwencai_query, limit=limit, strategy_library_id=None)

        selected_strategy_ids = [sid for sid in strategy_ids if sid in STRATEGIES]
        if not selected_strategy_ids:
            selected_strategy_ids = ["quality_value", "multi_factor", "trend_follow"]

        codes = _normalize_codes(stock_codes)
        results: List[Dict[str, Any]] = []
        skipped = 0
        notes: List[str] = []

        if use_iwencai:
            notes.append("在线问财召回已从主流程移除；本次仍按本地候选池运行。")

        for code in codes:
            df, source = load_history_df(code, days=120)
            if df is None or df.empty or len(df) < 20:
                skipped += 1
                continue
            df = _prepare_history(df)
            metrics = _build_technical_metrics(df)
            name = _latest_name(code, self.manager)
            latest_date = str(df.iloc[-1].get("date", "")) if "date" in df.columns else None

            fundamental_metrics: Dict[str, Optional[float]] = {}
            if include_fundamentals:
                try:
                    context = self.manager.get_fundamental_context(code)
                    fundamental_metrics = _extract_fundamental_metrics(context)
                    metrics.update(fundamental_metrics)
                except Exception as exc:
                    logger.warning("screener fundamental fetch failed for %s: %s", code, exc)

            total_score = 0.0
            matched: List[str] = []
            reasons: List[str] = []
            risks: List[str] = []

            for strategy_id in selected_strategy_ids:
                technical_score, technical_reasons, technical_risks = _score_technical(strategy_id, metrics)
                fundamental_score, fundamental_reasons, fundamental_risks = _score_fundamentals(
                    strategy_id,
                    fundamental_metrics,
                )
                strategy_score = technical_score + fundamental_score
                if strategy_score >= 18 or technical_reasons or fundamental_reasons:
                    matched.append(strategy_id)
                    reasons.extend([f"{STRATEGIES[strategy_id].name}：{item}" for item in technical_reasons + fundamental_reasons])
                risks.extend([f"{STRATEGIES[strategy_id].name}：{item}" for item in technical_risks + fundamental_risks])
                total_score += strategy_score

            if not matched:
                skipped += 1
                continue

            results.append(
                {
                    "code": code,
                    "name": name,
                    "score": round(min(total_score, 100.0), 1),
                    "matched_strategies": matched,
                    "reasons": reasons[:6],
                    "risks": list(dict.fromkeys(risks))[:5],
                    "metrics": metrics,
                    "iwencai_fields": {},
                    "latest_date": latest_date[:10] if latest_date else None,
                    "data_source": source,
                }
            )

        results.sort(key=lambda item: item["score"], reverse=True)

        if not codes:
            notes.append("当前没有候选股票。请先在设置页配置自选股，或在本页手动输入股票代码。")
        if include_fundamentals:
            notes.append("已启用基本面补充，运行会比纯技术筛选更慢。")
        else:
            notes.append("当前使用轻量模式；基本面质量/多因子策略主要依赖本地技术数据，开启基本面补充后更完整。")

        return {
            "strategies": self.list_strategies(),
            "candidates": results[:limit],
            "total_input": len(codes),
            "evaluated": len(results),
            "skipped": skipped,
            "data_mode": "watchlist_or_manual_pool",
            "execution_mode": "local_pool",
            "local_executable": True,
            "supported_terms": [],
            "unsupported_terms": [],
            "import_required": False,
            "iwencai_status": "disabled",
            "iwencai_query": None,
            "iwencai_code_count": None,
            "iwencai_returned_count": None,
            "iwencai_has_more": False,
            "iwencai_chunks_info": {},
            "notes": notes,
        }

    def run_local_query(self, query: str, *, limit: int = 30, strategy_library_id: Optional[str] = None) -> Dict[str, Any]:
        query_text = str(query or "").strip()
        plan = _build_local_query_plan(query_text)
        notes: List[str] = []

        if not query_text:
            notes.append("需要先填写策略选股语句。")
        if not MarketHistoryStore.is_enabled():
            notes.append("本地历史库未启用，不能直接本地选股。请先去问财客户端运行策略并导出 Excel。")
            return self._unsupported_query_payload(query_text, plan, notes)
        if plan.unsupported_terms or not plan.supported_terms:
            if plan.unsupported_terms:
                notes.append("本地暂不支持完整执行这条策略，请在问财客户端运行后导入候选股。")
            else:
                notes.append("没有识别出本地可执行条件，请在问财客户端运行后导入候选股。")
            return self._unsupported_query_payload(query_text, plan, notes)

        df, source = MarketHistoryStore().run_latest_snapshot_query(
            where_clauses=plan.where_clauses,
            order_by=plan.order_by,
            limit=limit,
        )
        if source in {"market_history_unavailable", "market_history_missing_duckdb", "market_history_error"}:
            reason = {
                "market_history_unavailable": "本地历史库文件不可用，不能执行策略筛选。",
                "market_history_missing_duckdb": "当前运行环境缺少 DuckDB，不能执行本地历史库筛选。",
                "market_history_error": "本地历史库查询失败，不能确认这条策略是否命中。",
            }.get(source, "本地历史库不可用，不能执行策略筛选。")
            notes.append(f"{reason} 请检查历史库配置，或先用问财客户端运行并导出 Excel 后导入候选股。")
            return self._local_query_unavailable_payload(query_text, plan, notes, source)

        candidates = []
        if df is not None and not df.empty:
            candidates = [
                _candidate_from_snapshot_row(dict(row), source=source)
                for row in df.to_dict(orient="records")
            ]

        if not candidates:
            notes.append("本地历史库已执行完整条件，但没有命中候选。可以放宽策略语句，或用问财客户端对照验证。")
        else:
            notes.append("已用本地历史库执行策略初筛；增强分析和回测需要你选择候选股后再手动执行。")

        return {
            "strategies": self.list_strategies(),
            "candidates": candidates,
            "total_input": len(candidates),
            "evaluated": len(candidates),
            "skipped": 0,
            "data_mode": source,
            "execution_mode": "local_query",
            "local_executable": True,
            "supported_terms": plan.supported_terms,
            "unsupported_terms": [],
            "import_required": False,
            "iwencai_status": "disabled",
            "iwencai_query": query_text,
            "iwencai_code_count": None,
            "iwencai_returned_count": None,
            "iwencai_has_more": False,
            "iwencai_chunks_info": {},
            "notes": notes,
        }

    def _local_query_unavailable_payload(
        self,
        query: str,
        plan: LocalQueryPlan,
        notes: List[str],
        source: str,
    ) -> Dict[str, Any]:
        return {
            "strategies": self.list_strategies(),
            "candidates": [],
            "total_input": 0,
            "evaluated": 0,
            "skipped": 0,
            "data_mode": source,
            "execution_mode": "local_query",
            "local_executable": False,
            "supported_terms": plan.supported_terms,
            "unsupported_terms": plan.unsupported_terms,
            "import_required": True,
            "iwencai_status": "disabled",
            "iwencai_query": query,
            "iwencai_code_count": None,
            "iwencai_returned_count": None,
            "iwencai_has_more": False,
            "iwencai_chunks_info": {},
            "notes": notes,
        }

    def _unsupported_query_payload(self, query: str, plan: LocalQueryPlan, notes: List[str]) -> Dict[str, Any]:
        return {
            "strategies": self.list_strategies(),
            "candidates": [],
            "total_input": 0,
            "evaluated": 0,
            "skipped": 0,
            "data_mode": "local_query_unsupported",
            "execution_mode": "local_query",
            "local_executable": False,
            "supported_terms": plan.supported_terms,
            "unsupported_terms": plan.unsupported_terms,
            "import_required": True,
            "iwencai_status": "disabled",
            "iwencai_query": query,
            "iwencai_code_count": None,
            "iwencai_returned_count": None,
            "iwencai_has_more": False,
            "iwencai_chunks_info": {},
            "notes": notes,
        }

    def import_iwencai_excel(
        self,
        content: bytes,
        *,
        filename: str = "",
        strategy_query: Optional[str] = None,
        limit: int = 100,
    ) -> Dict[str, Any]:
        if not content:
            raise ValueError("导入文件为空。")

        try:
            workbook = pd.read_excel(BytesIO(content), sheet_name=None, dtype=object)
        except Exception as exc:
            raise ValueError(f"无法读取问财 Excel 文件: {exc}") from exc

        if not workbook:
            raise ValueError("Excel 中没有可读取的 sheet。")

        sheet_name, df = next(iter(workbook.items()))
        if df.empty:
            raise ValueError("Excel 中没有候选股数据。")

        rows = df.head(max(1, min(int(limit), 500))).to_dict(orient="records")
        latest_date = None
        for column in df.columns:
            latest_date = _parse_header_date(str(column))
            if latest_date:
                break

        candidates = [
            candidate for candidate in (
                _candidate_from_iwencai_row(
                    {_normalize_excel_header(key): value for key, value in row.items()},
                    latest_date=latest_date,
                )
                for row in rows
            )
            if candidate is not None
        ]

        return {
            "strategies": self.list_strategies(),
            "candidates": candidates,
            "total_input": len(rows),
            "evaluated": len(candidates),
            "skipped": max(0, len(rows) - len(candidates)),
            "data_mode": "iwencai_excel_import",
            "execution_mode": "iwencai_import",
            "local_executable": True,
            "supported_terms": [],
            "unsupported_terms": [],
            "import_required": False,
            "iwencai_status": "imported",
            "iwencai_query": strategy_query,
            "iwencai_code_count": len(candidates),
            "iwencai_returned_count": len(candidates),
            "iwencai_has_more": len(df) > len(rows),
            "iwencai_chunks_info": {
                "filename": filename,
                "sheet": sheet_name,
                "rows": len(df),
                "latest_date": latest_date,
            },
            "notes": [
                "已导入问财客户端导出的候选股；这一步不消耗问财 API 额度。",
                "导入结果只作为初筛候选，增强分析和回测需要你选择候选股后再手动执行。",
            ],
        }
