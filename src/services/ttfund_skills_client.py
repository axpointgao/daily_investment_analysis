# -*- coding: utf-8 -*-
"""Client for Tiantian Fund official Skills gateway."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional, Tuple

import requests

from src.config import get_config

TTFUND_SKILLS_GATEWAY_URL = "https://skills.tiantianfunds.com/ai-smart-skill-service/openapi/skill/invoke"

SKILL_VERSIONS: Dict[str, str] = {
    "FUND_BASE_INFOS": "1.1.0",
    "FUND_CONDITION_SELECT": "1.1.0",
    "FUND_FAVOR_ZX": "1.1.0",
    "FUND_MANAGER_INFO": "1.0.0",
    "FUND_HOLDING_INFO": "1.0.0",
    "FUND_HUAAN_GOLD_INFO": "1.0.0",
    "FUND_TG_STRATEGY_INFO": "1.0.0",
    "FUND_INDEX_INFO": "1.0.0",
    "FUND_NAV_INFO": "1.0.0",
    "MODEL_PORTFOLIO": "1.0.0",
    "BOND_MARKET": "1.0.0",
    "FUND_GROUP_BACKTEST": "1.0.0",
    "FUND_SEARCH": "1.0.0",
}


class TtfundSkillsError(RuntimeError):
    """Raised when the Tiantian Fund Skills gateway cannot return usable data."""


class TtfundSkillsClient:
    """Minimal JSON client for the Tiantian Fund Skills openapi gateway."""

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        gateway_url: str = TTFUND_SKILLS_GATEWAY_URL,
        timeout: float = 12.0,
    ) -> None:
        config = get_config()
        resolved_key = (api_key if api_key is not None else getattr(config, "ttfund_apikey", "") or "").strip()
        if not resolved_key:
            raise TtfundSkillsError("请先在设置 -> Agent 设置中配置 TTFUND_APIKEY。")
        self.api_key = resolved_key
        self.gateway_url = gateway_url
        self.timeout = timeout

    def invoke(self, skill_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = self._build_payload(skill_id, params or {})
        try:
            response = requests.post(
                self.gateway_url,
                headers={
                    "X-API-Key": self.api_key,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise TtfundSkillsError(f"天天基金 Skills 请求失败: {exc}") from exc

        if not response.ok:
            error_text = response.text[:300] if response.text else f"HTTP {response.status_code}"
            raise TtfundSkillsError(f"天天基金 Skills HTTP {response.status_code}: {error_text}")

        try:
            data = response.json()
        except ValueError as exc:
            raise TtfundSkillsError("天天基金 Skills 返回不是有效 JSON。") from exc

        if not isinstance(data, dict):
            raise TtfundSkillsError("天天基金 Skills 返回格式异常。")

        self._raise_for_business_error(data)
        return data

    @staticmethod
    def _build_payload(skill_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        normalized_skill_id = str(skill_id or "").strip().upper()
        if not normalized_skill_id:
            raise TtfundSkillsError("skill_id 不能为空。")
        version = SKILL_VERSIONS.get(normalized_skill_id)
        if not version:
            raise TtfundSkillsError(f"不支持的天天基金 skill_id: {normalized_skill_id}")
        return {
            "skill_id": normalized_skill_id,
            "_skill_version": version,
            **params,
        }

    @staticmethod
    def _raise_for_business_error(data: Dict[str, Any]) -> None:
        error_candidates = [
            data.get("errorCode"),
            data.get("error_code"),
            data.get("code"),
            (data.get("data") or {}).get("errorCode") if isinstance(data.get("data"), dict) else None,
            (data.get("data") or {}).get("error_code") if isinstance(data.get("data"), dict) else None,
            TtfundSkillsClient._get_raw_body_value(data, "errorCode"),
            TtfundSkillsClient._get_raw_body_value(data, "error_code"),
        ]
        for value in error_candidates:
            if value in (None, "", 0, "0"):
                continue
            message = (
                data.get("errorMsg")
                or data.get("error_message")
                or data.get("message")
                or data.get("msg")
                or str(data)[:300]
            )
            raise TtfundSkillsError(f"天天基金 Skills 业务失败: {message}")

        raw_status = TtfundSkillsClient._get_raw_result_value(data, "status_code")
        if raw_status not in (None, "", 200, "200"):
            raise TtfundSkillsError(f"天天基金 Skills 下游 HTTP {raw_status}")

        raw_success = TtfundSkillsClient._get_raw_body_value(data, "success")
        if raw_success is False or str(raw_success).lower() == "false":
            message = TtfundSkillsClient._get_raw_body_value(data, "firstError") or str(data)[:300]
            raise TtfundSkillsError(f"天天基金 Skills 业务失败: {message}")

    @staticmethod
    def _get_raw_result_value(data: Dict[str, Any], key: str) -> Any:
        nested_data = data.get("data")
        if not isinstance(nested_data, dict):
            return None
        raw_result = nested_data.get("raw_result")
        if not isinstance(raw_result, dict):
            return None
        return raw_result.get(key)

    @staticmethod
    def _get_raw_body_value(data: Dict[str, Any], key: str) -> Any:
        raw_result = TtfundSkillsClient._get_raw_result_value(data, "body")
        if not isinstance(raw_result, dict):
            return None
        return raw_result.get(key)


def test_ttfund_skills_connection(*, api_key: Optional[str] = None, timeout: float = 8.0) -> Tuple[Dict[str, Any], int]:
    """Run a read-only connectivity probe and return payload plus latency."""
    client = TtfundSkillsClient(api_key=api_key, timeout=timeout)
    started_at = time.perf_counter()
    payload = client.invoke("FUND_BASE_INFOS", {"fcode": "000001"})
    latency_ms = int((time.perf_counter() - started_at) * 1000)
    return payload, latency_ms
