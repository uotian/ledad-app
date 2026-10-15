import copy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ledad.errors import AppError
from ledad.meeting.commands import SessionCommand, apply_command
from ledad.meeting.models import Transcript
from ledad.storage.files import compact

NOW = "2026-10-08T00:00:00Z"


def apply(session, command):
    return apply_command(session, SessionCommand(command=command).command, NOW)


def row(text, second):
    return Transcript(
        id=str(uuid4()),
        text=text,
        translation="旧訳",
        translation_language="en",
        timestamp=f"2026-10-05T00:00:{second:02}Z",

        analyzed=True,
        source="display",
        disposition="open",
    )


@pytest.fixture
def meeting(service):
    session = service.sessions.create()
    session.transcripts = [
        row("区間より前", 0),
        row("分", 1),
        row("かりますか？", 2),
        row("区間より後", 3),
    ]
    return session


def refinement(session):
    return {
        "type": "refinement",
        "expectedIds": [t.id for t in session.transcripts[1:3]],
        "result": {
            "originals": [{"id": t.id, "text": t.text} for t in session.transcripts[1:3]],
            "text": "分かりますか？",
            "translation": "Do you understand?",
            "translationLanguage": "en",

        },
    }


def test_refinement_preserves_time_text_and_old_references_without_mutating_input(meeting):
    command = refinement(meeting)
    result = apply(meeting, command)
    assert len(result.transcripts) == 3 and len(meeting.transcripts) == 4
    merged = result.transcripts[1]
    assert merged.timestamp == meeting.transcripts[1].timestamp
    assert merged.text == "分かりますか？" and merged.live_text == "分\nかりますか？"
    assert merged.translation == "Do you understand?" and merged.corrected_at == NOW
    assert merged.matches(meeting.transcripts[2].id)
    assert not merged.matches(meeting.transcripts[3].id)
    assert result.transcripts[0] == meeting.transcripts[0]
    assert result.transcripts[2] == meeting.transcripts[3]
    assert apply(result, command).transcripts == result.transcripts


def test_meeting_times_keep_original_segments_and_ignore_late_processing(meeting, service):
    meeting.transcripts = meeting.transcripts[:3]
    result = apply(meeting, refinement(meeting))
    assert result.meeting_started_at == "2026-10-05T00:00:00.000Z"
    assert result.meeting_last_at == "2026-10-05T00:00:02.000Z"
    assert result.updated_at == NOW
    result.status = "ended"
    result.ended_at = NOW
    result = apply(result, {"type": "chat-start", "id": str(uuid4()), "text": "会議後の相談"})
    result = apply(result, {"type": "minutes", "minutes": {
        "summary": ["後でまとめた議事録"], "decisions": [], "actions": [], "questions": [], "caveats": [],
    }})
    result.analyze = None
    service.sessions.save(result)
    restored = service.sessions.read(result.id)
    assert restored.meeting_last_at == "2026-10-05T00:00:02.000Z"
    legacy = restored.wire()
    del legacy["meetingStartedAt"], legacy["meetingLastAt"]
    restored = type(restored).model_validate(legacy)
    assert restored.meeting_started_at == "2026-10-05T00:00:00.000Z"
    assert restored.meeting_last_at == "2026-10-05T00:00:02.000Z"


@pytest.mark.parametrize("case", ["missing", "duplicate", "order", "changed", "manual", "empty"])
def test_stale_refinement_never_partially_applied(meeting, case):
    command = refinement(meeting)
    if case == "missing":
        command["result"]["originals"].pop()
    if case == "duplicate":
        command["expectedIds"].append(command["expectedIds"][0])
    if case == "order":
        command["result"]["originals"].reverse()
    if case == "changed":
        meeting.transcripts[1].text = "手で訂正しました"
    if case == "manual":
        meeting.transcripts[1].source = "manual"
    if case == "empty":
        command["result"]["text"] = " "
    assert apply(meeting, command).transcripts == meeting.transcripts


def test_candidates_playback_and_dismiss_follow_merged_transcript_references(meeting):
    target = meeting.transcripts[2].id
    candidate = {
        "title": "回答",
        "text": "答えます",
        "spokenText": "答えます",

        "caution": "",
    }
    ready = apply(meeting, {"type": "candidates", "targetId": target, "candidates": [candidate]})
    fixed = apply(ready, refinement(ready))
    assert fixed.candidates[0].target_id == target
    deferred = apply(fixed, {"type": "dismiss", "targetId": target, "status": "deferred"})
    assert deferred.transcripts[1].disposition == "deferred"
    assert deferred.candidates[0].status == "deferred"
    record = {
        "id": str(uuid4()),
        "kind": "answer",
        "candidateId": fixed.candidates[0].id,
        "targetId": target,
        "page": None,
        "plannedText": "答えます",
        "completedText": "",
        "status": "playing",
        "startedAt": NOW,
        "endedAt": None,
        "elapsedSeconds": 0,
    }
    playing = apply(fixed, {"type": "utterance", "record": record})
    assert playing.candidates[0].status == "speaking"
    assert playing.transcripts[1].disposition == "open"
    record.update(status="completed", completedText="答えます", endedAt=NOW)
    finished = apply(playing, {"type": "utterance", "record": record})
    assert len(finished.utterances) == 1
    assert finished.candidates[0].status == "spoken"
    assert finished.transcripts[1].disposition == "answered"


def test_restore_never_restarts_playback_and_cancelled_chat_ignores_late_result(meeting):
    chat_id = str(uuid4())
    pending = apply(
        meeting, {"type": "chat-start", "id": chat_id, "text": "私的な相談", "retry": False}
    )
    restored = apply(pending, {"type": "restore"})
    assert restored.chats[0].status == "failed"
    assert (
        apply(restored, {"type": "chat-result", "id": chat_id, "reply": "遅れた応答"})
        .chats[0]
        .status
        == "failed"
    )
    retried = apply(
        restored, {"type": "chat-start", "id": chat_id, "text": "私的な相談", "retry": True}
    )
    assert len(retried.chats) == 1 and retried.chats[0].status == "pending"
    completed = apply(retried, {"type": "chat-result", "id": chat_id, "reply": "回答"})
    assert completed.chats[0].status == "applied"
    assert apply(completed, {"type": "chat-failed", "id": chat_id}).chats[0].status == "applied"
    assert completed.candidates == [] and completed.utterances == []


async def test_summarized_meeting_cannot_resume_or_replace_minutes(meeting, service):
    minutes = {"summary": ["確定した要約"], "decisions": [], "actions": [], "questions": [], "caveats": []}
    ended = apply(meeting, {"type": "end"})
    service.sessions.save(ended)
    assert service.sessions.list()[0]["hasMinutes"] is False
    summarized = apply(ended, {"type": "minutes", "minutes": minutes})
    service.sessions.save(summarized)
    assert service.sessions.list()[0]["hasMinutes"] is True
    for command in ({"type": "start"}, {"type": "minutes", "minutes": minutes}):
        with pytest.raises(AppError, match="要約済み"):
            apply(summarized, command)

    async def send(action, data=None, method="POST"):
        return await service.dispatch({
            "id": str(uuid4()), "path": f"/api/sessions/{meeting.id}{action}",
            "method": method, "body": compact(data) if data is not None else "",
        })

    service.ai.minutes = AsyncMock()
    assert (await send("/minutes")).status == 400
    service.ai.minutes.assert_not_called()
    stale = ended.wire()
    assert (await send("/commands", {"snapshot": stale, "command": {"type": "start"}})).status == 400
    assert (await send("/commands", {"snapshot": stale, "command": {"type": "minutes", "minutes": {**minutes, "summary": ["上書き"]}}})).status == 400
    assert (await send("", stale, "PUT")).status == 400
    stale.update(status="active", minutes=None)
    assert (await send("", stale, "PUT")).status == 400
    assert service.sessions.read(meeting.id).minutes == summarized.minutes
    assert service.sessions.read(meeting.id).status == "ended"


def test_meeting_list_sorts_by_creation_not_speech_or_updates(service):
    older = service.sessions.create("古い会議")
    latest = service.sessions.create("新しい会議")
    empty = service.sessions.create("発言なし")
    older.created_at = "2026-10-05T01:00:00Z"
    latest.created_at = "2026-10-06T01:00:00Z"
    older.transcripts = [row("開始", 0), row("最後", 56)]
    latest.transcripts = [row("開始", 0), row("最後", 40)]
    older.updated_at = "2026-10-09T01:00:00Z"
    latest.updated_at = "2026-10-08T01:00:00Z"
    empty.created_at = empty.started_at = "2026-10-04T01:00:00Z"
    for session in (older, latest, empty):
        service.sessions.save(session)
    assert [s["id"] for s in service.sessions.list()] == [latest.id, older.id, empty.id]
    older.updated_at = "2026-10-10T01:00:00Z"
    service.sessions.save(older)
    assert [s["id"] for s in service.sessions.list()] == [latest.id, older.id, empty.id]


def test_chat_keeps_send_and_reply_times_separate_and_persists_them(meeting, service):
    chat_id = str(uuid4())
    pending = apply(meeting, {"type": "chat-start", "id": chat_id, "text": "相談"})
    assert pending.chats[0].created_at == NOW
    assert pending.chats[0].replied_at is None
    failed = apply(pending, {"type": "chat-failed", "id": chat_id})
    assert failed.chats[0].replied_at is None
    retried = apply(failed, {"type": "chat-start", "id": chat_id, "text": "相談", "retry": True})
    reply_time = "2026-10-08T00:00:30Z"
    command = SessionCommand(command={"type": "chat-result", "id": chat_id, "reply": "回答"})
    completed = apply_command(retried, command.command, reply_time)
    service.sessions.save(completed)
    chat = service.sessions.read(completed.id).chats[0]
    assert chat.created_at == NOW
    assert chat.replied_at == reply_time
    assert apply(completed, {"type": "restore"}).chats[0].replied_at == reply_time
    legacy = chat.wire()
    del legacy["repliedAt"]
    assert type(chat).model_validate(legacy).replied_at is None


async def test_command_saves_snapshot_and_preserves_server_identity_and_pricing(service):
    session = service.sessions.create()

    async def send(command, snapshot=None):
        return await service.dispatch(
            {
                "id": str(uuid4()),
                "path": f"/api/sessions/{session.id}/commands",
                "method": "POST",
                "body": compact({"command": command, "snapshot": snapshot}),
            }
        )

    snapshot = session.wire()
    snapshot["title"] = "開始直前の編集"
    started = await send({"type": "start"}, snapshot)
    assert started.status == 200
    assert started.value["title"] == "開始直前の編集"
    assert started.value["pricing"]
    ended = await send({"type": "end"})
    assert ended.value["endedAt"] and ended.value["startedAt"] == started.value["startedAt"]
    resumed = await send({"type": "start"})
    assert resumed.status == 400
    assert service.sessions.read(session.id).ended_at == ended.value["endedAt"]
    forged = copy.deepcopy(ended.value)
    forged["shareToken"] = str(uuid4())
    assert (await send({"type": "end"}, forged)).status == 400
    assert service.sessions.read(session.id).status == "ended"


async def test_lost_command_reply_can_be_retried_once_without_duplicate_candidates(service):
    session = service.sessions.create()
    command_id = str(uuid4())
    body = {
        "commandId": command_id,
        "snapshot": session.wire(),
        "command": {
            "type": "candidates",
            "targetId": None,
            "candidates": [
                {
                    "title": "確認",
                    "text": "確認します",
                    "spokenText": "確認します",
                    "caution": "",

                }
            ],
        },
    }
    request = {
        "id": str(uuid4()),
        "path": f"/api/sessions/{session.id}/commands",
        "method": "POST",
        "body": compact(body),
    }
    first = await service.dispatch(request)
    # Simulate a restart after commit but before the UI received its reply.
    from ledad.service import Service

    restarted = Service(service.config)
    second = await restarted.dispatch(request)
    assert first.status == second.status == 200
    assert first.value == second.value
    assert len(second.value["candidates"]) == 1
    assert second.value["appliedCommands"] == [command_id]
