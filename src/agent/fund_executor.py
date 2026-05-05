# -*- coding: utf-8 -*-
"""Fund-specific Agent executor."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from src.agent.llm_adapter import LLMToolAdapter
from src.agent.runner import run_agent_loop
from src.agent.tools.registry import ToolRegistry


@dataclass
class FundAgentResult:
    success: bool = False
    content: str = ""
    tool_calls_log: List[Dict[str, Any]] = field(default_factory=list)
    total_steps: int = 0
    total_tokens: int = 0
    provider: str = ""
    model: str = ""
    error: Optional[str] = None


FUND_CHAT_SYSTEM_PROMPT = """你是一位场外基金诊断 Agent，负责回答用户关于公募基金、基金经理、基金持仓、指数产品和债市的问题。

## 工作原则

1. 必须调用基金工具获取真实数据，不能编造基金净值、收益、回撤、规模、持仓或基金经理信息。
2. 基金不是股票短线交易标的，禁止使用涨停、筹码成本、狙击点、短线买卖点等股票交易话术。
3. 专业判断优先使用盈米工具：单只基金诊断、基金组合诊断、投顾策略/组合问题应优先调用 `yingmi_*` 工具；天天基金工具主要用于搜索、基础资料、净值、持仓、经理、交易规则和债市数据补充。
4. 默认从资产配置和风险收益角度分析：基金类型、阶段收益、波动、最大回撤、同类排名、持仓集中度、行业/资产配置、基金经理稳定性、费率与适合的持有周期。
5. 用户只给基金名称时，优先使用 `search_funds` 找候选；能确认基金代码后再查详情。
6. 工具失败时必须直接说明失败原因，不得使用假数据或静默降级。
7. 只做只读查询和分析，不执行自选、交易、组合创建或任何写操作。
8. 如果系统消息提供了历史基金上下文，优先基于上下文回答；只有用户明确要求更新数据、查询最新净值，或上下文字段不足以回答当前问题时，才再次调用基金工具。

{skills_section}

## 推荐分析流程

- 单只基金诊断：搜索/确认基金 -> 盈米专业诊断/风险分析 -> 基础信息 -> 净值表现 -> 持仓结构 -> 基金经理信息 -> 结论。
- 基金组合诊断：整理基金代码、金额或权重 -> 盈米资产配置/组合风险/相关性/回测 -> 本地或天天基金基础数据补充 -> 结论。
- 投顾策略问题：优先搜索盈米策略，再查询策略详情和组合结构；不要用普通基金搜索代替投顾策略查询。
- 条件选基：使用 `select_funds` 获取候选，再说明筛选条件、结果质量和局限。
- 债券/固收问题：优先使用 `get_bond_market`，再结合基金类型解释。

## 基金经理查询规则

- 对主动权益基金、主动混合基金、主动债券基金，以及用户询问“是否持有、是否新增、是否定投、适合作为核心仓位”等需要判断管理能力的问题，若基础信息或搜索结果能识别基金经理姓名或 ID，必须调用 `get_fund_manager_info`。
- 对宽基指数、被动指数、ETF 联接、货币基金，默认不强制调用基金经理工具，除非用户明确询问基金经理。
- 如果应该查询但基础信息没有返回基金经理姓名或 ID，必须在输出中写明“基金经理数据缺口”，不得用猜测补齐。
- 后续追问如果会话历史里已经有同一基金经理的查询结果，优先基于已有结果继续判断；只有用户要求更新、换基金经理或数据明显不足时再重复调用。

## 输出要求

- 用中文回答。
- 先给结论，再列关键依据和风险。
- 明确区分“适合定投”“适合长期持有”“仅适合观察”“不建议新增”的判断。
- 如果数据不足，直接说明缺口和下一步需要补充的信息。
"""


class FundAgentExecutor:
    """ReAct executor with fund-only prompt and fund-only tools."""

    def __init__(
        self,
        *,
        tool_registry: ToolRegistry,
        llm_adapter: LLMToolAdapter,
        skill_instructions: str = "",
        max_steps: int = 10,
        timeout_seconds: Optional[float] = None,
    ) -> None:
        self.tool_registry = tool_registry
        self.llm_adapter = llm_adapter
        self.skill_instructions = skill_instructions
        self.max_steps = max_steps
        self.timeout_seconds = timeout_seconds

    def chat(
        self,
        message: str,
        session_id: str,
        progress_callback: Optional[Callable] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> FundAgentResult:
        from src.agent.conversation import conversation_manager

        skills_section = ""
        if self.skill_instructions:
            skills_section = f"## 激活的基金策略\n\n{self.skill_instructions}"
        system_prompt = FUND_CHAT_SYSTEM_PROMPT.format(skills_section=skills_section)

        session = conversation_manager.get_or_create(session_id)
        history = session.get_history()
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        messages.extend(history)

        if context:
            context_text = json.dumps(context, ensure_ascii=False, default=str)
            messages.append({"role": "user", "content": f"[系统提供的基金上下文]\n{context_text}"})
            messages.append({"role": "assistant", "content": "好的，我会基于这些上下文继续诊断基金问题。"})

        messages.append({"role": "user", "content": message})
        conversation_manager.add_message(session_id, "user", message)

        loop_result = run_agent_loop(
            messages=messages,
            tool_registry=self.tool_registry,
            llm_adapter=self.llm_adapter,
            max_steps=self.max_steps,
            progress_callback=progress_callback,
            thinking_labels={
                "yingmi_get_fund_diagnosis": "盈米基金诊断",
                "yingmi_analyze_fund_risk": "盈米基金风险",
                "yingmi_get_asset_allocation": "盈米资产配置",
                "yingmi_get_funds_backtest": "盈米组合回测",
                "yingmi_get_funds_correlation": "盈米相关性",
                "yingmi_analyze_portfolio_risk": "盈米组合风险",
                "yingmi_search_strategies": "盈米策略搜索",
                "yingmi_get_strategy_details": "盈米策略详情",
                "yingmi_get_strategy_composition": "盈米策略持仓",
                "search_funds": "基金搜索",
                "get_fund_base_info": "基金基础信息",
                "get_fund_nav_info": "基金净值查询",
                "get_fund_holding_info": "基金持仓查询",
                "get_fund_manager_info": "基金经理查询",
                "select_funds": "条件选基",
                "get_fund_index_info": "指数信息查询",
                "get_bond_market": "债市晴雨表",
            },
            max_wall_clock_seconds=self.timeout_seconds,
        )

        result = FundAgentResult(
            success=loop_result.success,
            content=loop_result.content,
            tool_calls_log=loop_result.tool_calls_log,
            total_steps=loop_result.total_steps,
            total_tokens=loop_result.total_tokens,
            provider=loop_result.provider,
            model=loop_result.model,
            error=loop_result.error,
        )
        if result.success:
            conversation_manager.add_message(session_id, "assistant", result.content)
        else:
            conversation_manager.add_message(session_id, "assistant", f"[分析失败] {result.error or '未知错误'}")
        return result
