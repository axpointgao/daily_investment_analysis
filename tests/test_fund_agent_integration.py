# -*- coding: utf-8 -*-
"""Regression coverage for the fund Agent entrypoint."""

from tests.litellm_stub import ensure_litellm_stub

ensure_litellm_stub()


def test_fund_skills_response_uses_fund_strategy_catalog():
    from api.v1.endpoints.agent import _build_skills_response
    from src.agent.factory import reset_agent_factory_caches

    reset_agent_factory_caches()
    payload = _build_skills_response(config=None, asset_type="fund")
    skill_ids = {skill.id for skill in payload.skills}

    assert "fund_general" in skill_ids
    assert "fund_dca" in skill_ids
    assert "bull_trend" not in skill_ids
    assert payload.default_skill_id == "fund_general"


def test_stock_skills_response_keeps_stock_strategy_catalog():
    from api.v1.endpoints.agent import _build_skills_response
    from src.agent.factory import reset_agent_factory_caches

    reset_agent_factory_caches()
    payload = _build_skills_response(config=None, asset_type="stock")
    skill_ids = {skill.id for skill in payload.skills}

    assert "bull_trend" in skill_ids
    assert "fund_general" not in skill_ids


def test_fund_strategy_prompt_requires_manager_lookup_for_active_funds():
    from src.agent.factory import get_fund_skill_manager, reset_agent_factory_caches

    reset_agent_factory_caches()
    manager = get_fund_skill_manager(config=None)
    manager.activate(["fund_general", "fund_dca", "fund_core_satellite"])
    instructions = manager.get_skill_instructions()

    assert "必须调用 get_fund_manager_info" in instructions
    assert "主动基金" in instructions or "主动型基金" in instructions
