import asyncio
import json
import time
from unittest.mock import AsyncMock

import pytest

from ledad.ai.retry import retry_transient
from ledad.errors import AppError
from ledad.storage.diagnostics import provider_details


class ProviderError(Exception):
    def __init__(self, status=429, body=None, headers=None):
        super().__init__("private user input sk-secret")
        self.status_code = status
        self.body = body or {}
        self.headers = headers or {}


def quota_error(metric="generate_requests_per_minute", limit="10"):
    return ProviderError(
        body={
            "error": {
                "status": "RESOURCE_EXHAUSTED",
                "message": "非公開の会話と認証情報",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                        "violations": [
                            {
                                "quotaMetric": "generativelanguage.googleapis.com/" + metric,
                                "quotaId": "RequestsPerMinute",
                                "quotaValue": limit,
                                "quotaDimensions": {"project": "private-project"},
                                "description": "private-input",
                            }
                        ],
                    },
                    {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "3.5s"},
                ],
            }
        }
    )


async def test_three_attempts_and_provider_delay(monkeypatch):
    sleep = AsyncMock()
    monkeypatch.setattr("ledad.ai.retry.asyncio.sleep", sleep)
    error = ProviderError()
    run = AsyncMock(side_effect=error)
    with pytest.raises(ProviderError) as raised:
        await retry_transient(run, time.monotonic() + 90)
    assert raised.value is error
    assert run.await_count == 3
    assert [call.args[0] for call in sleep.call_args_list] == [5, 5]
    sleep.reset_mock()
    error = quota_error()
    error.headers = {"retry-after": "4"}
    run = AsyncMock(side_effect=[error, "ok"])
    assert await retry_transient(run, time.monotonic() + 90) == "ok"
    sleep.assert_awaited_once_with(4)


@pytest.mark.parametrize(
    "error",
    [
        ProviderError(400),
        ProviderError(401),
        ProviderError(403),
        AppError("empty output", 502),
        ValueError("validation failure"),
        quota_error("generate_requests_per_model_per_day"),
        quota_error(limit="0"),
        ProviderError(body={"code": "insufficient_quota"}),
        ProviderError(headers={"retry-after": "120"}),
    ],
)
async def test_no_retry_for_permanent_failure_or_delay_beyond_deadline(error):
    run = AsyncMock(side_effect=error)
    with pytest.raises(type(error)) as raised:
        await retry_transient(run, time.monotonic() + 90)
    assert raised.value is error
    run.assert_awaited_once()


async def test_cancellation_while_waiting_sends_no_more_requests():
    started = asyncio.Event()

    async def fail():
        started.set()
        raise ProviderError()

    run = AsyncMock(side_effect=fail)
    task = asyncio.create_task(retry_transient(run, time.monotonic() + 90))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    run.assert_awaited_once()


def test_diagnostic_metadata_excludes_provider_text_keys_and_project():
    details = provider_details(quota_error())
    assert details == {
        "reason": "RESOURCE_EXHAUSTED",
        "retryAfterMs": 3500,
        "messagePresent": True,
        "messageSummary": [],
        "quotas": [
            {
                "metric": "generativelanguage.googleapis.com/generate_requests_per_minute",
                "id": "RequestsPerMinute",
                "limit": "10",
            }
        ],
    }
    encoded = json.dumps(details, ensure_ascii=False)
    assert "非公開" not in encoded and "private" not in encoded and "sk-secret" not in encoded


@pytest.mark.parametrize("retry_after", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_invalid_retry_delay_never_poisoned_usage_json(retry_after):
    details = provider_details(ProviderError(headers={"retry-after": retry_after}))
    json.dumps(details, allow_nan=False)


@pytest.mark.parametrize(
    "message,expected",
    [
        (
            "Rate limit reached. Requests per minute (RPM): Limit 10, Used 10.",
            "1分あたりのリクエスト上限: 10",
        ),
        ("You have a limit of 100 requests per day.", "1日あたりのリクエスト上限: 100"),
        ("Your prepay credit balance is depleted.", "前払い残高の不足についての説明"),
        ("Service unavailable, model overloaded.", "サービスの混雑または容量不足についての説明"),
        ("Please retry in 12.5s.", "説明文中の再試行待ち時間: 12.5秒"),
    ],
)
def test_provider_explanation_is_summarized_without_affecting_retry(message, expected):
    details = provider_details(
        ProviderError(body={"message": message + " private-meeting sk-secret"})
    )
    assert expected in details["messageSummary"]
    assert details["retryAfterMs"] is None
    assert "private-meeting" not in json.dumps(details)
