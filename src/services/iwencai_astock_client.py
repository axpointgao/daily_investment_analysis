# -*- coding: utf-8 -*-
"""iWencai A-share natural-language stock selector client."""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

import requests

from src.config import get_config

IWENCAI_QUERY_PATH = "/v1/query2data"
IWENCAI_ASTOCK_SKILL_ID = "hithink-astock-selector"
IWENCAI_ASTOCK_SKILL_VERSION = "1.0.0"


class IwencaiAStockError(RuntimeError):
    """Raised when iWencai A-share selector cannot return usable data."""


@dataclass(frozen=True)
class IwencaiAStockRow:
    code: str
    name: Optional[str]
    raw: Dict[str, Any]


@dataclass(frozen=True)
class IwencaiAStockResult:
    query: str
    code_count: int
    returned_count: int
    page: int
    limit: int
    has_more: bool
    trace_id: str
    chunks_info: Dict[str, Any]
    rows: List[IwencaiAStockRow]
    raw_payload: Dict[str, Any]


class IwencaiAStockClient:
    """Minimal iWencai OpenAPI client scoped to A-share stock selection."""

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        config = get_config()
        resolved_key = (api_key if api_key is not None else getattr(config, "iwencai_api_key", "") or "").strip()
        if not resolved_key:
            raise IwencaiAStockError("请先在设置 -> Agent 设置中配置 IWENCAI_API_KEY。")
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

    def select(
        self,
        query: str,
        *,
        page: int = 1,
        limit: int = 30,
        call_type: str = "normal",
    ) -> IwencaiAStockResult:
        query_text = str(query or "").strip()
        if not query_text:
            raise IwencaiAStockError("问财选股条件不能为空。")

        payload = self.query(query_text, page=page, limit=limit, call_type=call_type)
        rows = [row for row in (self._parse_row(item) for item in self._iter_rows(payload)) if row is not None]
        code_count = self._coerce_int(payload.get("code_count"), len(rows))
        has_more = page * limit < code_count
        return IwencaiAStockResult(
            query=query_text,
            code_count=code_count,
            returned_count=len(rows),
            page=page,
            limit=limit,
            has_more=has_more,
            trace_id=str(payload.get("trace_id") or ""),
            chunks_info=payload.get("chunks_info") if isinstance(payload.get("chunks_info"), dict) else {},
            rows=rows,
            raw_payload=payload,
        )

    def query(self, query: str, *, page: int = 1, limit: int = 30, call_type: str = "normal") -> Dict[str, Any]:
        url = f"{self.base_url}{IWENCAI_QUERY_PATH}"
        trace_id = hashlib.sha256(f"{query}:{time.time_ns()}".encode("utf-8")).hexdigest()
        body = {
            "query": query,
            "page": str(max(1, int(page))),
            "limit": str(max(1, int(limit))),
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
                    "X-Claw-Skill-Id": IWENCAI_ASTOCK_SKILL_ID,
                    "X-Claw-Skill-Version": IWENCAI_ASTOCK_SKILL_VERSION,
                    "X-Claw-Plugin-Id": "none",
                    "X-Claw-Plugin-Version": "none",
                    "X-Claw-Trace-Id": trace_id,
                },
                json=body,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise IwencaiAStockError(f"问财 A 股选股请求失败: {exc}") from exc

        if not response.ok:
            preview = response.text[:300] if response.text else f"HTTP {response.status_code}"
            raise IwencaiAStockError(f"问财 A 股选股 HTTP {response.status_code}: {preview}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise IwencaiAStockError("问财 A 股选股返回不是有效 JSON。") from exc
        if not isinstance(payload, dict):
            raise IwencaiAStockError("问财 A 股选股返回格式异常。")
        payload.setdefault("trace_id", trace_id)
        return payload

    @classmethod
    def _iter_rows(cls, payload: Any) -> Iterable[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        datas = payload.get("datas")
        if isinstance(datas, list):
            return [item for item in datas if isinstance(item, dict)]
        return []

    @classmethod
    def _parse_row(cls, row: Dict[str, Any]) -> Optional[IwencaiAStockRow]:
        code = cls._pick_text(row, "股票代码", "代码", "证券代码")
        name = cls._pick_text(row, "股票简称", "股票名称", "简称", "名称")
        normalized = cls._normalize_astock_code(code)
        if not normalized:
            return None
        return IwencaiAStockRow(code=normalized, name=name, raw=dict(row))

    @staticmethod
    def _normalize_astock_code(value: Optional[str]) -> str:
        text = str(value or "").strip().upper()
        if not text:
            return ""
        match = re.search(r"(\d{6})(?:\.(?:SH|SZ|BJ))?", text)
        return match.group(1) if match else ""

    @staticmethod
    def _normalize_key(text: str) -> str:
        return re.sub(r"[\s_（）()：:]+", "", str(text or "")).lower()

    @classmethod
    def _find_value(cls, row: Dict[str, Any], names: tuple[str, ...]) -> Any:
        normalized_names = tuple(cls._normalize_key(name) for name in names)
        for key, value in row.items():
            key_norm = cls._normalize_key(str(key))
            if any(name in key_norm for name in normalized_names):
                return value
        return None

    @classmethod
    def _pick_text(cls, row: Dict[str, Any], *names: str) -> Optional[str]:
        value = cls._find_value(row, names)
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _coerce_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

