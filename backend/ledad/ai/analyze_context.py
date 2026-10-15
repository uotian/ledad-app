"""Keep mutable speech verbatim; compact only an unchanged, settled prefix."""

import hashlib
from datetime import datetime, timedelta

from ..meeting.models import AnalyzeContext
from ..storage.files import compact


def source_key(conversation):
    return hashlib.sha256(compact(conversation).encode()).hexdigest()


def prepare_context(conversation, previous, profile_key, language):
    context = previous.context if previous else None
    if previous and (previous.profile_key != profile_key or previous.language != language):
        previous = None
        context = None
    if context and (
        context.covered_count > len(conversation)
        or context.source_key != source_key(conversation[:context.covered_count])
    ):
        # 原文の訂正・削除後は要約を作り直す。Topicsは別に全件を渡して訂正する。
        previous = None
        context = None
    covered = context.covered_count if context else 0
    end = covered
    if conversation and previous and previous.started_at:
        cutoff = datetime.fromisoformat(previous.started_at) - timedelta(minutes=1)
        while end < len(conversation):
            entry = conversation[end]
            if not entry.get("settled", False) or datetime.fromisoformat(
                entry.get("endTimestamp", entry["timestamp"])
            ) >= cutoff:
                break
            end += 1
    return previous, context, covered, end


def updated_context(conversation, context, covered, end, summary):
    if end == covered:
        return context
    if not summary.strip():
        raise ValueError("引き継ぎ要約が空です")
    return AnalyzeContext(
        summary=summary, covered_count=end, source_key=source_key(conversation[:end])
    )
