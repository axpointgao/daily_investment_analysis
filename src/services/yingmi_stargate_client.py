# -*- coding: utf-8 -*-
"""Client for Yingmi StarGate OpenAPI/MCP operations."""

from __future__ import annotations

import copy
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote

import requests

from src.config import get_config


class YingmiStargateError(RuntimeError):
    """Raised when Yingmi StarGate cannot return usable data."""


class YingmiStargateClient:
    """Minimal operationId-based client for Yingmi StarGate OpenAPI."""

    _docs_cache: Dict[str, Dict[str, Any]] = {}

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 12.0,
    ) -> None:
        config = get_config()
        enabled = bool(getattr(config, "yingmi_enabled", True))
        resolved_key = (api_key if api_key is not None else getattr(config, "yingmi_api_key", "") or "").strip()
        if not enabled:
            raise YingmiStargateError("盈米 StarGate 当前未启用。")
        if not resolved_key:
            raise YingmiStargateError("请先在设置 -> Agent 设置中配置 YINGMI_API_KEY。")
        self.api_key = resolved_key
        self.base_url = (base_url or getattr(config, "yingmi_stargate_base_url", "") or "https://stargate.yingmi.com/api").strip().rstrip("/")
        self.timeout = timeout

    @staticmethod
    def is_configured() -> bool:
        config = get_config()
        return bool(getattr(config, "yingmi_enabled", True) and (getattr(config, "yingmi_api_key", "") or "").strip())

    def call_operation(self, operation_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        operation = self._find_operation(operation_id)
        method = operation["method"].upper()
        path = operation["path"]
        input_params = dict(params or {})
        used_keys = set()

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        query: Dict[str, Any] = {}
        for spec in operation.get("parameters") or []:
            name = spec.get("name")
            location = spec.get("in")
            if not name or name not in input_params:
                continue
            value = input_params[name]
            used_keys.add(name)
            if location == "path":
                path = path.replace("{" + name + "}", quote(str(value), safe=""))
            elif location == "query":
                query[name] = value
            elif location == "header":
                headers[name] = str(value)

        body = input_params.get("body")
        if "body" in input_params:
            used_keys.add("body")
        elif operation.get("requestBody"):
            body = {key: value for key, value in input_params.items() if key not in used_keys}
        else:
            for key, value in input_params.items():
                if key not in used_keys:
                    query[key] = value

        url = f"{self.base_url}{path}"
        try:
            response = requests.request(
                method,
                url,
                params=query or None,
                json=body if body is not None and method in {"POST", "PUT", "PATCH"} else None,
                headers=headers,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise YingmiStargateError(f"盈米 StarGate 请求失败: {operation_id}: {exc}") from exc

        if not response.ok:
            preview = response.text[:300] if response.text else f"HTTP {response.status_code}"
            raise YingmiStargateError(f"盈米 StarGate HTTP {response.status_code}: {preview}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise YingmiStargateError("盈米 StarGate 返回不是有效 JSON。") from exc
        if not isinstance(payload, dict):
            raise YingmiStargateError("盈米 StarGate 返回格式异常。")
        return payload

    def get_fund_diagnosis(self, fund_name_or_code: str) -> Dict[str, Any]:
        return self.call_operation("GetFundDiagnosis", {"fundNameOrCode": fund_name_or_code})

    def analyze_fund_risk(self, fund_codes: Iterable[str]) -> Dict[str, Any]:
        return self.call_operation("AnalyzeFundRisk", {"fundCodes": list(fund_codes)})

    def get_asset_allocation(self, fund_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.call_operation("GetAssetAllocation", {"fundList": fund_list})

    def get_funds_backtest(self, fund_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.call_operation("GetFundsBackTest", {"fundList": fund_list})

    def get_funds_correlation(self, fund_codes: Iterable[str]) -> Dict[str, Any]:
        return self.call_operation("GetFundsCorrelation", {"fundList": [{"fundCode": code} for code in fund_codes]})

    def analyze_portfolio_risk(self, holdings: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.call_operation("AnalyzePortfolioRisk", {"holdings": holdings})

    def search_strategies(self, keyword: str, page_num: int = 1, page_size: int = 10) -> Dict[str, Any]:
        return self.call_operation(
            "StrategySearchByKeyword",
            {"keyword": keyword, "pageNum": page_num, "pageSize": page_size},
        )

    def get_strategy_details(self, strategy_codes: Iterable[str], page_num: int = 1, page_size: int = 20) -> Dict[str, Any]:
        return self.call_operation(
            "GetStrategyDetails",
            {"strategyCodes": list(strategy_codes), "pageNum": page_num, "pageSize": page_size},
        )

    def get_strategy_composition(self, strategy_codes: Iterable[str]) -> Dict[str, Any]:
        return self.call_operation("BatchGetStrategiesComposition", {"strategyCodes": list(strategy_codes)})

    def _find_operation(self, operation_id: str) -> Dict[str, Any]:
        docs = self._get_docs()
        for path, methods in (docs.get("paths") or {}).items():
            if not isinstance(methods, dict):
                continue
            for method, operation in methods.items():
                if not isinstance(operation, dict):
                    continue
                if operation.get("operationId") == operation_id:
                    item = copy.deepcopy(operation)
                    item["path"] = path
                    item["method"] = method
                    return item
        raise YingmiStargateError(f"盈米 StarGate 未找到 operationId: {operation_id}")

    def _get_docs(self) -> Dict[str, Any]:
        cache_key = self.base_url
        cached = self._docs_cache.get(cache_key)
        if cached:
            return cached

        url = f"{self.base_url}/docs.json"
        try:
            response = requests.get(
                url,
                params={"apiKey": self.api_key},
                headers={"Accept": "application/json"},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise YingmiStargateError(f"盈米 StarGate 文档获取失败: {exc}") from exc
        if not response.ok:
            preview = response.text[:300] if response.text else f"HTTP {response.status_code}"
            raise YingmiStargateError(f"盈米 StarGate 文档 HTTP {response.status_code}: {preview}")
        try:
            docs = response.json()
        except ValueError as exc:
            raise YingmiStargateError("盈米 StarGate 文档不是有效 JSON。") from exc
        if not isinstance(docs, dict) or not isinstance(docs.get("paths"), dict):
            raise YingmiStargateError("盈米 StarGate 文档格式异常。")
        self._docs_cache[cache_key] = docs
        return docs


def test_yingmi_stargate_connection(
    *,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: float = 8.0,
) -> Tuple[Dict[str, Any], int]:
    """Run a lightweight docs probe without invoking a business operation."""
    client = YingmiStargateClient(api_key=api_key, base_url=base_url, timeout=timeout)
    started_at = time.perf_counter()
    docs = client._get_docs()
    latency_ms = int((time.perf_counter() - started_at) * 1000)
    operations = []
    for methods in (docs.get("paths") or {}).values():
        if not isinstance(methods, dict):
            continue
        for operation in methods.values():
            if isinstance(operation, dict) and operation.get("operationId"):
                operations.append(str(operation["operationId"]))
    return {"operation_count": len(operations), "sample_operations": operations[:12]}, latency_ms
