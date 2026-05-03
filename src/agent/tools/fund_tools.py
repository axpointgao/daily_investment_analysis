# -*- coding: utf-8 -*-
"""Fund Agent tools backed by Tiantian Fund official Skills."""

from __future__ import annotations

from typing import Any, Dict, Optional

from src.agent.tools.registry import ToolDefinition, ToolParameter
from src.services.ttfund_skills_client import TtfundSkillsClient, TtfundSkillsError


def _invoke(skill_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        return TtfundSkillsClient().invoke(skill_id, params or {})
    except TtfundSkillsError as exc:
        return {
            "error": str(exc),
            "retriable": False,
            "skill_id": skill_id,
        }


def _handle_search_funds(query: str, search_type: str = "fund", page_index: int = 1, page_size: int = 10) -> Dict[str, Any]:
    return _invoke(
        "FUND_SEARCH",
        {
            "query": query,
            "search_type": search_type,
            "page_index": page_index,
            "page_size": page_size,
        },
    )


def _handle_get_fund_base_info(fcode: str) -> Dict[str, Any]:
    return _invoke("FUND_BASE_INFOS", {"fcode": fcode})


def _handle_get_fund_nav_info(fund_id: str, range: str = "n") -> Dict[str, Any]:
    return _invoke("FUND_NAV_INFO", {"fund_id": fund_id, "range": range})


def _handle_get_fund_holding_info(
    fund_id: str,
    holding_type: str = "all",
    report_period: Optional[str] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {"fund_id": fund_id, "holding_type": holding_type}
    if report_period:
        params["report_period"] = report_period
    return _invoke("FUND_HOLDING_INFO", params)


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
    return _invoke("FUND_MANAGER_INFO", params)


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
    return _invoke("FUND_CONDITION_SELECT", params)


def _handle_get_fund_index_info(index_id: str) -> Dict[str, Any]:
    return _invoke("FUND_INDEX_INFO", {"index_id": index_id})


def _handle_get_bond_market() -> Dict[str, Any]:
    return _invoke("BOND_MARKET", {})


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


ALL_FUND_TOOLS = [
    search_funds_tool,
    get_fund_base_info_tool,
    get_fund_nav_info_tool,
    get_fund_holding_info_tool,
    get_fund_manager_info_tool,
    select_funds_tool,
    get_fund_index_info_tool,
    get_bond_market_tool,
]
