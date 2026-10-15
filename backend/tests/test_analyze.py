import copy
import hashlib
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ledad.meeting.models import Analyze, AnalyzeOutput
from ledad.storage.files import compact
from ledad.transport.requests import AnalyzeRequest


def inputs():
    conversation = [
        {"id": str(uuid4()), "text": "来月の導入に合意。", "timestamp": "2026-10-05T00:00:00Z"}
    ]
    output = {
        "suggestedQuestions": ["確認点は？", "確認点は？"],
        "suggestedMeetingQuestions": ["費用はいつ確定しますか？"],
        "topics": [
            {
                "id": "stable-topic",
                "title": "導入",
                "summary": "合意",

            },
        ],
        "mentions": [
            {"kind": "request", "summary": "費用確認", "evidenceId": "unknown", "quote": "元の引用"}
        ],
    }
    previous = {
        **copy.deepcopy(output),
        "updatedAt": "2026-10-05T00:02:00Z",
        "language": "ja",
        "profileKey": "{}",
        "inputKey": "old",
        "topicEvidence": {"stable-topic": conversation[0]["id"]},
    }
    return conversation, output, previous


def provider_output(output, conversation, existing=False):
    result = copy.deepcopy(output)
    result["handoffSummary"] = "以前の会話の経緯"
    result["mentions"] = []
    for topic in result["topics"]:
        topic["lastEvidenceId"] = "c1"
        topic["id"] = "t1" if existing else "n1"
    result["topicUpdates"] = result["topics"] if existing else []
    result["topicAdditions"] = [] if existing else result["topics"]
    result["topicDeletions"] = []
    del result["topics"]
    return result


@pytest.mark.parametrize(
    "mentions",
    [
        [],
        [{"kind": "request", "summary": "確認完了", "evidenceId": "unknown", "quote": "元の引用"}],
    ],
)
async def test_analyze_generates_topics_and_mentions_together(service, mentions):
    conversation, output, previous = inputs()
    session = service.sessions.create()
    mentions = [{**m, "evidenceId": conversation[0]["id"], "quote": conversation[0]["text"]} for m in mentions]
    generated = provider_output(output, conversation, existing=True)
    generated["mentions"] = [{**m, "evidenceId": "c1"} for m in mentions]
    provider = AsyncMock(return_value=generated)
    service.ai.provider.structured = provider
    body = AnalyzeRequest.model_validate(
        {
            "conversation": conversation,
            "profile": {"name": "内藤", "aliases": "Naito"},
            "language": "en",
            "previous": previous,
        }
    )
    result = await service.ai.analyze(session, body)
    assert result["topics"] == output["topics"]
    assert result["suggestedQuestions"] == output["suggestedQuestions"]
    assert result["suggestedMeetingQuestions"] == output["suggestedMeetingQuestions"]
    assert result["mentions"] == mentions
    data = provider.call_args.args[3]
    assert data == {
        "mentionTargetIds": ["c1"],
        "handoff": "",
        "summarizeThroughId": None,
        "conversation": [{**conversation[0], "id": "c1"}],
        "names": ["内藤", "Naito"],
        "language": "en",
        "previous": {"topics": [{**output["topics"][0], "id": "t1", "lastEvidenceId": "c1"}]},
        "documents": "",
    }
    assert result["language"] == "en"
    payload = {
        "version": 17,
        "conversation": conversation,
        "profileKey": compact(body.profile.wire()),
        "language": "en",
        "documents": "",
    }
    assert result["inputKey"] == hashlib.sha256(compact(payload).encode()).hexdigest()


async def test_analyze_key_changes_only_for_documents_used_by_analyze(service, document, reference):
    conversation, output, _ = inputs()
    session = service.sessions.create()
    session.documents = [document]
    session.document_reference = reference
    service.ai.provider.structured = AsyncMock(return_value=provider_output(output, conversation))
    body = AnalyzeRequest.model_validate({
        "conversation": conversation, "profile": {}, "language": "ja", "previous": None,
    })
    first = (await service.ai.analyze(session, body))["inputKey"]
    reference.summary += "背景の訂正"
    changed = (await service.ai.analyze(session, body))["inputKey"]
    assert first != changed
    reference.summary = ""
    disabled = (await service.ai.analyze(session, body))["inputKey"]
    assert disabled != changed
    document.pages[0].text += "未選択資料の訂正"
    assert (await service.ai.analyze(session, body))["inputKey"] == disabled


def test_ai_output_has_no_arbitrary_topic_or_mention_caps():
    _, output, _ = inputs()
    output["topics"] *= 101
    output["mentions"] *= 201
    assert AnalyzeOutput.model_validate(output).wire() == output


def test_legacy_analyze_without_meeting_questions_remain_readable():
    _, _, previous = inputs()
    del previous["suggestedMeetingQuestions"]
    restored = Analyze.model_validate(previous).wire()
    assert restored["suggestedMeetingQuestions"] == []
    assert restored["suggestedQuestions"] == previous["suggestedQuestions"]


async def test_analyze_endpoint_preserves_stored_session_and_rejects_ended(service):
    conversation, output, previous = inputs()
    session = service.sessions.create()
    session.status = "active"
    service.sessions.save(session)
    service.ai.provider.structured = AsyncMock(return_value=provider_output(output, conversation))
    request = {
        "id": str(uuid4()),
        "method": "POST",
        "path": f"/api/sessions/{session.id}/analyze",
        "body": compact(
            {
                "conversation": conversation,
                "profile": {"name": "内藤", "aliases": ""},
                "language": "ja",
                "previous": previous,
            }
        ),
    }
    response = await service.dispatch(request)
    assert response.status == 200
    assert service.sessions.read(session.id).analyze is None
    session.status = "ended"
    service.sessions.save(session)
    assert (await service.dispatch(request)).status == 400
    service.ai.provider.structured.assert_awaited_once()


def test_legacy_insights_are_read_as_analyze(service):
    from ledad.meeting.models import Session
    data = service.sessions.create().wire()
    _, _, previous = inputs()
    data.pop("analyze")
    previous["topics"][0].update(evidenceIds=["legacy-id"], decisions=["旧決定"], openQuestions=["旧未決事項"])
    data["insights"] = previous
    restored = Session.model_validate(data).wire()
    assert restored["analyze"] == Analyze.model_validate(previous).wire()
    assert "insights" not in restored
    assert "evidenceIds" not in restored["analyze"]["topics"][0]
    assert "decisions" not in restored["analyze"]["topics"][0]
    assert "openQuestions" not in restored["analyze"]["topics"][0]



@pytest.mark.parametrize("resumed", [False, True])
async def test_topics_follow_last_evidence_time_not_ai_order_or_summary_edits(service, resumed):
    conversation, output, previous = inputs()
    first = conversation[0]
    second = {"id": str(uuid4()), "text": "別件の予算を確認します。", "timestamp": "2026-10-05T00:01:00Z"}
    latest = {"id": str(uuid4()), "text": "導入の件に戻ります。", "timestamp": "2026-10-05T00:03:00Z"}
    conversation = [second, first, *([latest] if resumed else [])]
    old_topic = {**output["topics"][0], "summary": "要約の書き直し", "lastEvidenceId": "c3" if resumed else "c1", "id": "t1"}
    new_topic = {"id": "n1", "title": "予算", "summary": "予算を確認", "lastEvidenceId": "c2"}
    service.ai.provider.structured = AsyncMock(return_value={**output, "mentions": [], "topicUpdates": [old_topic], "topicAdditions": [new_topic], "topicDeletions": [], "handoffSummary": ""})
    body = AnalyzeRequest.model_validate({"conversation": conversation, "profile": {}, "language": "ja", "previous": previous})
    result = await service.ai.analyze(service.sessions.create(), body)
    assert [topic["title"] for topic in result["topics"]] == (
        ["予算", "導入"] if resumed else ["導入", "予算"]
    )
    assert all("lastEvidenceId" not in topic for topic in result["topics"])


async def test_topics_reject_unknown_evidence_instead_of_guessing_order(service):
    conversation, output, _ = inputs()
    generated = provider_output(output, conversation)
    generated["topicAdditions"][0]["lastEvidenceId"] = "unknown"
    service.ai.provider.structured = AsyncMock(return_value=generated)
    body = AnalyzeRequest.model_validate({"conversation": conversation, "profile": {}, "language": "ja", "previous": None})
    with pytest.raises(ValueError, match="最終発言"):
        await service.ai.analyze(service.sessions.create(), body)
