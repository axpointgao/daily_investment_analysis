# -*- coding: utf-8 -*-
"""Portfolio API schemas."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

PortfolioMarket = Literal["cn", "hk", "us", "fund", "crypto", "bank", "advisory", "insurance"]
PortfolioCashTrackingMode = Literal["managed", "asset_only"]
PortfolioAdvisoryProductType = Literal["advisory_combo", "dca_plan"]
PortfolioAdvisoryEventType = Literal["buy", "initial_buy", "dca_buy", "follow_buy", "redeem"]


class PortfolioAccountCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    broker: Optional[str] = Field(None, max_length=64)
    market: PortfolioMarket = "cn"
    base_currency: str = Field("CNY", min_length=3, max_length=8)
    cash_tracking_mode: Optional[PortfolioCashTrackingMode] = None
    owner_id: Optional[str] = Field(None, max_length=64)


class PortfolioAccountUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    broker: Optional[str] = Field(None, max_length=64)
    market: Optional[PortfolioMarket] = None
    base_currency: Optional[str] = Field(None, min_length=3, max_length=8)
    cash_tracking_mode: Optional[PortfolioCashTrackingMode] = None
    owner_id: Optional[str] = Field(None, max_length=64)
    is_active: Optional[bool] = None


class PortfolioAccountItem(BaseModel):
    id: int
    owner_id: Optional[str] = None
    name: str
    broker: Optional[str] = None
    market: str
    base_currency: str
    cash_tracking_mode: str = "managed"
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PortfolioAccountListResponse(BaseModel):
    accounts: List[PortfolioAccountItem] = Field(default_factory=list)


class PortfolioAssetTransferAsset(BaseModel):
    market: PortfolioMarket
    symbol: Optional[str] = Field(None, max_length=64)
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    display_name: Optional[str] = Field(None, max_length=128)
    linked_entry_id: Optional[int] = Field(None, gt=0)
    policy_id: Optional[int] = Field(None, gt=0)


class PortfolioAssetTransferRequest(BaseModel):
    target_account_id: int = Field(..., gt=0)
    asset: PortfolioAssetTransferAsset


class PortfolioAssetTransferResponse(BaseModel):
    source_account_id: int
    target_account_id: int
    source_account_name: str
    target_account_name: str
    asset: Dict[str, Any]
    transferred_counts: Dict[str, int] = Field(default_factory=dict)
    total_records: int
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    transferred: bool = False


class PortfolioTradeCreateRequest(BaseModel):
    account_id: int
    symbol: str = Field(..., min_length=1, max_length=32)
    trade_date: date
    side: Literal["buy", "sell"]
    quantity: float = Field(..., gt=0)
    price: float = Field(..., gt=0)
    fee: float = Field(0.0, ge=0)
    tax: float = Field(0.0, ge=0)
    market: Optional[PortfolioMarket] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    trade_uid: Optional[str] = Field(None, max_length=128)
    note: Optional[str] = Field(None, max_length=255)


class PortfolioCashLedgerCreateRequest(BaseModel):
    account_id: int
    event_date: date
    direction: Literal["in", "out"]
    amount: float = Field(..., gt=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    note: Optional[str] = Field(None, max_length=255)


class PortfolioCorporateActionCreateRequest(BaseModel):
    account_id: int
    symbol: str = Field(..., min_length=1, max_length=16)
    effective_date: date
    action_type: Literal["cash_dividend", "split_adjustment"]
    market: Optional[PortfolioMarket] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    cash_dividend_per_share: Optional[float] = Field(None, ge=0)
    split_ratio: Optional[float] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=255)


class PortfolioEventCreatedResponse(BaseModel):
    id: int


class PortfolioManualPriceUpsertRequest(BaseModel):
    account_id: int
    symbol: str = Field(..., min_length=1, max_length=32)
    market: PortfolioMarket
    price_date: date
    price: float = Field(..., gt=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    note: Optional[str] = Field(None, max_length=255)


class PortfolioManualPriceItem(BaseModel):
    id: int
    account_id: int
    symbol: str
    market: str
    currency: str
    price_date: str
    price: float
    note: Optional[str] = None


class PortfolioBankLedgerCreateRequest(BaseModel):
    account_id: int
    event_date: date
    asset_kind: Literal["demand", "deposit", "wealth", "term"]
    direction: Literal["in", "out"]
    amount: float = Field(..., gt=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    bank_name: str = Field(..., min_length=1, max_length=64)
    product_name: Optional[str] = Field(None, max_length=128)
    product_code: Optional[str] = Field(None, max_length=64)
    product_public_code: Optional[str] = Field(None, max_length=64)
    issuer_name: Optional[str] = Field(None, max_length=64)
    registration_code: Optional[str] = Field(None, max_length=64)
    linked_entry_id: Optional[int] = Field(None, gt=0)
    quantity: Optional[float] = Field(None, gt=0)
    unit_nav: Optional[float] = Field(None, gt=0)
    nav_date: Optional[date] = None
    start_date: Optional[date] = None
    maturity_date: Optional[date] = None
    annual_rate: Optional[float] = Field(None, ge=0)
    investment_nature: Optional[Literal[
        "fixed_income",
        "mixed",
        "equity",
        "commodity_derivative",
        "cash_management",
        "other",
    ]] = None
    risk_level: Optional[Literal["R1", "R2", "R3", "R4", "R5"]] = None
    income_mode: Optional[Literal["dividend", "reinvest"]] = None


class PortfolioBankLedgerListItem(BaseModel):
    id: int
    account_id: int
    event_date: str
    asset_kind: str
    direction: str
    amount: float
    currency: str
    bank_name: str
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    product_public_code: Optional[str] = None
    issuer_name: Optional[str] = None
    registration_code: Optional[str] = None
    linked_entry_id: Optional[int] = None
    quantity: Optional[float] = None
    unit_nav: Optional[float] = None
    nav_date: Optional[str] = None
    start_date: Optional[str] = None
    maturity_date: Optional[str] = None
    annual_rate: Optional[float] = None
    investment_nature: Optional[str] = None
    risk_level: Optional[str] = None
    income_mode: Optional[str] = None
    created_at: Optional[str] = None


class PortfolioBankLedgerListResponse(BaseModel):
    items: List[PortfolioBankLedgerListItem] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class PortfolioBankWealthProductSearchRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=128)
    limit: int = Field(10, ge=1, le=20)


class PortfolioBankWealthProductItem(BaseModel):
    product_code: Optional[str] = None
    product_name: str
    product_public_code: Optional[str] = None
    issuer_name: Optional[str] = None
    risk_level: Optional[str] = None
    investment_type: Optional[str] = None
    term_type: Optional[str] = None
    redeemable: Optional[str] = None
    benchmark: Optional[str] = None
    management_fee: Optional[str] = None
    custody_fee: Optional[str] = None
    subscription_fee: Optional[str] = None


class PortfolioBankWealthProductSearchResponse(BaseModel):
    products: List[PortfolioBankWealthProductItem] = Field(default_factory=list)


class PortfolioBankWealthNavRequest(BaseModel):
    product_identifier: str = Field(..., min_length=1, max_length=128)
    nav_date: Optional[date] = None


class PortfolioBankWealthNavResponse(BaseModel):
    unit_nav: Optional[float] = None
    nav_date: Optional[str] = None
    change_pct: Optional[float] = None
    source: str = "iwencai"


class PortfolioAdvisoryProductSearchRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=128)
    product_type: PortfolioAdvisoryProductType = "advisory_combo"
    limit: int = Field(10, ge=1, le=20)


class PortfolioAdvisoryProductItem(BaseModel):
    strategy_code: str
    product_name: str
    product_type: PortfolioAdvisoryProductType = "advisory_combo"
    risk_level: Optional[str] = None
    manager_name: Optional[str] = None
    established_date: Optional[str] = None
    recommended_holding_duration: Optional[str] = None
    latest_nav: Optional[float] = None
    latest_nav_date: Optional[str] = None
    daily_return: Optional[str] = None
    weekly_return: Optional[str] = None
    monthly_return: Optional[str] = None
    yearly_return: Optional[str] = None
    annualized_return: Optional[str] = None
    max_drawdown: Optional[str] = None
    source: str = "yingmi_stargate"


class PortfolioAdvisoryProductSearchResponse(BaseModel):
    products: List[PortfolioAdvisoryProductItem] = Field(default_factory=list)


class PortfolioAdvisoryNavRequest(BaseModel):
    strategy_code: str = Field(..., min_length=1, max_length=64)
    nav_date: Optional[date] = None


class PortfolioAdvisoryNavResponse(BaseModel):
    unit_nav: Optional[float] = None
    nav_date: Optional[str] = None
    source: str = "yingmi_stargate"


class PortfolioAdvisoryLedgerCreateRequest(BaseModel):
    account_id: int
    event_date: date
    platform: str = Field(..., min_length=1, max_length=64)
    product_name: str = Field(..., min_length=1, max_length=128)
    product_code: Optional[str] = Field(None, max_length=64)
    product_type: PortfolioAdvisoryProductType = "advisory_combo"
    event_type: PortfolioAdvisoryEventType
    amount: float = Field(..., gt=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    risk_level: Optional[str] = Field(None, max_length=16)
    investment_style: Optional[str] = Field(None, max_length=32)
    quantity: Optional[float] = Field(None, gt=0)
    nav: Optional[float] = Field(None, gt=0)
    nav_date: Optional[date] = None
    external_strategy_code: Optional[str] = Field(None, max_length=64)
    data_provider: Optional[str] = Field(None, max_length=32)
    valuation_model: Optional[str] = Field(None, max_length=24)
    manager_name: Optional[str] = Field(None, max_length=64)
    recommended_holding_duration: Optional[str] = Field(None, max_length=32)


class PortfolioAdvisoryLedgerListItem(BaseModel):
    id: int
    account_id: int
    event_date: str
    platform: str
    product_name: str
    product_code: Optional[str] = None
    product_type: str
    event_type: str
    direction: str
    amount: float
    quantity: Optional[float] = None
    nav: Optional[float] = None
    nav_date: Optional[str] = None
    currency: str
    risk_level: Optional[str] = None
    investment_style: Optional[str] = None
    data_provider: Optional[str] = None
    valuation_model: Optional[str] = None
    manager_name: Optional[str] = None
    recommended_holding_duration: Optional[str] = None
    created_at: Optional[str] = None


class PortfolioAdvisoryLedgerListResponse(BaseModel):
    items: List[PortfolioAdvisoryLedgerListItem] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class PortfolioInsurancePolicyCreateRequest(BaseModel):
    account_id: int
    policy_name: str = Field(..., min_length=1, max_length=128)
    insurer: Optional[str] = Field(None, max_length=64)
    policy_no: Optional[str] = Field(None, max_length=64)
    insurance_kind: Optional[Literal["annuity", "whole_life", "endowment", "universal", "unit_linked", "other"]] = "other"
    design_type: Optional[Literal["ordinary", "participating", "universal", "unit_linked", "other"]] = "ordinary"
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    status: Literal["active", "paid_up", "surrendered", "matured", "expired", "cancelled"] = "active"
    payment_mode: Literal["single", "annual", "semiannual", "quarterly", "monthly", "irregular"] = "single"
    premium_per_period: Optional[float] = Field(None, gt=0)
    first_payment_date: Optional[date] = None
    total_periods: Optional[int] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=255)


class PortfolioInsurancePolicyUpdateRequest(BaseModel):
    policy_name: Optional[str] = Field(None, min_length=1, max_length=128)
    insurer: Optional[str] = Field(None, max_length=64)
    policy_no: Optional[str] = Field(None, max_length=64)
    insurance_kind: Optional[Literal["annuity", "whole_life", "endowment", "universal", "unit_linked", "other"]] = None
    design_type: Optional[Literal["ordinary", "participating", "universal", "unit_linked", "other"]] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    status: Optional[Literal["active", "paid_up", "surrendered", "matured", "expired", "cancelled"]] = None
    payment_mode: Optional[Literal["single", "annual", "semiannual", "quarterly", "monthly", "irregular"]] = None
    premium_per_period: Optional[float] = Field(None, gt=0)
    first_payment_date: Optional[date] = None
    total_periods: Optional[int] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=255)


class PortfolioInsurancePolicyItem(BaseModel):
    id: int
    account_id: int
    policy_name: str
    insurer: Optional[str] = None
    policy_no: Optional[str] = None
    insurance_kind: Optional[str] = None
    design_type: Optional[str] = None
    currency: str
    status: str
    payment_mode: str
    premium_per_period: Optional[float] = None
    first_payment_date: Optional[str] = None
    total_periods: Optional[int] = None
    note: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PortfolioInsurancePolicyListResponse(BaseModel):
    policies: List[PortfolioInsurancePolicyItem] = Field(default_factory=list)


class PortfolioInsuranceLedgerCreateRequest(BaseModel):
    account_id: int
    policy_id: int
    event_date: date
    event_type: Literal[
        "premium",
        "value_update",
        "survival_benefit",
        "annuity_payment",
        "maturity_benefit",
        "dividend",
        "partial_withdrawal",
        "surrender",
        "refund",
        "other_inflow",
        "other_outflow",
    ]
    amount: float = Field(..., gt=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=8)
    period_no: Optional[int] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=255)


class PortfolioInsuranceLedgerListItem(BaseModel):
    id: int
    account_id: int
    policy_id: int
    event_date: str
    event_type: str
    amount: float
    currency: str
    period_no: Optional[int] = None
    note: Optional[str] = None
    created_at: Optional[str] = None


class PortfolioInsuranceLedgerListResponse(BaseModel):
    items: List[PortfolioInsuranceLedgerListItem] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class PortfolioDeleteResponse(BaseModel):
    deleted: int


class PortfolioTagItem(BaseModel):
    id: int
    name: str
    color: str
    sort_order: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PortfolioTagListResponse(BaseModel):
    tags: List[PortfolioTagItem] = Field(default_factory=list)


class PortfolioTagCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=32)
    color: str = Field("hsl(var(--primary))", min_length=1, max_length=32)


class PortfolioTagUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=32)
    color: Optional[str] = Field(None, min_length=1, max_length=32)


class PortfolioProductTagUpdateRequest(BaseModel):
    product_key: str = Field(..., min_length=1, max_length=160)
    tag_id: Optional[int] = Field(None, gt=0)


class PortfolioProductTagUpdateResponse(BaseModel):
    product_key: str
    tag_id: Optional[int] = None


class PortfolioTradeListItem(BaseModel):
    id: int
    account_id: int
    trade_uid: Optional[str] = None
    symbol: str
    market: str
    currency: str
    trade_date: str
    side: str
    quantity: float
    price: float
    fee: float
    tax: float
    note: Optional[str] = None
    created_at: Optional[str] = None


class PortfolioTradeListResponse(BaseModel):
    items: List[PortfolioTradeListItem] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class PortfolioCashLedgerListItem(BaseModel):
    id: int
    account_id: int
    event_date: str
    direction: str
    amount: float
    currency: str
    note: Optional[str] = None
    created_at: Optional[str] = None


class PortfolioCashLedgerListResponse(BaseModel):
    items: List[PortfolioCashLedgerListItem] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class PortfolioCorporateActionListItem(BaseModel):
    id: int
    account_id: int
    symbol: str
    market: str
    currency: str
    effective_date: str
    action_type: str
    cash_dividend_per_share: Optional[float] = None
    split_ratio: Optional[float] = None
    note: Optional[str] = None
    created_at: Optional[str] = None


class PortfolioCorporateActionListResponse(BaseModel):
    items: List[PortfolioCorporateActionListItem] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class PortfolioPositionItem(BaseModel):
    symbol: str
    product_key: Optional[str] = None
    tag_id: Optional[int] = None
    tag_name: Optional[str] = None
    tag_color: Optional[str] = None
    display_name: Optional[str] = None
    market: str
    currency: str
    quantity: float
    avg_cost: float
    total_cost: float
    last_price: float
    market_value_base: float
    unrealized_pnl_base: float
    unrealized_pnl_pct: Optional[float] = None
    annualized_return_pct: Optional[float] = None
    valuation_model: Optional[str] = None
    cost_display_value: Optional[float] = None
    price_display_value: Optional[float] = None
    valuation_currency: str
    price_source: str = "unknown"
    price_provider: Optional[str] = None
    price_date: Optional[str] = None
    price_stale: bool = False
    price_available: bool = True
    bank_name: Optional[str] = None
    product_name: Optional[str] = None
    product_public_code: Optional[str] = None
    issuer_name: Optional[str] = None
    registration_code: Optional[str] = None
    linked_entry_id: Optional[int] = None
    start_date: Optional[str] = None
    maturity_date: Optional[str] = None
    annual_rate: Optional[float] = None
    investment_nature: Optional[str] = None
    risk_level: Optional[str] = None
    income_mode: Optional[str] = None
    platform: Optional[str] = None
    product_code: Optional[str] = None
    product_type: Optional[str] = None
    product_type_label: Optional[str] = None
    investment_style: Optional[str] = None
    data_provider: Optional[str] = None
    valuation_model_detail: Optional[str] = None
    external_strategy_code: Optional[str] = None
    manager_name: Optional[str] = None
    recommended_holding_duration: Optional[str] = None
    nav_date: Optional[str] = None
    invested_amount: Optional[float] = None
    redeemed_amount: Optional[float] = None
    value_amount: Optional[float] = None
    wealth_units: Optional[float] = None
    policy_id: Optional[int] = None
    policy_name: Optional[str] = None
    insurer: Optional[str] = None
    policy_no: Optional[str] = None
    insurance_kind: Optional[str] = None
    design_type: Optional[str] = None
    policy_status: Optional[str] = None
    payment_mode: Optional[str] = None
    premium_per_period: Optional[float] = None
    first_payment_date: Optional[str] = None
    total_periods: Optional[int] = None
    paid_periods: Optional[int] = None
    paid_premium: Optional[float] = None
    received_amount: Optional[float] = None
    cash_value: Optional[float] = None
    value_date: Optional[str] = None
    next_payment_date: Optional[str] = None
    value_estimated: Optional[bool] = None


class PortfolioAccountSnapshot(BaseModel):
    account_id: int
    account_name: str
    owner_id: Optional[str] = None
    broker: Optional[str] = None
    market: str
    base_currency: str
    cash_tracking_mode: str = "managed"
    snapshot_schema_version: Optional[int] = None
    as_of: str
    cost_method: str
    total_cash: Optional[float] = None
    total_market_value: Optional[float] = None
    total_equity: Optional[float] = None
    realized_pnl: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    fee_total: Optional[float] = None
    tax_total: Optional[float] = None
    fx_stale: bool
    positions: List[PortfolioPositionItem] = Field(default_factory=list)


class PortfolioSnapshotResponse(BaseModel):
    as_of: str
    cost_method: str
    currency: str
    account_count: int
    total_cash: Optional[float] = None
    total_market_value: Optional[float] = None
    total_equity: Optional[float] = None
    realized_pnl: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    fee_total: Optional[float] = None
    tax_total: Optional[float] = None
    fx_stale: bool
    fx_missing: bool = False
    missing_fx_pairs: List[Dict[str, str]] = Field(default_factory=list)
    asset_breakdown: Dict[str, float] = Field(default_factory=dict)
    tag_breakdown: List[Dict[str, Any]] = Field(default_factory=list)
    accounts: List[PortfolioAccountSnapshot] = Field(default_factory=list)


class PortfolioImportTradeItem(BaseModel):
    trade_date: str
    symbol: str
    side: Literal["buy", "sell"]
    quantity: float
    price: float
    fee: float
    tax: float
    trade_uid: Optional[str] = None
    dedup_hash: str
    currency: Optional[str] = None


class PortfolioImportParseResponse(BaseModel):
    broker: str
    record_count: int
    skipped_count: int
    error_count: int
    records: List[PortfolioImportTradeItem] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class PortfolioImportCommitResponse(BaseModel):
    account_id: int
    record_count: int
    inserted_count: int
    duplicate_count: int
    failed_count: int
    dry_run: bool
    errors: List[str] = Field(default_factory=list)


class PortfolioImportBrokerItem(BaseModel):
    broker: str
    aliases: List[str] = Field(default_factory=list)
    display_name: Optional[str] = None


class PortfolioImportBrokerListResponse(BaseModel):
    brokers: List[PortfolioImportBrokerItem] = Field(default_factory=list)


class PortfolioFxRefreshResponse(BaseModel):
    as_of: str
    account_count: int
    refresh_enabled: bool
    disabled_reason: Optional[str] = None
    pair_count: int
    updated_count: int
    stale_count: int
    error_count: int


class PortfolioRiskResponse(BaseModel):
    as_of: str
    account_id: Optional[int] = None
    cost_method: str
    currency: str
    thresholds: Dict[str, Any] = Field(default_factory=dict)
    concentration: Dict[str, Any] = Field(default_factory=dict)
    sector_concentration: Dict[str, Any] = Field(default_factory=dict)
    drawdown: Dict[str, Any] = Field(default_factory=dict)
    stop_loss: Dict[str, Any] = Field(default_factory=dict)


class PortfolioAnalysisRequest(BaseModel):
    account_id: Optional[int] = None
    as_of: Optional[date] = None
    cost_method: Literal["fifo", "avg"] = "fifo"
    snapshot_signature: str = Field(..., min_length=1, max_length=128)
    mode: Literal["standard", "quick", "deep", "wealth_report"] = "standard"


class PortfolioAnalysisResponse(BaseModel):
    as_of: str
    snapshot_signature: str
    generated_at: str
    summary_points: List[str] = Field(default_factory=list)
    full_markdown: str
    model_used: Optional[str] = None
    analysis_mode: Literal["standard", "quick", "deep", "wealth_report"] = "standard"
    provider_status: List[Dict[str, Any]] = Field(default_factory=list)
