# -*- coding: utf-8 -*-
"""Stock screener API schemas."""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


ScreenerStrategyId = Literal[
    "quality_value",
    "multi_factor",
    "trend_follow",
    "pullback",
    "breakout",
]


class ScreenerRunRequest(BaseModel):
    strategy_ids: List[ScreenerStrategyId] = Field(
        default_factory=lambda: ["quality_value", "multi_factor", "trend_follow"],
        description="要执行的选股策略",
    )
    stock_codes: Optional[List[str]] = Field(
        default=None,
        description="候选股票池；为空时使用系统自选股列表",
    )
    iwencai_query: Optional[str] = Field(
        default=None,
        description="问财自然语言全市场选股条件；use_iwencai=true 时生效",
    )
    iwencai_page: int = Field(1, ge=1, le=100, description="问财分页页码")
    limit: int = Field(30, ge=1, le=100, description="返回结果上限")
    include_fundamentals: bool = Field(
        False,
        description="是否补充基本面数据；会比纯技术筛选更慢",
    )
    use_iwencai: bool = Field(
        False,
        description="兼容旧字段；当前主流程不再在线调用问财选股",
    )
    strategy_library_id: Optional[str] = Field(
        default=None,
        description="策略库条目 ID；传入后会更新该策略的最近运行结果",
    )


class ScreenerStrategyInfo(BaseModel):
    id: str
    name: str
    description: str
    cadence: str
    data_scope: List[str] = Field(default_factory=list)
    iwencai_fit: str


class ScreenerCandidate(BaseModel):
    code: str
    name: Optional[str] = None
    score: float
    matched_strategies: List[str] = Field(default_factory=list)
    reasons: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    metrics: Dict[str, Optional[float]] = Field(default_factory=dict)
    iwencai_fields: Dict[str, str] = Field(default_factory=dict)
    latest_date: Optional[str] = None
    data_source: str = ""


class ScreenerRunResponse(BaseModel):
    strategies: List[ScreenerStrategyInfo] = Field(default_factory=list)
    candidates: List[ScreenerCandidate] = Field(default_factory=list)
    total_input: int
    evaluated: int
    skipped: int
    data_mode: str
    execution_mode: str = "local_query"
    local_executable: bool = True
    supported_terms: List[str] = Field(default_factory=list)
    unsupported_terms: List[str] = Field(default_factory=list)
    import_required: bool = False
    iwencai_status: str
    iwencai_query: Optional[str] = None
    iwencai_code_count: Optional[int] = None
    iwencai_returned_count: Optional[int] = None
    iwencai_has_more: bool = False
    iwencai_chunks_info: Dict[str, object] = Field(default_factory=dict)
    notes: List[str] = Field(default_factory=list)


class ScreenerStrategyLibraryItem(BaseModel):
    id: str
    name: str
    description: str
    query: str
    backtest_status: str = "未回测"
    last_run_result: Optional[str] = None
    created_at: str
    updated_at: str


class ScreenerStrategyLibraryUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str = Field(..., min_length=1, max_length=400)
    query: str = Field(..., min_length=1, max_length=1000)
    backtest_status: Optional[str] = Field(default=None, max_length=80)
    last_run_result: Optional[str] = Field(default=None, max_length=400)
