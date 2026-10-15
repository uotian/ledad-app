import asyncio
import time

from ..errors import AppError, status_of
from ..storage.diagnostics import provider_details


async def retry_transient(run, deadline):
    for attempt in range(3):
        if time.monotonic() >= deadline:
            raise TimeoutError("処理の期限を超えました。")
        try:
            return await run()
        except Exception as error:
            details = provider_details(error)
            reason = (details["reason"] or "").lower()
            hard_limit = any(
                word in reason
                for word in ("insufficient_quota", "billing", "credit", "daily", "per_day")
            ) or any(
                q["limit"] == "0"
                or any(
                    word in f"{q['metric']} {q['id']}".lower()
                    for word in ("perday", "per_day", "permonth", "per_month", "daily")
                )
                for q in details["quotas"]
            )
            status = status_of(error)
            retryable = (
                status in (408, 429, 500, 502, 503, 504)
                if status is not None
                else type(error).__name__
                in (
                    "APIConnectionError",
                    "APITimeoutError",
                    "TimeoutError",
                    "ConnectError",
                    "ReadError",
                    "ReadTimeout",
                )
            )
            delay = (
                details["retryAfterMs"] if details["retryAfterMs"] is not None else 5000
            ) / 1000
            if (
                attempt == 2
                or isinstance(error, AppError)
                or hard_limit
                or not retryable
                or delay >= deadline - time.monotonic()
            ):
                raise
            await asyncio.sleep(delay)
