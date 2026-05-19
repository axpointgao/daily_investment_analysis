# -*- coding: utf-8 -*-

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services.iwencai_astock_client import IwencaiAStockClient


def test_iwencai_astock_query_uses_selector_skill_headers() -> None:
    response = MagicMock()
    response.ok = True
    response.json.return_value = {
        "datas": [{"股票代码": "600519.SH", "股票简称": "贵州茅台"}],
        "code_count": 1,
        "chunks_info": {"query": "ROE大于10%"},
    }

    with patch("src.services.iwencai_astock_client.requests.post", return_value=response) as post:
        client = IwencaiAStockClient(api_key="test-key")
        result = client.select("ROE大于10%", limit=20)

    headers = post.call_args.kwargs["headers"]
    body = post.call_args.kwargs["json"]
    assert headers["Authorization"] == "Bearer test-key"
    assert headers["X-Claw-Skill-Id"] == "hithink-astock-selector"
    assert headers["X-Claw-Skill-Version"] == "1.0.0"
    assert len(headers["X-Claw-Trace-Id"]) == 64
    assert body["query"] == "ROE大于10%"
    assert body["limit"] == "20"
    assert result.code_count == 1
    assert result.rows[0].code == "600519"
    assert result.rows[0].name == "贵州茅台"
