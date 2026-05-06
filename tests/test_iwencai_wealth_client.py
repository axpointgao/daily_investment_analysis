# -*- coding: utf-8 -*-

from datetime import date
from unittest.mock import MagicMock, patch

from src.services.iwencai_wealth_client import IwencaiWealthClient


def test_iwencai_wealth_search_query_includes_product_type_and_fields() -> None:
    response = MagicMock()
    response.ok = True
    response.json.return_value = {
        "datas": [
            {
                "产品代码": "YH0662195.YH",
                "产品简称": "中银理财-稳富全球配置7天持有期1号A",
                "产品公布代码": "CYQWFQQPZ7D1A",
                "发行机构简称": "中银理财",
                "风险等级": "较低风险",
                "投资品种": "固定收益类",
            }
        ]
    }
    with patch("src.services.iwencai_wealth_client.requests.post", return_value=response) as post:
        client = IwencaiWealthClient(api_key="test-key")
        products = client.search_products("中银理财-稳富全球配置7天持有期1号A")

    body = post.call_args.kwargs["json"]
    query = body["query"]
    assert "银行理财" in query
    assert "产品公布代码" in query
    assert "发行机构简称" in query
    assert "风险等级" in query
    assert "投资品种" in query
    assert products[0].product_code == "YH0662195.YH"
    assert products[0].public_code == "CYQWFQQPZ7D1A"


def test_iwencai_wealth_search_retries_with_simplified_query_when_empty() -> None:
    empty_response = MagicMock()
    empty_response.ok = True
    empty_response.json.return_value = {"datas": []}
    retry_response = MagicMock()
    retry_response.ok = True
    retry_response.json.return_value = {
        "datas": [
            {
                "产品代码": "YH0662195.YH",
                "产品简称": "中银理财-稳富全球配置7天持有期1号A",
                "产品公布代码": "CYQWFQQPZ7D1A",
            }
        ]
    }
    with patch("src.services.iwencai_wealth_client.requests.post", side_effect=[empty_response, retry_response]) as post:
        client = IwencaiWealthClient(api_key="test-key")
        products = client.search_products("中银理财-稳富全球配置7天持有期1号A")

    assert len(products) == 1
    assert post.call_args_list[1].kwargs["headers"]["X-Claw-Call-Type"] == "retry"
    assert post.call_args_list[1].kwargs["json"]["query"] == "中银理财-稳富全球配置7天持有期1号A 银行理财"


def test_iwencai_wealth_historical_nav_query_includes_date_and_fields() -> None:
    response = MagicMock()
    response.ok = True
    response.json.return_value = {
        "datas": [
            {
                "单位净值": "1.0256",
                "净值日期": "20260103",
            }
        ]
    }
    with patch("src.services.iwencai_wealth_client.requests.post", return_value=response) as post:
        client = IwencaiWealthClient(api_key="test-key")
        nav = client.get_historical_nav("YH0662195.YH", date(2026, 1, 3))

    query = post.call_args.kwargs["json"]["query"]
    assert "YH0662195.YH" in query
    assert "银行理财" in query
    assert "20260103" in query
    assert "历史净值" in query
    assert nav is not None
    assert nav.unit_nav == 1.0256
    assert nav.nav_date == date(2026, 1, 3)


def test_iwencai_wealth_historical_nav_uses_dated_nav_columns_not_after_target() -> None:
    response = MagicMock()
    response.ok = True
    response.json.return_value = {
        "datas": [
            {
                "产品代码": "YH0662195.YH",
                "单位净值[20260506]": 1.0256,
                "单位净值[20260430]": 1.0234,
                "单位净值[20260429]": 1.0222,
            }
        ]
    }
    with patch("src.services.iwencai_wealth_client.requests.post", return_value=response):
        client = IwencaiWealthClient(api_key="test-key")
        nav = client.get_historical_nav("YH0662195.YH", date(2026, 5, 1))

    assert nav is not None
    assert nav.unit_nav == 1.0234
    assert nav.nav_date == date(2026, 4, 30)
