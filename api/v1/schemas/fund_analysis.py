# -*- coding: utf-8 -*-
"""场外基金分析 API 模型。"""

from typing import Any, Optional, List

from pydantic import BaseModel, Field


class FundAnalyzeRequest(BaseModel):
    """场外基金分析请求。"""

    fund_code: str = Field(..., description="6 位场外基金代码", example="000001", pattern=r"^\d{6}$")
    fund_name: Optional[str] = Field(None, description="基金名称（可选）", example="华夏成长混合")
    report_type: str = Field(
        "simple",
        description="报告类型：brief(极简摘要) / simple(标准诊断摘要) / full(完整诊断)",
        pattern="^(simple|detailed|full|brief)$",
    )
    force_refresh: bool = Field(False, description="是否强制刷新")
    async_mode: bool = Field(False, description="是否使用异步模式")
    notify: bool = Field(True, description="是否发送通知")


class FundAnalysisResultResponse(BaseModel):
    """场外基金分析结果。"""

    query_id: str = Field(..., description="分析记录唯一标识")
    fund_code: str = Field(..., description="基金代码")
    fund_name: Optional[str] = Field(None, description="基金名称")
    report: Optional[Any] = Field(None, description="基金分析报告")
    created_at: str = Field(..., description="创建时间")


class FundTaskAccepted(BaseModel):
    """场外基金异步任务接受响应。"""

    task_id: str = Field(..., description="任务 ID")
    status: str = Field(..., description="任务状态", pattern="^(pending|processing)$")
    message: Optional[str] = Field(None, description="提示信息")


class FundTaskStatus(BaseModel):
    """场外基金任务状态。"""

    task_id: str = Field(..., description="任务 ID")
    status: str = Field(..., description="任务状态", pattern="^(pending|processing|completed|failed)$")
    progress: Optional[int] = Field(None, description="进度百分比", ge=0, le=100)
    result: Optional[FundAnalysisResultResponse] = Field(None, description="分析结果")
    error: Optional[str] = Field(None, description="错误信息")
    notification_error: Optional[str] = Field(None, description="通知发送失败原因")
    fund_name: Optional[str] = Field(None, description="基金名称")


class FundTaskInfo(BaseModel):
    """场外基金任务详情。"""

    task_id: str = Field(..., description="任务 ID")
    type: str = Field("fund", description="任务类型")
    fund_code: str = Field(..., description="基金代码")
    fund_name: Optional[str] = Field(None, description="基金名称")
    status: str = Field(..., description="任务状态")
    progress: int = Field(0, description="进度百分比", ge=0, le=100)
    message: Optional[str] = Field(None, description="状态消息")
    report_type: str = Field("detailed", description="报告类型")
    created_at: str = Field(..., description="创建时间")
    started_at: Optional[str] = Field(None, description="开始执行时间")
    completed_at: Optional[str] = Field(None, description="完成时间")
    error: Optional[str] = Field(None, description="错误信息")


class FundTaskListResponse(BaseModel):
    """场外基金任务列表。"""

    total: int = Field(..., description="任务总数")
    pending: int = Field(..., description="等待中的任务数")
    processing: int = Field(..., description="处理中的任务数")
    tasks: List[FundTaskInfo] = Field(default_factory=list, description="任务列表")


class DuplicateFundTaskErrorResponse(BaseModel):
    """基金重复任务错误。"""

    error: str = Field("duplicate_task", description="错误类型")
    message: str = Field(..., description="错误信息")
    fund_code: str = Field(..., description="基金代码")
    existing_task_id: str = Field(..., description="已存在任务 ID")
