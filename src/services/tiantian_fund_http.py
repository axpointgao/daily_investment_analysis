# -*- coding: utf-8 -*-
"""HTTP helpers for TiantianFundApi calls."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

RETRYABLE_STATUS_CODES = {500, 502, 503, 504}


def get_tiantian_fund_json(
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = 8.0,
    attempts: int = 3,
    retry_delay: float = 0.35,
) -> Dict[str, Any]:
    """GET TiantianFundApi JSON with short retries for proxy/upstream flaps."""
    last_error: Optional[BaseException] = None
    total_attempts = max(1, attempts)

    for attempt in range(1, total_attempts + 1):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            if response.status_code in RETRYABLE_STATUS_CODES and attempt < total_attempts:
                last_error = requests.HTTPError(
                    f"{response.status_code} Server Error for url: {response.url}",
                    response=response,
                )
                logger.warning(
                    "TiantianFundApi retryable status %s on attempt %s/%s: %s",
                    response.status_code,
                    attempt,
                    total_attempts,
                    response.url,
                )
                time.sleep(retry_delay * attempt)
                continue
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("TiantianFundApi returned non-object JSON")
            return payload
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as exc:
            last_error = exc
            if attempt >= total_attempts:
                break
            logger.warning(
                "TiantianFundApi request failed on attempt %s/%s: %s",
                attempt,
                total_attempts,
                exc,
            )
            time.sleep(retry_delay * attempt)

    if last_error is not None:
        raise last_error
    raise RuntimeError("TiantianFundApi request failed")
