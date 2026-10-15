"""Only allowlisted provider metadata is persisted, never raw API errors."""

import json
import math
import os
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from uuid import uuid4

from ..errors import is_timeout, status_of
from .files import compact, now_iso


def redact(message):
    message = re.sub(r'\bBearer\s+[^\s"\'<>]+', "Bearer [redacted]", message, flags=re.IGNORECASE)
    message = re.sub(r"\b(?:sk-[a-zA-Z0-9_-]+|AIza[a-zA-Z0-9_-]+)", "[redacted]", message)
    return re.sub(
        r'([?&](?:key|api_key|token)=)[^\s&#"\']+', r"\1[redacted]", message, flags=re.IGNORECASE
    )[:2000]


def identifier(value, limit):
    return (
        value
        if isinstance(value, str)
        and len(value) <= limit
        and re.fullmatch(r"[a-zA-Z0-9_./:-]+", value)
        else None
    )


def provider_details(error):
    raw = getattr(error, "body", None) or getattr(error, "response_json", None) or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw[:65536])
        except ValueError:
            raw = {}
    payload = raw.get("error", raw) if isinstance(raw, dict) else {}
    if not isinstance(payload, dict):
        payload = {}
    reason = identifier(
        payload.get("status", payload.get("code", getattr(error, "code", None))), 160
    )
    if is_timeout(error):
        reason = "timeout"
    messages = [payload.get("message") or str(error)]
    quotas, delays = [], []
    headers = (
        getattr(error, "headers", None)
        or getattr(getattr(error, "response", None), "headers", {})
        or {}
    )
    retry = headers.get("retry-after")
    if isinstance(retry, str):
        try:
            delays.append(max(0, float(retry) * 1000))
        except ValueError:
            try:
                delays.append(
                    max(
                        0, (parsedate_to_datetime(retry) - datetime.now(UTC)).total_seconds() * 1000
                    )
                )
            except (ValueError, TypeError):
                pass
    details = payload.get("details", [])
    for detail in details[:40] if isinstance(details, list) else []:
        if not isinstance(detail, dict):
            continue
        kind = detail.get("@type", "")
        if kind.endswith("/google.rpc.ErrorInfo"):
            reason = identifier(detail.get("reason"), 160) or reason
        elif kind.endswith("/google.rpc.RetryInfo"):
            duration = detail.get("retryDelay")
            try:
                if isinstance(duration, str) and re.fullmatch(r"\d+(\.\d+)?s", duration):
                    delays.append(float(duration[:-1]) * 1000)
                elif isinstance(duration, dict):
                    delays.append(
                        max(
                            0,
                            float(duration.get("seconds", 0)) * 1000
                            + float(duration.get("nanos", 0)) / 1_000_000,
                        )
                    )
            except (TypeError, ValueError):
                pass
        elif kind.endswith("/google.rpc.QuotaFailure"):
            violations = detail.get("violations", [])
            for violation in violations[: 20 - len(quotas)] if isinstance(violations, list) else []:
                if not isinstance(violation, dict):
                    continue
                messages.append(violation.get("description"))
                limit = str(violation.get("quotaValue", ""))
                quotas.append(
                    {
                        "metric": identifier(violation.get("quotaMetric"), 240),
                        "id": identifier(violation.get("quotaId"), 240),
                        "limit": limit
                        if len(limit) <= 40 and re.fullmatch(r"\d+(\.\d+)?", limit)
                        else None,
                    }
                )
    text = "\n".join(m[:8192] for m in messages[:24] if isinstance(m, str))
    summaries = []
    for pattern, explanation in [
        (r"\btoo many requests\b", "リクエストが多すぎる旨の説明"),
        (r"\brate[ -]limit(?:s|ed)?\b", "レート制限についての説明"),
        (
            r"\b(?:quota|limit) (?:has been )?exceeded\b|\bexceeded (?:your |the |current )*(?:quota|limit)\b",
            "利用上限を超えた旨の説明",
        ),
        (
            r"\bdaily (?:request |token |usage )*(?:quota|limit)\b|\b(?:requests?|tokens?) per day\b|\bRPD\b",
            "日次の利用上限についての説明",
        ),
        (
            r"\b(?:requests?|tokens?) per minute\b|\b(?:RPM|TPM)\b",
            "1分あたりの利用上限についての説明",
        ),
        (r"\b(?:requests?|tokens?) per second\b", "1秒あたりの利用上限についての説明"),
        (r"\bmonthly (?:usage |spend )*(?:quota|limit|cap)\b", "月次の利用上限についての説明"),
        (r"\b(?:concurrent requests?|concurrency limit)\b", "同時リクエスト数の制限についての説明"),
        (
            r"\b(?:spend[ -]based|spending|spend) (?:rate )?(?:limit|cap)\b",
            "支出額の上限についての説明",
        ),
        (
            r"\b(?:credit balance|credits?) (?:is |are |has been |have been )?(?:depleted|exhausted|insufficient)\b|\binsufficient (?:credits?|balance)\b",
            "前払い残高の不足についての説明",
        ),
        (
            r"\b(?:billing (?:is )?(?:disabled|not enabled)|enable billing)\b",
            "課金の有効化が必要という説明",
        ),
        (r"\b(?:free[ -]tier|paid[ -]tier)\b", "無料枠または有料枠についての説明"),
        (
            r"\b(?:overloaded|capacity exhausted|insufficient capacity|service unavailable)\b",
            "サービスの混雑または容量不足についての説明",
        ),
    ]:
        if re.search(pattern, text, re.IGNORECASE):
            summaries.append(explanation)
    for metric, limit in re.findall(
        r"\bquota exceeded for metric:\s*(generativelanguage\.googleapis\.com/[a-z_]{1,160}),\s*limit:\s*(\d{1,12})(?![\d.])",
        text,
        re.IGNORECASE,
    ):
        summaries.append(f"上限超過の制限項目: {metric}; 上限値: {limit}")
    units = {"request": "リクエスト", "token": "トークン"}
    periods = {"second": "1秒", "minute": "1分", "hour": "1時間", "day": "1日", "month": "1か月"}
    limits = re.findall(
        r"\b(?:limit|quota)(?:\s+(?:of|is)|:)?\s*(\d{1,12})\s+(requests?|tokens?)\s+per\s+(second|minute|hour|day|month)\b",
        text,
        re.IGNORECASE,
    )
    limits += [
        (count, unit, period)
        for unit, period, count in re.findall(
            r"\b(requests?|tokens?) per (second|minute|hour|day|month)(?:\s*\((?:RPM|TPM|RPD)\))?\s*:\s*limit\s*:?\s*(\d{1,12})(?![\d.])",
            text,
            re.IGNORECASE,
        )
    ]
    for count, unit, period in limits:
        summaries.append(
            f"{periods[period.lower()]}あたりの{units[unit.lower().rstrip('s')]}上限: {count}"
        )
    for count, unit in re.findall(
        r"\b(?:please )?(?:retry|try again) (?:in|after)\s+(\d{1,8}(?:\.\d{1,3})?)\s*(seconds?|minutes?|hours?|s)\b",
        text,
        re.IGNORECASE,
    ):
        summaries.append(
            f"説明文中の再試行待ち時間: {count}{'時間' if unit.lower().startswith('h') else '分' if unit.lower().startswith('m') else '秒'}"
        )
    return {
        "reason": reason,
        "retryAfterMs": max((d for d in delays if math.isfinite(d)), default=None),
        "quotas": quotas,
        "messagePresent": bool(text),
        "messageSummary": list(dict.fromkeys(summaries))[:16],
    }


class Diagnostics:
    def __init__(self, config):
        self.config = config

    def log(self, event, error=None):
        record = {
            **event,
            "id": str(uuid4()),
            "occurredAt": event.get("occurredAt") or now_iso(),
            "message": redact(event.get("message", "")),
        }
        if error is not None:
            record["providerDetails"] = provider_details(error)
            status = status_of(error)
            if isinstance(status, int):
                record.setdefault("status", status)
        try:
            directory = self.config.data_dir / "logs"
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = directory / "errors.jsonl"
            if path.exists() and path.stat().st_size >= 2 * 1024 * 1024:
                previous = directory / "errors.jsonl.1"
                if previous.exists():
                    previous.replace(directory / "errors.jsonl.2")
                path.replace(previous)
            with path.open("a", encoding="utf-8") as stream:
                os.chmod(path, 0o600)
                stream.write(compact(record) + "\n")
            return True
        except OSError:
            return False
