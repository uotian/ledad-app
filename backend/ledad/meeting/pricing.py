"""Meeting-time pricing snapshot. Historical amounts are never recalculated at new rates."""

import json
import re
from pathlib import Path

from ..storage.files import now_iso
from .models import Pricing, Rate


def create_pricing_snapshot(now=None):
    captured = now or now_iso()
    data = json.loads(Path(__file__).with_name("pricing.json").read_text())
    data["capturedAt"] = captured
    if captured >= "2027-01-01T00:00:00":
        rate = next(r for r in data["rates"] if r["model"] == "gemini-3.8-flash-lite-tts")
        rate.update(inputUsdPerMillion=1, cachedInputUsdPerMillion=0.25, outputUsdPerMillion=12)
    return Pricing.model_validate(data)


def estimate_usd(record, pricing):
    if record["operation"] == "live_token":
        return 0
    rate = next(
        (
            r
            for r in pricing.rates
            if r.provider == record["provider"]
            and (
                r.model == record["model"]
                or (
                    r.provider == "openai"
                    and re.fullmatch(re.escape(r.model) + r"-\d{4}-\d{2}-\d{2}", record["model"])
                )
            )
        ),
        None,
    )
    # Fill only the missing TTS rate at its introduction price; never replace saved rates.
    if rate is None and record["provider"] == "openai" and record["operation"] == "speech" and re.fullmatch(
        r"gpt-4o-mini-tts(?:-\d{4}-\d{2}-\d{2})?", record["model"]
    ):
        rate = Rate(
            provider="openai", model="gpt-4o-mini-tts",
            input_usd_per_million=0.6, cached_input_usd_per_million=0.6,
            output_usd_per_million=12, source="https://developers.openai.com/api/docs/pricing",
        )
    if rate is None and record["provider"] == "openai" and record["operation"] == "live_transcription" and re.fullmatch(
        r"gpt-live-transcribe(?:-\d{4}-\d{2}-\d{2})?", record["model"]
    ):
        rate = Rate(
            provider="openai", model="gpt-live-transcribe", input_usd_per_million=0,
            cached_input_usd_per_million=0, output_usd_per_million=0,
            audio_input_usd_per_minute=0.017,
            source="https://developers.openai.com/api/docs/pricing#transcription-and-speech",
        )
    if rate is None:
        return None
    if rate.audio_input_usd_per_minute is not None:
        seconds = record.get("audioInputSeconds")
        if seconds is None or (record["operation"] != "live_transcription" and record.get("status") != "completed"):
            return None
        return seconds / 60 * rate.audio_input_usd_per_minute
    if record["operation"] == "live_transcription":
        seconds = record.get("audioInputSeconds")
        if (
            seconds is None
            or rate.audio_tokens_per_second is None
            or rate.estimated_output_tokens_per_minute is None
        ):
            return None
        return (
            seconds
            * (
                rate.audio_tokens_per_second * rate.input_usd_per_million
                + rate.estimated_output_tokens_per_minute / 60 * rate.output_usd_per_million
            )
            / 1_000_000
        )
    output = record.get("outputTokens")
    if (
        output is None
        and record["operation"] == "speech"
        and record.get("audioOutputSeconds") is not None
        and rate.audio_tokens_per_second
    ):
        output = record["audioOutputSeconds"] * rate.audio_tokens_per_second
    count = record.get("inputTokens")
    if count is None or output is None:
        return None
    if record["operation"] == "mention_detection":
        long = rate.long_context if rate.long_context and count > rate.long_context.threshold else None
        return count * rate.input_usd_per_million * (long.input_multiplier if long else 1) / 1_000_000
    cached = min(record.get("cachedTokens") or 0, count)
    writes = min(record.get("cacheWriteTokens") or 0, count - cached)
    long = rate.long_context if rate.long_context and count > rate.long_context.threshold else None
    write_rate = (
        rate.cache_write_usd_per_million
        if rate.cache_write_usd_per_million is not None
        else rate.input_usd_per_million
    )
    return (
        (
            (count - cached - writes) * rate.input_usd_per_million
            + cached * rate.cached_input_usd_per_million
            + writes * write_rate
        )
        * (long.input_multiplier if long else 1)
        + output * rate.output_usd_per_million * (long.output_multiplier if long else 1)
    ) / 1_000_000


def meeting_cost(session, records):
    pricing = session.pricing
    result = {"pricing": pricing.model_dump(by_alias=True, exclude_none=True) if pricing else None}
    for provider in ("openai", "gemini"):
        if not pricing:
            result[provider] = {"yen": None, "incomplete": True}
            continue
        amounts = [
            estimate_usd(r, pricing)
            for r in records
            if r["sessionId"] == session.id
            and r["provider"] == provider
            and r["operation"] != "live_token"
        ]
        known = [value for value in amounts if value is not None]
        result[provider] = {
            "yen": None if amounts and not known else sum(known) * pricing.usd_to_jpy,
            "incomplete": len(known) != len(amounts),
        }
    return result
