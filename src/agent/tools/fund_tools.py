# -*- coding: utf-8 -*-
"""Fund Agent tools backed by Yingmi StarGate and Tiantian Fund Skills."""

from __future__ import annotations

from typing import Any, Dict, Optional

from src.agent.tools.registry import ToolDefinition, ToolParameter
from src.config import get_config, normalize_yingmi_fund_data_strategy
from src.services.ttfund_skills_client import TtfundSkillsClient, TtfundSkillsError
from src.services.yingmi_stargate_client import YingmiStargateClient, YingmiStargateError


def _invoke(skill_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        return TtfundSkillsClient().invoke(skill_id, params or {})
    except TtfundSkillsError as exc:
        return {
            "error": str(exc),
            "retriable": False,
            "skill_id": skill_id,
        }


_PRIORITY_KEYS = {
    "code", "fcode", "fundCode", "fund_code", "fundId", "fund_id",
    "name", "fundName", "fund_name", "shortName", "fullName",
    "type", "fundType", "riskLevel", "risk", "rating", "level",
    "scale", "fundSize", "latestScale", "nav", "unitNav", "accumulatedNav",
    "date", "endDate", "startDate", "reportDate", "report_period",
    "return", "returnPct", "yield", "maxDrawdown", "maxDrawdownPct",
    "volatility", "sharpe", "rank", "peerCount", "percentile",
    "manager", "managerName", "managerNames", "manager_id", "managerId",
    "asset", "assetAllocation", "industry", "industryAllocation",
    "holding", "holdings", "stock", "bond", "cash", "weight", "ratio",
    "advantage", "advantages", "riskSummary", "diagnosis", "conclusion",
    "advice", "suggestion", "suitable", "score", "provider", "method",
    "success", "message", "data", "result", "items", "list",
}


def _compact_fund_tool_result(
    tool_name: str,
    result: Dict[str, Any],
    *,
    max_list_items: int = 10,
    max_dict_keys: int = 36,
    max_text_length: int = 700,
) -> Dict[str, Any]:
    """Return an Agent-facing compact copy of a fund tool result.

    The upstream fund gateways often return large raw arrays and wrapper
    metadata.  The Agent needs stable decision facts, not full raw payloads,
    so this keeps representative fields and marks truncated collections.
    """
    if not isinstance(result, dict):
        return {"agent_compacted": True, "tool": tool_name, "data": result}
    if result.get("error"):
        return result

    compacted = _compact_value(
        result,
        max_list_items=max_list_items,
        max_dict_keys=max_dict_keys,
        max_text_length=max_text_length,
    )
    if not isinstance(compacted, dict):
        compacted = {"data": compacted}
    compacted.setdefault("agent_compacted", True)
    compacted.setdefault("tool", tool_name)
    return compacted


def _compact_value(
    value: Any,
    *,
    max_list_items: int,
    max_dict_keys: int,
    max_text_length: int,
    depth: int = 0,
) -> Any:
    if isinstance(value, dict):
        items = list(value.items())
        omitted_count = 0
        if len(items) > max_dict_keys:
            priority_items = [(k, v) for k, v in items if str(k) in _PRIORITY_KEYS]
            other_items = [(k, v) for k, v in items if str(k) not in _PRIORITY_KEYS]
            selected = priority_items[:max_dict_keys]
            selected.extend(other_items[: max(0, max_dict_keys - len(selected))])
            omitted_count = len(items) - len(selected)
            items = selected

        compacted: Dict[str, Any] = {}
        for key, item in items:
            compacted[str(key)] = _compact_value(
                item,
                max_list_items=max_list_items,
                max_dict_keys=max(16, max_dict_keys - 8),
                max_text_length=max_text_length,
                depth=depth + 1,
            )
        if omitted_count > 0:
            compacted["truncated"] = True
            compacted["omitted_key_count"] = omitted_count
        return compacted

    if isinstance(value, list):
        total_count = len(value)
        if total_count <= max_list_items:
            return [
                _compact_value(
                    item,
                    max_list_items=max(4, max_list_items // 2),
                    max_dict_keys=max_dict_keys,
                    max_text_length=max_text_length,
                    depth=depth + 1,
                )
                for item in value
            ]

        head_count = max(1, max_list_items // 2)
        tail_count = max(1, max_list_items - head_count)
        selected = value[:head_count] + value[-tail_count:]
        return {
            "items": [
                _compact_value(
                    item,
                    max_list_items=max(4, max_list_items // 2),
                    max_dict_keys=max_dict_keys,
                    max_text_length=max_text_length,
                    depth=depth + 1,
                )
                for item in selected
            ],
            "total_count": total_count,
            "truncated": True,
        }

    if isinstance(value, str) and len(value) > max_text_length:
        return {
            "text": f"{value[:max_text_length]}...",
            "truncated": True,
            "original_length": len(value),
        }

    return value


def _handle_search_funds(
    query: str,
    search_type: str = "fund",
    page_index: int = 1,
    page_size: int = 10,
) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "search_funds",
        _invoke(
            "FUND_SEARCH",
            {
                "query": query,
                "search_type": search_type,
                "page_index": page_index,
                "page_size": page_size,
            },
        ),
        max_list_items=5,
    )


def _handle_get_fund_base_info(fcode: str) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "get_fund_base_info",
        _invoke("FUND_BASE_INFOS", {"fcode": fcode}),
    )


def _handle_get_fund_nav_info(fund_id: str, range: str = "n") -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "get_fund_nav_info",
        _invoke("FUND_NAV_INFO", {"fund_id": fund_id, "range": range}),
        max_list_items=8,
    )


def _handle_get_fund_holding_info(
    fund_id: str,
    holding_type: str = "all",
    report_period: Optional[str] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {"fund_id": fund_id, "holding_type": holding_type}
    if report_period:
        params["report_period"] = report_period
    return _compact_fund_tool_result(
        "get_fund_holding_info",
        _invoke("FUND_HOLDING_INFO", params),
        max_list_items=10,
    )


def _handle_get_fund_manager_info(
    manager_name: Optional[str] = None,
    manager_id: Optional[str] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {}
    if manager_id:
        params["manager_id"] = manager_id
    if manager_name:
        params["manager_name"] = manager_name
    if not params:
        return {"error": "manager_name or manager_id is required", "retriable": False}
    return _compact_fund_tool_result(
        "get_fund_manager_info",
        _invoke("FUND_MANAGER_INFO", params),
        max_list_items=8,
    )


def _handle_select_funds(
    orderField: str = "5_6_-1",
    pageIndex: int = 1,
    pageNum: int = 5,
    riskLevel: Optional[str] = None,
    fundLevel: Optional[str] = None,
    fundSize: Optional[str] = None,
    isDt: Optional[str] = None,
    fcode: Optional[str] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "pageIndex": pageIndex,
        "pageNum": pageNum,
        "pageType": 1,
        "orderField": orderField,
    }
    for key, value in {
        "riskLevel": riskLevel,
        "fundLevel": fundLevel,
        "fundSize": fundSize,
        "isDt": isDt,
        "fcode": fcode,
    }.items():
        if value:
            params[key] = value
    return _compact_fund_tool_result(
        "select_funds",
        _invoke("FUND_CONDITION_SELECT", params),
        max_list_items=8,
    )


def _handle_get_fund_index_info(index_id: str) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "get_fund_index_info",
        _invoke("FUND_INDEX_INFO", {"index_id": index_id}),
        max_list_items=8,
    )


def _handle_get_bond_market() -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "get_bond_market",
        _invoke("BOND_MARKET", {}),
        max_list_items=8,
    )


def _invoke_yingmi(method: str, *args: Any, **kwargs: Any) -> Dict[str, Any]:
    strategy = normalize_yingmi_fund_data_strategy(getattr(get_config(), "yingmi_fund_data_strategy", None))
    if strategy == "basic_only":
        return {
            "error": "基金数据策略为仅基础数据，已跳过盈米专业工具。",
            "retriable": False,
            "provider": "yingmi_stargate",
            "method": method,
        }
    try:
        client = YingmiStargateClient()
        handler = getattr(client, method)
        return handler(*args, **kwargs)
    except YingmiStargateError as exc:
        return {
            "error": str(exc),
            "retriable": False,
            "provider": "yingmi_stargate",
            "method": method,
        }


def _handle_yingmi_get_fund_diagnosis(fund_name_or_code: str) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_get_fund_diagnosis",
        _invoke_yingmi("get_fund_diagnosis", fund_name_or_code),
        max_list_items=8,
    )


def _handle_yingmi_analyze_fund_risk(fund_codes: Any) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_analyze_fund_risk",
        _invoke_yingmi("analyze_fund_risk", _normalize_code_list(fund_codes)),
        max_list_items=8,
    )


def _handle_yingmi_get_asset_allocation(fund_list: Any) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_get_asset_allocation",
        _invoke_yingmi("get_asset_allocation", _normalize_fund_list(fund_list)),
        max_list_items=10,
    )


def _handle_yingmi_get_funds_backtest(fund_list: Any) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_get_funds_backtest",
        _invoke_yingmi("get_funds_backtest", _normalize_fund_list(fund_list)),
        max_list_items=8,
    )


def _handle_yingmi_get_funds_correlation(fund_codes: Any) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_get_funds_correlation",
        _invoke_yingmi("get_funds_correlation", _normalize_code_list(fund_codes)),
        max_list_items=8,
    )


def _handle_yingmi_analyze_portfolio_risk(holdings: Any) -> Dict[str, Any]:
    normalized = holdings if isinstance(holdings, list) else []
    return _compact_fund_tool_result(
        "yingmi_analyze_portfolio_risk",
        _invoke_yingmi("analyze_portfolio_risk", normalized),
        max_list_items=8,
    )


def _handle_yingmi_search_strategies(keyword: str, page_num: int = 1, page_size: int = 10) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_search_strategies",
        _invoke_yingmi("search_strategies", keyword, page_num, page_size),
        max_list_items=5,
    )


def _handle_yingmi_get_strategy_details(strategy_codes: Any) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_get_strategy_details",
        _invoke_yingmi("get_strategy_details", _normalize_code_list(strategy_codes)),
        max_list_items=8,
    )


def _handle_yingmi_get_strategy_composition(strategy_codes: Any) -> Dict[str, Any]:
    return _compact_fund_tool_result(
        "yingmi_get_strategy_composition",
        _invoke_yingmi("get_strategy_composition", _normalize_code_list(strategy_codes)),
        max_list_items=8,
    )


def _normalize_code_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _normalize_fund_list(value: Any) -> list[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized = []
    for item in value:
        if not isinstance(item, dict):
            continue
        code = str(item.get("fundCode") or item.get("fund_code") or item.get("code") or "").strip()
        if not code:
            continue
        row = {"fundCode": code}
        if item.get("fundName") or item.get("fund_name") or item.get("name"):
            row["fundName"] = item.get("fundName") or item.get("fund_name") or item.get("name")
        if item.get("amount") is not None:
            row["amount"] = item.get("amount")
        normalized.append(row)
    return normalized


search_funds_tool = ToolDefinition(
    name="search_funds",
    description="Search Tiantian Fund ecosystem candidates by keyword. Supports fund, index, manager, and strategy search.",
    parameters=[
        ToolParameter(name="query", type="string", description="Search keyword, fund name, index name, manager name, or strategy name."),
        ToolParameter(
            name="search_type",
            type="string",
            description="Search type.",
            required=False,
            enum=["fund", "index", "manager", "strategy"],
            default="fund",
        ),
        ToolParameter(name="page_index", type="integer", description="Page index, default 1.", required=False, default=1),
        ToolParameter(name="page_size", type="integer", description="Page size, default 10.", required=False, default=10),
    ],
    handler=_handle_search_funds,
    category="data",
)

get_fund_base_info_tool = ToolDefinition(
    name="get_fund_base_info",
    description="Get fund base information by 6-digit fund code.",
    parameters=[ToolParameter(name="fcode", type="string", description="6-digit fund code, e.g. 000001.")],
    handler=_handle_get_fund_base_info,
    category="data",
)

get_fund_nav_info_tool = ToolDefinition(
    name="get_fund_nav_info",
    description="Get fund NAV history and performance range data.",
    parameters=[
        ToolParameter(name="fund_id", type="string", description="Fund code or fund name."),
        ToolParameter(
            name="range",
            type="string",
            description="NAV range: y=1 month, 3y=3 months, 6y=6 months, n=1 year, 2n=2 years, 3n=3 years, ln=since inception.",
            required=False,
            enum=["y", "3y", "6y", "n", "2n", "3n", "ln"],
            default="n",
        ),
    ],
    handler=_handle_get_fund_nav_info,
    category="data",
)

get_fund_holding_info_tool = ToolDefinition(
    name="get_fund_holding_info",
    description="Get fund holdings, asset allocation, industry allocation, and heavy holdings.",
    parameters=[
        ToolParameter(name="fund_id", type="string", description="Fund code or fund name."),
        ToolParameter(
            name="holding_type",
            type="string",
            description="Holding type: stock, bond, or all.",
            required=False,
            enum=["stock", "bond", "all"],
            default="all",
        ),
        ToolParameter(name="report_period", type="string", description="Optional report period, e.g. 2025-Q4.", required=False),
    ],
    handler=_handle_get_fund_holding_info,
    category="data",
)

get_fund_manager_info_tool = ToolDefinition(
    name="get_fund_manager_info",
    description=(
        "Get fund manager profile, tenure, managed products, representative funds, and historical risk/return metrics. "
        "Use this for active funds when judging hold/buy/DCA/core-position suitability if manager_name or manager_id is available."
    ),
    parameters=[
        ToolParameter(name="manager_name", type="string", description="Fund manager name.", required=False),
        ToolParameter(name="manager_id", type="string", description="Fund manager ID.", required=False),
    ],
    handler=_handle_get_fund_manager_info,
    category="data",
)

select_funds_tool = ToolDefinition(
    name="select_funds",
    description="Select funds by conditions such as return ranking, risk level, rating, size, DCA availability, or fund codes.",
    parameters=[
        ToolParameter(name="orderField", type="string", description="Sort field, e.g. 5_6_-1 for 1-year return descending.", required=False, default="5_6_-1"),
        ToolParameter(name="pageIndex", type="integer", description="Page index.", required=False, default=1),
        ToolParameter(name="pageNum", type="integer", description="Page size.", required=False, default=5),
        ToolParameter(name="riskLevel", type="string", description="Comma-separated risk levels.", required=False),
        ToolParameter(name="fundLevel", type="string", description="Comma-separated fund ratings.", required=False),
        ToolParameter(name="fundSize", type="string", description="Fund size filter.", required=False),
        ToolParameter(name="isDt", type="string", description="DCA availability, 1 means yes.", required=False),
        ToolParameter(name="fcode", type="string", description="Comma-separated fund codes.", required=False),
    ],
    handler=_handle_select_funds,
    category="data",
)

get_fund_index_info_tool = ToolDefinition(
    name="get_fund_index_info",
    description="Get index details, valuation, constituents, and related fund products.",
    parameters=[ToolParameter(name="index_id", type="string", description="Index code or index name.")],
    handler=_handle_get_fund_index_info,
    category="data",
)

get_bond_market_tool = ToolDefinition(
    name="get_bond_market",
    description="Get the latest Tiantian Fund bond market dashboard snapshot.",
    parameters=[],
    handler=_handle_get_bond_market,
    category="data",
)

yingmi_get_fund_diagnosis_tool = ToolDefinition(
    name="yingmi_get_fund_diagnosis",
    description="Get Yingmi professional diagnosis for a fund by fund code or name. Prefer this for single-fund suitability, risk, hold/add/watch judgments.",
    parameters=[ToolParameter(name="fund_name_or_code", type="string", description="Fund code or fund name.")],
    handler=_handle_yingmi_get_fund_diagnosis,
    category="analysis",
)

yingmi_analyze_fund_risk_tool = ToolDefinition(
    name="yingmi_analyze_fund_risk",
    description="Analyze professional risk for one or more fund codes with Yingmi.",
    parameters=[ToolParameter(name="fund_codes", type="array", description="List of 6-digit fund codes.")],
    handler=_handle_yingmi_analyze_fund_risk,
    category="analysis",
)

yingmi_get_asset_allocation_tool = ToolDefinition(
    name="yingmi_get_asset_allocation",
    description="Analyze fund-portfolio asset allocation with Yingmi. fund_list items should include fundCode and optional fundName/amount.",
    parameters=[ToolParameter(name="fund_list", type="array", description="List of fund holdings, each with fundCode, optional fundName and amount.")],
    handler=_handle_yingmi_get_asset_allocation,
    category="analysis",
)

yingmi_get_funds_backtest_tool = ToolDefinition(
    name="yingmi_get_funds_backtest",
    description="Run Yingmi fund-combination backtest for a list of fund holdings.",
    parameters=[ToolParameter(name="fund_list", type="array", description="List of fund holdings, each with fundCode, optional fundName and amount.")],
    handler=_handle_yingmi_get_funds_backtest,
    category="analysis",
)

yingmi_get_funds_correlation_tool = ToolDefinition(
    name="yingmi_get_funds_correlation",
    description="Analyze correlation between multiple funds with Yingmi. Use only when there are at least two fund codes.",
    parameters=[ToolParameter(name="fund_codes", type="array", description="List of 6-digit fund codes.")],
    handler=_handle_yingmi_get_funds_correlation,
    category="analysis",
)

yingmi_analyze_portfolio_risk_tool = ToolDefinition(
    name="yingmi_analyze_portfolio_risk",
    description="Analyze fund-portfolio risk with Yingmi. holdings items should include fundCode and weight.",
    parameters=[ToolParameter(name="holdings", type="array", description="List of holdings, each with fundCode and weight.")],
    handler=_handle_yingmi_analyze_portfolio_risk,
    category="analysis",
)

yingmi_search_strategies_tool = ToolDefinition(
    name="yingmi_search_strategies",
    description="Search Yingmi advisory strategy products by keyword. Prefer this for investment-advisory or strategy-product questions.",
    parameters=[
        ToolParameter(name="keyword", type="string", description="Strategy keyword or product name."),
        ToolParameter(name="page_num", type="integer", description="Page number.", required=False, default=1),
        ToolParameter(name="page_size", type="integer", description="Page size.", required=False, default=10),
    ],
    handler=_handle_yingmi_search_strategies,
    category="search",
)

yingmi_get_strategy_details_tool = ToolDefinition(
    name="yingmi_get_strategy_details",
    description="Get Yingmi advisory strategy details by strategy codes.",
    parameters=[ToolParameter(name="strategy_codes", type="array", description="List of strategy codes.")],
    handler=_handle_yingmi_get_strategy_details,
    category="analysis",
)

yingmi_get_strategy_composition_tool = ToolDefinition(
    name="yingmi_get_strategy_composition",
    description="Get Yingmi advisory strategy composition by strategy codes.",
    parameters=[ToolParameter(name="strategy_codes", type="array", description="List of strategy codes.")],
    handler=_handle_yingmi_get_strategy_composition,
    category="analysis",
)


ALL_FUND_TOOLS = [
    yingmi_get_fund_diagnosis_tool,
    yingmi_analyze_fund_risk_tool,
    yingmi_get_asset_allocation_tool,
    yingmi_get_funds_backtest_tool,
    yingmi_get_funds_correlation_tool,
    yingmi_analyze_portfolio_risk_tool,
    yingmi_search_strategies_tool,
    yingmi_get_strategy_details_tool,
    yingmi_get_strategy_composition_tool,
    search_funds_tool,
    get_fund_base_info_tool,
    get_fund_nav_info_tool,
    get_fund_holding_info_tool,
    get_fund_manager_info_tool,
    select_funds_tool,
    get_fund_index_info_tool,
    get_bond_market_tool,
]
