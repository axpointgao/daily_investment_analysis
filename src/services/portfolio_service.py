# -*- coding: utf-8 -*-
"""Portfolio service for P0 account/events/snapshot workflow."""

from __future__ import annotations

import json
import logging
import requests
import hashlib
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlencode

from data_provider.base import DataFetcherManager, canonical_stock_code, normalize_stock_code
from src.data.stock_index_loader import get_index_stock_name
from src.data.stock_mapping import STOCK_NAME_MAP, is_meaningful_stock_name
from src.config import get_config
from src.repositories.portfolio_repo import (
    DuplicateTradeDedupHashError,
    DuplicateTradeUidError,
    PortfolioBusyError as RepoPortfolioBusyError,
    PortfolioRepository,
)

logger = logging.getLogger(__name__)

PortfolioBusyError = RepoPortfolioBusyError

try:
    import yfinance as yf
except Exception:  # pragma: no cover - optional dependency path
    yf = None

EPS = 1e-8
VALID_MARKETS = {"cn", "hk", "us", "fund", "crypto", "bank", "advisory", "insurance"}
VALID_CASH_TRACKING_MODES = {"managed", "asset_only"}
ASSET_ONLY_DEFAULT_MARKETS = {"bank", "advisory", "insurance"}
VALID_COST_METHODS = {"fifo", "avg"}
VALID_SIDES = {"buy", "sell"}
VALID_CASH_DIRECTIONS = {"in", "out"}
PORTFOLIO_SNAPSHOT_SCHEMA_VERSION = 2
VALID_ADVISORY_PRODUCT_TYPES = {"advisory_combo", "dca_plan"}
VALID_ADVISORY_EVENT_TYPES = {"buy", "initial_buy", "dca_buy", "follow_buy", "redeem"}
ADVISORY_BUY_EVENTS = {"buy", "initial_buy", "dca_buy", "follow_buy"}
ADVISORY_PRODUCT_TYPE_LABELS = {
    "advisory_combo": "投顾组合",
    "dca_plan": "定投计划",
}
VALID_INSURANCE_KINDS = {"annuity", "whole_life", "endowment", "universal", "unit_linked", "other"}
VALID_INSURANCE_DESIGN_TYPES = {"ordinary", "participating", "universal", "unit_linked", "other"}
VALID_INSURANCE_STATUSES = {"active", "paid_up", "surrendered", "matured", "expired", "cancelled"}
VALID_INSURANCE_PAYMENT_MODES = {"single", "annual", "semiannual", "quarterly", "monthly", "irregular"}
VALID_INSURANCE_EVENT_TYPES = {
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
}
INSURANCE_OUTFLOW_EVENTS = {"premium", "other_outflow"}
INSURANCE_RETURN_EVENTS = {
    "survival_benefit",
    "annuity_payment",
    "maturity_benefit",
    "dividend",
    "partial_withdrawal",
    "surrender",
    "refund",
    "other_inflow",
}
INSURANCE_TERMINAL_EVENTS = {"surrender", "maturity_benefit"}
TERMINAL_INSURANCE_STATUSES = {"surrendered", "matured", "expired", "cancelled"}
VALID_BANK_ASSET_KINDS = {"demand", "deposit", "wealth"}
LEGACY_BANK_ASSET_KIND_ALIASES = {"term": "deposit"}
VALID_BANK_INVESTMENT_NATURES = {
    "fixed_income",
    "mixed",
    "equity",
    "commodity_derivative",
    "cash_management",
    "other",
}
VALID_BANK_RISK_LEVELS = {"R1", "R2", "R3", "R4", "R5"}
VALID_BANK_INCOME_MODES = {"dividend", "reinvest"}
BANK_WEALTH_SYMBOL_PREFIX = "BANK:W:"
VALID_CORPORATE_ACTIONS = {"cash_dividend", "split_adjustment"}
PORTFOLIO_FX_REFRESH_DISABLED_REASON = "portfolio_fx_update_disabled"


class PortfolioConflictError(Exception):
    """Raised when request conflicts with existing portfolio state."""


class PortfolioOversellError(ValueError):
    """Raised when a sell would exceed the available position quantity."""

    def __init__(
        self,
        *,
        symbol: str,
        trade_date: Optional[date],
        requested_quantity: float,
        available_quantity: float,
    ) -> None:
        self.symbol = symbol
        self.trade_date = trade_date
        self.requested_quantity = float(requested_quantity)
        self.available_quantity = max(0.0, float(available_quantity))
        date_hint = f" on {trade_date.isoformat()}" if trade_date is not None else ""
        super().__init__(
            "Oversell detected for "
            f"{symbol}{date_hint}: requested={round(self.requested_quantity, 8)}, "
            f"available={round(self.available_quantity, 8)}"
        )


@dataclass
class _AvgState:
    quantity: float = 0.0
    total_cost: float = 0.0


@dataclass(frozen=True)
class _ResolvedPositionPrice:
    price: float
    source: str
    price_date: Optional[date]
    is_stale: bool
    is_available: bool
    provider: Optional[str] = None


@dataclass(frozen=True)
class _ConvertedAmount:
    amount: Optional[float]
    is_stale: bool
    source: str
    missing_pair: Optional[Tuple[str, str]] = None


@dataclass
class _AnnualizedCashFlow:
    flow_date: date
    amount: float
    currency: str


class PortfolioService:
    """Business logic for account CRUD, event writes, and snapshot replay."""

    def __init__(self, repo: Optional[PortfolioRepository] = None):
        self.repo = repo or PortfolioRepository()
        self._data_manager: Optional[DataFetcherManager] = None

    # ------------------------------------------------------------------
    # Product tags
    # ------------------------------------------------------------------
    def list_tags(self) -> List[Dict[str, Any]]:
        return [self._tag_row_to_dict(row) for row in self.repo.list_tags()]

    def create_tag(self, *, name: str, color: str) -> Dict[str, Any]:
        name_norm = self._normalize_tag_name(name)
        color_norm = self._normalize_tag_color(color)
        try:
            return self._tag_row_to_dict(self.repo.create_tag(name=name_norm, color=color_norm))
        except Exception as exc:
            if self._looks_like_unique_conflict(exc):
                raise PortfolioConflictError("标签名称已存在") from exc
            raise

    def update_tag(self, *, tag_id: int, name: Optional[str], color: Optional[str]) -> Optional[Dict[str, Any]]:
        fields: Dict[str, Any] = {}
        if name is not None:
            fields["name"] = self._normalize_tag_name(name)
        if color is not None:
            fields["color"] = self._normalize_tag_color(color)
        if not fields:
            row = self.repo.get_tag(tag_id)
            return self._tag_row_to_dict(row) if row is not None else None
        try:
            row = self.repo.update_tag(tag_id, fields)
        except Exception as exc:
            if self._looks_like_unique_conflict(exc):
                raise PortfolioConflictError("标签名称已存在") from exc
            raise
        return self._tag_row_to_dict(row) if row is not None else None

    def delete_tag(self, tag_id: int) -> bool:
        return self.repo.delete_tag(tag_id)

    def set_product_tag(self, *, product_key: str, tag_id: Optional[int]) -> Dict[str, Any]:
        key = str(product_key or "").strip()
        if not key:
            raise ValueError("product_key is required")
        if len(key) > 160:
            raise ValueError("product_key is too long")
        self.repo.set_product_tag(product_key=key, tag_id=tag_id)
        return {"product_key": key, "tag_id": tag_id}

    def _get_data_manager(self) -> DataFetcherManager:
        if self._data_manager is None:
            self._data_manager = DataFetcherManager()
        return self._data_manager

    # ------------------------------------------------------------------
    # Account CRUD
    # ------------------------------------------------------------------
    def create_account(
        self,
        *,
        name: str,
        broker: Optional[str],
        market: str,
        base_currency: str,
        cash_tracking_mode: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        name_norm = (name or "").strip()
        if not name_norm:
            raise ValueError("name is required")
        market_norm = self._normalize_market(market)
        base_currency_norm = self._normalize_currency(base_currency)
        cash_mode_norm = self._normalize_cash_tracking_mode(cash_tracking_mode, market=market_norm)
        row = self.repo.create_account(
            name=name_norm,
            broker=(broker or "").strip() or None,
            market=market_norm,
            base_currency=base_currency_norm,
            cash_tracking_mode=cash_mode_norm,
            owner_id=(owner_id or "").strip() or None,
        )
        return self._account_to_dict(row)

    def list_accounts(self, include_inactive: bool = False) -> List[Dict[str, Any]]:
        rows = self.repo.list_accounts(include_inactive=include_inactive)
        return [self._account_to_dict(r) for r in rows]

    def update_account(
        self,
        account_id: int,
        *,
        name: Optional[str] = None,
        broker: Optional[str] = None,
        market: Optional[str] = None,
        base_currency: Optional[str] = None,
        cash_tracking_mode: Optional[str] = None,
        owner_id: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        fields: Dict[str, Any] = {}
        if name is not None:
            name_norm = name.strip()
            if not name_norm:
                raise ValueError("name is required")
            fields["name"] = name_norm
        if broker is not None:
            fields["broker"] = broker.strip() or None
        if market is not None:
            fields["market"] = self._normalize_market(market)
        if base_currency is not None:
            fields["base_currency"] = self._normalize_currency(base_currency)
        if cash_tracking_mode is not None:
            fields["cash_tracking_mode"] = self._normalize_cash_tracking_mode(cash_tracking_mode, market=market)
        if owner_id is not None:
            fields["owner_id"] = owner_id.strip() or None
        if is_active is not None:
            fields["is_active"] = bool(is_active)
        if not fields:
            raise ValueError("No fields provided for update")

        row = self.repo.update_account(account_id, fields)
        if row is None:
            return None
        return self._account_to_dict(row)

    def deactivate_account(self, account_id: int) -> bool:
        return self.repo.deactivate_account(account_id)

    # ------------------------------------------------------------------
    # Event writes
    # ------------------------------------------------------------------
    def record_trade(
        self,
        *,
        account_id: int,
        symbol: str,
        trade_date: date,
        side: str,
        quantity: float,
        price: float,
        fee: float = 0.0,
        tax: float = 0.0,
        market: Optional[str] = None,
        currency: Optional[str] = None,
        trade_uid: Optional[str] = None,
        dedup_hash: Optional[str] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        side_norm = (side or "").strip().lower()
        if side_norm not in VALID_SIDES:
            raise ValueError("side must be buy or sell")
        if quantity <= 0 or price <= 0:
            raise ValueError("quantity and price must be > 0")
        if fee < 0 or tax < 0:
            raise ValueError("fee and tax must be >= 0")
        symbol_norm = self._normalize_symbol_for_storage(symbol)
        if not symbol_norm:
            raise ValueError("symbol is required")
        trade_uid_norm = (trade_uid or "").strip() or None
        dedup_hash_norm = (dedup_hash or "").strip() or None
        try:
            with self.repo.portfolio_write_session() as session:
                account = self._require_active_account_in_session(session=session, account_id=account_id)
                market_norm = self._normalize_market(market or account.market)
                currency_norm = self._normalize_currency(currency or self._default_currency_for_market(market_norm))
                if market_norm == "bank":
                    raise ValueError("bank accounts do not support trade events")
                self._validate_trade_identity(
                    account_id=account_id,
                    trade_uid=trade_uid_norm,
                    dedup_hash=dedup_hash_norm,
                    session=session,
                    )
                if side_norm == "sell":
                    self._validate_sell_quantity(
                        account_id=account_id,
                        symbol=symbol,
                        market=market_norm,
                        currency=currency_norm,
                        trade_date=trade_date,
                        quantity=float(quantity),
                        session=session,
                    )
                row = self.repo.add_trade_in_session(
                    session=session,
                    account_id=account_id,
                    trade_uid=trade_uid_norm,
                    symbol=symbol_norm,
                    market=market_norm,
                    currency=currency_norm,
                    trade_date=trade_date,
                    side=side_norm,
                    quantity=float(quantity),
                    price=float(price),
                    fee=float(fee),
                    tax=float(tax),
                    note=(note or "").strip() or None,
                    dedup_hash=dedup_hash_norm,
                )
                return {"id": int(row.id)}
        except (DuplicateTradeUidError, DuplicateTradeDedupHashError) as exc:
            raise PortfolioConflictError(str(exc)) from exc

    def upsert_manual_price(
        self,
        *,
        account_id: int,
        symbol: str,
        market: str,
        price_date: date,
        price: float,
        currency: Optional[str] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        if price <= 0:
            raise ValueError("price must be > 0")
        account = self._require_active_account(account_id)
        market_norm = self._normalize_market(market or account.market)
        symbol_norm = self._normalize_symbol_for_position(symbol)
        if not symbol_norm:
            raise ValueError("symbol is required")
        currency_norm = self._normalize_currency(currency or self._default_currency_for_market(market_norm))
        row = self.repo.upsert_manual_price(
            account_id=account_id,
            symbol=symbol_norm,
            market=market_norm,
            currency=currency_norm,
            price_date=price_date,
            price=float(price),
            note=(note or "").strip() or None,
        )
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "symbol": row.symbol,
            "market": row.market,
            "currency": row.currency,
            "price_date": row.price_date.isoformat(),
            "price": float(row.price),
            "note": row.note,
        }

    def record_bank_ledger(
        self,
        *,
        account_id: int,
        event_date: date,
        asset_kind: str,
        direction: str,
        amount: float,
        bank_name: str,
        currency: Optional[str] = None,
        product_name: Optional[str] = None,
        product_code: Optional[str] = None,
        product_public_code: Optional[str] = None,
        issuer_name: Optional[str] = None,
        registration_code: Optional[str] = None,
        linked_entry_id: Optional[int] = None,
        quantity: Optional[float] = None,
        unit_nav: Optional[float] = None,
        nav_date: Optional[date] = None,
        start_date: Optional[date] = None,
        maturity_date: Optional[date] = None,
        annual_rate: Optional[float] = None,
        investment_nature: Optional[str] = None,
        risk_level: Optional[str] = None,
        income_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        account = self._require_active_account(account_id)
        if account.market != "bank":
            raise ValueError("bank ledger can only be recorded in bank accounts")
        asset_kind_norm = self._normalize_bank_asset_kind(asset_kind)
        direction_norm = (direction or "").strip().lower()
        if direction_norm not in VALID_CASH_DIRECTIONS:
            raise ValueError("direction must be in or out")
        if amount <= 0:
            raise ValueError("amount must be > 0")
        bank_name_norm = (bank_name or "").strip()
        if not bank_name_norm:
            raise ValueError("bank_name is required")
        product_name_norm = (product_name or "").strip() or None
        product_code_norm = (product_code or "").strip().upper() or None
        product_public_code_norm = (product_public_code or "").strip().upper() or None
        issuer_name_norm = (issuer_name or "").strip() or None
        registration_code_norm = (registration_code or "").strip().upper() or None
        investment_nature_norm = (investment_nature or "").strip().lower() or None
        risk_level_norm = (risk_level or "").strip().upper() or None
        income_mode_norm = (income_mode or "").strip().lower() or None
        linked_entry = None
        if linked_entry_id is not None:
            linked_entry = self.repo.get_bank_ledger_by_id(int(linked_entry_id))
            if linked_entry is None:
                raise ValueError("linked_entry_id is invalid")
            if int(linked_entry.account_id) != int(account_id):
                raise ValueError("linked_entry_id does not belong to this account")
            if self._normalize_bank_asset_kind(linked_entry.asset_kind) != asset_kind_norm:
                raise ValueError("linked_entry_id asset kind mismatch")
            if linked_entry.direction != "in":
                raise ValueError("linked_entry_id must point to an open bank purchase/deposit event")
            if linked_entry.event_date and event_date < linked_entry.event_date:
                raise ValueError("event_date must be >= linked entry date")
            product_name_norm = product_name_norm or (linked_entry.product_name or None)
            product_code_norm = product_code_norm or (getattr(linked_entry, "product_code", None) or None)
            product_public_code_norm = product_public_code_norm or (
                getattr(linked_entry, "product_public_code", None) or None
            )
            issuer_name_norm = issuer_name_norm or (getattr(linked_entry, "issuer_name", None) or None)
            registration_code_norm = registration_code_norm or (
                linked_entry.registration_code.strip().upper() if linked_entry.registration_code else None
            )
            bank_name_norm = bank_name_norm or (linked_entry.bank_name or "")
            currency = currency or linked_entry.currency
            start_date = start_date or linked_entry.start_date
            maturity_date = maturity_date or linked_entry.maturity_date
            annual_rate = annual_rate if annual_rate is not None else linked_entry.annual_rate
            investment_nature_norm = investment_nature_norm or linked_entry.investment_nature
            risk_level_norm = risk_level_norm or linked_entry.risk_level
            income_mode_norm = income_mode_norm or linked_entry.income_mode
            if asset_kind_norm == "wealth":
                linked_entry_id = int(linked_entry.linked_entry_id or linked_entry.id)

        if asset_kind_norm == "deposit":
            if not product_name_norm:
                raise ValueError("product_name is required for deposit assets")
            if start_date is None:
                raise ValueError("start_date is required for deposit assets")
            if maturity_date is None:
                raise ValueError("maturity_date is required for deposit assets")
            if maturity_date < start_date:
                raise ValueError("maturity_date must be >= start_date")
            if annual_rate is None or annual_rate < 0:
                raise ValueError("annual_rate must be >= 0 for deposit assets")
        elif asset_kind_norm == "wealth":
            if not product_name_norm:
                raise ValueError("product_name is required for wealth assets")
            if income_mode_norm and income_mode_norm not in VALID_BANK_INCOME_MODES:
                raise ValueError("income_mode must be dividend or reinvest")
            if investment_nature_norm and investment_nature_norm not in VALID_BANK_INVESTMENT_NATURES:
                raise ValueError("investment_nature is invalid")
            if risk_level_norm and risk_level_norm not in VALID_BANK_RISK_LEVELS:
                raise ValueError("risk_level must be R1-R5")
            if start_date and maturity_date and maturity_date < start_date:
                raise ValueError("maturity_date must be >= start_date")
            if unit_nav is not None and unit_nav <= 0:
                raise ValueError("unit_nav must be > 0")
            if quantity is None and direction_norm == "in" and unit_nav is not None:
                quantity = float(amount) / float(unit_nav)
            if nav_date is not None and nav_date > event_date:
                raise ValueError("nav_date must be <= event_date")
        currency_norm = self._normalize_currency(currency or account.base_currency)
        row = self.repo.add_bank_ledger(
            account_id=account_id,
            event_date=event_date,
            asset_kind=asset_kind_norm,
            direction=direction_norm,
            amount=float(amount),
            currency=currency_norm,
            bank_name=bank_name_norm,
            product_name=product_name_norm,
            product_code=product_code_norm,
            product_public_code=product_public_code_norm,
            issuer_name=issuer_name_norm,
            registration_code=registration_code_norm,
            linked_entry_id=int(linked_entry_id) if linked_entry_id is not None else None,
            quantity=float(quantity) if quantity is not None else None,
            unit_nav=float(unit_nav) if unit_nav is not None else None,
            nav_date=nav_date,
            start_date=start_date,
            maturity_date=maturity_date,
            annual_rate=float(annual_rate) if annual_rate is not None else None,
            investment_nature=investment_nature_norm,
            risk_level=risk_level_norm,
            income_mode=income_mode_norm,
        )
        return {"id": int(row.id)}

    def record_cash_ledger(
        self,
        *,
        account_id: int,
        event_date: date,
        direction: str,
        amount: float,
        currency: Optional[str] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        direction_norm = (direction or "").strip().lower()
        if direction_norm not in VALID_CASH_DIRECTIONS:
            raise ValueError("direction must be in or out")
        if amount <= 0:
            raise ValueError("amount must be > 0")
        with self.repo.portfolio_write_session() as session:
            account = self._require_active_account_in_session(session=session, account_id=account_id)
            currency_norm = self._normalize_currency(currency or account.base_currency)
            row = self.repo.add_cash_ledger_in_session(
                session=session,
                account_id=account_id,
                event_date=event_date,
                direction=direction_norm,
                amount=float(amount),
                currency=currency_norm,
                note=(note or "").strip() or None,
            )
            return {"id": int(row.id)}

    def record_corporate_action(
        self,
        *,
        account_id: int,
        symbol: str,
        effective_date: date,
        action_type: str,
        market: Optional[str] = None,
        currency: Optional[str] = None,
        cash_dividend_per_share: Optional[float] = None,
        split_ratio: Optional[float] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        action_type_norm = (action_type or "").strip().lower()
        if action_type_norm not in VALID_CORPORATE_ACTIONS:
            raise ValueError("action_type must be cash_dividend or split_adjustment")

        if action_type_norm == "cash_dividend":
            if cash_dividend_per_share is None or cash_dividend_per_share < 0:
                raise ValueError("cash_dividend_per_share must be >= 0 for cash_dividend")
        if action_type_norm == "split_adjustment":
            if split_ratio is None or split_ratio <= 0:
                raise ValueError("split_ratio must be > 0 for split_adjustment")
        with self.repo.portfolio_write_session() as session:
            account = self._require_active_account_in_session(session=session, account_id=account_id)
            market_norm = self._normalize_market(market or account.market)
            currency_norm = self._normalize_currency(currency or self._default_currency_for_market(market_norm))
            symbol_norm = self._normalize_symbol_for_storage(symbol)
            if not symbol_norm:
                raise ValueError("symbol is required")
            row = self.repo.add_corporate_action_in_session(
                session=session,
                account_id=account_id,
                symbol=symbol_norm,
                market=market_norm,
                currency=currency_norm,
                effective_date=effective_date,
                action_type=action_type_norm,
                cash_dividend_per_share=cash_dividend_per_share,
                split_ratio=split_ratio,
                note=(note or "").strip() or None,
            )
            return {"id": int(row.id)}

    def delete_trade_event(self, trade_id: int) -> bool:
        with self.repo.portfolio_write_session() as session:
            return self.repo.delete_trade_in_session(session=session, trade_id=trade_id)

    def delete_cash_ledger_event(self, entry_id: int) -> bool:
        with self.repo.portfolio_write_session() as session:
            return self.repo.delete_cash_ledger_in_session(session=session, entry_id=entry_id)

    def delete_corporate_action_event(self, action_id: int) -> bool:
        with self.repo.portfolio_write_session() as session:
            return self.repo.delete_corporate_action_in_session(session=session, action_id=action_id)

    def delete_bank_ledger_event(self, entry_id: int) -> bool:
        return self.repo.delete_bank_ledger(entry_id)

    def record_advisory_ledger(
        self,
        *,
        account_id: int,
        event_date: date,
        platform: str,
        product_name: str,
        product_code: Optional[str],
        product_type: str,
        event_type: str,
        amount: float,
        currency: Optional[str] = None,
        risk_level: Optional[str] = None,
        investment_style: Optional[str] = None,
    ) -> Dict[str, Any]:
        account = self._require_active_account(account_id)
        if account.market != "advisory":
            raise ValueError("advisory ledger can only be recorded in advisory accounts")
        if amount <= 0:
            raise ValueError("amount must be > 0")
        product_type_norm = self._normalize_advisory_product_type(product_type)
        event_type_norm = self._normalize_advisory_event_type(event_type)
        self._validate_advisory_event_for_product(product_type_norm, event_type_norm)
        platform_norm = (platform or "").strip()
        if not platform_norm:
            raise ValueError("platform is required")
        product_name_norm = (product_name or "").strip()
        if not product_name_norm:
            raise ValueError("product_name is required")
        product_code_norm = (product_code or "").strip().upper() or None
        currency_norm = self._normalize_currency(currency or account.base_currency)
        risk_level_norm = (risk_level or "").strip() or None
        investment_style_norm = (investment_style or "").strip() or None
        self._validate_advisory_product_type_consistency(
            account_id=account_id,
            platform=platform_norm,
            product_code=product_code_norm,
            product_name=product_name_norm,
            currency=currency_norm,
            product_type=product_type_norm,
        )

        row = self.repo.add_advisory_ledger(
            account_id=account_id,
            event_date=event_date,
            platform=platform_norm,
            product_name=product_name_norm,
            product_code=product_code_norm,
            product_type=product_type_norm,
            direction=event_type_norm,
            amount=float(amount),
            quantity=1.0,
            nav=float(amount),
            currency=currency_norm,
            risk_level=risk_level_norm,
            investment_style=investment_style_norm,
        )
        return {"id": int(row.id)}

    def delete_advisory_ledger_event(self, entry_id: int) -> bool:
        return self.repo.delete_advisory_ledger(entry_id)

    def create_insurance_policy(
        self,
        *,
        account_id: int,
        policy_name: str,
        insurer: Optional[str] = None,
        policy_no: Optional[str] = None,
        insurance_kind: Optional[str] = None,
        design_type: Optional[str] = None,
        currency: Optional[str] = None,
        status: str = "active",
        payment_mode: str = "single",
        premium_per_period: Optional[float] = None,
        first_payment_date: Optional[date] = None,
        total_periods: Optional[int] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        account = self._require_active_account(account_id)
        if account.market != "insurance":
            raise ValueError("insurance policies can only be created in insurance accounts")
        fields = self._normalize_insurance_policy_fields(
            account=account,
            policy_name=policy_name,
            insurer=insurer,
            policy_no=policy_no,
            insurance_kind=insurance_kind,
            design_type=design_type,
            currency=currency,
            status=status,
            payment_mode=payment_mode,
            premium_per_period=premium_per_period,
            first_payment_date=first_payment_date,
            total_periods=total_periods,
            note=note,
            partial=False,
        )
        row = self.repo.add_insurance_policy(account_id=account_id, **fields)
        return self._insurance_policy_row_to_dict(row)

    def update_insurance_policy(
        self,
        policy_id: int,
        *,
        policy_name: Optional[str] = None,
        insurer: Optional[str] = None,
        policy_no: Optional[str] = None,
        insurance_kind: Optional[str] = None,
        design_type: Optional[str] = None,
        currency: Optional[str] = None,
        status: Optional[str] = None,
        payment_mode: Optional[str] = None,
        premium_per_period: Optional[float] = None,
        first_payment_date: Optional[date] = None,
        total_periods: Optional[int] = None,
        note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        existing = self.repo.get_insurance_policy(policy_id)
        if existing is None:
            return None
        account = self._require_active_account(int(existing.account_id))
        fields = self._normalize_insurance_policy_fields(
            account=account,
            policy_name=policy_name,
            insurer=insurer,
            policy_no=policy_no,
            insurance_kind=insurance_kind,
            design_type=design_type,
            currency=currency,
            status=status,
            payment_mode=payment_mode,
            premium_per_period=premium_per_period,
            first_payment_date=first_payment_date,
            total_periods=total_periods,
            note=note,
            partial=True,
        )
        if not fields:
            raise ValueError("No fields provided for update")
        locked_fields = {"insurance_kind", "design_type", "currency"}
        if locked_fields.intersection(fields) and self.repo.count_insurance_ledger(policy_id) > 0:
            raise ValueError("insurance_kind, design_type and currency cannot be changed after ledger events exist")
        row = self.repo.update_insurance_policy(policy_id, fields)
        if row is None:
            return None
        return self._insurance_policy_row_to_dict(row)

    def list_insurance_policies(
        self,
        *,
        account_id: Optional[int] = None,
        include_inactive: bool = False,
    ) -> Dict[str, Any]:
        if account_id is not None:
            account = self._require_active_account(account_id)
            if account.market != "insurance":
                raise ValueError("insurance policies can only be listed for insurance accounts")
        rows = self.repo.query_insurance_policies(account_id=account_id, include_inactive=include_inactive)
        return {"policies": [self._insurance_policy_row_to_dict(row) for row in rows]}

    def record_insurance_ledger(
        self,
        *,
        account_id: int,
        policy_id: int,
        event_date: date,
        event_type: str,
        amount: float,
        currency: Optional[str] = None,
        period_no: Optional[int] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        account = self._require_active_account(account_id)
        if account.market != "insurance":
            raise ValueError("insurance ledger can only be recorded in insurance accounts")
        policy = self.repo.get_insurance_policy(policy_id)
        if policy is None:
            raise ValueError("policy_id is invalid")
        if int(policy.account_id) != int(account_id):
            raise ValueError("policy_id does not belong to this account")
        event_type_norm = self._normalize_insurance_event_type(event_type)
        self._validate_insurance_event_for_policy(policy, event_type_norm, event_date)
        if amount <= 0:
            raise ValueError("amount must be > 0")
        if period_no is not None and period_no <= 0:
            raise ValueError("period_no must be > 0")
        currency_norm = self._normalize_currency(currency or policy.currency or account.base_currency)
        if currency_norm != self._normalize_currency(policy.currency or account.base_currency):
            raise ValueError("currency must match policy currency")
        row = self.repo.add_insurance_ledger(
            account_id=account_id,
            policy_id=policy_id,
            event_date=event_date,
            event_type=event_type_norm,
            amount=float(amount),
            currency=currency_norm,
            period_no=int(period_no) if period_no is not None else None,
            note=(note or "").strip() or None,
        )
        return {"id": int(row.id)}

    def list_insurance_ledger_events(
        self,
        *,
        account_id: Optional[int] = None,
        policy_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        event_type: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        if account_id is not None:
            account = self._require_active_account(account_id)
            if account.market != "insurance":
                raise ValueError("insurance ledger can only be listed for insurance accounts")
        if policy_id is not None:
            policy = self.repo.get_insurance_policy(policy_id)
            if policy is None:
                raise ValueError("policy_id is invalid")
            if account_id is not None and int(policy.account_id) != int(account_id):
                raise ValueError("policy_id does not belong to this account")
        page, page_size = self._validate_paging(page=page, page_size=page_size)
        if date_from is not None and date_to is not None and date_from > date_to:
            raise ValueError("date_from must be <= date_to")
        event_type_norm: Optional[str] = None
        if event_type is not None and event_type.strip():
            event_type_norm = self._normalize_insurance_event_type(event_type)
        rows, total = self.repo.query_insurance_ledger(
            account_id=account_id,
            policy_id=policy_id,
            date_from=date_from,
            date_to=date_to,
            event_type=event_type_norm,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._insurance_ledger_row_to_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def delete_insurance_ledger_event(self, entry_id: int) -> bool:
        return self.repo.delete_insurance_ledger(entry_id)

    def list_trade_events(
        self,
        *,
        account_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        symbol: Optional[str] = None,
        side: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        if account_id is not None:
            self._require_active_account(account_id)
        page, page_size = self._validate_paging(page=page, page_size=page_size)
        if date_from is not None and date_to is not None and date_from > date_to:
            raise ValueError("date_from must be <= date_to")

        symbol_filters: Optional[List[str]] = None
        if symbol is not None and symbol.strip():
            symbol_filters = self._build_symbol_filter_values(symbol)
            if not symbol_filters:
                raise ValueError("symbol is invalid")

        side_norm: Optional[str] = None
        if side is not None and side.strip():
            side_norm = side.strip().lower()
            if side_norm not in VALID_SIDES:
                raise ValueError("side must be buy or sell")

        rows, total = self.repo.query_trades(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            symbols=symbol_filters,
            side=side_norm,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._trade_row_to_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def list_cash_ledger_events(
        self,
        *,
        account_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        direction: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        if account_id is not None:
            self._require_active_account(account_id)
        page, page_size = self._validate_paging(page=page, page_size=page_size)
        if date_from is not None and date_to is not None and date_from > date_to:
            raise ValueError("date_from must be <= date_to")

        direction_norm: Optional[str] = None
        if direction is not None and direction.strip():
            direction_norm = direction.strip().lower()
            if direction_norm not in VALID_CASH_DIRECTIONS:
                raise ValueError("direction must be in or out")

        rows, total = self.repo.query_cash_ledger(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            direction=direction_norm,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._cash_ledger_row_to_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def list_corporate_action_events(
        self,
        *,
        account_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        symbol: Optional[str] = None,
        action_type: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        if account_id is not None:
            self._require_active_account(account_id)
        page, page_size = self._validate_paging(page=page, page_size=page_size)
        if date_from is not None and date_to is not None and date_from > date_to:
            raise ValueError("date_from must be <= date_to")

        symbol_filters: Optional[List[str]] = None
        if symbol is not None and symbol.strip():
            symbol_filters = self._build_symbol_filter_values(symbol)
            if not symbol_filters:
                raise ValueError("symbol is invalid")

        action_norm: Optional[str] = None
        if action_type is not None and action_type.strip():
            action_norm = action_type.strip().lower()
            if action_norm not in VALID_CORPORATE_ACTIONS:
                raise ValueError("action_type must be cash_dividend or split_adjustment")

        rows, total = self.repo.query_corporate_actions(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            symbols=symbol_filters,
            action_type=action_norm,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._corporate_action_row_to_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def list_bank_ledger_events(
        self,
        *,
        account_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        asset_kind: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        if account_id is not None:
            self._require_active_account(account_id)
        page, page_size = self._validate_paging(page=page, page_size=page_size)
        if date_from is not None and date_to is not None and date_from > date_to:
            raise ValueError("date_from must be <= date_to")
        asset_kind_norm: Optional[str] = None
        if asset_kind is not None and asset_kind.strip():
            asset_kind_norm = self._normalize_bank_asset_kind(asset_kind)
        rows, total = self.repo.query_bank_ledger(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            asset_kind=asset_kind_norm,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._bank_ledger_row_to_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def list_advisory_ledger_events(
        self,
        *,
        account_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        product: Optional[str] = None,
        direction: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        if account_id is not None:
            self._require_active_account(account_id)
        page, page_size = self._validate_paging(page=page, page_size=page_size)
        if date_from is not None and date_to is not None and date_from > date_to:
            raise ValueError("date_from must be <= date_to")
        direction_norm: Optional[str] = None
        if direction is not None and direction.strip():
            direction_norm = self._normalize_advisory_event_type(direction)
        rows, total = self.repo.query_advisory_ledger(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            product=(product or "").strip() or None,
            direction=direction_norm,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._advisory_ledger_row_to_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    # ------------------------------------------------------------------
    # Snapshot replay
    # ------------------------------------------------------------------
    def get_portfolio_snapshot(
        self,
        *,
        account_id: Optional[int] = None,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
        refresh_prices: bool = False,
    ) -> Dict[str, Any]:
        as_of_date = as_of or date.today()
        method = self._normalize_cost_method(cost_method)

        if account_id is not None:
            account = self._require_active_account(account_id)
            account_rows = [account]
        else:
            account_rows = self.repo.list_accounts(include_inactive=False)

        if not refresh_prices:
            cached_snapshot = self._build_cached_portfolio_snapshot(
                account_rows=account_rows,
                as_of_date=as_of_date,
                cost_method=method,
            )
            if cached_snapshot is not None:
                return cached_snapshot

        accounts_payload: List[Dict[str, Any]] = []
        aggregate_currency = "CNY"
        aggregate = {
            "total_cash": 0.0,
            "total_market_value": 0.0,
            "total_equity": 0.0,
            "realized_pnl": 0.0,
            "unrealized_pnl": 0.0,
            "fee_total": 0.0,
            "tax_total": 0.0,
            "fx_stale": False,
            "fx_missing": False,
        }
        missing_fx_pairs: Set[Tuple[str, str]] = set()

        for account in account_rows:
            account_snapshot = self._replay_account(
                account=account,
                as_of_date=as_of_date,
                cost_method=method,
                refresh_prices=refresh_prices,
            )

            self.repo.replace_positions_lots_and_snapshot(
                account_id=account.id,
                snapshot_date=as_of_date,
                cost_method=method,
                base_currency=account.base_currency,
                total_cash=account_snapshot["total_cash"],
                total_market_value=account_snapshot["total_market_value"],
                total_equity=account_snapshot["total_equity"],
                unrealized_pnl=account_snapshot["unrealized_pnl"],
                realized_pnl=account_snapshot["realized_pnl"],
                fee_total=account_snapshot["fee_total"],
                tax_total=account_snapshot["tax_total"],
                fx_stale=account_snapshot["fx_stale"],
                payload=json.dumps(account_snapshot["payload"], ensure_ascii=False),
                positions=account_snapshot["positions_cache"],
                lots=account_snapshot["lots_cache"],
                valuation_currency=account.base_currency,
            )

            accounts_payload.append(account_snapshot["public"])

            conversions = {
                "total_cash": self._convert_amount(
                    amount=account_snapshot["total_cash"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "total_market_value": self._convert_amount(
                    amount=account_snapshot["total_market_value"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "total_equity": self._convert_amount(
                    amount=account_snapshot["total_equity"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "realized_pnl": self._convert_amount(
                    amount=account_snapshot["realized_pnl"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "unrealized_pnl": self._convert_amount(
                    amount=account_snapshot["unrealized_pnl"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "fee_total": self._convert_amount(
                    amount=account_snapshot["fee_total"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "tax_total": self._convert_amount(
                    amount=account_snapshot["tax_total"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
            }

            for key, conversion in conversions.items():
                if conversion.amount is not None:
                    aggregate[key] += conversion.amount
                if conversion.missing_pair is not None:
                    aggregate["fx_missing"] = True
                    missing_fx_pairs.add(conversion.missing_pair)
                aggregate["fx_stale"] = aggregate["fx_stale"] or conversion.is_stale

        has_missing_fx = bool(aggregate["fx_missing"])
        asset_breakdown = {
            "stock": 0.0,
            "fund": 0.0,
            "crypto": 0.0,
            "bank": 0.0,
            "advisory": 0.0,
            "insurance": 0.0,
            "cash": 0.0,
        }
        if not has_missing_fx:
            asset_breakdown["cash"] = round(aggregate["total_cash"], 6)
            for account, account_snapshot in zip(account_rows, accounts_payload):
                converted_mv = self._convert_amount(
                    amount=account_snapshot["total_market_value"],
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                )
                key = account.market if account.market in {"fund", "crypto", "bank", "advisory", "insurance"} else "stock"
                asset_breakdown[key] += float(converted_mv.amount or 0.0)
            asset_breakdown = {key: round(value, 6) for key, value in asset_breakdown.items()}

        self._apply_product_tags(accounts_payload)
        tag_breakdown = [] if has_missing_fx else self._build_tag_breakdown(
            accounts_payload=accounts_payload,
        )

        def _aggregate_value(key: str) -> Optional[float]:
            if has_missing_fx:
                return None
            return round(aggregate[key], 6)

        return {
            "as_of": as_of_date.isoformat(),
            "cost_method": method,
            "currency": aggregate_currency,
            "account_count": len(account_rows),
            "total_cash": _aggregate_value("total_cash"),
            "total_market_value": _aggregate_value("total_market_value"),
            "total_equity": _aggregate_value("total_equity"),
            "realized_pnl": _aggregate_value("realized_pnl"),
            "unrealized_pnl": _aggregate_value("unrealized_pnl"),
            "fee_total": _aggregate_value("fee_total"),
            "tax_total": _aggregate_value("tax_total"),
            "fx_stale": aggregate["fx_stale"],
            "fx_missing": aggregate["fx_missing"],
            "missing_fx_pairs": [
                {"from_currency": from_currency, "to_currency": to_currency}
                for from_currency, to_currency in sorted(missing_fx_pairs)
            ],
            "asset_breakdown": {} if has_missing_fx else asset_breakdown,
            "tag_breakdown": tag_breakdown,
            "accounts": accounts_payload,
        }

    def _build_cached_portfolio_snapshot(
        self,
        *,
        account_rows: List[Any],
        as_of_date: date,
        cost_method: str,
    ) -> Optional[Dict[str, Any]]:
        account_payloads: List[Dict[str, Any]] = []
        for account in account_rows:
            row = self.repo.get_latest_daily_snapshot(
                account_id=int(account.id),
                as_of=as_of_date,
                cost_method=cost_method,
            )
            if row is None or not row.payload:
                return None
            try:
                payload = json.loads(row.payload)
            except (TypeError, ValueError):
                return None
            if not isinstance(payload, dict):
                return None
            if self._snapshot_payload_missing_position_metrics(payload):
                return None
            account_payloads.append(payload)

        return self._aggregate_account_payloads(
            account_rows=account_rows,
            accounts_payload=account_payloads,
            as_of_date=as_of_date,
            cost_method=cost_method,
        )

    @staticmethod
    def _snapshot_payload_missing_position_metrics(payload: Dict[str, Any]) -> bool:
        if int(payload.get("snapshot_schema_version") or 0) < PORTFOLIO_SNAPSHOT_SCHEMA_VERSION:
            return True
        if "cash_tracking_mode" not in payload:
            return True
        positions = payload.get("positions")
        if not positions:
            return False
        for position in positions:
            if not isinstance(position, dict):
                return True
            if (
                "product_key" not in position
                or "annualized_return_pct" not in position
                or "valuation_model" not in position
                or "cost_display_value" not in position
                or "price_display_value" not in position
            ):
                return True
        return False

    def _aggregate_account_payloads(
        self,
        *,
        account_rows: List[Any],
        accounts_payload: List[Dict[str, Any]],
        as_of_date: date,
        cost_method: str,
    ) -> Dict[str, Any]:
        aggregate_currency = "CNY"
        aggregate = {
            "total_cash": 0.0,
            "total_market_value": 0.0,
            "total_equity": 0.0,
            "realized_pnl": 0.0,
            "unrealized_pnl": 0.0,
            "fee_total": 0.0,
            "tax_total": 0.0,
            "fx_stale": False,
            "fx_missing": False,
        }
        missing_fx_pairs: Set[Tuple[str, str]] = set()

        for account, account_snapshot in zip(account_rows, accounts_payload):
            conversions = {
                "total_cash": self._convert_amount(
                    amount=float(account_snapshot.get("total_cash") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "total_market_value": self._convert_amount(
                    amount=float(account_snapshot.get("total_market_value") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "total_equity": self._convert_amount(
                    amount=float(account_snapshot.get("total_equity") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "realized_pnl": self._convert_amount(
                    amount=float(account_snapshot.get("realized_pnl") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "unrealized_pnl": self._convert_amount(
                    amount=float(account_snapshot.get("unrealized_pnl") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "fee_total": self._convert_amount(
                    amount=float(account_snapshot.get("fee_total") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
                "tax_total": self._convert_amount(
                    amount=float(account_snapshot.get("tax_total") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                ),
            }
            for key, conversion in conversions.items():
                if conversion.amount is not None:
                    aggregate[key] += conversion.amount
                if conversion.missing_pair is not None:
                    aggregate["fx_missing"] = True
                    missing_fx_pairs.add(conversion.missing_pair)
                aggregate["fx_stale"] = aggregate["fx_stale"] or conversion.is_stale
            aggregate["fx_stale"] = aggregate["fx_stale"] or bool(account_snapshot.get("fx_stale"))

        has_missing_fx = bool(aggregate["fx_missing"])
        asset_breakdown = {
            "stock": 0.0,
            "fund": 0.0,
            "crypto": 0.0,
            "bank": 0.0,
            "advisory": 0.0,
            "insurance": 0.0,
            "cash": 0.0,
        }
        if not has_missing_fx:
            asset_breakdown["cash"] = round(aggregate["total_cash"], 6)
            for account, account_snapshot in zip(account_rows, accounts_payload):
                converted_mv = self._convert_amount(
                    amount=float(account_snapshot.get("total_market_value") or 0.0),
                    from_currency=account.base_currency,
                    to_currency=aggregate_currency,
                    as_of_date=as_of_date,
                )
                key = account.market if account.market in {"fund", "crypto", "bank", "advisory", "insurance"} else "stock"
                asset_breakdown[key] += float(converted_mv.amount or 0.0)
            asset_breakdown = {key: round(value, 6) for key, value in asset_breakdown.items()}

        self._apply_product_tags(accounts_payload)
        tag_breakdown = [] if has_missing_fx else self._build_tag_breakdown(
            accounts_payload=accounts_payload,
        )

        def _aggregate_value(key: str) -> Optional[float]:
            if has_missing_fx:
                return None
            return round(aggregate[key], 6)

        return {
            "as_of": as_of_date.isoformat(),
            "cost_method": cost_method,
            "currency": aggregate_currency,
            "account_count": len(account_rows),
            "total_cash": _aggregate_value("total_cash"),
            "total_market_value": _aggregate_value("total_market_value"),
            "total_equity": _aggregate_value("total_equity"),
            "realized_pnl": _aggregate_value("realized_pnl"),
            "unrealized_pnl": _aggregate_value("unrealized_pnl"),
            "fee_total": _aggregate_value("fee_total"),
            "tax_total": _aggregate_value("tax_total"),
            "fx_stale": aggregate["fx_stale"],
            "fx_missing": aggregate["fx_missing"],
            "missing_fx_pairs": [
                {"from_currency": from_currency, "to_currency": to_currency}
                for from_currency, to_currency in sorted(missing_fx_pairs)
            ],
            "asset_breakdown": {} if has_missing_fx else asset_breakdown,
            "tag_breakdown": tag_breakdown,
            "accounts": accounts_payload,
        }

    def refresh_fx_rates(
        self,
        *,
        account_id: Optional[int] = None,
        as_of: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Refresh account FX pairs online with stale fallback when fetch fails."""
        as_of_date = as_of or date.today()
        config = get_config()
        refresh_enabled = bool(getattr(config, "portfolio_fx_update_enabled", True))
        if account_id is not None:
            account_rows = [self._require_active_account(account_id)]
        else:
            account_rows = self.repo.list_accounts(include_inactive=False)

        summary = {
            "as_of": as_of_date.isoformat(),
            "account_count": len(account_rows),
            "refresh_enabled": refresh_enabled,
            "disabled_reason": None if refresh_enabled else PORTFOLIO_FX_REFRESH_DISABLED_REASON,
            "pair_count": 0,
            "updated_count": 0,
            "stale_count": 0,
            "error_count": 0,
        }
        for account in account_rows:
            item = self._refresh_account_fx_rates(
                account=account,
                as_of_date=as_of_date,
                refresh_enabled=refresh_enabled,
                aggregate_currency="CNY",
            )
            summary["pair_count"] += item["pair_count"]
            summary["updated_count"] += item["updated_count"]
            summary["stale_count"] += item["stale_count"]
            summary["error_count"] += item["error_count"]
        return summary

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _validate_trade_identity(
        self,
        *,
        account_id: int,
        trade_uid: Optional[str],
        dedup_hash: Optional[str],
        session: Optional[Any] = None,
    ) -> None:
        if trade_uid and self._has_trade_uid(account_id=account_id, trade_uid=trade_uid, session=session):
            raise PortfolioConflictError(f"Duplicate trade_uid for account_id={account_id}: {trade_uid}")
        if dedup_hash and self._has_trade_dedup_hash(account_id=account_id, dedup_hash=dedup_hash, session=session):
            raise PortfolioConflictError(f"Duplicate dedup_hash for account_id={account_id}: {dedup_hash}")

    def _validate_sell_quantity(
        self,
        *,
        account_id: int,
        symbol: str,
        market: str,
        currency: str,
        trade_date: date,
        quantity: float,
        session: Optional[Any] = None,
    ) -> None:
        key = (
            self._normalize_symbol_for_position(symbol),
            self._normalize_market(market),
            self._normalize_currency(currency),
        )
        available_quantity = self._calculate_available_quantity(
            account_id=account_id,
            key=key,
            as_of_date=trade_date,
            session=session,
        )
        if available_quantity + EPS < quantity:
            raise PortfolioOversellError(
                symbol=key[0],
                trade_date=trade_date,
                requested_quantity=quantity,
                available_quantity=available_quantity,
            )

    def _calculate_available_quantity(
        self,
        *,
        account_id: int,
        key: Tuple[str, str, str],
        as_of_date: date,
        session: Optional[Any] = None,
    ) -> float:
        if session is None:
            trades = self.repo.list_trades(account_id, as_of=as_of_date)
            corporate_actions = self.repo.list_corporate_actions(account_id, as_of=as_of_date)
        else:
            trades = self.repo.list_trades_in_session(session=session, account_id=account_id, as_of=as_of_date)
            corporate_actions = self.repo.list_corporate_actions_in_session(
                session=session,
                account_id=account_id,
                as_of=as_of_date,
            )

        events = []
        for row in corporate_actions:
            event_key = (
                self._normalize_symbol_for_position(row.symbol),
                self._normalize_market(row.market),
                self._normalize_currency(row.currency),
            )
            if event_key == key:
                events.append(("corp", row.effective_date, row.id, row))
        for row in trades:
            event_key = (
                self._normalize_symbol_for_position(row.symbol),
                self._normalize_market(row.market),
                self._normalize_currency(row.currency),
            )
            if event_key == key:
                events.append(("trade", row.trade_date, row.id, row))

        # Quantity validation only depends on position-changing events for one symbol.
        # Cash ledger entries do not affect shares held, so we keep the same corp->trade
        # ordering as full replay without pulling unrelated cash events into this path.
        event_priority = {"corp": 1, "trade": 2}
        events.sort(key=lambda item: (item[1], event_priority[item[0]], item[2]))

        quantity_held = 0.0
        for event_type, event_date, _, event in events:
            if event_type == "corp":
                action_type = (event.action_type or "").strip().lower()
                if action_type != "split_adjustment":
                    continue
                split_ratio = float(event.split_ratio or 0.0)
                if split_ratio <= 0:
                    raise ValueError(f"Invalid split_ratio for {key[0]}")
                if abs(split_ratio - 1.0) <= EPS:
                    continue
                quantity_held *= split_ratio
                continue

            qty = float(event.quantity or 0.0)
            if qty <= 0:
                raise ValueError(f"Invalid trade quantity for {key[0]}")
            side = (event.side or "").strip().lower()
            if side == "buy":
                quantity_held += qty
                continue
            if side != "sell":
                raise ValueError(f"Unsupported trade side: {event.side}")
            if quantity_held + EPS < qty:
                raise PortfolioOversellError(
                    symbol=key[0],
                    trade_date=event_date,
                    requested_quantity=qty,
                    available_quantity=quantity_held,
                )
            quantity_held -= qty
            if quantity_held <= EPS:
                quantity_held = 0.0

        return quantity_held

    def _validate_advisory_product_type_consistency(
        self,
        *,
        account_id: int,
        platform: str,
        product_code: Optional[str],
        product_name: str,
        currency: str,
        product_type: str,
    ) -> None:
        for row in self.repo.list_advisory_ledger(account_id, as_of=date.max):
            row_code = (row.product_code or "").strip().upper() or None
            row_platform = str(row.platform or "").strip()
            row_name = str(row.product_name or "").strip()
            row_currency = self._normalize_currency(row.currency)
            same_product = row_currency == currency and (
                (product_code and row_code == product_code)
                or (not product_code and not row_code and row_platform == platform and row_name == product_name)
            )
            if same_product and self._normalize_advisory_product_type(
                getattr(row, "product_type", None) or "advisory_combo"
            ) != product_type:
                raise ValueError("product_type cannot change for an existing advisory product")

    def _replay_account(
        self,
        *,
        account: Any,
        as_of_date: date,
        cost_method: str,
        refresh_prices: bool,
    ) -> Dict[str, Any]:
        trades = self.repo.list_trades(account.id, as_of=as_of_date)
        cash_ledger = self.repo.list_cash_ledger(account.id, as_of=as_of_date)
        corporate_actions = self.repo.list_corporate_actions(account.id, as_of=as_of_date)
        bank_ledger = self.repo.list_bank_ledger(account.id, as_of=as_of_date) if account.market == "bank" else []
        advisory_ledger = (
            self.repo.list_advisory_ledger(account.id, as_of=as_of_date) if account.market == "advisory" else []
        )
        advisory_value_updates = (
            self.repo.list_manual_prices(account_id=account.id, market="advisory", as_of=as_of_date)
            if account.market == "advisory"
            else []
        )
        bank_value_updates = (
            self.repo.list_manual_prices(account_id=account.id, market="bank", as_of=as_of_date)
            if account.market == "bank"
            else []
        )
        insurance_policies = (
            self.repo.list_insurance_policies(account.id, as_of=as_of_date) if account.market == "insurance" else []
        )
        insurance_ledger = (
            self.repo.list_insurance_ledger(account.id, as_of=as_of_date) if account.market == "insurance" else []
        )

        events = []
        for row in cash_ledger:
            events.append(("cash", row.event_date, row.id, row))
        for row in trades:
            events.append(("trade", row.trade_date, row.id, row))
        for row in corporate_actions:
            events.append(("corp", row.effective_date, row.id, row))
        for row in bank_ledger:
            events.append(("bank", row.event_date, row.id, row))
        for row in bank_value_updates:
            events.append(("bank_value", row.price_date, row.id, row))
        for row in advisory_ledger:
            events.append(("advisory", row.event_date, row.id, row))
        for row in advisory_value_updates:
            events.append(("advisory_value", row.price_date, row.id, row))
        for row in insurance_ledger:
            events.append(("insurance", row.event_date, row.id, row))

        # Same-day deterministic ordering: cash -> corporate action -> trade.
        event_priority = {
            "cash": 0,
            "bank": 0,
            "bank_value": 0.5,
            "advisory": 0,
            "advisory_value": 0.5,
            "insurance": 0,
            "corp": 1,
            "trade": 2,
        }
        events.sort(key=lambda item: (item[1], event_priority[item[0]], item[2]))

        cash_balances: Dict[str, float] = defaultdict(float)
        fees_total_base = 0.0
        taxes_total_base = 0.0
        realized_pnl_base = 0.0
        fx_stale = False
        position_cashflows: Dict[str, List[_AnnualizedCashFlow]] = defaultdict(list)
        cash_tracking_mode = self._account_cash_tracking_mode(account)
        tracks_asset_cash = cash_tracking_mode == "managed"

        fifo_lots: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
        avg_state: Dict[Tuple[str, str, str], _AvgState] = defaultdict(_AvgState)
        bank_assets: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
        advisory_assets: Dict[Tuple[str, str], Dict[str, Any]] = {}
        insurance_assets: Dict[int, Dict[str, Any]] = {}

        for policy in insurance_policies:
            policy_id = int(policy.id)
            insurance_assets[policy_id] = {
                "symbol": f"INS:{policy_id}",
                "display_name": policy.policy_name,
                "market": "insurance",
                "currency": self._normalize_currency(policy.currency or account.base_currency),
                "policy_id": policy_id,
                "policy_name": policy.policy_name,
                "insurer": policy.insurer,
                "policy_no": policy.policy_no,
                "insurance_kind": policy.insurance_kind,
                "design_type": policy.design_type,
                "policy_status": policy.status,
                "payment_mode": policy.payment_mode,
                "premium_per_period": policy.premium_per_period,
                "first_payment_date": policy.first_payment_date.isoformat() if policy.first_payment_date else None,
                "total_periods": policy.total_periods,
                "paid_periods": 0,
                "paid_premium": 0.0,
                "received_amount": 0.0,
                "cash_value": None,
                "value_date": None,
                "terminal": str(policy.status or "").strip().lower() in {"surrendered", "matured", "expired", "cancelled"},
                "quantity": 1.0,
                "avg_cost": 0.0,
                "total_cost": 0.0,
                "last_price": 0.0,
                "market_value_base": 0.0,
                "unrealized_pnl_base": 0.0,
                "unrealized_pnl_pct": None,
                "valuation_currency": account.base_currency,
                "price_source": "insurance_no_value",
                "price_provider": "insurance_ledger",
                "price_date": None,
                "price_stale": True,
                "price_available": True,
                "value_estimated": True,
            }

        for event_type, event_date, _, event in events:
            if event_type == "insurance":
                policy_id = int(event.policy_id)
                item = insurance_assets.get(policy_id)
                if item is None:
                    continue
                currency = self._normalize_currency(event.currency or item["currency"])
                amount = float(event.amount or 0.0)
                insurance_event_type = self._normalize_insurance_event_type(event.event_type)
                item["currency"] = currency
                if insurance_event_type == "value_update":
                    item["cash_value"] = amount
                    item["value_date"] = event_date
                    item["price_date"] = event_date.isoformat()
                    item["price_source"] = "insurance_value_update"
                    item["price_provider"] = "insurance_ledger"
                    item["price_stale"] = event_date < as_of_date
                    item["price_available"] = True
                    item["value_estimated"] = False
                    continue
                if insurance_event_type in INSURANCE_OUTFLOW_EVENTS:
                    if tracks_asset_cash:
                        cash_balances[currency] -= amount
                    if insurance_event_type == "premium":
                        item["paid_premium"] += amount
                        if event.period_no is not None:
                            item["paid_periods"] = max(int(item["paid_periods"] or 0), int(event.period_no or 0))
                        else:
                            item["paid_periods"] = int(item["paid_periods"] or 0) + 1
                        product_key = self._make_product_key(
                            market="insurance",
                            symbol=str(item.get("symbol") or ""),
                            currency=currency,
                            item=item,
                        )
                        position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, -amount, currency))
                    continue
                if insurance_event_type in INSURANCE_RETURN_EVENTS:
                    if tracks_asset_cash:
                        cash_balances[currency] += amount
                    item["received_amount"] += amount
                    product_key = self._make_product_key(
                        market="insurance",
                        symbol=str(item.get("symbol") or ""),
                        currency=currency,
                        item=item,
                    )
                    position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, amount, currency))
                    if insurance_event_type in INSURANCE_TERMINAL_EVENTS:
                        item["terminal"] = True
                        item["policy_status"] = "surrendered" if insurance_event_type == "surrender" else "matured"
                    continue

            if event_type == "advisory":
                currency = self._normalize_currency(event.currency)
                amount = float(event.amount or 0.0)
                if amount <= 0:
                    raise ValueError(f"Invalid advisory ledger amount for {event.product_name}")
                advisory_event_type = self._normalize_advisory_event_type(event.direction)
                product_type = self._normalize_advisory_product_type(
                    getattr(event, "product_type", None) or "advisory_combo"
                )
                self._validate_advisory_event_for_product(product_type, advisory_event_type)
                product_code = str(event.product_code or "").strip().upper()
                platform = str(event.platform or "").strip()
                product_name = str(event.product_name or "").strip()
                symbol = self._make_advisory_symbol(product_code or f"{platform}:{product_name}")
                key = (symbol, currency)
                item = advisory_assets.setdefault(
                    key,
                    {
                        "symbol": symbol,
                        "display_name": product_name or symbol,
                        "market": "advisory",
                        "currency": currency,
                        "platform": platform,
                        "product_name": product_name,
                        "product_code": product_code or None,
                        "product_type": product_type,
                        "product_type_label": ADVISORY_PRODUCT_TYPE_LABELS.get(product_type, "投顾组合"),
                        "risk_level": event.risk_level,
                        "investment_style": event.investment_style,
                        "invested_amount": 0.0,
                        "redeemed_amount": 0.0,
                        "value_amount": 0.0,
                        "quantity": 1.0,
                        "avg_cost": 0.0,
                        "total_cost": 0.0,
                        "last_price": 0.0,
                        "market_value_base": 0.0,
                        "unrealized_pnl_base": 0.0,
                        "unrealized_pnl_pct": None,
                        "valuation_currency": account.base_currency,
                        "price_source": "advisory_net_invested_estimate",
                        "price_provider": "advisory_ledger",
                        "price_date": event_date.isoformat(),
                        "price_stale": event_date < as_of_date,
                        "price_available": True,
                        "value_estimated": True,
                    },
                )
                if item.get("product_type") != product_type:
                    raise ValueError(f"product_type cannot change for advisory product {product_name}")
                current_value = float(item["value_amount"] or 0.0)
                if advisory_event_type in ADVISORY_BUY_EVENTS:
                    if tracks_asset_cash:
                        cash_balances[currency] -= amount
                    product_key = self._make_product_key(
                        market="advisory",
                        symbol=symbol,
                        currency=currency,
                        item=item,
                    )
                    position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, -amount, currency))
                    item["invested_amount"] = float(item["invested_amount"] or 0.0) + amount
                    item["value_amount"] = current_value + amount
                    item["price_date"] = event_date.isoformat()
                    item["price_stale"] = event_date < as_of_date
                    if event.risk_level:
                        item["risk_level"] = event.risk_level
                    if event.investment_style:
                        item["investment_style"] = event.investment_style
                    continue
                if tracks_asset_cash:
                    cash_balances[currency] += amount
                product_key = self._make_product_key(
                    market="advisory",
                    symbol=symbol,
                    currency=currency,
                    item=item,
                )
                position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, amount, currency))
                item["redeemed_amount"] = float(item["redeemed_amount"] or 0.0) + amount
                item["value_amount"] = max(0.0, current_value - amount)
                item["price_date"] = event_date.isoformat()
                item["price_stale"] = event_date < as_of_date
                continue

            if event_type == "advisory_value":
                value_amount = max(0.0, float(event.price or 0.0))
                symbol = self._normalize_symbol_for_position(str(event.symbol or "").strip())
                currency = self._normalize_currency(event.currency)
                item = advisory_assets.get((symbol, currency))
                if item is None:
                    continue
                item["value_amount"] = value_amount
                item["last_price"] = value_amount
                item["price_source"] = "advisory_value_update"
                item["price_provider"] = "manual_price"
                item["price_date"] = event_date.isoformat()
                item["price_stale"] = event_date < as_of_date
                item["price_available"] = True
                item["value_estimated"] = False
                continue

            if event_type == "bank":
                currency = self._normalize_currency(event.currency)
                amount = float(event.amount or 0.0)
                signed_amount = amount if event.direction == "in" else -amount
                if event.direction not in VALID_CASH_DIRECTIONS:
                    raise ValueError(f"Unsupported bank ledger direction: {event.direction}")
                asset_kind = self._normalize_bank_asset_kind(event.asset_kind)
                if asset_kind == "demand":
                    cash_balances[currency] += signed_amount
                    continue
                if tracks_asset_cash:
                    cash_balances[currency] -= signed_amount
                if asset_kind == "deposit":
                    lot_id = int(event.linked_entry_id or event.id)
                    key = ("deposit", lot_id) if event.direction == "in" or event.linked_entry_id else (
                        "deposit",
                        str(event.bank_name or "").strip(),
                        str(event.product_name or "").strip(),
                        currency,
                        event.start_date,
                        event.maturity_date,
                        float(event.annual_rate or 0.0),
                    )
                    bank_name = str(event.bank_name or "").strip()
                    product_name = str(event.product_name or "").strip()
                    start = event.start_date
                    maturity = event.maturity_date
                    annual_rate = float(event.annual_rate or 0.0)
                    item = bank_assets.setdefault(
                        key,
                        {
                            "symbol": f"BANK:D:{lot_id}",
                            "display_name": product_name or bank_name or None,
                            "market": "bank",
                            "currency": currency,
                            "bank_name": bank_name,
                            "product_name": product_name,
                            "linked_entry_id": lot_id,
                            "start_date": start.isoformat() if start else None,
                            "maturity_date": maturity.isoformat() if maturity else None,
                            "annual_rate": annual_rate,
                            "quantity": 1.0,
                            "avg_cost": 0.0,
                            "total_cost": 0.0,
                            "last_price": 0.0,
                            "market_value_base": 0.0,
                            "unrealized_pnl_base": 0.0,
                            "unrealized_pnl_pct": None,
                            "valuation_currency": account.base_currency,
                            "price_source": "manual_amount",
                            "price_provider": "bank_ledger",
                            "price_date": event_date.isoformat(),
                            "price_stale": False,
                            "price_available": True,
                        },
                    )
                    item["last_price"] += signed_amount
                    item["total_cost"] += signed_amount
                    item["market_value_base"] += signed_amount
                    if event.direction == "out" and float(item["last_price"] or 0.0) < -EPS:
                        raise PortfolioOversellError(
                            symbol=item["symbol"],
                            trade_date=event_date,
                            requested_quantity=amount,
                            available_quantity=amount + float(item["last_price"] or 0.0),
                        )
                if asset_kind == "wealth":
                    lot_id = int(event.linked_entry_id or event.id)
                    symbol = self._make_bank_wealth_symbol(lot_id)
                    registration_code = str(event.registration_code or "").strip().upper()
                    product_code = str(getattr(event, "product_code", "") or "").strip().upper()
                    product_public_code = str(getattr(event, "product_public_code", "") or "").strip().upper()
                    key = ("wealth", lot_id, currency)
                    item = bank_assets.setdefault(
                        key,
                        {
                            "symbol": symbol,
                            "display_name": str(event.product_name or "").strip() or registration_code or symbol,
                            "market": "bank",
                            "currency": currency,
                            "bank_name": str(event.bank_name or "").strip(),
                            "product_name": str(event.product_name or "").strip() or None,
                            "product_code": product_code or None,
                            "product_public_code": product_public_code or None,
                            "issuer_name": str(getattr(event, "issuer_name", "") or "").strip() or None,
                            "registration_code": registration_code or None,
                            "linked_entry_id": lot_id,
                            "start_date": event.start_date.isoformat() if event.start_date else None,
                            "maturity_date": event.maturity_date.isoformat() if event.maturity_date else None,
                            "investment_nature": event.investment_nature,
                            "risk_level": event.risk_level,
                            "income_mode": event.income_mode,
                            "invested_amount": 0.0,
                            "redeemed_amount": 0.0,
                            "value_amount": 0.0,
                            "wealth_units": 0.0,
                            "quantity": 0.0,
                            "avg_cost": 0.0,
                            "total_cost": 0.0,
                            "last_price": 0.0,
                            "market_value_base": 0.0,
                            "unrealized_pnl_base": 0.0,
                            "unrealized_pnl_pct": None,
                            "valuation_currency": account.base_currency,
                            "price_source": "bank_net_invested_estimate",
                            "price_provider": "bank_ledger",
                            "price_date": event_date.isoformat(),
                            "price_stale": event_date < as_of_date,
                            "price_available": True,
                            "value_estimated": True,
                        },
                    )
                    current_value = float(item["value_amount"] or 0.0)
                    current_units = float(item.get("wealth_units") or 0.0)
                    unit_nav = float(getattr(event, "unit_nav", None) or 0.0)
                    event_units = float(event.quantity or 0.0)
                    if event.direction == "in" and event_units <= EPS and unit_nav > EPS:
                        event_units = amount / unit_nav
                    if event.direction == "out" and event_units <= EPS and unit_nav > EPS:
                        event_units = min(current_units, amount / unit_nav)
                    if event.direction == "out" and unit_nav > EPS and current_units > EPS:
                        current_value = current_units * unit_nav
                        item["value_amount"] = current_value
                        item["last_price"] = unit_nav
                        item["price_source"] = "bank_wealth_nav"
                        item["price_provider"] = "iwencai"
                        item["price_date"] = (
                            getattr(event, "nav_date", None).isoformat()
                            if getattr(event, "nav_date", None)
                            else event_date.isoformat()
                        )
                        item["value_estimated"] = False
                    if event.direction == "out" and amount - current_value > EPS:
                        raise PortfolioOversellError(
                            symbol=symbol,
                            trade_date=event_date,
                            requested_quantity=amount,
                            available_quantity=current_value,
                        )
                    if event.direction == "in":
                        product_key = self._make_product_key(
                            market="bank",
                            symbol=str(item.get("symbol") or ""),
                            currency=currency,
                            item=item,
                        )
                        position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, -amount, currency))
                        item["invested_amount"] = float(item["invested_amount"] or 0.0) + amount
                        item["value_amount"] = current_value + amount
                        item["wealth_units"] = current_units + max(0.0, event_units)
                        item["quantity"] = item["wealth_units"]
                        if unit_nav > EPS:
                            item["last_price"] = unit_nav
                            item["price_source"] = "bank_wealth_nav"
                            item["price_provider"] = "iwencai"
                            item["price_date"] = (
                                getattr(event, "nav_date", None).isoformat()
                                if getattr(event, "nav_date", None)
                                else event_date.isoformat()
                            )
                            item["value_amount"] = float(item["wealth_units"] or 0.0) * unit_nav
                            item["value_estimated"] = False
                        if product_code:
                            item["product_code"] = product_code
                        if product_public_code:
                            item["product_public_code"] = product_public_code
                        issuer_name = str(getattr(event, "issuer_name", "") or "").strip()
                        if issuer_name:
                            item["issuer_name"] = issuer_name
                        if registration_code:
                            item["registration_code"] = registration_code
                        if event.investment_nature:
                            item["investment_nature"] = event.investment_nature
                        if event.risk_level:
                            item["risk_level"] = event.risk_level
                        if event.income_mode:
                            item["income_mode"] = event.income_mode
                    else:
                        product_key = self._make_product_key(
                            market="bank",
                            symbol=str(item.get("symbol") or ""),
                            currency=currency,
                            item=item,
                        )
                        position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, amount, currency))
                        item["redeemed_amount"] = float(item["redeemed_amount"] or 0.0) + amount
                        item["value_amount"] = max(0.0, current_value - amount)
                        item["wealth_units"] = max(0.0, current_units - max(0.0, event_units))
                        item["quantity"] = item["wealth_units"]
                    if unit_nav <= EPS:
                        item["price_date"] = event_date.isoformat()
                    item["price_stale"] = event_date < as_of_date
                    continue
                continue

            if event_type == "bank_value":
                symbol = self._normalize_symbol_for_position(str(event.symbol or "").strip())
                currency = self._normalize_currency(event.currency)
                lot_id = self._parse_bank_wealth_symbol(symbol)
                if lot_id is None:
                    continue
                item = bank_assets.get(("wealth", lot_id, currency))
                if item is None:
                    continue
                value_amount = max(0.0, float(event.price or 0.0))
                units = float(item.get("wealth_units") or item.get("quantity") or 0.0)
                item["value_amount"] = value_amount
                item["last_price"] = value_amount / units if units > EPS else value_amount
                item["price_source"] = "bank_value_update"
                item["price_provider"] = "manual_price"
                item["price_date"] = event_date.isoformat()
                item["price_stale"] = event_date < as_of_date
                item["price_available"] = True
                item["value_estimated"] = False
                continue

            if event_type == "cash":
                currency = self._normalize_currency(event.currency)
                amount = float(event.amount or 0.0)
                if event.direction == "in":
                    cash_balances[currency] += amount
                elif event.direction == "out":
                    cash_balances[currency] -= amount
                else:
                    raise ValueError(f"Unsupported cash direction: {event.direction}")
                continue

            if event_type == "trade":
                key = (
                    self._normalize_symbol_for_position(event.symbol),
                    self._normalize_market(event.market),
                    self._normalize_currency(event.currency),
                )
                qty = float(event.quantity or 0.0)
                price = float(event.price or 0.0)
                fee = float(event.fee or 0.0)
                tax = float(event.tax or 0.0)
                if qty <= 0 or price <= 0:
                    raise ValueError(f"Invalid trade quantity or price for {event.symbol}")

                gross = qty * price
                side = (event.side or "").lower().strip()
                if side == "buy":
                    cash_balances[key[2]] -= (gross + fee + tax)
                    product_key = self._make_product_key(
                        market=key[1],
                        symbol=key[0],
                        currency=key[2],
                        item=None,
                    )
                    position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, -(gross + fee + tax), key[2]))
                    if cost_method == "fifo":
                        unit_cost = (gross + fee + tax) / qty
                        fifo_lots[key].append(
                            {
                                "symbol": key[0],
                                "market": key[1],
                                "currency": key[2],
                                "open_date": event_date,
                                "remaining_quantity": qty,
                                "unit_cost": unit_cost,
                                "source_trade_id": event.id,
                            }
                        )
                    else:
                        state = avg_state[key]
                        state.quantity += qty
                        state.total_cost += (gross + fee + tax)
                elif side == "sell":
                    cash_balances[key[2]] += (gross - fee - tax)
                    proceeds_net = gross - fee - tax
                    product_key = self._make_product_key(
                        market=key[1],
                        symbol=key[0],
                        currency=key[2],
                        item=None,
                    )
                    position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, proceeds_net, key[2]))
                    if cost_method == "fifo":
                        cost_basis = self._consume_fifo_lots(
                            fifo_lots[key],
                            qty,
                            key[0],
                            event_date,
                        )
                    else:
                        cost_basis = self._consume_avg_position(
                            avg_state[key],
                            qty,
                            key[0],
                            event_date,
                        )
                    realized_local = proceeds_net - cost_basis
                    realized_conversion = self._convert_amount(
                        amount=realized_local,
                        from_currency=key[2],
                        to_currency=account.base_currency,
                        as_of_date=event_date,
                    )
                    if realized_conversion.amount is not None:
                        realized_pnl_base += realized_conversion.amount
                    fx_stale = fx_stale or realized_conversion.is_stale
                else:
                    raise ValueError(f"Unsupported trade side: {event.side}")

                fee_conversion = self._convert_amount(
                    amount=fee,
                    from_currency=key[2],
                    to_currency=account.base_currency,
                    as_of_date=event_date,
                )
                tax_conversion = self._convert_amount(
                    amount=tax,
                    from_currency=key[2],
                    to_currency=account.base_currency,
                    as_of_date=event_date,
                )
                if fee_conversion.amount is not None:
                    fees_total_base += fee_conversion.amount
                if tax_conversion.amount is not None:
                    taxes_total_base += tax_conversion.amount
                fx_stale = fx_stale or fee_conversion.is_stale or tax_conversion.is_stale
                continue

            if event_type == "corp":
                key = (
                    self._normalize_symbol_for_position(event.symbol),
                    self._normalize_market(event.market),
                    self._normalize_currency(event.currency),
                )
                action_type = (event.action_type or "").strip().lower()
                if action_type == "cash_dividend":
                    per_share = float(event.cash_dividend_per_share or 0.0)
                    if per_share <= 0:
                        continue
                    qty_held = self._held_quantity(
                        key=key,
                        cost_method=cost_method,
                        fifo_lots=fifo_lots,
                        avg_state=avg_state,
                    )
                    if qty_held > EPS:
                        cash_balances[key[2]] += qty_held * per_share
                        product_key = self._make_product_key(
                            market=key[1],
                            symbol=key[0],
                            currency=key[2],
                            item=None,
                        )
                        position_cashflows[product_key].append(_AnnualizedCashFlow(event_date, qty_held * per_share, key[2]))
                elif action_type == "split_adjustment":
                    split_ratio = float(event.split_ratio or 0.0)
                    if split_ratio <= 0:
                        raise ValueError(f"Invalid split_ratio for {event.symbol}")
                    if abs(split_ratio - 1.0) <= EPS:
                        continue
                    if cost_method == "fifo":
                        for lot in fifo_lots[key]:
                            lot["remaining_quantity"] *= split_ratio
                            lot["unit_cost"] /= split_ratio
                    else:
                        state = avg_state[key]
                        state.quantity *= split_ratio
                else:
                    raise ValueError(f"Unsupported corporate action type: {event.action_type}")

        position_rows, lot_rows, market_value_base, total_cost_base, stale_pos = self._build_positions(
            account=account,
            as_of_date=as_of_date,
            cost_method=cost_method,
            fifo_lots=fifo_lots,
            avg_state=avg_state,
            refresh_prices=refresh_prices,
        )
        fx_stale = fx_stale or stale_pos

        bank_position_rows: List[Dict[str, Any]] = []
        for item in bank_assets.values():
            if self._parse_bank_wealth_symbol(str(item.get("symbol") or "")) is not None:
                invested_amount = float(item.get("invested_amount") or 0.0)
                redeemed_amount = float(item.get("redeemed_amount") or 0.0)
                value_amount = max(0.0, float(item.get("value_amount") or 0.0))
                units = float(item.get("wealth_units") or item.get("quantity") or 0.0)
                if value_amount <= EPS and units <= EPS:
                    continue
                if refresh_prices and units > EPS:
                    latest_price = self._fetch_bank_wealth_nav(
                        product_identifier=(
                            str(item.get("product_code") or "")
                            or str(item.get("product_public_code") or "")
                            or str(item.get("product_name") or "")
                        ),
                        as_of_date=as_of_date,
                    )
                    if (
                        latest_price is not None
                        and latest_price.price > EPS
                        and self._should_apply_bank_wealth_nav(current_item=item, latest_price=latest_price)
                    ):
                        value_amount = units * latest_price.price
                        item["value_amount"] = value_amount
                        item["last_price"] = latest_price.price
                        item["price_source"] = "bank_wealth_nav"
                        item["price_provider"] = latest_price.provider
                        item["price_date"] = latest_price.price_date.isoformat() if latest_price.price_date else None
                        item["price_stale"] = latest_price.is_stale
                        item["price_available"] = latest_price.is_available
                        item["value_estimated"] = False
                market_conversion = self._convert_amount(
                    amount=value_amount,
                    from_currency=item["currency"],
                    to_currency=account.base_currency,
                    as_of_date=as_of_date,
                )
                cost_conversion = self._convert_amount(
                    amount=invested_amount,
                    from_currency=item["currency"],
                    to_currency=account.base_currency,
                    as_of_date=as_of_date,
                )
                redeemed_conversion = self._convert_amount(
                    amount=redeemed_amount,
                    from_currency=item["currency"],
                    to_currency=account.base_currency,
                    as_of_date=as_of_date,
                )
                market_base = market_conversion.amount
                cost_base = cost_conversion.amount
                redeemed_base = redeemed_conversion.amount
                fx_stale = fx_stale or market_conversion.is_stale or cost_conversion.is_stale or redeemed_conversion.is_stale
                unrealized_base = (
                    (market_base or 0.0) + (redeemed_base or 0.0) - (cost_base or 0.0)
                    if market_base is not None and cost_base is not None and redeemed_base is not None
                    else 0.0
                )
                item["quantity"] = round(units, 8) if units > EPS else 1.0
                item["product_key"] = self._make_product_key(
                    market="bank",
                    symbol=str(item.get("symbol") or ""),
                    currency=item["currency"],
                    item=item,
                )
                item["total_cost"] = round(invested_amount, 8)
                item["avg_cost"] = round((invested_amount / units), 8) if units > EPS else round(invested_amount, 8)
                item["market_value_base"] = round(market_base or 0.0, 8)
                item["unrealized_pnl_base"] = round(unrealized_base, 8)
                item["unrealized_pnl_pct"] = (
                    round((unrealized_base / cost_base) * 100, 8) if cost_base and market_base is not None else None
                )
                if units <= EPS or float(item.get("last_price") or 0.0) <= EPS:
                    item["last_price"] = round(value_amount, 8)
                item["invested_amount"] = round(invested_amount, 8)
                item["redeemed_amount"] = round(redeemed_amount, 8)
                item["value_amount"] = round(value_amount, 8)
                self._apply_position_display_metrics(item, valuation_model="unit_nav")
                bank_position_rows.append(item)
                if market_base is not None:
                    market_value_base += market_base
                if market_base is not None:
                    total_cost_base += market_base - unrealized_base
                continue

            amount_local = float(item["last_price"] or 0.0)
            if abs(amount_local) <= EPS:
                continue
            market_conversion = self._convert_amount(
                amount=amount_local,
                from_currency=item["currency"],
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            market_base = market_conversion.amount
            fx_stale = fx_stale or market_conversion.is_stale
            item["total_cost"] = round(amount_local, 8)
            item["product_key"] = self._make_product_key(
                market="bank",
                symbol=str(item.get("symbol") or ""),
                currency=item["currency"],
                item=item,
            )
            item["avg_cost"] = round(amount_local, 8)
            item["market_value_base"] = round(market_base or 0.0, 8)
            item["last_price"] = round(amount_local, 8)
            self._apply_position_display_metrics(item, valuation_model="amount_value")
            bank_position_rows.append(item)
            if market_base is not None:
                market_value_base += market_base
                total_cost_base += market_base
        position_rows.extend(bank_position_rows)

        advisory_position_rows: List[Dict[str, Any]] = []
        for item in advisory_assets.values():
            invested_amount = float(item.get("invested_amount") or 0.0)
            redeemed_amount = float(item.get("redeemed_amount") or 0.0)
            value_amount = max(0.0, float(item.get("value_amount") or 0.0))
            if value_amount <= EPS and invested_amount <= EPS and redeemed_amount <= EPS:
                continue
            market_local = value_amount
            market_conversion = self._convert_amount(
                amount=market_local,
                from_currency=item["currency"],
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            cost_conversion = self._convert_amount(
                amount=invested_amount,
                from_currency=item["currency"],
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            redeemed_conversion = self._convert_amount(
                amount=redeemed_amount,
                from_currency=item["currency"],
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            market_base = market_conversion.amount
            cost_base = cost_conversion.amount
            redeemed_base = redeemed_conversion.amount
            fx_stale = fx_stale or market_conversion.is_stale or cost_conversion.is_stale or redeemed_conversion.is_stale
            unrealized_base = (
                (market_base or 0.0) + (redeemed_base or 0.0) - (cost_base or 0.0)
                if market_base is not None and cost_base is not None and redeemed_base is not None
                else 0.0
            )
            item["quantity"] = 1.0
            item["product_key"] = self._make_product_key(
                market="advisory",
                symbol=str(item.get("symbol") or ""),
                currency=item["currency"],
                item=item,
            )
            item["total_cost"] = round(invested_amount, 8)
            item["avg_cost"] = round(invested_amount, 8)
            item["market_value_base"] = round(market_base or 0.0, 8)
            item["unrealized_pnl_base"] = round(unrealized_base, 8)
            item["unrealized_pnl_pct"] = (
                round((unrealized_base / cost_base) * 100, 8) if cost_base and market_base is not None else None
            )
            item["last_price"] = round(value_amount, 8)
            item["invested_amount"] = round(invested_amount, 8)
            item["redeemed_amount"] = round(redeemed_amount, 8)
            item["value_amount"] = round(value_amount, 8)
            self._apply_position_display_metrics(item, valuation_model="amount_value")
            advisory_position_rows.append(item)
            if market_base is not None:
                market_value_base += market_base
                total_cost_base += market_base - unrealized_base
        position_rows.extend(advisory_position_rows)

        insurance_position_rows: List[Dict[str, Any]] = []
        for item in insurance_assets.values():
            paid_premium = float(item.get("paid_premium") or 0.0)
            received_amount = float(item.get("received_amount") or 0.0)
            cash_value = item.get("cash_value")
            estimated_value = max(0.0, paid_premium - received_amount) if cash_value is None else float(cash_value or 0.0)
            if bool(item.get("terminal")):
                estimated_value = 0.0
            if cash_value is None and paid_premium > EPS:
                item["price_source"] = "insurance_net_invested"
            market_conversion = self._convert_amount(
                amount=estimated_value,
                from_currency=item["currency"],
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            cost_conversion = self._convert_amount(
                amount=paid_premium,
                from_currency=item["currency"],
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            received_conversion = self._convert_amount(
                amount=received_amount,
                from_currency=item["currency"],
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            market_base = market_conversion.amount
            cost_base = cost_conversion.amount
            received_base = received_conversion.amount
            fx_stale = fx_stale or market_conversion.is_stale or cost_conversion.is_stale or received_conversion.is_stale
            unrealized_base = (
                (market_base or 0.0) + (received_base or 0.0) - (cost_base or 0.0)
                if cost_base is not None and market_base is not None and received_base is not None
                else 0.0
            )
            next_payment_date = self._calculate_next_insurance_payment_date(
                first_payment_date=item.get("first_payment_date"),
                payment_mode=str(item.get("payment_mode") or ""),
                paid_periods=int(item.get("paid_periods") or 0),
                total_periods=item.get("total_periods"),
            )
            item["quantity"] = 1.0
            item["product_key"] = self._make_product_key(
                market="insurance",
                symbol=str(item.get("symbol") or ""),
                currency=item["currency"],
                item=item,
            )
            item["avg_cost"] = round(paid_premium, 8)
            item["total_cost"] = round(paid_premium, 8)
            item["last_price"] = round(estimated_value, 8)
            item["market_value_base"] = round(market_base or 0.0, 8)
            item["unrealized_pnl_base"] = round(unrealized_base, 8)
            item["unrealized_pnl_pct"] = round((unrealized_base / cost_base) * 100, 8) if cost_base else None
            item["paid_premium"] = round(paid_premium, 8)
            item["received_amount"] = round(received_amount, 8)
            item["cash_value"] = round(float(cash_value), 8) if cash_value is not None else None
            item["value_date"] = item["value_date"].isoformat() if isinstance(item.get("value_date"), date) else item.get("value_date")
            item["next_payment_date"] = next_payment_date.isoformat() if next_payment_date else None
            self._apply_position_display_metrics(item, valuation_model="insurance_cash_value")
            insurance_position_rows.append(item)
            if market_base is not None:
                market_value_base += market_base
                total_cost_base += market_base - unrealized_base
        position_rows.extend(insurance_position_rows)

        self._apply_position_annualized_returns(
            position_rows=position_rows,
            position_cashflows=position_cashflows,
            account_currency=account.base_currency,
            as_of_date=as_of_date,
        )

        total_cash_base = 0.0
        for currency, amount in cash_balances.items():
            cash_conversion = self._convert_amount(
                amount=amount,
                from_currency=currency,
                to_currency=account.base_currency,
                as_of_date=as_of_date,
            )
            if cash_conversion.amount is not None:
                total_cash_base += cash_conversion.amount
            fx_stale = fx_stale or cash_conversion.is_stale

        unrealized_pnl_base = market_value_base - total_cost_base
        total_equity_base = total_cash_base + market_value_base

        account_payload = {
            "account_id": account.id,
            "account_name": account.name,
            "owner_id": account.owner_id,
            "broker": account.broker,
            "market": account.market,
            "base_currency": account.base_currency,
            "cash_tracking_mode": cash_tracking_mode,
            "snapshot_schema_version": PORTFOLIO_SNAPSHOT_SCHEMA_VERSION,
            "as_of": as_of_date.isoformat(),
            "cost_method": cost_method,
            "total_cash": round(total_cash_base, 6),
            "total_market_value": round(market_value_base, 6),
            "total_equity": round(total_equity_base, 6),
            "realized_pnl": round(realized_pnl_base, 6),
            "unrealized_pnl": round(unrealized_pnl_base, 6),
            "fee_total": round(fees_total_base, 6),
            "tax_total": round(taxes_total_base, 6),
            "fx_stale": fx_stale,
            "positions": position_rows,
        }

        return {
            "public": account_payload,
            "payload": account_payload,
            "positions_cache": position_rows,
            "lots_cache": lot_rows,
            "total_cash": float(total_cash_base),
            "total_market_value": float(market_value_base),
            "total_equity": float(total_equity_base),
            "realized_pnl": float(realized_pnl_base),
            "unrealized_pnl": float(unrealized_pnl_base),
            "fee_total": float(fees_total_base),
            "tax_total": float(taxes_total_base),
            "fx_stale": fx_stale,
        }

    def _build_positions(
        self,
        *,
        account: Any,
        as_of_date: date,
        cost_method: str,
        fifo_lots: Dict[Tuple[str, str, str], List[Dict[str, Any]]],
        avg_state: Dict[Tuple[str, str, str], _AvgState],
        refresh_prices: bool,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], float, float, bool]:
        position_rows: List[Dict[str, Any]] = []
        lot_rows: List[Dict[str, Any]] = []
        market_value_base = 0.0
        total_cost_base = 0.0
        fx_stale = False

        keys: Iterable[Tuple[str, str, str]]
        if cost_method == "fifo":
            keys = list(fifo_lots.keys())
        else:
            keys = list(avg_state.keys())

        for key in sorted(keys):
            symbol, market, currency = key

            if cost_method == "fifo":
                active_lots = [lot for lot in fifo_lots[key] if lot["remaining_quantity"] > EPS]
                qty = sum(float(lot["remaining_quantity"]) for lot in active_lots)
                if qty <= EPS:
                    continue
                total_cost = sum(float(lot["remaining_quantity"]) * float(lot["unit_cost"]) for lot in active_lots)
                avg_cost = total_cost / qty
                lot_rows.extend(active_lots)
            else:
                state = avg_state[key]
                qty = float(state.quantity)
                total_cost = float(state.total_cost)
                if qty <= EPS:
                    continue
                avg_cost = total_cost / qty
                lot_rows.append(
                    {
                        "symbol": symbol,
                        "market": market,
                        "currency": currency,
                        "open_date": as_of_date,
                        "remaining_quantity": qty,
                        "unit_cost": avg_cost,
                        "source_trade_id": None,
                    }
                )

            price_info = self._resolve_position_price(
                account_id=int(account.id),
                symbol=symbol,
                market=market,
                as_of_date=as_of_date,
                refresh_prices=refresh_prices,
            )
            last_price = price_info.price

            if price_info.is_available:
                local_market_value = qty * float(last_price)
                market_conversion = self._convert_amount(
                    amount=local_market_value,
                    from_currency=currency,
                    to_currency=account.base_currency,
                    as_of_date=as_of_date,
                )
                cost_conversion = self._convert_amount(
                    amount=total_cost,
                    from_currency=currency,
                    to_currency=account.base_currency,
                    as_of_date=as_of_date,
                )
                market_base = market_conversion.amount or 0.0
                cost_base = cost_conversion.amount or 0.0
                unrealized_base = market_base - cost_base if market_conversion.amount is not None and cost_conversion.amount is not None else 0.0
                fx_stale = fx_stale or market_conversion.is_stale or cost_conversion.is_stale
            else:
                market_base = 0.0
                cost_base = 0.0
                unrealized_base = 0.0

            unrealized_pct = None
            if abs(cost_base) > EPS:
                unrealized_pct = unrealized_base / cost_base * 100.0

            position_rows.append(
                self._with_display_metrics(
                    {
                        "symbol": symbol,
                        "product_key": self._make_product_key(
                            market=market,
                            symbol=symbol,
                            currency=currency,
                            item=None,
                        ),
                        "display_name": self._resolve_position_display_name(symbol=symbol, market=market),
                        "market": market,
                        "currency": currency,
                        "quantity": round(qty, 8),
                        "avg_cost": round(avg_cost, 8),
                        "total_cost": round(total_cost, 8),
                        "last_price": round(float(last_price), 8),
                        "market_value_base": round(market_base, 8),
                        "unrealized_pnl_base": round(unrealized_base, 8),
                        "unrealized_pnl_pct": round(unrealized_pct, 8) if unrealized_pct is not None else None,
                        "valuation_currency": account.base_currency,
                        "price_source": price_info.source,
                        "price_provider": price_info.provider,
                        "price_date": price_info.price_date.isoformat() if price_info.price_date else None,
                        "price_stale": price_info.is_stale,
                        "price_available": price_info.is_available,
                    },
                    valuation_model="unit_price",
                )
            )

            market_value_base += market_base
            total_cost_base += cost_base

        return position_rows, lot_rows, market_value_base, total_cost_base, fx_stale

    def _apply_product_tags(self, accounts_payload: List[Dict[str, Any]]) -> None:
        product_keys = [
            str(position.get("product_key") or "").strip()
            for account in accounts_payload
            for position in account.get("positions", [])
        ]
        tag_map = self.repo.get_product_tag_map(product_keys)
        for account in accounts_payload:
            for position in account.get("positions", []):
                product_key = str(position.get("product_key") or "").strip()
                tag = tag_map.get(product_key)
                position["tag_id"] = tag.get("tag_id") if tag else None
                position["tag_name"] = tag.get("tag_name") if tag else None
                position["tag_color"] = tag.get("tag_color") if tag else None

    @staticmethod
    def _build_tag_breakdown(*, accounts_payload: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        grouped: Dict[str, Dict[str, Any]] = {}
        for account in accounts_payload:
            for position in account.get("positions", []):
                value = float(position.get("market_value_base") or 0.0)
                if abs(value) <= EPS:
                    continue
                tag_id = position.get("tag_id")
                if tag_id is None:
                    key = "__untagged__"
                    label = "未定义"
                    color = "hsl(var(--muted-foreground))"
                else:
                    key = f"tag:{tag_id}"
                    label = str(position.get("tag_name") or "未命名标签")
                    color = str(position.get("tag_color") or "hsl(var(--primary))")
                item = grouped.setdefault(
                    key,
                    {
                        "key": key,
                        "tag_id": tag_id,
                        "tag_name": label,
                        "tag_color": color,
                        "amount": 0.0,
                    },
                )
                item["amount"] += value
        rows = list(grouped.values())
        rows.sort(key=lambda item: (-abs(float(item["amount"] or 0.0)), str(item["tag_name"])))
        for item in rows:
            item["amount"] = round(float(item["amount"] or 0.0), 6)
        return rows

    def _apply_position_annualized_returns(
        self,
        *,
        position_rows: List[Dict[str, Any]],
        position_cashflows: Dict[str, List[_AnnualizedCashFlow]],
        account_currency: str,
        as_of_date: date,
    ) -> None:
        for position in position_rows:
            product_key = str(position.get("product_key") or "").strip()
            flows = list(position_cashflows.get(product_key, []))
            market_value = float(position.get("market_value_base") or 0.0)
            if market_value > EPS:
                flows.append(_AnnualizedCashFlow(as_of_date, market_value, account_currency))
            annualized = self._calculate_annualized_return_pct(
                flows=flows,
                account_currency=account_currency,
                as_of_date=as_of_date,
            )
            position["annualized_return_pct"] = annualized

    @staticmethod
    def _apply_position_display_metrics(position: Dict[str, Any], *, valuation_model: str) -> None:
        position["valuation_model"] = valuation_model
        position["cost_display_value"] = round(float(position.get("avg_cost") or position.get("total_cost") or 0.0), 8)
        position["price_display_value"] = round(float(position.get("last_price") or 0.0), 8)

    @classmethod
    def _with_display_metrics(cls, position: Dict[str, Any], *, valuation_model: str) -> Dict[str, Any]:
        cls._apply_position_display_metrics(position, valuation_model=valuation_model)
        return position

    def _calculate_annualized_return_pct(
        self,
        *,
        flows: List[_AnnualizedCashFlow],
        account_currency: str,
        as_of_date: date,
    ) -> Optional[float]:
        converted: List[Tuple[date, float]] = []
        for flow in flows:
            if abs(flow.amount) <= EPS:
                continue
            conversion = self._convert_amount(
                amount=flow.amount,
                from_currency=flow.currency,
                to_currency=account_currency,
                as_of_date=min(flow.flow_date, as_of_date),
            )
            if conversion.amount is None:
                return None
            converted.append((flow.flow_date, float(conversion.amount)))

        if len(converted) < 2:
            return None
        if not any(amount > EPS for _, amount in converted) or not any(amount < -EPS for _, amount in converted):
            return None

        first_date = min(flow_date for flow_date, _ in converted)
        last_date = max(flow_date for flow_date, _ in converted)
        if (last_date - first_date).days < 1:
            return None

        def npv(rate: float) -> float:
            base = 1.0 + rate
            if base <= 0:
                return float("inf")
            total = 0.0
            for flow_date, amount in converted:
                years = (flow_date - first_date).days / 365.0
                total += amount / (base ** years)
            return total

        low = -0.9999
        high = 10.0
        low_value = npv(low)
        high_value = npv(high)
        expansion_count = 0
        while low_value * high_value > 0 and high < 1e12 and expansion_count < 40:
            high *= 2
            high_value = npv(high)
            expansion_count += 1
        if low_value * high_value > 0:
            return None

        for _ in range(100):
            mid = (low + high) / 2
            mid_value = npv(mid)
            if abs(mid_value) < 1e-7:
                return round(mid * 100.0, 8)
            if low_value * mid_value <= 0:
                high = mid
                high_value = mid_value
            else:
                low = mid
                low_value = mid_value
        return round(((low + high) / 2) * 100.0, 8)

    @classmethod
    def _make_product_key(
        cls,
        *,
        market: str,
        symbol: str,
        currency: str,
        item: Optional[Dict[str, Any]],
    ) -> str:
        market_norm = str(market or "").strip().lower()
        currency_norm = str(currency or "").strip().upper() or "CNY"
        symbol_norm = str(symbol or "").strip().upper()
        item = item or {}
        if market_norm == "advisory":
            product_code = str(item.get("product_code") or "").strip().upper()
            if product_code:
                return f"advisory:code:{product_code}:{currency_norm}"
            raw = "|".join(
                [
                    str(item.get("platform") or "").strip(),
                    str(item.get("product_name") or item.get("display_name") or symbol_norm).strip(),
                    str(item.get("product_type") or "").strip(),
                    currency_norm,
                ]
            )
            return f"advisory:hash:{cls._stable_digest(raw)}"
        if market_norm == "bank":
            product_code = str(item.get("product_code") or "").strip().upper()
            if product_code:
                return f"bank:wealth:code:{product_code}:{currency_norm}"
            raw = "|".join(
                [
                    str(item.get("bank_name") or "").strip(),
                    str(item.get("issuer_name") or "").strip(),
                    str(item.get("product_name") or item.get("display_name") or symbol_norm).strip(),
                    str(item.get("registration_code") or "").strip().upper(),
                    str(item.get("product_public_code") or "").strip().upper(),
                    str(item.get("linked_entry_id") or "").strip(),
                    currency_norm,
                ]
            )
            return f"bank:hash:{cls._stable_digest(raw)}"
        if market_norm == "insurance":
            raw = "|".join(
                [
                    str(item.get("policy_no") or "").strip().upper(),
                    str(item.get("insurer") or "").strip(),
                    str(item.get("policy_name") or item.get("display_name") or symbol_norm).strip(),
                    str(item.get("policy_id") or "").strip(),
                    currency_norm,
                ]
            )
            return f"insurance:hash:{cls._stable_digest(raw)}"
        return f"{market_norm}:{symbol_norm}:{currency_norm}"

    @staticmethod
    def _stable_digest(value: str) -> str:
        text = str(value or "").strip()
        return hashlib.sha1(text.encode("utf-8")).hexdigest()[:24]

    @lru_cache(maxsize=1024)
    def _resolve_position_display_name(self, *, symbol: str, market: str) -> Optional[str]:
        if market == "bank":
            return None
        raw_symbol = str(symbol or "").strip()
        if not raw_symbol:
            return None

        if market == "crypto":
            return raw_symbol.upper()
        if market == "fund":
            return None

        normalized = normalize_stock_code(raw_symbol)
        static_name = STOCK_NAME_MAP.get(normalized)
        if is_meaningful_stock_name(static_name, normalized):
            return static_name

        index_name = get_index_stock_name(normalized)
        if is_meaningful_stock_name(index_name, normalized):
            return index_name

        try:
            name = self._get_data_manager().get_stock_name(raw_symbol, allow_realtime=False)
        except Exception as exc:
            logger.debug("Resolve portfolio position display name failed for %s: %s", raw_symbol, exc)
            return None
        if is_meaningful_stock_name(name, normalized):
            return str(name)
        return None

    def _resolve_position_price(
        self,
        *,
        account_id: int,
        symbol: str,
        market: str,
        as_of_date: date,
        refresh_prices: bool,
    ) -> _ResolvedPositionPrice:
        today = date.today()

        if market == "fund":
            manual = self._get_manual_position_price(
                account_id=account_id,
                symbol=symbol,
                market=market,
                as_of_date=as_of_date,
            )
            if manual is not None and not refresh_prices:
                return manual
            if not refresh_prices:
                return _ResolvedPositionPrice(
                    price=0.0,
                    source="missing",
                    price_date=None,
                    is_stale=True,
                    is_available=False,
                )
            fund_price = self._fetch_fund_nav(symbol=symbol, as_of_date=as_of_date)
            if fund_price is not None:
                return fund_price
            if manual is not None:
                return manual
            return _ResolvedPositionPrice(
                price=0.0,
                source="missing",
                price_date=None,
                is_stale=True,
                is_available=False,
            )

        if market == "crypto":
            manual = self._get_manual_position_price(
                account_id=account_id,
                symbol=symbol,
                market=market,
                as_of_date=as_of_date,
            )
            if manual is not None and not refresh_prices:
                return manual
            if not refresh_prices:
                return _ResolvedPositionPrice(
                    price=0.0,
                    source="missing",
                    price_date=None,
                    is_stale=True,
                    is_available=False,
                )
            crypto_price = self._fetch_crypto_price(symbol=symbol, as_of_date=as_of_date)
            if crypto_price is not None:
                return crypto_price
            if manual is not None:
                return manual
            return _ResolvedPositionPrice(
                price=0.0,
                source="missing",
                price_date=None,
                is_stale=True,
                is_available=False,
            )

        close = self.repo.get_latest_close_with_date(symbol=symbol, as_of=as_of_date)
        if close is not None:
            close_price, close_date = close
            if close_price > 0:
                return _ResolvedPositionPrice(
                    price=float(close_price),
                    source="history_close",
                    price_date=close_date,
                    is_stale=close_date < as_of_date,
                    is_available=True,
                )

        if as_of_date == today and refresh_prices:
            realtime_price, provider = self._fetch_realtime_position_price(symbol)
            if realtime_price is not None and realtime_price > 0:
                return _ResolvedPositionPrice(
                    price=float(realtime_price),
                    source="realtime_quote",
                    price_date=today,
                    is_stale=False,
                    is_available=True,
                    provider=provider,
                )

        return _ResolvedPositionPrice(
            price=0.0,
            source="missing",
            price_date=None,
            is_stale=True,
            is_available=False,
        )

    def _get_manual_position_price(
        self,
        *,
        account_id: int,
        symbol: str,
        market: str,
        as_of_date: date,
    ) -> Optional[_ResolvedPositionPrice]:
        row = self.repo.get_latest_manual_price(
            account_id=account_id,
            symbol=symbol,
            market=market,
            as_of=as_of_date,
        )
        if row is None or float(row.price or 0.0) <= 0:
            return None
        return _ResolvedPositionPrice(
            price=float(row.price),
            source="manual_price",
            price_date=row.price_date,
            is_stale=row.price_date < as_of_date,
            is_available=True,
            provider="manual",
        )

    @staticmethod
    def _fetch_fund_nav(*, symbol: str, as_of_date: date) -> Optional[_ResolvedPositionPrice]:
        base_url = (getattr(get_config(), "tiantian_fund_api_base_url", "") or "").strip().rstrip("/")
        if not base_url:
            return None
        query = urlencode({"FCODE": symbol.strip(), "pageIndex": 1, "pagesize": 1})
        candidates = [f"{base_url}/fundMNHisNetList?{query}"]
        for url in candidates:
            try:
                response = requests.get(url, timeout=5)
                if response.status_code >= 400:
                    continue
                payload = response.json()
            except Exception:
                continue
            price, price_date = PortfolioService._extract_fund_nav_payload(payload)
            if price is not None and price > 0:
                return _ResolvedPositionPrice(
                    price=price,
                    source="fund_nav",
                    price_date=price_date,
                    is_stale=bool(price_date and price_date < as_of_date),
                    is_available=True,
                    provider="tiantianfund",
                )
        return None

    @staticmethod
    def _fetch_bank_wealth_nav(*, product_identifier: str, as_of_date: date) -> Optional[_ResolvedPositionPrice]:
        identifier = str(product_identifier or "").strip()
        if not identifier:
            return None
        try:
            from src.services.iwencai_wealth_client import IwencaiWealthClient, IwencaiWealthError

            if not IwencaiWealthClient.is_configured():
                return None
            nav = IwencaiWealthClient(timeout=8.0).get_latest_nav(identifier)
        except IwencaiWealthError:
            return None
        except Exception:
            return None
        if nav is None or nav.unit_nav <= 0:
            return None
        price_date = nav.nav_date or as_of_date
        return _ResolvedPositionPrice(
            price=float(nav.unit_nav),
            source="bank_wealth_nav",
            price_date=price_date,
            is_stale=price_date < as_of_date,
            is_available=True,
            provider="iwencai",
        )

    @staticmethod
    def _extract_fund_nav_payload(payload: Any) -> Tuple[Optional[float], Optional[date]]:
        stack = [payload]
        while stack:
            item = stack.pop(0)
            if isinstance(item, list):
                stack.extend(item[:5])
                continue
            if not isinstance(item, dict):
                continue
            price = None
            for key in ("nav", "dwjz", "DWJZ", "netWorth", "net_worth", "unit_nav", "jz"):
                value = item.get(key)
                try:
                    price = float(value)
                    break
                except (TypeError, ValueError):
                    continue
            price_date = None
            for key in ("date", "jzrq", "JZRQ", "FSRQ", "navDate", "netWorthDate", "price_date"):
                raw = item.get(key)
                if not raw:
                    continue
                text = str(raw).strip()[:10]
                for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
                    try:
                        price_date = datetime.strptime(text.replace("/", "-") if fmt == "%Y-%m-%d" else text, fmt).date()
                        break
                    except ValueError:
                        continue
                if price_date is not None:
                    break
            if price is not None:
                return price, price_date
            stack.extend(value for value in item.values() if isinstance(value, (dict, list)))
        return None, None

    @staticmethod
    def _fetch_crypto_price(*, symbol: str, as_of_date: date) -> Optional[_ResolvedPositionPrice]:
        normalized_symbol = symbol.strip().upper()
        if not normalized_symbol:
            return None

        fetchers = (
            ("binance", PortfolioService._fetch_binance_crypto_price),
            ("okx", PortfolioService._fetch_okx_crypto_price),
        )
        for provider, fetcher in fetchers:
            price = fetcher(normalized_symbol)
            if price is None or price <= 0:
                continue
            return _ResolvedPositionPrice(
                price=price,
                source="crypto_price",
                price_date=as_of_date,
                is_stale=False,
                is_available=True,
                provider=provider,
            )
        return None

    @staticmethod
    def _fetch_binance_crypto_price(symbol: str) -> Optional[float]:
        pair = f"{symbol}USDT"
        try:
            response = requests.get(
                "https://api.binance.com/api/v3/ticker/price",
                params={"symbol": pair},
                timeout=5,
            )
            response.raise_for_status()
            payload = response.json()
            return float(payload["price"])
        except Exception:
            return None

    @staticmethod
    def _fetch_okx_crypto_price(symbol: str) -> Optional[float]:
        inst_id = f"{symbol}-USDT"
        try:
            response = requests.get(
                "https://www.okx.com/api/v5/market/ticker",
                params={"instId": inst_id},
                timeout=5,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("code") not in (0, "0"):
                return None
            rows = payload.get("data") or []
            if not rows:
                return None
            return float(rows[0]["last"])
        except Exception:
            return None

    def _fetch_realtime_position_price(self, symbol: str) -> Tuple[Optional[float], Optional[str]]:
        try:
            quote = self._get_data_manager().get_realtime_quote(symbol, log_final_failure=False, basic_only=True)
        except Exception as exc:
            logger.warning("Failed to fetch realtime portfolio price for %s: %s", symbol, exc)
            return None, None

        if quote is None:
            return None, None

        price = getattr(quote, "price", None)
        try:
            numeric_price = float(price)
        except (TypeError, ValueError):
            return None, None

        if numeric_price <= 0:
            return None, None

        source = getattr(quote, "source", None)
        provider = getattr(source, "value", None) or (str(source) if source is not None else None)
        return numeric_price, provider

    @staticmethod
    def _normalize_symbol_for_storage(symbol: str) -> str:
        return canonical_stock_code(symbol)

    @staticmethod
    def _normalize_symbol_for_position(symbol: str) -> str:
        if not (symbol or "").strip():
            return ""

        raw = canonical_stock_code(symbol)
        if len(raw) >= 8 and raw[:2] in {"SH", "SZ", "BJ"} and raw[2:].isdigit():
            return raw

        if "." in raw:
            base, suffix = raw.rsplit(".", 1)
            if base.isdigit() and suffix in {"SH", "SS", "SZ", "BJ"}:
                exchange = "SH" if suffix == "SS" else suffix
                return f"{exchange}{base}"

        return canonical_stock_code(normalize_stock_code(symbol))

    @staticmethod
    def _normalize_symbol(symbol: str) -> str:
        """
        Canonicalization for symbol filtering with exchange-qualified input preservation.

        Keep explicit A-share exchange annotations (SH/SZ/BJ) intact to avoid collapsing
        different exchange variants of the same 6-digit core code.
        """
        raw = canonical_stock_code(symbol)
        if not raw:
            return ""

        if len(raw) >= 8 and raw[:2] in {"SH", "SZ", "BJ"} and raw[2:].isdigit():
            return raw

        if "." in raw:
            base, suffix = raw.rsplit(".", 1)
            if base.isdigit() and suffix in {"SH", "SS", "SZ", "BJ"}:
                exchange = "SH" if suffix == "SS" else suffix
                return f"{exchange}{base}"

        return canonical_stock_code(normalize_stock_code(symbol))

    @classmethod
    def _build_symbol_filter_values(cls, symbol: str) -> List[str]:
        original = (symbol or "").strip().upper()
        normalized = cls._normalize_symbol(original)
        if not normalized:
            return []

        seen: Set[str] = set()
        values: List[str] = []

        def _add(value: Optional[str]) -> None:
            candidate = (value or "").strip().upper()
            if candidate and candidate not in seen:
                seen.add(candidate)
                values.append(candidate)

        _add(original)
        _add(normalized)

        if normalized.startswith("HK"):
            hk_digits = normalized[2:]
            if hk_digits.isdigit() and len(hk_digits) == 5:
                legacy_hk_digits = str(int(hk_digits))
                _add(f"HK{hk_digits}")
                _add(f"HK{legacy_hk_digits}")
                _add(f"{hk_digits}.HK")
                _add(f"{legacy_hk_digits}.HK")
            return values

        explicit_exchange: Optional[str] = None
        if len(original) >= 8 and original[:2] in {"SH", "SZ", "BJ"} and original[2:].isdigit():
            explicit_exchange = original[:2]
            explicit_code = original[2:]
        elif "." in original:
            base, suffix = original.rsplit(".", 1)
            if base.isdigit() and suffix in {"SH", "SS", "SZ", "BJ"}:
                explicit_exchange = "SH" if suffix == "SS" else suffix
                explicit_code = base
            else:
                explicit_code = None
        else:
            explicit_code = None

        if normalized.isdigit():
            if len(normalized) == 6:
                exchanges = [explicit_exchange] if explicit_exchange else ["SH", "SZ", "BJ"]
                for exchange in exchanges:
                    if exchange is None:
                        continue
                    _add(f"{exchange}{normalized}")
                    _add(f"{normalized}.{'SS' if exchange == 'SH' else exchange}")
                    if exchange == "SH":
                        _add(f"{normalized}.SH")
            return values

        if explicit_exchange is not None and explicit_code is not None and explicit_code.isdigit():
            if len(explicit_code) == 6:
                _add(f"{explicit_exchange}{explicit_code}")
                _add(f"{explicit_code}.{'SS' if explicit_exchange == 'SH' else explicit_exchange}")
                if explicit_exchange == "SH":
                    _add(f"{explicit_code}.SH")
            elif len(normalized) == 5:
                _add(f"HK{normalized}")
                _add(f"{normalized}.HK")

        return values

    @staticmethod
    def _consume_fifo_lots(
        lots: List[Dict[str, Any]],
        quantity: float,
        symbol: str,
        trade_date: Optional[date] = None,
    ) -> float:
        remaining = quantity
        cost_basis = 0.0
        while remaining > EPS:
            if not lots:
                raise PortfolioOversellError(
                    symbol=symbol,
                    trade_date=trade_date,
                    requested_quantity=quantity,
                    available_quantity=quantity - remaining,
                )
            head = lots[0]
            take = min(remaining, float(head["remaining_quantity"]))
            cost_basis += take * float(head["unit_cost"])
            head["remaining_quantity"] = float(head["remaining_quantity"]) - take
            remaining -= take
            if head["remaining_quantity"] <= EPS:
                lots.pop(0)
        return cost_basis

    @staticmethod
    def _consume_avg_position(
        state: _AvgState,
        quantity: float,
        symbol: str,
        trade_date: Optional[date] = None,
    ) -> float:
        if state.quantity + EPS < quantity:
            raise PortfolioOversellError(
                symbol=symbol,
                trade_date=trade_date,
                requested_quantity=quantity,
                available_quantity=state.quantity,
            )
        if state.quantity <= EPS:
            raise PortfolioOversellError(
                symbol=symbol,
                trade_date=trade_date,
                requested_quantity=quantity,
                available_quantity=0.0,
            )
        avg_cost = state.total_cost / state.quantity
        cost_basis = avg_cost * quantity
        state.quantity -= quantity
        state.total_cost -= cost_basis
        if state.quantity <= EPS:
            state.quantity = 0.0
            state.total_cost = 0.0
        return cost_basis

    @staticmethod
    def _held_quantity(
        *,
        key: Tuple[str, str, str],
        cost_method: str,
        fifo_lots: Dict[Tuple[str, str, str], List[Dict[str, Any]]],
        avg_state: Dict[Tuple[str, str, str], _AvgState],
    ) -> float:
        if cost_method == "fifo":
            return sum(float(lot["remaining_quantity"]) for lot in fifo_lots.get(key, []))
        return float(avg_state.get(key, _AvgState()).quantity)

    def _convert_amount(
        self,
        *,
        amount: float,
        from_currency: str,
        to_currency: str,
        as_of_date: date,
    ) -> _ConvertedAmount:
        from_norm = self._normalize_currency(from_currency)
        to_norm = self._normalize_currency(to_currency)
        if abs(amount) <= EPS:
            return _ConvertedAmount(amount=0.0, is_stale=False, source="zero")
        if from_norm == to_norm:
            return _ConvertedAmount(amount=float(amount), is_stale=False, source="identity")

        direct = self.repo.get_latest_fx_rate(
            from_currency=from_norm,
            to_currency=to_norm,
            as_of=as_of_date,
        )
        if direct is not None and direct.rate > 0:
            return _ConvertedAmount(
                amount=float(amount) * float(direct.rate),
                is_stale=bool(direct.is_stale),
                source="direct_rate",
            )

        inverse = self.repo.get_latest_fx_rate(
            from_currency=to_norm,
            to_currency=from_norm,
            as_of=as_of_date,
        )
        if inverse is not None and inverse.rate > 0:
            return _ConvertedAmount(
                amount=float(amount) / float(inverse.rate),
                is_stale=bool(inverse.is_stale),
                source="inverse_rate",
            )

        return _ConvertedAmount(
            amount=None,
            is_stale=True,
            source="missing_rate",
            missing_pair=(from_norm, to_norm),
        )

    def convert_amount(
        self,
        *,
        amount: float,
        from_currency: str,
        to_currency: str,
        as_of_date: date,
    ) -> Tuple[Optional[float], bool, str]:
        """Public conversion entry for cross-service consumers."""
        converted = self._convert_amount(
            amount=amount,
            from_currency=from_currency,
            to_currency=to_currency,
            as_of_date=as_of_date,
        )
        return converted.amount, converted.is_stale, converted.source

    def _list_account_refresh_fx_currencies(
        self,
        *,
        account: Any,
        as_of_date: date,
        strict: bool = True,
    ) -> List[str]:
        """Return distinct non-base currencies participating in refresh for one account."""
        base_currency = self._normalize_currency(account.base_currency)
        currencies: Set[str] = set()
        rows = list(self.repo.list_trades(account.id, as_of=as_of_date))
        rows.extend(self.repo.list_cash_ledger(account.id, as_of=as_of_date))
        for row in rows:
            try:
                currency = self._normalize_currency(row.currency)
            except ValueError:
                if strict:
                    raise
                logger.warning(
                    "Skip invalid FX refresh currency for account %s on %s: %r",
                    account.id,
                    as_of_date.isoformat(),
                    getattr(row, "currency", None),
                )
                continue
            if currency != base_currency:
                currencies.add(currency)
        return sorted(currencies)

    def _refresh_account_fx_rates(
        self,
        *,
        account: Any,
        as_of_date: date,
        refresh_enabled: bool,
        aggregate_currency: Optional[str] = None,
    ) -> Dict[str, int]:
        """Refresh FX pairs for one account and keep stale fallback on failures."""
        refresh_currencies = self._list_account_refresh_fx_currencies(
            account=account,
            as_of_date=as_of_date,
            strict=refresh_enabled,
        )
        base_currency = self._normalize_currency(account.base_currency)
        aggregate_currency_norm = self._normalize_currency(aggregate_currency) if aggregate_currency else None
        if aggregate_currency_norm and base_currency != aggregate_currency_norm:
            refresh_currencies = sorted(set(refresh_currencies) | {base_currency})
        if not refresh_enabled:
            return {
                "pair_count": len(refresh_currencies),
                "updated_count": 0,
                "stale_count": 0,
                "error_count": 0,
            }

        summary = {
            "pair_count": len(refresh_currencies),
            "updated_count": 0,
            "stale_count": 0,
            "error_count": 0,
        }
        for from_currency in refresh_currencies:
            to_currency = aggregate_currency_norm if aggregate_currency_norm and from_currency == base_currency else base_currency
            try:
                rate = self._fetch_fx_rate_from_yfinance(
                    from_currency=from_currency,
                    to_currency=to_currency,
                    as_of_date=as_of_date,
                )
                if rate is not None and rate > 0:
                    self.repo.save_fx_rate(
                        from_currency=from_currency,
                        to_currency=to_currency,
                        rate_date=as_of_date,
                        rate=rate,
                        source="yfinance",
                        is_stale=False,
                    )
                    summary["updated_count"] += 1
                    continue
            except Exception as exc:
                logger.warning(
                    "FX online fetch failed for %s/%s on %s: %s",
                    from_currency,
                    to_currency,
                    as_of_date.isoformat(),
                    exc,
                )

            fallback = self.repo.get_latest_fx_rate(
                from_currency=from_currency,
                to_currency=to_currency,
                as_of=as_of_date,
            )
            if fallback is not None and float(fallback.rate or 0.0) > 0:
                self.repo.save_fx_rate(
                    from_currency=from_currency,
                    to_currency=to_currency,
                    rate_date=as_of_date,
                    rate=float(fallback.rate),
                    source=(fallback.source or "cache_fallback"),
                    is_stale=True,
                )
                summary["stale_count"] += 1
            else:
                summary["error_count"] += 1
        return summary

    @staticmethod
    def _fetch_fx_rate_from_yfinance(
        *,
        from_currency: str,
        to_currency: str,
        as_of_date: date,
    ) -> Optional[float]:
        """Fetch latest available FX close rate around as_of date."""
        if yf is None:
            return None
        symbol = f"{from_currency}{to_currency}=X"
        ticker = yf.Ticker(symbol)
        history = ticker.history(
            start=(as_of_date - timedelta(days=7)).isoformat(),
            end=(as_of_date + timedelta(days=1)).isoformat(),
            interval="1d",
            auto_adjust=False,
        )
        if history is None or history.empty or "Close" not in history:
            return None
        close = history["Close"].dropna()
        if close.empty:
            return None
        value = float(close.iloc[-1])
        if value <= 0:
            return None
        return value

    def _require_active_account(self, account_id: int) -> Any:
        account = self.repo.get_account(account_id, include_inactive=False)
        if account is None:
            raise ValueError(f"Active account not found: {account_id}")
        return account

    def _require_active_account_in_session(self, *, session: Any, account_id: int) -> Any:
        account = self.repo.get_account_in_session(
            session=session,
            account_id=account_id,
            include_inactive=False,
        )
        if account is None:
            raise ValueError(f"Active account not found: {account_id}")
        return account

    def _has_trade_uid(self, *, account_id: int, trade_uid: str, session: Optional[Any] = None) -> bool:
        if session is None:
            return self.repo.has_trade_uid(account_id, trade_uid)
        return self.repo.has_trade_uid_in_session(session=session, account_id=account_id, trade_uid=trade_uid)

    def _has_trade_dedup_hash(
        self,
        *,
        account_id: int,
        dedup_hash: str,
        session: Optional[Any] = None,
    ) -> bool:
        if session is None:
            return self.repo.has_trade_dedup_hash(account_id, dedup_hash)
        return self.repo.has_trade_dedup_hash_in_session(
            session=session,
            account_id=account_id,
            dedup_hash=dedup_hash,
        )

    @staticmethod
    def _account_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": row.id,
            "owner_id": row.owner_id,
            "name": row.name,
            "broker": row.broker,
            "market": row.market,
            "base_currency": row.base_currency,
            "cash_tracking_mode": PortfolioService._account_cash_tracking_mode(row),
            "is_active": bool(row.is_active),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    @staticmethod
    def _tag_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "name": row.name,
            "color": row.color,
            "sort_order": int(row.sort_order or 0),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    @staticmethod
    def _normalize_tag_name(value: str) -> str:
        name = str(value or "").strip()
        if not name:
            raise ValueError("标签名称不能为空")
        if len(name) > 32:
            raise ValueError("标签名称不能超过 32 个字符")
        return name

    @staticmethod
    def _normalize_tag_color(value: str) -> str:
        color = str(value or "").strip() or "hsl(var(--primary))"
        if len(color) > 32:
            raise ValueError("标签颜色不能超过 32 个字符")
        return color

    @staticmethod
    def _looks_like_unique_conflict(exc: Exception) -> bool:
        text = str(exc).lower()
        return "unique" in text or "constraint" in text or "duplicate" in text

    @staticmethod
    def _trade_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "trade_uid": row.trade_uid,
            "symbol": row.symbol,
            "market": row.market,
            "currency": row.currency,
            "trade_date": row.trade_date.isoformat() if row.trade_date else "",
            "side": row.side,
            "quantity": float(row.quantity),
            "price": float(row.price),
            "fee": float(row.fee),
            "tax": float(row.tax),
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _cash_ledger_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "event_date": row.event_date.isoformat() if row.event_date else "",
            "direction": row.direction,
            "amount": float(row.amount),
            "currency": row.currency,
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _corporate_action_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "symbol": row.symbol,
            "market": row.market,
            "currency": row.currency,
            "effective_date": row.effective_date.isoformat() if row.effective_date else "",
            "action_type": row.action_type,
            "cash_dividend_per_share": (
                float(row.cash_dividend_per_share) if row.cash_dividend_per_share is not None else None
            ),
            "split_ratio": float(row.split_ratio) if row.split_ratio is not None else None,
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _bank_ledger_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "event_date": row.event_date.isoformat() if row.event_date else "",
            "asset_kind": PortfolioService._normalize_bank_asset_kind(row.asset_kind),
            "direction": row.direction,
            "amount": float(row.amount or 0.0),
            "currency": row.currency,
            "bank_name": row.bank_name,
            "product_name": row.product_name,
            "product_code": getattr(row, "product_code", None),
            "product_public_code": getattr(row, "product_public_code", None),
            "issuer_name": getattr(row, "issuer_name", None),
            "registration_code": row.registration_code,
            "linked_entry_id": int(row.linked_entry_id) if row.linked_entry_id is not None else None,
            "quantity": float(row.quantity) if row.quantity is not None else None,
            "unit_nav": float(row.unit_nav) if getattr(row, "unit_nav", None) is not None else None,
            "nav_date": row.nav_date.isoformat() if getattr(row, "nav_date", None) else None,
            "start_date": row.start_date.isoformat() if row.start_date else None,
            "maturity_date": row.maturity_date.isoformat() if row.maturity_date else None,
            "annual_rate": float(row.annual_rate) if row.annual_rate is not None else None,
            "investment_nature": row.investment_nature,
            "risk_level": row.risk_level,
            "income_mode": row.income_mode,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _advisory_ledger_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "event_date": row.event_date.isoformat() if row.event_date else "",
            "platform": row.platform,
            "product_name": row.product_name,
            "product_code": row.product_code,
            "product_type": getattr(row, "product_type", None) or "advisory_combo",
            "event_type": row.direction,
            "direction": row.direction,
            "amount": float(row.amount or 0.0),
            "quantity": float(row.quantity or 0.0) if row.quantity is not None else None,
            "nav": float(row.nav or 0.0) if row.nav is not None else None,
            "currency": row.currency,
            "risk_level": row.risk_level,
            "investment_style": row.investment_style,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _insurance_policy_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "policy_name": row.policy_name,
            "insurer": row.insurer,
            "policy_no": row.policy_no,
            "insurance_kind": row.insurance_kind,
            "design_type": row.design_type,
            "currency": row.currency,
            "status": row.status,
            "payment_mode": row.payment_mode,
            "premium_per_period": float(row.premium_per_period) if row.premium_per_period is not None else None,
            "first_payment_date": row.first_payment_date.isoformat() if row.first_payment_date else None,
            "total_periods": int(row.total_periods) if row.total_periods is not None else None,
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    @staticmethod
    def _insurance_ledger_row_to_dict(row: Any) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.account_id),
            "policy_id": int(row.policy_id),
            "event_date": row.event_date.isoformat() if row.event_date else "",
            "event_type": row.event_type,
            "amount": float(row.amount or 0.0),
            "currency": row.currency,
            "period_no": int(row.period_no) if row.period_no is not None else None,
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _build_asset_breakdown(accounts: List[Dict[str, Any]]) -> Dict[str, float]:
        breakdown: Dict[str, float] = {
            "stock": 0.0,
            "fund": 0.0,
            "crypto": 0.0,
            "bank": 0.0,
            "advisory": 0.0,
            "insurance": 0.0,
            "cash": 0.0,
        }
        for account in accounts:
            market = str(account.get("market") or "").lower()
            key = market if market in {"fund", "crypto", "bank", "advisory", "insurance"} else "stock"
            breakdown[key] += float(account.get("total_market_value") or 0.0)
            breakdown["cash"] += float(account.get("total_cash") or 0.0)
        return {key: round(value, 6) for key, value in breakdown.items()}

    @staticmethod
    def _validate_paging(*, page: int, page_size: int) -> Tuple[int, int]:
        if page < 1:
            raise ValueError("page must be >= 1")
        if page_size < 1 or page_size > 100:
            raise ValueError("page_size must be in [1, 100]")
        return page, page_size

    @staticmethod
    def _normalize_market(value: str) -> str:
        market = (value or "").strip().lower()
        if market not in VALID_MARKETS:
            raise ValueError("market must be one of: cn, hk, us, fund, crypto, bank, advisory, insurance")
        return market

    @staticmethod
    def _normalize_currency(value: str) -> str:
        currency = (value or "").strip().upper()
        if not currency:
            raise ValueError("currency is required")
        return currency

    @staticmethod
    def _default_cash_tracking_mode_for_market(market: str) -> str:
        return "asset_only" if market in ASSET_ONLY_DEFAULT_MARKETS else "managed"

    @classmethod
    def _normalize_cash_tracking_mode(cls, value: Optional[str], *, market: Optional[str] = None) -> str:
        mode = (value or "").strip().lower()
        if not mode:
            market_norm = cls._normalize_market(market) if market else "cn"
            return cls._default_cash_tracking_mode_for_market(market_norm)
        if mode not in VALID_CASH_TRACKING_MODES:
            raise ValueError("cash_tracking_mode must be managed or asset_only")
        return mode

    @classmethod
    def _account_cash_tracking_mode(cls, account: Any) -> str:
        return cls._normalize_cash_tracking_mode(
            getattr(account, "cash_tracking_mode", None),
            market=getattr(account, "market", None) or "cn",
        )

    @staticmethod
    def _normalize_cost_method(value: str) -> str:
        method = (value or "").strip().lower()
        if method not in VALID_COST_METHODS:
            raise ValueError("cost_method must be fifo or avg")
        return method

    @staticmethod
    def _normalize_bank_asset_kind(value: str) -> str:
        kind = (value or "").strip().lower()
        kind = LEGACY_BANK_ASSET_KIND_ALIASES.get(kind, kind)
        if kind not in VALID_BANK_ASSET_KINDS:
            raise ValueError("asset_kind must be demand, deposit or wealth")
        return kind

    @staticmethod
    def _normalize_advisory_product_type(value: Optional[str]) -> str:
        product_type = (value or "advisory_combo").strip().lower()
        if product_type not in VALID_ADVISORY_PRODUCT_TYPES:
            raise ValueError("product_type must be advisory_combo or dca_plan")
        return product_type

    @staticmethod
    def _normalize_advisory_event_type(value: str) -> str:
        event_type = (value or "").strip().lower()
        legacy_aliases = {
            "subscribe": "buy",
        }
        event_type = legacy_aliases.get(event_type, event_type)
        if event_type not in VALID_ADVISORY_EVENT_TYPES:
            raise ValueError("event_type must be buy, initial_buy, dca_buy, follow_buy or redeem")
        return event_type

    @staticmethod
    def _validate_advisory_event_for_product(product_type: str, event_type: str) -> None:
        if product_type == "advisory_combo" and event_type not in {"buy", "redeem"}:
            raise ValueError("advisory_combo supports buy or redeem events")
        if product_type == "dca_plan" and event_type not in {"initial_buy", "dca_buy", "follow_buy", "redeem"}:
            raise ValueError("dca_plan supports initial_buy, dca_buy, follow_buy or redeem events")

    def _normalize_insurance_policy_fields(
        self,
        *,
        account: Any,
        policy_name: Optional[str],
        insurer: Optional[str],
        policy_no: Optional[str],
        insurance_kind: Optional[str],
        design_type: Optional[str],
        currency: Optional[str],
        status: Optional[str],
        payment_mode: Optional[str],
        premium_per_period: Optional[float],
        first_payment_date: Optional[date],
        total_periods: Optional[int],
        note: Optional[str],
        partial: bool,
    ) -> Dict[str, Any]:
        fields: Dict[str, Any] = {}
        if policy_name is not None or not partial:
            policy_name_norm = (policy_name or "").strip()
            if not policy_name_norm:
                raise ValueError("policy_name is required")
            fields["policy_name"] = policy_name_norm
        for key, raw in (("insurer", insurer), ("policy_no", policy_no), ("note", note)):
            if raw is not None or not partial:
                fields[key] = (raw or "").strip() or None
        if insurance_kind is not None or not partial:
            kind = (insurance_kind or "").strip().lower() or "other"
            if kind not in VALID_INSURANCE_KINDS:
                raise ValueError("insurance_kind is invalid")
            fields["insurance_kind"] = kind
        if design_type is not None or not partial:
            design = (design_type or "").strip().lower() or "ordinary"
            if design not in VALID_INSURANCE_DESIGN_TYPES:
                raise ValueError("design_type is invalid")
            fields["design_type"] = design
        if currency is not None or not partial:
            fields["currency"] = self._normalize_currency(currency or account.base_currency)
        if status is not None or not partial:
            status_norm = (status or "").strip().lower() or "active"
            if status_norm not in VALID_INSURANCE_STATUSES:
                raise ValueError("status is invalid")
            fields["status"] = status_norm
        if payment_mode is not None or not partial:
            payment_mode_norm = (payment_mode or "").strip().lower() or "single"
            if payment_mode_norm not in VALID_INSURANCE_PAYMENT_MODES:
                raise ValueError("payment_mode is invalid")
            fields["payment_mode"] = payment_mode_norm
        if premium_per_period is not None:
            if premium_per_period <= 0:
                raise ValueError("premium_per_period must be > 0")
            fields["premium_per_period"] = float(premium_per_period)
        elif not partial:
            fields["premium_per_period"] = None
        if first_payment_date is not None or not partial:
            fields["first_payment_date"] = first_payment_date
        if total_periods is not None:
            if total_periods <= 0:
                raise ValueError("total_periods must be > 0")
            fields["total_periods"] = int(total_periods)
        elif not partial:
            fields["total_periods"] = None
        return fields

    @staticmethod
    def _normalize_insurance_event_type(value: str) -> str:
        event_type = (value or "").strip().lower()
        if event_type not in VALID_INSURANCE_EVENT_TYPES:
            raise ValueError("event_type is invalid")
        return event_type

    @staticmethod
    def _allowed_insurance_event_types_for_policy(policy: Any) -> Set[str]:
        kind = str(getattr(policy, "insurance_kind", None) or "other").strip().lower()
        design_type = str(getattr(policy, "design_type", None) or "ordinary").strip().lower()
        status = str(getattr(policy, "status", None) or "active").strip().lower()

        if status in TERMINAL_INSURANCE_STATUSES:
            return set()

        allowed = {"value_update", "surrender", "refund", "other_inflow", "other_outflow"}
        if status != "paid_up":
            allowed.add("premium")
        if kind in {"annuity", "endowment"}:
            allowed.add("survival_benefit")
        if kind == "annuity":
            allowed.add("annuity_payment")
        if kind == "endowment":
            allowed.add("maturity_benefit")
        if design_type == "participating":
            allowed.add("dividend")
        if kind in {"whole_life", "universal", "unit_linked"} or design_type in {"universal", "unit_linked"}:
            allowed.add("partial_withdrawal")
        return allowed

    def _validate_insurance_event_for_policy(self, policy: Any, event_type: str, event_date: date) -> None:
        allowed = self._allowed_insurance_event_types_for_policy(policy)
        if event_type not in allowed:
            raise ValueError("event_type is not available for this insurance policy")
        terminal_event = self.repo.get_latest_insurance_terminal_event(
            policy_id=int(policy.id),
            event_types=INSURANCE_TERMINAL_EVENTS,
        )
        if terminal_event is not None and event_date > terminal_event.event_date:
            raise ValueError("policy already has a terminal insurance event")

    @staticmethod
    def _calculate_next_insurance_payment_date(
        *,
        first_payment_date: Optional[str],
        payment_mode: str,
        paid_periods: int,
        total_periods: Optional[int],
    ) -> Optional[date]:
        if not first_payment_date or payment_mode in {"single", "irregular"}:
            return None
        if total_periods is not None and paid_periods >= int(total_periods):
            return None
        try:
            first_date = datetime.strptime(first_payment_date, "%Y-%m-%d").date()
        except ValueError:
            return None
        months_by_mode = {
            "monthly": 1,
            "quarterly": 3,
            "semiannual": 6,
            "annual": 12,
        }
        months = months_by_mode.get(payment_mode)
        if not months:
            return None
        return PortfolioService._add_months(first_date, months * paid_periods)

    @staticmethod
    def _add_months(value: date, months: int) -> date:
        month_index = value.month - 1 + months
        year = value.year + month_index // 12
        month = month_index % 12 + 1
        last_day = 31
        while True:
            try:
                return date(year, month, min(value.day, last_day))
            except ValueError:
                last_day -= 1

    @staticmethod
    def _make_advisory_symbol(product_name: str) -> str:
        text = str(product_name or "").strip()
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12].upper()
        return f"ADV:{digest or 'PRODUCT'}"

    @staticmethod
    def _make_bank_wealth_symbol(entry_id: int) -> str:
        return f"{BANK_WEALTH_SYMBOL_PREFIX}{int(entry_id)}"

    @staticmethod
    def _parse_bank_wealth_symbol(symbol: str) -> Optional[int]:
        symbol_norm = (symbol or "").strip().upper()
        if not symbol_norm.startswith(BANK_WEALTH_SYMBOL_PREFIX):
            return None
        try:
            return int(symbol_norm[len(BANK_WEALTH_SYMBOL_PREFIX):])
        except ValueError:
            return None

    @staticmethod
    def _should_apply_bank_wealth_nav(
        *,
        current_item: Dict[str, Any],
        latest_price: _ResolvedPositionPrice,
    ) -> bool:
        current_date = PortfolioService._parse_iso_date(current_item.get("price_date"))
        latest_date = latest_price.price_date
        if current_date is None or latest_date is None:
            return True
        if latest_date > current_date:
            return True
        if latest_date < current_date:
            return False
        return current_item.get("price_source") != "bank_value_update"

    @staticmethod
    def _parse_iso_date(value: Any) -> Optional[date]:
        if isinstance(value, date):
            return value
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return datetime.strptime(text[:10], "%Y-%m-%d").date()
        except ValueError:
            return None

    @staticmethod
    def _default_currency_for_market(market: str) -> str:
        if market == "hk":
            return "HKD"
        if market == "us":
            return "USD"
        if market == "crypto":
            return "USD"
        return "CNY"
