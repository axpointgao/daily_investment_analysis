# -*- coding: utf-8 -*-
"""Stock screener endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from api.v1.schemas.screener import (
    ScreenerRunRequest,
    ScreenerRunResponse,
    ScreenerStrategyInfo,
    ScreenerStrategyLibraryItem,
    ScreenerStrategyLibraryUpsertRequest,
)
from src.services.screener_service import ScreenerService
from src.services.screener_strategy_library_service import ScreenerStrategyLibraryService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/strategies", response_model=list[ScreenerStrategyInfo])
def list_screener_strategies() -> list[ScreenerStrategyInfo]:
    """List local low-frequency screener strategies."""
    return [ScreenerStrategyInfo(**item) for item in ScreenerService.list_strategies()]


@router.get("/library", response_model=list[ScreenerStrategyLibraryItem])
def list_screener_strategy_library() -> list[ScreenerStrategyLibraryItem]:
    """List saved natural-language screener strategies."""
    return [ScreenerStrategyLibraryItem(**item) for item in ScreenerStrategyLibraryService().list_items()]


@router.post("/library", response_model=ScreenerStrategyLibraryItem)
def create_screener_strategy_library_item(
    request: ScreenerStrategyLibraryUpsertRequest,
) -> ScreenerStrategyLibraryItem:
    """Create a saved natural-language screener strategy."""
    item = ScreenerStrategyLibraryService().create_item(request.model_dump(exclude_none=True))
    return ScreenerStrategyLibraryItem(**item)


@router.put("/library/{item_id}", response_model=ScreenerStrategyLibraryItem)
def update_screener_strategy_library_item(
    item_id: str,
    request: ScreenerStrategyLibraryUpsertRequest,
) -> ScreenerStrategyLibraryItem:
    """Update a saved natural-language screener strategy."""
    try:
        item = ScreenerStrategyLibraryService().update_item(item_id, request.model_dump(exclude_none=True))
        return ScreenerStrategyLibraryItem(**item)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "strategy_not_found", "message": "策略不存在。"},
        ) from exc


@router.post("/run", response_model=ScreenerRunResponse)
def run_screener(request: ScreenerRunRequest) -> ScreenerRunResponse:
    """Run local screener against watchlist or user-provided stock pool."""
    try:
        payload = ScreenerService().run(
            strategy_ids=list(request.strategy_ids),
            stock_codes=request.stock_codes,
            limit=request.limit,
            include_fundamentals=request.include_fundamentals,
            use_iwencai=request.use_iwencai,
            iwencai_query=request.iwencai_query,
            iwencai_page=request.iwencai_page,
        )
        if request.strategy_library_id:
            mode = "导入候选" if payload.get("execution_mode") == "iwencai_import" else "本地选股"
            summary = (
                f"{mode} {len(payload.get('candidates') or [])} 只，"
                f"输入 {payload.get('total_input') or 0} 只"
            )
            ScreenerStrategyLibraryService().update_last_run(request.strategy_library_id, summary)
        return ScreenerRunResponse(**payload)
    except Exception as exc:
        logger.error("Screener run failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "screener_failed", "message": f"选股运行失败: {exc}"},
        ) from exc


@router.post("/imports/iwencai-excel", response_model=ScreenerRunResponse)
async def import_iwencai_excel(
    file: UploadFile = File(...),
    strategy_query: str = Form(""),
    strategy_library_id: str = Form(""),
    limit: int = Form(100),
) -> ScreenerRunResponse:
    """Import iWencai Web/client exported Excel rows as screener candidates."""
    try:
        content = await file.read()
        payload = ScreenerService().import_iwencai_excel(
            content,
            filename=file.filename or "",
            strategy_query=strategy_query or None,
            limit=limit,
        )
        if strategy_library_id:
            summary = f"导入 {len(payload.get('candidates') or [])} 只候选"
            ScreenerStrategyLibraryService().update_last_run(strategy_library_id, summary)
        return ScreenerRunResponse(**payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_iwencai_excel", "message": str(exc)},
        ) from exc
    except Exception as exc:
        logger.error("Screener iWencai Excel import failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "screener_import_failed", "message": f"导入问财候选股失败: {exc}"},
        ) from exc
