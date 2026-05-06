# -*- coding: utf-8 -*-
"""iWencai client for bank wealth product lookup and NAV retrieval."""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

from src.config import get_config

IWENCAI_QUERY_PATH = "/v1/query2data"
IWENCAI_WEALTH_SKILL_ID = "hithink-basicinfo-query"

PRODUCT_FIELDS = (
    "产品代码 产品简称 产品公布代码 发行机构简称 风险等级 投资品种 最新单位净值 历史净值"
)
LATEST_NAV_FIELDS = "最新单位净值 最新涨跌幅 净值日期"
HISTORICAL_NAV_FIELDS = "历史净值 单位净值 净值日期"


class IwencaiWealthError(RuntimeError):
    """Raised when iWencai cannot return usable bank wealth data."""


@dataclass(frozen=True)
class IwencaiWealthProduct:
    product_code: Optional[str]
    product_name: str
    public_code: Optional[str] = None
    issuer_name: Optional[str] = None
    risk_level: Optional[str] = None
    investment_type: Optional[str] = None
    term_type: Optional[str] = None
    redeemable: Optional[str] = None
    benchmark: Optional[str] = None
    management_fee: Optional[str] = None
    custody_fee: Optional[str] = None
    subscription_fee: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class IwencaiWealthNav:
    unit_nav: float
    nav_date: Optional[date]
    change_pct: Optional[float] = None
    raw: Optional[Dict[str, Any]] = None


class IwencaiWealthClient:
    """Minimal iWencai OpenAPI client scoped to bank wealth products."""

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 12.0,
    ) -> None:
        config = get_config()
        resolved_key = (api_key if api_key is not None else getattr(config, "iwencai_api_key", "") or "").strip()
        if not resolved_key:
            raise IwencaiWealthError("请先在设置 -> Agent 设置中配置 IWENCAI_API_KEY。")
        self.api_key = resolved_key
        self.base_url = (
            base_url
            or getattr(config, "iwencai_base_url", "")
            or "https://openapi.iwencai.com"
        ).strip().rstrip("/")
        self.timeout = timeout

    @staticmethod
    def is_configured() -> bool:
        return bool((getattr(get_config(), "iwencai_api_key", "") or "").strip())

    def search_products(self, keyword: str, *, limit: int = 10) -> List[IwencaiWealthProduct]:
        text = str(keyword or "").strip()
        if not text:
            raise IwencaiWealthError("产品名称不能为空。")
        queries = [
            f"{text} 银行理财 {PRODUCT_FIELDS}",
            f"{text} 银行理财",
        ]
        products: List[IwencaiWealthProduct] = []
        for index, query in enumerate(queries):
            payload = self.query(query, limit=limit, call_type="retry" if index else "normal")
            products = [self._parse_product(row) for row in self._iter_rows(payload)]
            products = [item for item in products if item is not None]
            if products:
                break
        return [item for item in products if item is not None]

    def get_latest_nav(self, product_identifier: str) -> Optional[IwencaiWealthNav]:
        text = str(product_identifier or "").strip()
        if not text:
            return None
        query = f"{text} 银行理财 {LATEST_NAV_FIELDS}"
        payload = self.query(query, limit=5)
        return self._first_nav(payload)

    def get_historical_nav(self, product_identifier: str, nav_date: date) -> Optional[IwencaiWealthNav]:
        text = str(product_identifier or "").strip()
        if not text:
            return None
        query = f"{text} 银行理财 {nav_date.strftime('%Y%m%d')} {HISTORICAL_NAV_FIELDS}"
        payload = self.query(query, limit=10)
        navs = [nav for nav in (self._parse_nav(row, target_date=nav_date) for row in self._iter_rows(payload)) if nav is not None]
        if not navs:
            return None
        not_after = [item for item in navs if item.nav_date is None or item.nav_date <= nav_date]
        candidates = not_after or navs
        return sorted(candidates, key=lambda item: item.nav_date or date.min, reverse=True)[0]

    def query(self, query: str, *, page: int = 1, limit: int = 10, call_type: str = "normal") -> Dict[str, Any]:
        url = f"{self.base_url}{IWENCAI_QUERY_PATH}"
        trace_id = hashlib.sha256(f"{query}:{time.time_ns()}".encode("utf-8")).hexdigest()
        body = {
            "query": query,
            "page": str(page),
            "limit": str(limit),
            "is_cache": "1",
            "expand_index": "true",
        }
        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "X-Claw-Call-Type": call_type,
                    "X-Claw-Skill-Id": IWENCAI_WEALTH_SKILL_ID,
                    "X-Claw-Skill-Version": "1.0.0",
                    "X-Claw-Plugin-Id": "none",
                    "X-Claw-Plugin-Version": "none",
                    "X-Claw-Trace-Id": trace_id,
                },
                json=body,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise IwencaiWealthError(f"问财银行理财请求失败: {exc}") from exc

        if not response.ok:
            preview = response.text[:300] if response.text else f"HTTP {response.status_code}"
            raise IwencaiWealthError(f"问财银行理财 HTTP {response.status_code}: {preview}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise IwencaiWealthError("问财银行理财返回不是有效 JSON。") from exc
        if not isinstance(payload, dict):
            raise IwencaiWealthError("问财银行理财返回格式异常。")
        return payload

    @classmethod
    def _first_nav(cls, payload: Dict[str, Any]) -> Optional[IwencaiWealthNav]:
        for row in cls._iter_rows(payload):
            nav = cls._parse_nav(row)
            if nav is not None:
                return nav
        return None

    @classmethod
    def _iter_rows(cls, payload: Any) -> Iterable[Dict[str, Any]]:
        stack = [payload]
        while stack:
            item = stack.pop(0)
            if isinstance(item, dict):
                if cls._looks_like_data_row(item):
                    yield item
                for key in ("datas", "data", "result", "rows", "list"):
                    value = item.get(key)
                    if isinstance(value, (list, dict)):
                        stack.append(value)
            elif isinstance(item, list):
                stack.extend(item)

    @staticmethod
    def _looks_like_data_row(item: Dict[str, Any]) -> bool:
        return any("产品" in str(key) or "净值" in str(key) or "风险" in str(key) for key in item.keys())

    @classmethod
    def _parse_product(cls, row: Dict[str, Any]) -> Optional[IwencaiWealthProduct]:
        name = cls._pick_text(row, "产品简称", "产品名称", "简称", "名称")
        code = cls._pick_text(row, "产品代码")
        public_code = cls._pick_text(row, "产品公布代码", "登记编码", "理财登记编码")
        if not name and not code and not public_code:
            return None
        return IwencaiWealthProduct(
            product_code=code,
            product_name=name or public_code or code or "",
            public_code=public_code,
            issuer_name=cls._pick_text(row, "发行机构简称", "发行机构", "管理人"),
            risk_level=cls._pick_text(row, "风险等级"),
            investment_type=cls._pick_text(row, "投资品种", "投资性质"),
            term_type=cls._pick_text(row, "期限类型"),
            redeemable=cls._pick_text(row, "是否可赎回"),
            benchmark=cls._pick_text(row, "业绩比较基准"),
            management_fee=cls._pick_text(row, "管理费率"),
            custody_fee=cls._pick_text(row, "托管费率"),
            subscription_fee=cls._pick_text(row, "申购费率"),
            raw=dict(row),
        )

    @classmethod
    def _parse_nav(cls, row: Dict[str, Any], *, target_date: Optional[date] = None) -> Optional[IwencaiWealthNav]:
        dated_nav = cls._pick_dated_nav(row, target_date)
        if dated_nav is not None:
            nav_date, nav = dated_nav
            return IwencaiWealthNav(
                unit_nav=nav,
                nav_date=nav_date,
                change_pct=cls._pick_float(row, "最新涨跌幅", "涨跌幅"),
                raw=dict(row),
            )
        nav = cls._pick_float(row, "最新单位净值", "单位净值", "历史净值", "净值")
        if nav is None or nav <= 0:
            return None
        return IwencaiWealthNav(
            unit_nav=nav,
            nav_date=cls._pick_date(row, "净值日期", "日期", "更新日期"),
            change_pct=cls._pick_float(row, "最新涨跌幅", "涨跌幅"),
            raw=dict(row),
        )

    @classmethod
    def _pick_dated_nav(cls, row: Dict[str, Any], target_date: Optional[date]) -> Optional[Tuple[date, float]]:
        candidates: List[Tuple[date, float]] = []
        for key, value in row.items():
            if "净值" not in str(key):
                continue
            match = re.search(r"20\d{6}", str(key))
            if not match:
                continue
            nav_date = cls._parse_date_text(match.group(0))
            nav = cls._coerce_float(value)
            if nav_date is not None and nav is not None and nav > 0:
                candidates.append((nav_date, nav))
        if not candidates:
            return None
        if target_date is not None:
            not_after = [item for item in candidates if item[0] <= target_date]
            if not_after:
                return sorted(not_after, key=lambda item: item[0], reverse=True)[0]
        return sorted(candidates, key=lambda item: item[0], reverse=True)[0]

    @staticmethod
    def _normalize_key(text: str) -> str:
        return re.sub(r"[\s_（）()：:]+", "", str(text or "")).lower()

    @classmethod
    def _find_value(cls, row: Dict[str, Any], names: Tuple[str, ...]) -> Any:
        normalized_names = tuple(cls._normalize_key(name) for name in names)
        for key, value in row.items():
            key_norm = cls._normalize_key(str(key))
            if any(name in key_norm or key_norm in name for name in normalized_names):
                return value
        return None

    @classmethod
    def _pick_text(cls, row: Dict[str, Any], *names: str) -> Optional[str]:
        value = cls._find_value(row, names)
        if value in (None, ""):
            return None
        text = str(value).strip()
        return text or None

    @classmethod
    def _pick_float(cls, row: Dict[str, Any], *names: str) -> Optional[float]:
        value = cls._find_value(row, names)
        return cls._coerce_float(value)

    @staticmethod
    def _coerce_float(value: Any) -> Optional[float]:
        if value in (None, ""):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip().replace(",", "").replace("%", "")
        try:
            return float(text)
        except ValueError:
            return None

    @classmethod
    def _pick_date(cls, row: Dict[str, Any], *names: str) -> Optional[date]:
        value = cls._find_value(row, names)
        if value in (None, ""):
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        return cls._parse_date_text(str(value).strip())

    @staticmethod
    def _parse_date_text(text: str) -> Optional[date]:
        for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(text[:10] if "-" in text or "/" in text else text[:8], fmt).date()
            except ValueError:
                continue
        return None
