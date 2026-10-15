from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ledad.ai.analyze_context import prepare_context, source_key
from ledad.meeting.models import Analyze
from ledad.transport.requests import AnalyzeRequest


def entries():
    start = datetime(2026, 10, 14, 10, tzinfo=UTC)
    return [
        {"id": str(uuid4()), "text": f"発言{i}",
         "timestamp": (start + timedelta(seconds=i * 15)).isoformat(), "settled": True}
        for i in range(16)
    ]


def previous(conversation, covered=0):
    return Analyze.model_validate({
        "topics": [{"id": "old", "title": "以前の話", "summary": "経緯"}],
        "topicEvidence": {"old": conversation[0]["id"]},
        "mentions": [], "updatedAt": "2026-10-14T10:04:00+00:00",
        "startedAt": "2026-10-14T10:03:00+00:00",
        "language": "ja", "profileKey": '{"name":"","aliases":""}', "inputKey": "old",
        "context": {"summary": "以前の経緯", "coveredCount": covered,
                    "sourceKey": source_key(conversation[:covered])} if covered else None,
    })


def test_cutoff_is_previous_start_minus_one_minute_not_completion_or_count():
    conversation = entries()
    old = previous(conversation)
    _, _, covered, end = prepare_context(conversation, old, old.profile_key, "ja")
    assert covered == 0
    assert end == 8  # 10:02:00以降は原文。最低発言数の条件はない。
    assert conversation[end]["timestamp"].endswith("10:02:00+00:00")


def test_unfixed_live_and_fixed_block_crossing_cutoff_stay_verbatim():
    conversation = entries()
    old = previous(conversation)
    conversation[2].pop("settled")
    assert prepare_context(conversation, old, old.profile_key, "ja")[3] == 2
    conversation[2]["settled"] = True
    conversation[2]["endTimestamp"] = "2026-10-14T10:02:00+00:00"
    assert prepare_context(conversation, old, old.profile_key, "ja")[3] == 2


@pytest.mark.parametrize("change", ["edit", "delete", "profile", "language"])
def test_changed_archived_source_or_profile_rebuilds_without_stale_summary(change):
    conversation = entries()
    old = previous(conversation, 5)
    profile, language = old.profile_key, "ja"
    if change == "edit":
        conversation[0]["text"] = "訂正"
    elif change == "delete":
        del conversation[0]
    elif change == "profile":
        profile = "changed"
    else:
        language = "en"
    assert prepare_context(conversation, old, profile, language) == (None, None, 0, 0)


async def test_incremental_summary_raw_overlap_and_historical_topic_order(service, monkeypatch):
    monkeypatch.setattr("ledad.ai.tasks.now_iso", lambda: "2026-10-14T10:03:00+00:00")
    conversation = entries()
    old = previous(conversation, 5)
    service.ai.provider.structured = AsyncMock(return_value={
        "topicUpdates": [{"id": "t1", "title": "以前", "summary": "古い話", "lastEvidenceId": "c1"}],
        "topicAdditions": [{"id": "n1", "title": "現在", "summary": "新しい話", "lastEvidenceId": "c16"}],
        "topicDeletions": [],
        "mentions": [], "suggestedQuestions": ["確認は？"], "suggestedMeetingQuestions": [],
        "handoffSummary": "以前の経緯に追加分を反映",
    })
    request = AnalyzeRequest.model_validate({
        "conversation": conversation, "previous": old.wire(), "profile": {}, "language": "ja",
    })
    result = await service.ai.analyze(service.sessions.create(), request)
    data = service.ai.provider.structured.call_args.args[3]
    assert data["handoff"] == "以前の経緯"
    assert [entry["id"] for entry in data["conversation"]] == [f"c{i}" for i in range(6, 17)]
    assert data["summarizeThroughId"] == "c8"
    assert data["previous"]["topics"][0]["lastEvidenceId"] == "c1"
    assert result["context"]["coveredCount"] == 8
    assert result["context"]["sourceKey"] == source_key(conversation[:8])
    assert result["context"]["summary"] == "以前の経緯に追加分を反映"
    assert [topic["title"] for topic in result["topics"]] == ["以前", "現在"]
    assert result["topicEvidence"]["old"] == conversation[0]["id"]
    assert "handoffSummary" not in result
    assert result["startedAt"] <= result["updatedAt"]
    restored = Analyze.model_validate(result)
    request.previous = restored
    service.ai.provider.structured.return_value.update(topicUpdates=[], topicAdditions=[])
    again = await service.ai.analyze(service.sessions.create(), request)
    next_data = service.ai.provider.structured.call_args.args[3]
    assert next_data["handoff"] == result["context"]["summary"]
    assert [entry["id"] for entry in next_data["conversation"]] == [f"c{i}" for i in range(9, 17)]
    assert next_data["summarizeThroughId"] is None
    assert again["context"] == result["context"]


async def test_no_eligible_prefix_keeps_context_and_failure_does_not_mutate_it(service):
    conversation = entries()
    old = previous(conversation, 8)
    old.started_at = "2026-10-14T10:03:00+00:00"
    request = AnalyzeRequest.model_validate({
        "conversation": conversation, "previous": old.wire(), "profile": {}, "language": "ja",
    })
    original = request.previous.wire()
    service.ai.provider.structured = AsyncMock(return_value={
        "topicUpdates": [], "topicAdditions": [], "topicDeletions": [], "mentions": [], "suggestedQuestions": [], "suggestedMeetingQuestions": [],
        "handoffSummary": "直近の原文を誤って要約しても採用しない",
    })
    result = await service.ai.analyze(service.sessions.create(), request)
    assert service.ai.provider.structured.call_args.args[3]["summarizeThroughId"] is None
    assert result["context"] == old.context.wire()
    assert request.previous.wire() == original
    service.ai.provider.structured.side_effect = RuntimeError("failed")
    with pytest.raises(RuntimeError):
        await service.ai.analyze(service.sessions.create(), request)
    assert request.previous.wire() == original
