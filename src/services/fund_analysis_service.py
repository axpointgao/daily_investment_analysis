# -*- coding: utf-8 -*-
"""场外基金分析服务。"""

from __future__ import annotations

import json
import logging
import math
import re
import time
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple
from urllib.parse import urlencode

import requests

from src.config import (
    get_config,
    normalize_yingmi_fund_analysis_depth,
    normalize_yingmi_fund_data_strategy,
)
from src.storage import DatabaseManager

logger = logging.getLogger(__name__)


class FundAnalysisError(RuntimeError):
    """基金分析失败。"""


@dataclass
class FundAnalysisResult:
    query_id: str
    fund_code: str
    fund_name: str
    report_type: str
    report: Dict[str, Any]
    data_snapshot: Dict[str, Any]


class TiantianFundClient:
    """TiantianFundApi 最小客户端。"""

    def __init__(self, base_url: Optional[str] = None, timeout: float = 8.0):
        config = get_config()
        resolved = (base_url or getattr(config, "tiantian_fund_api_base_url", "") or "").strip().rstrip("/")
        if not resolved:
            raise FundAnalysisError("请先在设置中配置 TiantianFundApi Base URL。")
        self.base_url = resolved
        self.timeout = timeout

    def get(self, endpoint: str, params: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        try:
            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            raise FundAnalysisError(f"TiantianFundApi 请求失败: {endpoint}: {exc}") from exc
        if not isinstance(payload, dict):
            raise FundAnalysisError(f"TiantianFundApi 返回格式异常: {endpoint}")
        return payload


def normalize_fund_code(raw: str) -> str:
    code = str(raw or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        raise FundAnalysisError("基金代码必须是 6 位数字。")
    return code


def _as_float(value: Any) -> Optional[float]:
    if value in (None, "", "--"):
        return None
    try:
        parsed = float(str(value).replace("%", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _as_int(value: Any) -> Optional[int]:
    number = _as_float(value)
    return int(number) if number is not None else None


def _as_date(value: Any) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()[:10].replace("/", "-")
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text or None


def _format_fund_period_label(value: Any) -> str:
    text = str(value or "").strip()
    return {
        "Z": "近1周",
        "Y": "近1月",
        "3Y": "近3月",
        "6Y": "近6月",
        "1N": "近1年",
        "2N": "近2年",
        "3N": "近3年",
        "5N": "近5年",
    }.get(text, text)


def _datas(payload: Dict[str, Any]) -> Any:
    return payload.get("Datas") if isinstance(payload, dict) else None


class FundAnalysisService:
    """封装场外基金数据获取、指标计算、LLM 诊断与历史保存。"""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()
        self.last_error: Optional[str] = None
        self.last_notification_error: Optional[str] = None

    def analyze_fund(
        self,
        *,
        fund_code: str,
        fund_name: Optional[str] = None,
        report_type: str = "detailed",
        force_refresh: bool = False,
        query_id: Optional[str] = None,
        notify: bool = True,
        progress_callback: Optional[Callable[[int, str], None]] = None,
        ) -> Optional[Dict[str, Any]]:
        code = normalize_fund_code(fund_code)
        normalized_report_type = str(report_type or "detailed").strip() or "detailed"
        query_id = query_id or datetime.now().strftime("%Y%m%d%H%M%S%f")
        stage_timings: Dict[str, int] = {}
        total_started_at = time.perf_counter()

        def emit(progress: int, message: str) -> None:
            if progress_callback:
                try:
                    progress_callback(progress, message)
                except Exception:
                    logger.debug("基金分析进度回调失败", exc_info=True)

        @contextmanager
        def measure(stage: str) -> Iterator[None]:
            started_at = time.perf_counter()
            try:
                yield
            finally:
                stage_timings[stage] = int((time.perf_counter() - started_at) * 1000)

        try:
            self.last_error = None
            self.last_notification_error = None

            if not force_refresh:
                cached = self._load_cached_fund_analysis(
                    fund_code=code,
                    report_type=normalized_report_type,
                    stage_timings=stage_timings,
                )
                if cached:
                    cached["cache"] = {"hit": True, "source": "fund_analysis_history"}
                    stage_timings["total"] = int((time.perf_counter() - total_started_at) * 1000)
                    self._attach_report_details(cached.get("report"), stage_timings=stage_timings, cache_hit=True)
                    logger.info(
                        "基金 %s 命中当天诊断缓存: query_id=%s report_type=%s timings_ms=%s",
                        code,
                        cached.get("query_id"),
                        normalized_report_type,
                        stage_timings,
                    )
                    return cached

            emit(15, f"{code}：正在连接天天基金数据源")
            with measure("connect"):
                client = TiantianFundClient()

            emit(25, f"{code}：正在获取基金资料")
            with measure("profile"):
                profile = self._fetch_profile(client, code, fund_name)

            emit(40, f"{code}：正在获取历史净值")
            with measure("nav"):
                nav_series = self._fetch_nav_series(client, code, page_size=500)
            if len(nav_series) < 2:
                raise FundAnalysisError("基金历史净值不足，无法生成分析。")

            config = get_config()
            data_strategy = normalize_yingmi_fund_data_strategy(getattr(config, "yingmi_fund_data_strategy", None))
            use_basic_enrichment = data_strategy != "yingmi_only"

            emit(52, f"{code}：正在获取收益、排名与经理数据")
            with measure("basic_enrichment"):
                performance, ranking, managers, grade = self._fetch_basic_enrichment(
                    client,
                    code,
                    use_basic_enrichment=use_basic_enrichment,
                )

            emit(65, f"{code}：正在计算风险收益指标")
            with measure("risk"):
                risk = self._calculate_risk(nav_series)
            data_snapshot = {
                "fundProfile": profile,
                "performance": performance,
                "risk": risk,
                "ranking": ranking,
                "manager": managers,
                "grade": grade,
                "navSeries": nav_series,
                "dataCoverage": self._build_data_coverage(profile, performance, risk, ranking, managers, grade, nav_series),
            }

            emit(68, f"{profile['fundName']}：正在调用盈米专业诊断")
            with measure("yingmi"):
                yingmi_data = self._fetch_yingmi_professional_data(code, profile["fundName"])
            data_snapshot["yingmi"] = yingmi_data.get("data") or {}
            data_snapshot["providerStatus"] = yingmi_data.get("providerStatus") or []
            data_snapshot["dataCoverage"]["yingmi"] = bool(data_snapshot["yingmi"])

            emit(75, f"{profile['fundName']}：正在生成基金诊断")
            with measure("llm"):
                report = self._build_report_with_llm(
                    query_id=query_id,
                    fund_code=code,
                    fund_name=profile["fundName"],
                    report_type=normalized_report_type,
                    data_snapshot=data_snapshot,
                )

            emit(94, f"{profile['fundName']}：正在保存基金分析")
            stage_timings["total"] = int((time.perf_counter() - total_started_at) * 1000)
            self._attach_report_details(report, stage_timings=stage_timings, cache_hit=False)
            with measure("save"):
                self.db.save_fund_analysis_history(
                    query_id=query_id,
                    fund_code=code,
                    fund_name=profile["fundName"],
                    report_type=normalized_report_type,
                    allocation_rating=report["summary"].get("allocationRating"),
                    suitability_score=report["summary"].get("suitabilityScore"),
                    analysis_summary=report["summary"].get("analysisSummary"),
                    risk_summary=report["summary"].get("riskSummary"),
                    raw_result=report,
                    data_snapshot=data_snapshot,
                )

            notification_status = {"requested": bool(notify), "sent": False, "error": None}
            if notify:
                emit(97, f"{profile['fundName']}：正在发送基金诊断通知")
                with measure("notify"):
                    notification_status = self._send_notification(
                        fund_code=code,
                        fund_name=profile["fundName"],
                        report=report,
                        report_type=normalized_report_type,
                    )

            emit(100, f"{profile['fundName']}：基金分析完成")
            stage_timings["total"] = int((time.perf_counter() - total_started_at) * 1000)
            self._attach_report_details(report, stage_timings=stage_timings, cache_hit=False)
            logger.info(
                "基金 %s 诊断完成: query_id=%s report_type=%s timings_ms=%s",
                code,
                query_id,
                normalized_report_type,
                stage_timings,
            )
            return {
                "query_id": query_id,
                "fund_code": code,
                "fund_name": profile["fundName"],
                "report": report,
                "notification": notification_status,
                "created_at": datetime.now().isoformat(),
            }
        except Exception as exc:
            self.last_error = str(exc)
            logger.error("基金分析失败: %s", exc, exc_info=True)
            return None

    def _load_cached_fund_analysis(
        self,
        *,
        fund_code: str,
        report_type: str,
        stage_timings: Dict[str, int],
    ) -> Optional[Dict[str, Any]]:
        started_at = time.perf_counter()
        try:
            cached = self.db.get_latest_fund_analysis_history_today(
                fund_code=fund_code,
                report_type=report_type,
            )
        except Exception as exc:
            logger.info("基金 %s 当天诊断缓存读取失败: %s", fund_code, exc)
            return None
        finally:
            stage_timings["cache_lookup"] = int((time.perf_counter() - started_at) * 1000)

        if not cached:
            return None
        return {
            "query_id": cached.get("query_id") or "",
            "fund_code": cached.get("fund_code") or fund_code,
            "fund_name": cached.get("fund_name"),
            "report": cached.get("report") or {},
            "notification": {"requested": False, "sent": False, "error": None},
            "created_at": cached.get("created_at") or datetime.now().isoformat(),
        }

    @staticmethod
    def _attach_report_details(
        report: Any,
        *,
        stage_timings: Dict[str, int],
        cache_hit: bool,
    ) -> None:
        if not isinstance(report, dict):
            return
        details = report.get("details")
        if not isinstance(details, dict):
            details = {}
            report["details"] = details
        details["stageTimingsMs"] = dict(stage_timings)
        details["cacheHit"] = bool(cache_hit)

    def _send_notification(
        self,
        *,
        fund_code: str,
        fund_name: str,
        report: Dict[str, Any],
        report_type: str,
    ) -> Dict[str, Any]:
        from src.enums import ReportType
        from src.notification import NotificationService

        notifier = NotificationService()
        if not notifier.is_available():
            message = "未配置有效的通知渠道"
            self.last_notification_error = message
            logger.warning("基金 %s 通知未发送: %s", fund_code, message)
            return {"requested": True, "sent": False, "error": message}

        payload = {
            "fund_code": fund_code,
            "fund_name": fund_name,
            "report": report,
        }
        normalized_type = ReportType.from_str(report_type)
        content = notifier.generate_fund_report([payload], report_type=normalized_type)
        try:
            if notifier.send(content):
                logger.info("基金 %s 通知发送成功", fund_code)
                return {"requested": True, "sent": True, "error": None}
            message = "所有通知渠道均发送失败"
            self.last_notification_error = message
            logger.warning("基金 %s 通知发送失败", fund_code)
            return {"requested": True, "sent": False, "error": message}
        except Exception as exc:
            message = str(exc)
            self.last_notification_error = message
            logger.error("基金 %s 通知发送异常: %s", fund_code, exc, exc_info=True)
            return {"requested": True, "sent": False, "error": message}

    def _fetch_profile(self, client: TiantianFundClient, code: str, fund_name: Optional[str]) -> Dict[str, Any]:
        detail_payload = client.get("/fundMNDetailInformation", {"FCODE": code})
        detail = _datas(detail_payload)
        if not isinstance(detail, dict) or not detail:
            raise FundAnalysisError(f"未找到基金 {code} 的详情。")

        search_name = fund_name
        if not search_name:
            search_name = detail.get("SHORTNAME") or detail.get("FULLNAME")
        return {
            "fundCode": code,
            "fundName": str(search_name or code),
            "fullName": detail.get("FULLNAME"),
            "fundType": detail.get("FTYPE"),
            "establishDate": _as_date(detail.get("ESTABDATE")),
            "fundCompany": detail.get("JJGS"),
            "managerNames": detail.get("JJJL"),
            "custodian": detail.get("TGYH"),
            "latestScale": _as_float(detail.get("ENDNAV")),
            "scaleDate": _as_date(detail.get("FEGMRQ")),
            "rating": detail.get("RLEVEL_SZ"),
            "riskLevel": detail.get("RISKLEVEL"),
            "benchmark": detail.get("PERFCMP") or detail.get("BENCH"),
            "investmentObjective": detail.get("INVTGT"),
            "investmentStrategy": detail.get("INVSTRA"),
            "managementFee": detail.get("MGREXP"),
            "custodyFee": detail.get("TRUSTEXP"),
            "salesServiceFee": detail.get("SALESEXP"),
        }

    def _fetch_nav_series(self, client: TiantianFundClient, code: str, page_size: int) -> List[Dict[str, Any]]:
        payload = client.get("/fundMNHisNetList", {"FCODE": code, "pageIndex": 1, "pagesize": page_size})
        rows = _datas(payload)
        if not isinstance(rows, list):
            raise FundAnalysisError(f"基金 {code} 未返回历史净值。")
        normalized = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            nav = _as_float(row.get("DWJZ"))
            date_text = _as_date(row.get("FSRQ"))
            if nav is None or not date_text:
                continue
            normalized.append({
                "date": date_text,
                "unitNav": nav,
                "dailyReturnPct": _as_float(row.get("JZZZL")),
                "accumulatedNav": _as_float(row.get("LJJZ")),
            })
        normalized.sort(key=lambda item: item["date"])
        return normalized

    def _fetch_period_increase(self, client: TiantianFundClient, code: str) -> List[Dict[str, Any]]:
        try:
            payload = client.get("/fundMNPeriodIncrease", {"FCODE": code})
        except FundAnalysisError as exc:
            logger.info("基金阶段涨幅获取失败: %s", exc)
            return []
        rows = _datas(payload)
        if not isinstance(rows, list):
            return []
        result = []
        for row in rows:
            if isinstance(row, dict):
                result.append({
                    "period": _format_fund_period_label(row.get("title")),
                    "returnPct": _as_float(row.get("syl")),
                    "peerAvgPct": _as_float(row.get("avg")),
                    "hs300Pct": _as_float(row.get("hs300")),
                    "rank": _as_int(row.get("rank")),
                    "peerCount": _as_int(row.get("sc")),
                })
        return result

    def _fetch_rank_diagram(self, client: TiantianFundClient, code: str) -> List[Dict[str, Any]]:
        try:
            payload = client.get("/fundRankDiagram", {"FCODE": code})
        except FundAnalysisError as exc:
            logger.info("基金排名走势获取失败: %s", exc)
            return []
        rows = _datas(payload)
        if not isinstance(rows, list):
            return []
        result = []
        for row in rows[-240:]:
            if isinstance(row, dict):
                rank = _as_int(row.get("QRANK"))
                count = _as_int(row.get("QSC"))
                result.append({
                    "date": _as_date(row.get("PDATE")),
                    "rank": rank,
                    "peerCount": count,
                    "percentile": round(rank / count * 100, 2) if rank and count else None,
                })
        return [item for item in result if item["date"]]

    def _fetch_managers(self, client: TiantianFundClient, code: str) -> List[Dict[str, Any]]:
        try:
            payload = client.get("/fundMNMangerList", {"FCODE": code})
        except FundAnalysisError as exc:
            logger.info("基金经理获取失败: %s", exc)
            return []
        rows = _datas(payload)
        if not isinstance(rows, list):
            return []
        managers = []
        for row in rows:
            if isinstance(row, dict):
                managers.append({
                    "managerNames": row.get("MGRNAME"),
                    "startDate": _as_date(row.get("FEMPDATE")),
                    "endDate": _as_date(row.get("LEMPDATE")),
                    "days": _as_int(row.get("DAYS")),
                    "tenureReturnPct": _as_float(row.get("PENAVGROWTH")),
                    "isInOffice": row.get("ISINOFFICE"),
                })
        return managers

    def _fetch_grade(self, client: TiantianFundClient, code: str) -> List[Dict[str, Any]]:
        try:
            payload = client.get("/fundGradeDetail", {"FCODE": code, "pageIndex": 1, "pageSize": 5})
        except FundAnalysisError as exc:
            logger.info("基金评级获取失败: %s", exc)
            return []
        rows = _datas(payload)
        if not isinstance(rows, list):
            return []
        return [
            {
                "date": _as_date(row.get("RDATE")),
                "zhaoshangRating": row.get("ZSPJ"),
                "shanghaiRating3y": row.get("SZPJ3"),
                "jianRating": row.get("JAPJ"),
            }
            for row in rows
            if isinstance(row, dict)
        ]

    def _fetch_basic_enrichment(
        self,
        client: TiantianFundClient,
        code: str,
        *,
        use_basic_enrichment: bool,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
        calls = {
            "performance": lambda: self._fetch_period_increase(client, code),
        }
        if use_basic_enrichment:
            calls.update({
                "ranking": lambda: self._fetch_rank_diagram(client, code),
                "managers": lambda: self._fetch_managers(client, code),
                "grade": lambda: self._fetch_grade(client, code),
            })

        results: Dict[str, List[Dict[str, Any]]] = {
            "performance": [],
            "ranking": [],
            "managers": [],
            "grade": [],
        }
        if not calls:
            return results["performance"], results["ranking"], results["managers"], results["grade"]

        with ThreadPoolExecutor(max_workers=min(4, len(calls)), thread_name_prefix="fund_basic_data_") as executor:
            future_map = {executor.submit(caller): key for key, caller in calls.items()}
            for future in as_completed(future_map):
                key = future_map[future]
                try:
                    value = future.result()
                except Exception as exc:
                    logger.info("基金 %s 基础补充数据获取失败: %s: %s", code, key, exc)
                    continue
                if isinstance(value, list):
                    results[key] = value

        return results["performance"], results["ranking"], results["managers"], results["grade"]

    def _calculate_risk(self, nav_series: List[Dict[str, Any]]) -> Dict[str, Any]:
        navs = [float(item["unitNav"]) for item in nav_series if _as_float(item.get("unitNav")) is not None]
        dates = [item["date"] for item in nav_series if _as_float(item.get("unitNav")) is not None]
        if len(navs) < 2:
            return {"dataSufficient": False, "reason": "历史净值不足"}

        returns = [(navs[i] / navs[i - 1] - 1.0) for i in range(1, len(navs)) if navs[i - 1] > 0]
        annual_factor = 252
        total_return = navs[-1] / navs[0] - 1.0
        years = max(len(returns) / annual_factor, 1 / annual_factor)
        annual_return = (1 + total_return) ** (1 / years) - 1 if total_return > -1 else None

        mean_return = sum(returns) / len(returns) if returns else 0.0
        variance = sum((r - mean_return) ** 2 for r in returns) / max(1, len(returns) - 1)
        volatility = math.sqrt(variance) * math.sqrt(annual_factor) if returns else None

        peak = navs[0]
        max_drawdown = 0.0
        current_drawdown = 0.0
        for nav in navs:
            peak = max(peak, nav)
            drawdown = nav / peak - 1.0 if peak > 0 else 0.0
            max_drawdown = min(max_drawdown, drawdown)
            current_drawdown = drawdown

        sharpe = annual_return / volatility if annual_return is not None and volatility and volatility > 0 else None
        calmar = annual_return / abs(max_drawdown) if annual_return is not None and max_drawdown < 0 else None
        enough = len(navs) >= 60
        return {
            "dataSufficient": enough,
            "sampleCount": len(navs),
            "startDate": dates[0] if dates else None,
            "endDate": dates[-1] if dates else None,
            "totalReturnPct": self._pct(total_return),
            "annualReturnPct": self._pct(annual_return),
            "annualVolatilityPct": self._pct(volatility),
            "maxDrawdownPct": self._pct(max_drawdown),
            "currentDrawdownPct": self._pct(current_drawdown),
            "sharpe": round(sharpe, 3) if sharpe is not None else None,
            "calmar": round(calmar, 3) if calmar is not None else None,
            "reason": None if enough else "历史净值少于 60 条，风险指标仅供参考。",
        }

    @staticmethod
    def _pct(value: Optional[float]) -> Optional[float]:
        return round(value * 100, 2) if value is not None and math.isfinite(value) else None

    def _build_data_coverage(self, *blocks: Any) -> Dict[str, bool]:
        keys = ["profile", "performance", "risk", "ranking", "manager", "grade", "navSeries"]
        coverage: Dict[str, bool] = {}
        for key, block in zip(keys, blocks):
            coverage[key] = bool(block)
        return coverage

    def _fetch_yingmi_professional_data(self, code: str, fund_name: str) -> Dict[str, Any]:
        provider_status: List[Dict[str, Any]] = []
        professional: Dict[str, Any] = {}
        config = get_config()
        strategy = normalize_yingmi_fund_data_strategy(getattr(config, "yingmi_fund_data_strategy", None))
        depth = normalize_yingmi_fund_analysis_depth(getattr(config, "yingmi_fund_analysis_depth", None))
        if strategy == "basic_only":
            return {
                "data": professional,
                "providerStatus": [
                    {
                        "provider": "yingmi_stargate",
                        "stage": "configure",
                        "available": False,
                        "message": "基金数据策略为仅基础数据，已跳过盈米专业诊断。",
                    }
                ],
            }
        try:
            from src.services.yingmi_stargate_client import YingmiStargateClient, YingmiStargateError

            client = YingmiStargateClient(timeout=10.0)
        except Exception as exc:
            return {
                "data": professional,
                "providerStatus": [
                    {
                        "provider": "yingmi_stargate",
                        "stage": "configure",
                        "available": False,
                        "message": str(exc),
                    }
                ],
            }

        for stage, caller in (
            ("fund_diagnosis", lambda: client.get_fund_diagnosis(code or fund_name)),
            *([] if depth == "fast" else [("fund_risk", lambda: client.analyze_fund_risk([code]))]),
        ):
            try:
                professional[stage] = caller()
                provider_status.append(
                    {
                        "provider": "yingmi_stargate",
                        "stage": stage,
                        "available": True,
                        "message": "ok",
                    }
                )
            except YingmiStargateError as exc:
                provider_status.append(
                    {
                        "provider": "yingmi_stargate",
                        "stage": stage,
                        "available": False,
                        "message": str(exc),
                    }
                )
            except Exception as exc:
                provider_status.append(
                    {
                        "provider": "yingmi_stargate",
                        "stage": stage,
                        "available": False,
                        "message": str(exc),
                    }
                )
        return {"data": professional, "providerStatus": provider_status}

    def _build_report_with_llm(
        self,
        *,
        query_id: str,
        fund_code: str,
        fund_name: str,
        report_type: str,
        data_snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        from src.analyzer import GeminiAnalyzer

        analyzer = GeminiAnalyzer()
        if not analyzer.is_available():
            raise FundAnalysisError("LLM API Key 未配置，无法生成基金分析报告。")

        prompt = self._build_llm_prompt(fund_code, fund_name, data_snapshot)
        text = analyzer.generate_text(prompt, max_tokens=2400, temperature=0.35)
        if not text:
            raise FundAnalysisError("LLM 未返回基金分析结果。")
        parsed = self._parse_llm_json(text)
        summary = parsed.get("summary") if isinstance(parsed.get("summary"), dict) else {}
        details = parsed.get("details") if isinstance(parsed.get("details"), dict) else {}

        latest = data_snapshot["navSeries"][-1]
        profile = data_snapshot["fundProfile"]
        return {
            "meta": {
                "assetType": "fund",
                "queryId": query_id,
                "fundCode": fund_code,
                "fundName": fund_name,
                "reportType": report_type,
                "createdAt": datetime.now().isoformat(),
                "latestNav": latest.get("unitNav"),
                "navDate": latest.get("date"),
                "dailyReturnPct": latest.get("dailyReturnPct"),
                "fundType": profile.get("fundType"),
            },
            "summary": {
                "allocationRating": summary.get("allocationRating") or "谨慎观察",
                "suitabilityScore": _as_int(summary.get("suitabilityScore")) or 50,
                "analysisSummary": summary.get("analysisSummary") or "基金分析结果不完整，请查看数据明细。",
                "riskSummary": summary.get("riskSummary") or "",
                "holdingAdvice": summary.get("holdingAdvice") or "",
                "suitableFor": summary.get("suitableFor") or "",
            },
            "metrics": {
                "profile": profile,
                "performance": data_snapshot.get("performance", []),
                "risk": data_snapshot.get("risk", {}),
                "ranking": data_snapshot.get("ranking", [])[-20:],
                "manager": data_snapshot.get("manager", []),
                "grade": data_snapshot.get("grade", []),
                "yingmi": data_snapshot.get("yingmi", {}),
            },
            "details": {
                "advantages": details.get("advantages") if isinstance(details.get("advantages"), list) else [],
                "risks": details.get("risks") if isinstance(details.get("risks"), list) else [],
                "watchItems": details.get("watchItems") if isinstance(details.get("watchItems"), list) else [],
                "rawText": text,
                "dataCoverage": data_snapshot.get("dataCoverage", {}),
                "providerStatus": data_snapshot.get("providerStatus", []),
            },
        }

    def _build_llm_prompt(self, fund_code: str, fund_name: str, data_snapshot: Dict[str, Any]) -> str:
        compact = self._build_compact_llm_snapshot(data_snapshot)
        return (
            "你是中国公募场外基金分析师。请只基于给定结构化数据分析，不要编造新闻、持仓或未提供的信息。\n"
            "如果数据里包含 yingmi 字段，盈米专业诊断和风险分析应作为专业判断的优先依据；天天基金、自建净值和本地指标用于补充、校验和解释。\n"
            "如果盈米不可用或部分失败，请保持原有基金分析质量，并在风险/观察项里说明专业数据覆盖不足。\n"
            "不要使用股票交易语言，不要给精确止损价/止盈价。输出 JSON，不要 Markdown。\n"
            "JSON 结构：{\n"
            '  "summary": {"allocationRating": "适合配置|谨慎观察|不建议新增|可替换", '
            '"suitabilityScore": 0-100, "analysisSummary": "...", "riskSummary": "...", '
            '"holdingAdvice": "...", "suitableFor": "..."},\n'
            '  "details": {"advantages": ["..."], "risks": ["..."], "watchItems": ["..."]}\n'
            "}\n"
            f"基金：{fund_name}({fund_code})\n"
            f"数据：{json.dumps(compact, ensure_ascii=False)}"
        )

    def _build_compact_llm_snapshot(self, data_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        nav_series = data_snapshot.get("navSeries", [])
        nav_points = nav_series if isinstance(nav_series, list) else []
        compact: Dict[str, Any] = {
            "fundProfile": data_snapshot.get("fundProfile", {}),
            "performance": data_snapshot.get("performance", []),
            "risk": data_snapshot.get("risk", {}),
            "ranking": data_snapshot.get("ranking", [])[-20:] if isinstance(data_snapshot.get("ranking"), list) else [],
            "manager": data_snapshot.get("manager", []),
            "grade": data_snapshot.get("grade", []),
            "navSummary": self._build_nav_summary(nav_points),
            "yingmi": self._compact_yingmi_data(data_snapshot.get("yingmi", {})),
            "providerStatus": data_snapshot.get("providerStatus", []),
            "dataCoverage": data_snapshot.get("dataCoverage", {}),
        }
        return compact

    @staticmethod
    def _build_nav_summary(nav_series: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not nav_series:
            return {"sampleCount": 0, "latestPoints": []}
        latest_points = [
            {
                "date": item.get("date"),
                "unitNav": item.get("unitNav"),
                "dailyReturnPct": item.get("dailyReturnPct"),
            }
            for item in nav_series[-20:]
            if isinstance(item, dict)
        ]
        first = nav_series[0] if isinstance(nav_series[0], dict) else {}
        latest = nav_series[-1] if isinstance(nav_series[-1], dict) else {}
        return {
            "sampleCount": len(nav_series),
            "start": {
                "date": first.get("date"),
                "unitNav": first.get("unitNav"),
            },
            "latest": {
                "date": latest.get("date"),
                "unitNav": latest.get("unitNav"),
                "dailyReturnPct": latest.get("dailyReturnPct"),
            },
            "latestPoints": latest_points,
        }

    def _compact_yingmi_data(self, yingmi: Any) -> Dict[str, Any]:
        if not isinstance(yingmi, dict):
            return {}
        compact: Dict[str, Any] = {}
        for key in ("fund_diagnosis", "fund_risk"):
            if key not in yingmi:
                continue
            compact[key] = self._compact_json_value(yingmi.get(key), depth=3, max_list_items=8, max_text_length=600)
        return compact

    def _compact_json_value(
        self,
        value: Any,
        *,
        depth: int,
        max_list_items: int,
        max_text_length: int,
    ) -> Any:
        if depth <= 0:
            return self._compact_scalar(value, max_text_length=max_text_length)
        if isinstance(value, dict):
            return {
                str(key): self._compact_json_value(
                    item,
                    depth=depth - 1,
                    max_list_items=max_list_items,
                    max_text_length=max_text_length,
                )
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [
                self._compact_json_value(
                    item,
                    depth=depth - 1,
                    max_list_items=max_list_items,
                    max_text_length=max_text_length,
                )
                for item in value[:max_list_items]
            ]
        return self._compact_scalar(value, max_text_length=max_text_length)

    @staticmethod
    def _compact_scalar(value: Any, *, max_text_length: int) -> Any:
        if isinstance(value, dict):
            return {"truncated": True, "keys": list(value.keys())[:12]}
        if isinstance(value, list):
            return {"truncated": True, "count": len(value)}
        if isinstance(value, str) and len(value) > max_text_length:
            return f"{value[:max_text_length]}..."
        return value

    def _parse_llm_json(self, text: str) -> Dict[str, Any]:
        match = re.search(r"\{.*\}", text, flags=re.S)
        if not match:
            raise FundAnalysisError("LLM 返回不是有效 JSON。")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise FundAnalysisError(f"LLM JSON 解析失败: {exc}") from exc
        if not isinstance(parsed, dict):
            raise FundAnalysisError("LLM JSON 根节点不是对象。")
        return parsed
