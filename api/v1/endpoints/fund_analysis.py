# -*- coding: utf-8 -*-
"""场外基金分析接口。"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse

from api.v1.schemas.common import ErrorResponse
from api.v1.schemas.fund_analysis import (
    DuplicateFundTaskErrorResponse,
    FundAnalyzeRequest,
    FundAnalysisResultResponse,
    FundTaskAccepted,
    FundTaskInfo,
    FundTaskListResponse,
    FundTaskStatus,
)
from src.services.fund_analysis_service import FundAnalysisService, FundAnalysisError, normalize_fund_code
from src.services.fund_task_queue import DuplicateFundTaskError, get_fund_task_queue

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post(
    "/analyze",
    response_model=FundAnalysisResultResponse,
    responses={
        200: {"description": "分析完成", "model": FundAnalysisResultResponse},
        202: {"description": "分析任务已接受", "model": FundTaskAccepted},
        400: {"description": "请求参数错误", "model": ErrorResponse},
        409: {"description": "基金正在分析中", "model": DuplicateFundTaskErrorResponse},
        500: {"description": "分析失败", "model": ErrorResponse},
    },
    summary="触发场外基金分析",
)
def trigger_fund_analysis(request: FundAnalyzeRequest) -> Union[FundAnalysisResultResponse, JSONResponse]:
    try:
        code = normalize_fund_code(request.fund_code)
    except FundAnalysisError as exc:
        raise HTTPException(status_code=400, detail={"error": "validation_error", "message": str(exc)}) from exc

    if request.async_mode:
        queue = get_fund_task_queue()
        try:
            task = queue.submit_task(
                fund_code=code,
                fund_name=request.fund_name,
                report_type=request.report_type,
                force_refresh=request.force_refresh,
                notify=request.notify,
            )
        except DuplicateFundTaskError as exc:
            response = DuplicateFundTaskErrorResponse(
                message=str(exc),
                fund_code=exc.fund_code,
                existing_task_id=exc.existing_task_id,
            )
            return JSONResponse(status_code=409, content=response.model_dump())
        except Exception as exc:
            logger.error("基金任务提交失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)}) from exc

        response = FundTaskAccepted(
            task_id=task.task_id,
            status="pending",
            message=f"基金分析任务已加入队列: {task.fund_code}",
        )
        return JSONResponse(status_code=202, content=response.model_dump())

    service = FundAnalysisService()
    result = service.analyze_fund(
        fund_code=code,
        fund_name=request.fund_name,
        report_type=request.report_type,
        force_refresh=request.force_refresh,
        notify=request.notify,
    )
    if not result:
        raise HTTPException(
            status_code=500,
            detail={"error": "analysis_failed", "message": service.last_error or f"分析基金 {code} 失败"},
        )
    return FundAnalysisResultResponse(
        query_id=result.get("query_id", ""),
        fund_code=result.get("fund_code", code),
        fund_name=result.get("fund_name"),
        report=result.get("report"),
        created_at=result.get("created_at") or datetime.now().isoformat(),
    )


@router.get("/tasks", response_model=FundTaskListResponse, summary="获取场外基金分析任务列表")
def get_fund_task_list(
    status: Optional[str] = Query(None, description="筛选状态：pending, processing, completed, failed"),
    limit: int = Query(20, ge=1, le=100, description="返回数量限制"),
) -> FundTaskListResponse:
    queue = get_fund_task_queue()
    tasks = queue.list_all_tasks(limit=limit)
    if status:
        status_list = [item.strip().lower() for item in status.split(",")]
        tasks = [task for task in tasks if task.status.value in status_list]
    stats = queue.get_task_stats()
    return FundTaskListResponse(
        total=stats["total"],
        pending=stats["pending"],
        processing=stats["processing"],
        tasks=[
            FundTaskInfo(
                task_id=task.task_id,
                fund_code=task.fund_code,
                fund_name=task.fund_name,
                status=task.status.value,
                progress=task.progress,
                message=task.message,
                report_type=task.report_type,
                created_at=task.created_at.isoformat(),
                started_at=task.started_at.isoformat() if task.started_at else None,
                completed_at=task.completed_at.isoformat() if task.completed_at else None,
                error=task.error,
                notification_error=task.notification_error,
            )
            for task in tasks
        ],
    )


@router.get("/status/{task_id}", response_model=FundTaskStatus, responses={404: {"model": ErrorResponse}})
def get_fund_task_status(task_id: str) -> FundTaskStatus:
    task = get_fund_task_queue().get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"任务不存在: {task_id}"})

    result = None
    if task.result:
        result = FundAnalysisResultResponse(
            query_id=task.result.get("query_id", task.task_id),
            fund_code=task.result.get("fund_code", task.fund_code),
            fund_name=task.result.get("fund_name", task.fund_name),
            report=task.result.get("report"),
            created_at=task.result.get("created_at") or datetime.now().isoformat(),
        )

    return FundTaskStatus(
        task_id=task.task_id,
        status=task.status.value,
        progress=task.progress,
        result=result,
        error=task.error,
        message=task.message,
        notification_error=task.notification_error,
        fund_name=task.fund_name,
    )


@router.get(
    "/tasks/stream",
    responses={200: {"description": "SSE 事件流", "content": {"text/event-stream": {}}}},
    summary="场外基金任务状态 SSE 流",
)
async def fund_task_stream():
    async def event_generator():
        queue = get_fund_task_queue()
        event_queue: asyncio.Queue = asyncio.Queue()
        yield _format_sse_event("connected", {"message": "Connected to fund task stream"})

        for task in queue.list_pending_tasks():
            yield _format_sse_event("task_created", task.to_dict())

        queue.subscribe(event_queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(event_queue.get(), timeout=30)
                    yield _format_sse_event(event["type"], event["data"])
                except asyncio.TimeoutError:
                    yield _format_sse_event("heartbeat", {"timestamp": datetime.now().isoformat()})
        except asyncio.CancelledError:
            logger.debug("基金 SSE client disconnected")
            raise
        finally:
            queue.unsubscribe(event_queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


def _format_sse_event(event_type: str, data: Dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
