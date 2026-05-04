#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the local off-exchange fund autocomplete index."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

import requests
from pypinyin import Style, lazy_pinyin


DEFAULT_OUTPUT = Path("apps/dsa-web/public/funds.index.json")
LETTERS = "abcdefghijklmnopqrstuvwxyz"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def _get_json(base_url: str, endpoint: str, params: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    url = urljoin(f"{base_url.rstrip('/')}/", endpoint.lstrip("/"))
    response = requests.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"{endpoint} returned non-object JSON")
    return payload


def _fund_company_items(payload: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    datas = payload.get("Datas")
    if not isinstance(datas, list):
        return []
    funds: List[Dict[str, Any]] = []
    for company in datas:
        if not isinstance(company, dict):
            continue
        for item in company.get("QXJJ") or []:
            if isinstance(item, dict):
                funds.append(item)
    return funds


def _fund_net_items(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    datas = payload.get("Datas")
    return [item for item in datas if isinstance(item, dict)] if isinstance(datas, list) else []


def _normalize_code(value: Any) -> str:
    text = str(value or "").strip()
    return text if len(text) == 6 and text.isdigit() else ""


def _pinyin_full(name: str) -> str:
    return "".join(lazy_pinyin(name, errors="ignore")).lower()


def _pinyin_abbr(name: str) -> str:
    return "".join(lazy_pinyin(name, style=Style.FIRST_LETTER, errors="ignore")).lower()


def _normalize_fund(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    code = _normalize_code(raw.get("FCODE") or raw.get("CODE") or raw.get("_id"))
    name = str(raw.get("SHORTNAME") or raw.get("NAME") or "").strip()
    if not code or not name:
        return None
    pinyin_abbr = str(raw.get("JP") or "").strip().lower() or _pinyin_abbr(name)
    return {
        "fundCode": code,
        "fundName": name,
        "pinyinFull": _pinyin_full(name),
        "pinyinAbbr": pinyin_abbr,
        "aliases": [],
        "fundType": str(raw.get("FTYPE") or raw.get("FUNDTYPE") or "").strip(),
        "active": True,
        "popularity": 0,
    }


def build_index(base_url: str, *, timeout: float, pause: float) -> List[Dict[str, Any]]:
    by_code: Dict[str, Dict[str, Any]] = {}
    for letter in LETTERS:
        count = 0
        try:
            payload = _get_json(base_url, "/fundSearch", {"m": 3, "key": letter}, timeout)
            err_code = payload.get("ErrCode")
            if err_code not in (None, 0, "0"):
                raise RuntimeError(str(payload.get("ErrMsg") or err_code))
            for raw in _fund_company_items(payload):
                item = _normalize_fund(raw)
                if item:
                    by_code[item["fundCode"]] = item
                    count += 1
        except Exception as exc:
            print(f"[fund-index] letter={letter} company search failed: {exc}; using fundNetList")
            count = _fetch_fund_net_letter(base_url, letter, by_code, timeout=timeout, pause=pause)

        print(f"[fund-index] letter={letter} funds={count} total={len(by_code)}")
        if pause > 0:
            time.sleep(pause)

    return sorted(by_code.values(), key=lambda item: item["fundCode"])


def _fetch_fund_net_letter(
    base_url: str,
    letter: str,
    by_code: Dict[str, Dict[str, Any]],
    *,
    timeout: float,
    pause: float,
) -> int:
    count = 0
    page_index = 1
    while True:
        payload = _get_json(
            base_url,
            "/fundNetList",
            {
                "fundtype": 0,
                "Letter": letter,
                "pageIndex": page_index,
                "pagesize": 30,
            },
            timeout,
        )
        items = _fund_net_items(payload)
        if not items:
            break
        for raw in items:
            item = _normalize_fund(raw)
            if item:
                by_code[item["fundCode"]] = item
                count += 1
        total_count = payload.get("TotalCount")
        if isinstance(total_count, int) and page_index * 30 >= total_count:
            break
        page_index += 1
        if pause > 0:
            time.sleep(pause)
    return count


def write_index(items: List[Dict[str, Any]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(items, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build apps/dsa-web/public/funds.index.json")
    parser.add_argument("--base-url", default="", help="TiantianFundApi base URL. Defaults to TIANTIAN_FUND_API_BASE_URL.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path.")
    parser.add_argument("--timeout", type=float, default=30.0, help="Request timeout in seconds.")
    parser.add_argument("--pause", type=float, default=0.15, help="Pause between requests in seconds.")
    return parser.parse_args()


def main() -> int:
    _load_dotenv(Path(".env"))
    args = parse_args()
    base_url = (args.base_url or os.getenv("TIANTIAN_FUND_API_BASE_URL") or "").strip().rstrip("/")
    if not base_url:
        print("TIANTIAN_FUND_API_BASE_URL is required. Set it in .env or pass --base-url.", file=sys.stderr)
        return 2

    items = build_index(base_url, timeout=args.timeout, pause=args.pause)
    if not items:
        print("No fund items were fetched; index was not written.", file=sys.stderr)
        return 1

    output = Path(args.output)
    write_index(items, output)
    print(f"[fund-index] wrote {len(items)} funds to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
