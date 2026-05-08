# -*- coding: utf-8 -*-
"""Portfolio endpoints (P0 core account + snapshot workflow)."""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from api.v1.schemas.common import ErrorResponse
from api.v1.schemas.portfolio import (
    PortfolioAccountCreateRequest,
    PortfolioAccountItem,
    PortfolioAccountListResponse,
    PortfolioAccountUpdateRequest,
    PortfolioAdvisoryLedgerCreateRequest,
    PortfolioAdvisoryLedgerListResponse,
    PortfolioAdvisoryNavRequest,
    PortfolioAdvisoryNavResponse,
    PortfolioAdvisoryProductItem,
    PortfolioAdvisoryProductSearchRequest,
    PortfolioAdvisoryProductSearchResponse,
    PortfolioAnalysisRequest,
    PortfolioAnalysisResponse,
    PortfolioBankLedgerCreateRequest,
    PortfolioBankLedgerListResponse,
    PortfolioBankWealthNavRequest,
    PortfolioBankWealthNavResponse,
    PortfolioBankWealthProductItem,
    PortfolioBankWealthProductSearchRequest,
    PortfolioBankWealthProductSearchResponse,
    PortfolioCashLedgerListResponse,
    PortfolioCashLedgerCreateRequest,
    PortfolioCorporateActionListResponse,
    PortfolioCorporateActionCreateRequest,
    PortfolioDeleteResponse,
    PortfolioEventCreatedResponse,
    PortfolioFxRefreshResponse,
    PortfolioImportBrokerListResponse,
    PortfolioImportCommitResponse,
    PortfolioImportParseResponse,
    PortfolioImportTradeItem,
    PortfolioInsuranceLedgerCreateRequest,
    PortfolioInsuranceLedgerListResponse,
    PortfolioInsurancePolicyCreateRequest,
    PortfolioInsurancePolicyItem,
    PortfolioInsurancePolicyListResponse,
    PortfolioInsurancePolicyUpdateRequest,
    PortfolioManualPriceItem,
    PortfolioManualPriceUpsertRequest,
    PortfolioRiskResponse,
    PortfolioSnapshotResponse,
    PortfolioProductTagUpdateRequest,
    PortfolioProductTagUpdateResponse,
    PortfolioTagCreateRequest,
    PortfolioTagItem,
    PortfolioTagListResponse,
    PortfolioTagUpdateRequest,
    PortfolioTradeListResponse,
    PortfolioTradeCreateRequest,
)
from src.services.iwencai_wealth_client import IwencaiWealthClient, IwencaiWealthError
from src.services.portfolio_analysis_service import PortfolioAnalysisError, PortfolioAnalysisService
from src.services.portfolio_import_service import PortfolioImportService
from src.services.portfolio_risk_service import PortfolioRiskService
from src.services.portfolio_service import (
    PortfolioBusyError,
    PortfolioConflictError,
    PortfolioOversellError,
    PortfolioService,
)
from src.services.yingmi_stargate_client import YingmiStargateClient, YingmiStargateError

logger = logging.getLogger(__name__)

router = APIRouter()


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"error": "validation_error", "message": str(exc)},
    )


def _internal_error(message: str, exc: Exception) -> HTTPException:
    logger.error(f"{message}: {exc}", exc_info=True)
    return HTTPException(
        status_code=500,
        detail={"error": "internal_error", "message": f"{message}: {str(exc)}"},
    )


def _conflict_error(*, error: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"error": error, "message": message},
    )


def _serialize_import_record(item: dict) -> PortfolioImportTradeItem:
    payload = dict(item)
    trade_date = payload.get("trade_date")
    if isinstance(trade_date, date):
        payload["trade_date"] = trade_date.isoformat()
    else:
        payload["trade_date"] = str(trade_date)
    return PortfolioImportTradeItem(**payload)


@router.get(
    "/tags",
    response_model=PortfolioTagListResponse,
    responses={500: {"model": ErrorResponse}},
    summary="List portfolio product tags",
)
def list_tags() -> PortfolioTagListResponse:
    service = PortfolioService()
    try:
        return PortfolioTagListResponse(tags=[PortfolioTagItem(**item) for item in service.list_tags()])
    except Exception as exc:
        raise _internal_error("List portfolio tags failed", exc)


@router.post(
    "/tags",
    response_model=PortfolioTagItem,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Create portfolio product tag",
)
def create_tag(request: PortfolioTagCreateRequest) -> PortfolioTagItem:
    service = PortfolioService()
    try:
        return PortfolioTagItem(**service.create_tag(name=request.name, color=request.color))
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except PortfolioConflictError as exc:
        raise _conflict_error(error="conflict", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create portfolio tag failed", exc)


@router.patch(
    "/tags/{tag_id}",
    response_model=PortfolioTagItem,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Update portfolio product tag",
)
def update_tag(tag_id: int, request: PortfolioTagUpdateRequest) -> PortfolioTagItem:
    service = PortfolioService()
    try:
        data = service.update_tag(tag_id=tag_id, name=request.name, color=request.color)
        if data is None:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Tag not found: {tag_id}"})
        return PortfolioTagItem(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except PortfolioConflictError as exc:
        raise _conflict_error(error="conflict", message=str(exc))
    except HTTPException:
        raise
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Update portfolio tag failed", exc)


@router.delete(
    "/tags/{tag_id}",
    response_model=PortfolioDeleteResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete portfolio product tag",
)
def delete_tag(tag_id: int) -> PortfolioDeleteResponse:
    service = PortfolioService()
    try:
        ok = service.delete_tag(tag_id)
        if not ok:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Tag not found: {tag_id}"})
        return PortfolioDeleteResponse(deleted=1)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Delete portfolio tag failed", exc)


@router.put(
    "/product-tags",
    response_model=PortfolioProductTagUpdateResponse,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Assign one global tag to a portfolio product",
)
def update_product_tag(request: PortfolioProductTagUpdateRequest) -> PortfolioProductTagUpdateResponse:
    service = PortfolioService()
    try:
        data = service.set_product_tag(product_key=request.product_key, tag_id=request.tag_id)
        return PortfolioProductTagUpdateResponse(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Update product tag failed", exc)


@router.post(
    "/accounts",
    response_model=PortfolioAccountItem,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Create portfolio account",
)
def create_account(request: PortfolioAccountCreateRequest) -> PortfolioAccountItem:
    service = PortfolioService()
    try:
        row = service.create_account(
            name=request.name,
            broker=request.broker,
            market=request.market,
            base_currency=request.base_currency,
            cash_tracking_mode=request.cash_tracking_mode,
            owner_id=request.owner_id,
        )
        return PortfolioAccountItem(**row)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create account failed", exc)


@router.get(
    "/accounts",
    response_model=PortfolioAccountListResponse,
    responses={500: {"model": ErrorResponse}},
    summary="List portfolio accounts",
)
def list_accounts(
    include_inactive: bool = Query(False, description="Whether to include inactive accounts"),
) -> PortfolioAccountListResponse:
    service = PortfolioService()
    try:
        rows = service.list_accounts(include_inactive=include_inactive)
        return PortfolioAccountListResponse(accounts=[PortfolioAccountItem(**item) for item in rows])
    except Exception as exc:
        raise _internal_error("List accounts failed", exc)


@router.put(
    "/accounts/{account_id}",
    response_model=PortfolioAccountItem,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Update portfolio account",
)
def update_account(account_id: int, request: PortfolioAccountUpdateRequest) -> PortfolioAccountItem:
    service = PortfolioService()
    try:
        updated = service.update_account(
            account_id,
            name=request.name,
            broker=request.broker,
            market=request.market,
            base_currency=request.base_currency,
            cash_tracking_mode=request.cash_tracking_mode,
            owner_id=request.owner_id,
            is_active=request.is_active,
        )
        if updated is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Account not found: {account_id}"},
            )
        return PortfolioAccountItem(**updated)
    except HTTPException:
        raise
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Update account failed", exc)


@router.delete(
    "/accounts/{account_id}",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Deactivate portfolio account",
)
def delete_account(account_id: int):
    service = PortfolioService()
    try:
        ok = service.deactivate_account(account_id)
        if not ok:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Account not found: {account_id}"},
            )
        return {"deleted": 1}
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Deactivate account failed", exc)


@router.post(
    "/trades",
    response_model=PortfolioEventCreatedResponse,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Record trade event",
)
def create_trade(request: PortfolioTradeCreateRequest) -> PortfolioEventCreatedResponse:
    service = PortfolioService()
    try:
        data = service.record_trade(
            account_id=request.account_id,
            symbol=request.symbol,
            trade_date=request.trade_date,
            side=request.side,
            quantity=request.quantity,
            price=request.price,
            fee=request.fee,
            tax=request.tax,
            market=request.market,
            currency=request.currency,
            trade_uid=request.trade_uid,
            note=request.note,
        )
        return PortfolioEventCreatedResponse(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except PortfolioOversellError as exc:
        raise _conflict_error(error="portfolio_oversell", message=str(exc))
    except PortfolioConflictError as exc:
        raise _conflict_error(error="conflict", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create trade failed", exc)


@router.get(
    "/trades",
    response_model=PortfolioTradeListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List trade events",
)
def list_trades(
    account_id: Optional[int] = Query(None, description="Optional account id"),
    date_from: Optional[date] = Query(None, description="Trade date from"),
    date_to: Optional[date] = Query(None, description="Trade date to"),
    symbol: Optional[str] = Query(None, description="Optional stock symbol filter"),
    side: Optional[str] = Query(None, description="Optional side filter: buy/sell"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PortfolioTradeListResponse:
    service = PortfolioService()
    try:
        data = service.list_trade_events(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            symbol=symbol,
            side=side,
            page=page,
            page_size=page_size,
        )
        return PortfolioTradeListResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List trade events failed", exc)


@router.delete(
    "/trades/{trade_id}",
    response_model=PortfolioDeleteResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete trade event",
)
def delete_trade(trade_id: int) -> PortfolioDeleteResponse:
    service = PortfolioService()
    try:
        ok = service.delete_trade_event(trade_id)
        if not ok:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Trade not found: {trade_id}"},
            )
        return PortfolioDeleteResponse(deleted=1)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Delete trade event failed", exc)


@router.post(
    "/cash-ledger",
    response_model=PortfolioEventCreatedResponse,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Record cash event",
)
def create_cash_ledger(request: PortfolioCashLedgerCreateRequest) -> PortfolioEventCreatedResponse:
    service = PortfolioService()
    try:
        data = service.record_cash_ledger(
            account_id=request.account_id,
            event_date=request.event_date,
            direction=request.direction,
            amount=request.amount,
            currency=request.currency,
            note=request.note,
        )
        return PortfolioEventCreatedResponse(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create cash ledger event failed", exc)


@router.post(
    "/manual-prices",
    response_model=PortfolioManualPriceItem,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Upsert manual latest price fallback",
)
def upsert_manual_price(request: PortfolioManualPriceUpsertRequest) -> PortfolioManualPriceItem:
    service = PortfolioService()
    try:
        data = service.upsert_manual_price(
            account_id=request.account_id,
            symbol=request.symbol,
            market=request.market,
            price_date=request.price_date,
            price=request.price,
            currency=request.currency,
            note=request.note,
        )
        return PortfolioManualPriceItem(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Upsert manual price failed", exc)


@router.post(
    "/bank-ledger",
    response_model=PortfolioEventCreatedResponse,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Record bank demand, deposit or wealth ledger event",
)
def create_bank_ledger(request: PortfolioBankLedgerCreateRequest) -> PortfolioEventCreatedResponse:
    service = PortfolioService()
    try:
        data = service.record_bank_ledger(
            account_id=request.account_id,
            event_date=request.event_date,
            asset_kind=request.asset_kind,
            direction=request.direction,
            amount=request.amount,
            currency=request.currency,
            bank_name=request.bank_name,
            product_name=request.product_name,
            product_code=request.product_code,
            product_public_code=request.product_public_code,
            issuer_name=request.issuer_name,
            registration_code=request.registration_code,
            linked_entry_id=request.linked_entry_id,
            quantity=request.quantity,
            unit_nav=request.unit_nav,
            nav_date=request.nav_date,
            start_date=request.start_date,
            maturity_date=request.maturity_date,
            annual_rate=request.annual_rate,
            investment_nature=request.investment_nature,
            risk_level=request.risk_level,
            income_mode=request.income_mode,
        )
        return PortfolioEventCreatedResponse(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create bank ledger event failed", exc)


@router.post(
    "/bank-wealth/search",
    response_model=PortfolioBankWealthProductSearchResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Search bank wealth products via iWencai",
)
def search_bank_wealth_products(
    request: PortfolioBankWealthProductSearchRequest,
) -> PortfolioBankWealthProductSearchResponse:
    try:
        products = IwencaiWealthClient().search_products(request.keyword, limit=request.limit)
        return PortfolioBankWealthProductSearchResponse(
            products=[
                PortfolioBankWealthProductItem(
                    product_code=item.product_code,
                    product_name=item.product_name,
                    product_public_code=item.public_code,
                    issuer_name=item.issuer_name,
                    risk_level=item.risk_level,
                    investment_type=item.investment_type,
                    term_type=item.term_type,
                    redeemable=item.redeemable,
                    benchmark=item.benchmark,
                    management_fee=item.management_fee,
                    custody_fee=item.custody_fee,
                    subscription_fee=item.subscription_fee,
                )
                for item in products
            ]
        )
    except IwencaiWealthError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Search bank wealth products failed", exc)


@router.post(
    "/bank-wealth/nav",
    response_model=PortfolioBankWealthNavResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Fetch bank wealth NAV via iWencai",
)
def get_bank_wealth_nav(request: PortfolioBankWealthNavRequest) -> PortfolioBankWealthNavResponse:
    try:
        client = IwencaiWealthClient()
        nav = (
            client.get_historical_nav(request.product_identifier, request.nav_date)
            if request.nav_date
            else client.get_latest_nav(request.product_identifier)
        )
        if nav is None:
            return PortfolioBankWealthNavResponse(unit_nav=None, nav_date=None, change_pct=None)
        return PortfolioBankWealthNavResponse(
            unit_nav=nav.unit_nav,
            nav_date=nav.nav_date.isoformat() if nav.nav_date else None,
            change_pct=nav.change_pct,
        )
    except IwencaiWealthError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Fetch bank wealth NAV failed", exc)


def _yingmi_rows(payload: object) -> list[dict]:
    rows: list[dict] = []
    stack = [payload]
    while stack:
        item = stack.pop(0)
        if isinstance(item, list):
            rows.extend(candidate for candidate in item if isinstance(candidate, dict))
            continue
        if not isinstance(item, dict):
            continue
        nested = False
        for key in ("rows", "data", "items", "list"):
            value = item.get(key)
            if isinstance(value, list) or isinstance(value, dict):
                stack.append(value)
                nested = True
        if not nested:
            rows.append(item)
    return rows


def _field(row: dict, *names: str) -> object:
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            return value
    return None


@router.post(
    "/advisory-products/search",
    response_model=PortfolioAdvisoryProductSearchResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Search advisory products via Yingmi StarGate",
)
def search_advisory_products(
    request: PortfolioAdvisoryProductSearchRequest,
) -> PortfolioAdvisoryProductSearchResponse:
    try:
        client = YingmiStargateClient(timeout=12.0)
        search_payload = client.search_strategies(request.keyword, page_num=1, page_size=request.limit)
        search_rows = _yingmi_rows(search_payload)
        codes: list[str] = []
        for row in search_rows:
            code = str(_field(row, "策略代码", "strategyCode", "strategy_code") or "").strip().upper()
            if code and code not in codes:
                codes.append(code)
        details_by_code: dict[str, dict] = {}
        if codes:
            detail_payload = client.get_strategy_details(codes, page_num=1, page_size=max(len(codes), 1))
            for row in _yingmi_rows(detail_payload):
                code = str(_field(row, "策略代码", "strategyCode", "strategy_code") or "").strip().upper()
                if code:
                    details_by_code[code] = row
        products: list[PortfolioAdvisoryProductItem] = []
        for row in search_rows:
            code = str(_field(row, "策略代码", "strategyCode", "strategy_code") or "").strip().upper()
            if not code:
                continue
            detail = details_by_code.get(code, {})
            source = {**row, **detail}
            latest_nav = _field(source, "策略净值", "nav", "latestNav")
            try:
                latest_nav_float = float(latest_nav) if latest_nav is not None else None
            except (TypeError, ValueError):
                latest_nav_float = None
            products.append(
                PortfolioAdvisoryProductItem(
                    strategy_code=code,
                    product_name=str(_field(source, "策略名称", "strategyName", "name") or ""),
                    product_type=request.product_type,
                    risk_level=str(_field(source, "策略风险等级", "risk5LevelName", "riskLevel") or "") or None,
                    manager_name=str(_field(source, "管理人名称", "managerName") or "") or None,
                    established_date=str(_field(source, "策略成立时间", "establishedDate") or "") or None,
                    latest_nav=latest_nav_float,
                    latest_nav_date=str(_field(source, "最新净值日期", "latestNavDate") or "") or None,
                    daily_return=str(_field(source, "日收益率", "dailyReturn") or "") or None,
                    weekly_return=str(_field(source, "周收益率", "weeklyReturn") or "") or None,
                    monthly_return=str(_field(source, "月收益率", "monthlyReturn") or "") or None,
                    yearly_return=str(_field(source, "年收益率", "yearlyReturn") or "") or None,
                    annualized_return=str(_field(source, "年化收益率", "annualizedReturn") or "") or None,
                    max_drawdown=str(_field(source, "最大回撤", "maxDrawdown") or "") or None,
                )
            )
        return PortfolioAdvisoryProductSearchResponse(products=products)
    except YingmiStargateError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Search advisory products failed", exc)


@router.post(
    "/advisory-products/nav",
    response_model=PortfolioAdvisoryNavResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Fetch advisory strategy NAV via Yingmi StarGate",
)
def get_advisory_nav(request: PortfolioAdvisoryNavRequest) -> PortfolioAdvisoryNavResponse:
    try:
        as_of = request.nav_date or date.today()
        price = PortfolioService._fetch_advisory_nav(strategy_code=request.strategy_code, as_of_date=as_of)
        if price is None:
            return PortfolioAdvisoryNavResponse(unit_nav=None, nav_date=None)
        return PortfolioAdvisoryNavResponse(
            unit_nav=price.price,
            nav_date=price.price_date.isoformat() if price.price_date else None,
        )
    except Exception as exc:
        raise _internal_error("Fetch advisory NAV failed", exc)


@router.get(
    "/bank-ledger",
    response_model=PortfolioBankLedgerListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List bank ledger events",
)
def list_bank_ledger(
    account_id: Optional[int] = Query(None, description="Optional account id"),
    date_from: Optional[date] = Query(None, description="Bank event date from"),
    date_to: Optional[date] = Query(None, description="Bank event date to"),
    asset_kind: Optional[str] = Query(None, description="Optional kind: demand/deposit/wealth"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PortfolioBankLedgerListResponse:
    service = PortfolioService()
    try:
        data = service.list_bank_ledger_events(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            asset_kind=asset_kind,
            page=page,
            page_size=page_size,
        )
        return PortfolioBankLedgerListResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List bank ledger events failed", exc)


@router.delete(
    "/bank-ledger/{entry_id}",
    response_model=PortfolioDeleteResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete bank ledger event",
)
def delete_bank_ledger(entry_id: int) -> PortfolioDeleteResponse:
    service = PortfolioService()
    try:
        ok = service.delete_bank_ledger_event(entry_id)
        if not ok:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Bank ledger entry not found: {entry_id}"},
            )
        return PortfolioDeleteResponse(deleted=1)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Delete bank ledger event failed", exc)


@router.post(
    "/advisory-ledger",
    response_model=PortfolioEventCreatedResponse,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Record advisory product subscription or redemption",
)
def create_advisory_ledger(request: PortfolioAdvisoryLedgerCreateRequest) -> PortfolioEventCreatedResponse:
    service = PortfolioService()
    try:
        data = service.record_advisory_ledger(
            account_id=request.account_id,
            event_date=request.event_date,
            platform=request.platform,
            product_name=request.product_name,
            product_code=request.product_code,
            product_type=request.product_type,
            event_type=request.event_type,
            amount=request.amount,
            currency=request.currency,
            risk_level=request.risk_level,
            investment_style=request.investment_style,
            quantity=request.quantity,
            nav=request.nav,
            nav_date=request.nav_date,
            external_strategy_code=request.external_strategy_code,
            data_provider=request.data_provider,
            valuation_model=request.valuation_model,
            manager_name=request.manager_name,
            recommended_holding_duration=request.recommended_holding_duration,
        )
        return PortfolioEventCreatedResponse(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except PortfolioOversellError as exc:
        raise _conflict_error(error="portfolio_oversell", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create advisory ledger event failed", exc)


@router.get(
    "/advisory-ledger",
    response_model=PortfolioAdvisoryLedgerListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List advisory product ledger events",
)
def list_advisory_ledger(
    account_id: Optional[int] = Query(None, description="Optional account id"),
    date_from: Optional[date] = Query(None, description="Advisory event date from"),
    date_to: Optional[date] = Query(None, description="Advisory event date to"),
    product: Optional[str] = Query(None, description="Optional product name or code filter"),
    direction: Optional[str] = Query(None, description="Optional direction: subscribe/redeem"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PortfolioAdvisoryLedgerListResponse:
    service = PortfolioService()
    try:
        data = service.list_advisory_ledger_events(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            product=product,
            direction=direction,
            page=page,
            page_size=page_size,
        )
        return PortfolioAdvisoryLedgerListResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List advisory ledger events failed", exc)


@router.delete(
    "/advisory-ledger/{entry_id}",
    response_model=PortfolioDeleteResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete advisory product ledger event",
)
def delete_advisory_ledger(entry_id: int) -> PortfolioDeleteResponse:
    service = PortfolioService()
    try:
        ok = service.delete_advisory_ledger_event(entry_id)
        if not ok:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Advisory ledger entry not found: {entry_id}"},
            )
        return PortfolioDeleteResponse(deleted=1)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Delete advisory ledger event failed", exc)


@router.post(
    "/insurance-policies",
    response_model=PortfolioInsurancePolicyItem,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Create insurance policy",
)
def create_insurance_policy(request: PortfolioInsurancePolicyCreateRequest) -> PortfolioInsurancePolicyItem:
    service = PortfolioService()
    try:
        data = service.create_insurance_policy(
            account_id=request.account_id,
            policy_name=request.policy_name,
            insurer=request.insurer,
            policy_no=request.policy_no,
            insurance_kind=request.insurance_kind,
            design_type=request.design_type,
            currency=request.currency,
            status=request.status,
            payment_mode=request.payment_mode,
            premium_per_period=request.premium_per_period,
            first_payment_date=request.first_payment_date,
            total_periods=request.total_periods,
            note=request.note,
        )
        return PortfolioInsurancePolicyItem(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create insurance policy failed", exc)


@router.get(
    "/insurance-policies",
    response_model=PortfolioInsurancePolicyListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List insurance policies",
)
def list_insurance_policies(
    account_id: Optional[int] = Query(None, description="Optional insurance account id"),
    include_inactive: bool = Query(False, description="Whether to include terminal/inactive policies"),
) -> PortfolioInsurancePolicyListResponse:
    service = PortfolioService()
    try:
        data = service.list_insurance_policies(account_id=account_id, include_inactive=include_inactive)
        return PortfolioInsurancePolicyListResponse(
            policies=[PortfolioInsurancePolicyItem(**item) for item in data["policies"]]
        )
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List insurance policies failed", exc)


@router.put(
    "/insurance-policies/{policy_id}",
    response_model=PortfolioInsurancePolicyItem,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Update insurance policy",
)
def update_insurance_policy(
    policy_id: int,
    request: PortfolioInsurancePolicyUpdateRequest,
) -> PortfolioInsurancePolicyItem:
    service = PortfolioService()
    try:
        updated = service.update_insurance_policy(
            policy_id,
            policy_name=request.policy_name,
            insurer=request.insurer,
            policy_no=request.policy_no,
            insurance_kind=request.insurance_kind,
            design_type=request.design_type,
            currency=request.currency,
            status=request.status,
            payment_mode=request.payment_mode,
            premium_per_period=request.premium_per_period,
            first_payment_date=request.first_payment_date,
            total_periods=request.total_periods,
            note=request.note,
        )
        if updated is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Insurance policy not found: {policy_id}"},
            )
        return PortfolioInsurancePolicyItem(**updated)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Update insurance policy failed", exc)


@router.post(
    "/insurance-ledger",
    response_model=PortfolioEventCreatedResponse,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Record insurance premium, return or valuation event",
)
def create_insurance_ledger(request: PortfolioInsuranceLedgerCreateRequest) -> PortfolioEventCreatedResponse:
    service = PortfolioService()
    try:
        data = service.record_insurance_ledger(
            account_id=request.account_id,
            policy_id=request.policy_id,
            event_date=request.event_date,
            event_type=request.event_type,
            amount=request.amount,
            currency=request.currency,
            period_no=request.period_no,
            note=request.note,
        )
        return PortfolioEventCreatedResponse(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create insurance ledger event failed", exc)


@router.get(
    "/insurance-ledger",
    response_model=PortfolioInsuranceLedgerListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List insurance ledger events",
)
def list_insurance_ledger(
    account_id: Optional[int] = Query(None, description="Optional insurance account id"),
    policy_id: Optional[int] = Query(None, description="Optional policy id"),
    date_from: Optional[date] = Query(None, description="Insurance event date from"),
    date_to: Optional[date] = Query(None, description="Insurance event date to"),
    event_type: Optional[str] = Query(None, description="Optional insurance event type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PortfolioInsuranceLedgerListResponse:
    service = PortfolioService()
    try:
        data = service.list_insurance_ledger_events(
            account_id=account_id,
            policy_id=policy_id,
            date_from=date_from,
            date_to=date_to,
            event_type=event_type,
            page=page,
            page_size=page_size,
        )
        return PortfolioInsuranceLedgerListResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List insurance ledger events failed", exc)


@router.delete(
    "/insurance-ledger/{entry_id}",
    response_model=PortfolioDeleteResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete insurance ledger event",
)
def delete_insurance_ledger(entry_id: int) -> PortfolioDeleteResponse:
    service = PortfolioService()
    try:
        ok = service.delete_insurance_ledger_event(entry_id)
        if not ok:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Insurance ledger entry not found: {entry_id}"},
            )
        return PortfolioDeleteResponse(deleted=1)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Delete insurance ledger event failed", exc)


@router.get(
    "/cash-ledger",
    response_model=PortfolioCashLedgerListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List cash ledger events",
)
def list_cash_ledger(
    account_id: Optional[int] = Query(None, description="Optional account id"),
    date_from: Optional[date] = Query(None, description="Cash event date from"),
    date_to: Optional[date] = Query(None, description="Cash event date to"),
    direction: Optional[str] = Query(None, description="Optional direction filter: in/out"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PortfolioCashLedgerListResponse:
    service = PortfolioService()
    try:
        data = service.list_cash_ledger_events(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            direction=direction,
            page=page,
            page_size=page_size,
        )
        return PortfolioCashLedgerListResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List cash ledger events failed", exc)


@router.delete(
    "/cash-ledger/{entry_id}",
    response_model=PortfolioDeleteResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete cash ledger event",
)
def delete_cash_ledger(entry_id: int) -> PortfolioDeleteResponse:
    service = PortfolioService()
    try:
        ok = service.delete_cash_ledger_event(entry_id)
        if not ok:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Cash ledger entry not found: {entry_id}"},
            )
        return PortfolioDeleteResponse(deleted=1)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Delete cash ledger event failed", exc)


@router.post(
    "/corporate-actions",
    response_model=PortfolioEventCreatedResponse,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Record corporate action event",
)
def create_corporate_action(request: PortfolioCorporateActionCreateRequest) -> PortfolioEventCreatedResponse:
    service = PortfolioService()
    try:
        data = service.record_corporate_action(
            account_id=request.account_id,
            symbol=request.symbol,
            effective_date=request.effective_date,
            action_type=request.action_type,
            market=request.market,
            currency=request.currency,
            cash_dividend_per_share=request.cash_dividend_per_share,
            split_ratio=request.split_ratio,
            note=request.note,
        )
        return PortfolioEventCreatedResponse(**data)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create corporate action event failed", exc)


@router.get(
    "/corporate-actions",
    response_model=PortfolioCorporateActionListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List corporate action events",
)
def list_corporate_actions(
    account_id: Optional[int] = Query(None, description="Optional account id"),
    date_from: Optional[date] = Query(None, description="Corporate action effective date from"),
    date_to: Optional[date] = Query(None, description="Corporate action effective date to"),
    symbol: Optional[str] = Query(None, description="Optional stock symbol filter"),
    action_type: Optional[str] = Query(None, description="Optional action type filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PortfolioCorporateActionListResponse:
    service = PortfolioService()
    try:
        data = service.list_corporate_action_events(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            symbol=symbol,
            action_type=action_type,
            page=page,
            page_size=page_size,
        )
        return PortfolioCorporateActionListResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List corporate action events failed", exc)


@router.delete(
    "/corporate-actions/{action_id}",
    response_model=PortfolioDeleteResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete corporate action event",
)
def delete_corporate_action(action_id: int) -> PortfolioDeleteResponse:
    service = PortfolioService()
    try:
        ok = service.delete_corporate_action_event(action_id)
        if not ok:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"Corporate action not found: {action_id}"},
            )
        return PortfolioDeleteResponse(deleted=1)
    except PortfolioBusyError as exc:
        raise _conflict_error(error="portfolio_busy", message=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _internal_error("Delete corporate action event failed", exc)


@router.get(
    "/snapshot",
    response_model=PortfolioSnapshotResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Get portfolio snapshot",
)
def get_snapshot(
    account_id: Optional[int] = Query(None, description="Optional account id, default returns all accounts"),
    as_of: Optional[date] = Query(None, description="Snapshot date, default today"),
    cost_method: str = Query("fifo", description="Cost method: fifo or avg"),
    refresh_prices: bool = Query(False, description="Refresh online prices instead of using cached/latest snapshot"),
) -> PortfolioSnapshotResponse:
    service = PortfolioService()
    try:
        data = service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=as_of,
            cost_method=cost_method,
            refresh_prices=refresh_prices,
        )
        return PortfolioSnapshotResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Get snapshot failed", exc)


@router.post(
    "/analysis",
    response_model=PortfolioAnalysisResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Generate LLM portfolio asset analysis",
)
def analyze_portfolio(request: PortfolioAnalysisRequest) -> PortfolioAnalysisResponse:
    service = PortfolioAnalysisService()
    try:
        data = service.analyze(
            account_id=request.account_id,
            as_of=request.as_of,
            cost_method=request.cost_method,
            snapshot_signature=request.snapshot_signature,
            mode=request.mode,
        )
        return PortfolioAnalysisResponse(**data)
    except PortfolioAnalysisError as exc:
        raise _bad_request(exc)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Generate portfolio analysis failed", exc)


@router.post(
    "/imports/csv/parse",
    response_model=PortfolioImportParseResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Parse broker CSV into normalized trade records",
)
def parse_csv_import(
    broker: str = Form(..., description="Broker id: huatai/citic/cmb"),
    file: UploadFile = File(...),
) -> PortfolioImportParseResponse:
    importer = PortfolioImportService()
    try:
        content = file.file.read()
        parsed = importer.parse_trade_csv(broker=broker, content=content)
        return PortfolioImportParseResponse(
            broker=parsed["broker"],
            record_count=parsed["record_count"],
            skipped_count=parsed["skipped_count"],
            error_count=parsed["error_count"],
            records=[_serialize_import_record(item) for item in parsed.get("records", [])],
            errors=list(parsed.get("errors", [])),
        )
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Parse CSV import failed", exc)


@router.get(
    "/imports/csv/brokers",
    response_model=PortfolioImportBrokerListResponse,
    responses={500: {"model": ErrorResponse}},
    summary="List supported broker CSV parsers",
)
def list_csv_brokers() -> PortfolioImportBrokerListResponse:
    importer = PortfolioImportService()
    try:
        return PortfolioImportBrokerListResponse(brokers=importer.list_supported_brokers())
    except Exception as exc:
        raise _internal_error("List CSV brokers failed", exc)


@router.post(
    "/imports/csv/commit",
    response_model=PortfolioImportCommitResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Parse and commit broker CSV with dedup",
)
def commit_csv_import(
    account_id: int = Form(...),
    broker: str = Form(..., description="Broker id: huatai/citic/cmb"),
    dry_run: bool = Form(False),
    file: UploadFile = File(...),
) -> PortfolioImportCommitResponse:
    importer = PortfolioImportService()
    try:
        content = file.file.read()
        parsed = importer.parse_trade_csv(broker=broker, content=content)
        result = importer.commit_trade_records(
            account_id=account_id,
            broker=parsed["broker"],
            records=list(parsed.get("records", [])),
            dry_run=dry_run,
        )
        return PortfolioImportCommitResponse(**result)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Commit CSV import failed", exc)


@router.post(
    "/fx/refresh",
    response_model=PortfolioFxRefreshResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Refresh FX cache online with stale fallback",
)
def refresh_fx_rates(
    account_id: Optional[int] = Query(None, description="Optional account id"),
    as_of: Optional[date] = Query(None, description="Rate date, default today"),
) -> PortfolioFxRefreshResponse:
    service = PortfolioService()
    try:
        data = service.refresh_fx_rates(account_id=account_id, as_of=as_of)
        return PortfolioFxRefreshResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Refresh FX rates failed", exc)


@router.get(
    "/risk",
    response_model=PortfolioRiskResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Get portfolio risk report",
)
def get_risk_report(
    account_id: Optional[int] = Query(None, description="Optional account id"),
    as_of: Optional[date] = Query(None, description="Risk report date, default today"),
    cost_method: str = Query("fifo", description="Cost method: fifo or avg"),
) -> PortfolioRiskResponse:
    service = PortfolioRiskService()
    try:
        data = service.get_risk_report(account_id=account_id, as_of=as_of, cost_method=cost_method)
        return PortfolioRiskResponse(**data)
    except ValueError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Get risk report failed", exc)
