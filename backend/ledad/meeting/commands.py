"""Meeting state transitions. Device events are inputs, never hardware operations."""

from typing import Annotated, Literal
from uuid import uuid4

from pydantic import Field

from ..errors import AppError
from .models import (
    Candidate,
    CandidateDraft,
    Chat,
    Id,
    Language,
    LiveSegment,
    Minutes,
    Model,
    Session,
    Utterance,
)


class Lifecycle(Model):
    type: Literal["restore", "start", "end"]


class CandidatesReady(Model):
    type: Literal["candidates"]
    target_id: Id | None
    candidates: list[CandidateDraft]


class Dismiss(Model):
    type: Literal["dismiss"]
    target_id: Id | None
    status: Literal["deferred", "skipped"]


class Playback(Model):
    type: Literal["utterance"]
    record: Utterance


class Original(Model):
    id: Id
    text: str


class Refinement(Model):
    originals: list[Original]
    text: str
    translation: str
    translation_language: Language



class Refine(Model):
    type: Literal["refinement"]
    expected_ids: list[Id]
    result: Refinement


class ChatStart(Model):
    type: Literal["chat-start"]
    id: Id
    text: str = Field(min_length=1, max_length=100_000)
    retry: bool = False


class ChatResult(Model):
    type: Literal["chat-result"]
    id: Id
    reply: str = Field(min_length=1, max_length=100_000)


class ChatFailed(Model):
    type: Literal["chat-failed"]
    id: Id


class RecordMinutes(Model):
    type: Literal["minutes"]
    minutes: Minutes


Command = Annotated[
    Lifecycle
    | CandidatesReady
    | Dismiss
    | Playback
    | Refine
    | ChatStart
    | ChatResult
    | ChatFailed
    | RecordMinutes,
    Field(discriminator="type"),
]


class SessionCommand(Model):
    command_id: Id = Field(default_factory=lambda: str(uuid4()))
    snapshot: Session | None = None
    command: Command


def apply_command(original: Session, command: Command, now: str):
    session = original.model_copy(deep=True)
    if command.type == "restore":
        for candidate in session.candidates:
            if candidate.status == "speaking":
                candidate.status = "ready"
        for chat in session.chats:
            if chat.status == "pending":
                chat.status = "failed"
        for utterance in session.utterances:
            if utterance.status == "playing":
                utterance.status, utterance.ended_at = "interrupted", now
    elif command.type == "start":
        if session.minutes is not None:
            raise AppError("要約済みの会議は再開できません。")
        if session.status == "ended":
            raise AppError("終了した会議は再開できません。")
        session.status = "active"
        session.started_at = session.started_at or now
        session.ended_at = None
    elif command.type == "end":
        session.status = "ended"
        session.ended_at = session.ended_at or now
    elif command.type == "candidates":
        for candidate in session.candidates:
            if candidate.status == "ready":
                candidate.status = "skipped"
        session.candidates.extend(
            Candidate.model_validate(
                {
                    **candidate.wire(),
                    "id": str(uuid4()),
                    "targetId": command.target_id,
                    "createdAt": now,
                    "status": "ready",
                }
            )
            for candidate in command.candidates
        )
    elif command.type == "dismiss":
        for candidate in session.candidates:
            if candidate.status == "ready":
                candidate.status = command.status
        for transcript in session.transcripts:
            if transcript.matches(command.target_id):
                transcript.disposition = command.status
    elif command.type == "utterance":
        record = command.record
        index = next((i for i, u in enumerate(session.utterances) if u.id == record.id), None)
        if index is None:
            session.utterances.append(record)
        else:
            session.utterances[index] = record
        for candidate in session.candidates:
            if candidate.id == record.candidate_id:
                candidate.status = (
                    "spoken"
                    if record.status == "completed"
                    else "ready"
                    if record.status == "failed"
                    else "speaking"
                )
        if record.status == "completed" and record.kind == "answer":
            for transcript in session.transcripts:
                if transcript.matches(record.target_id):
                    transcript.disposition = "answered"
    elif command.type == "refinement":
        refine(session, command, now)
    elif command.type == "chat-start":
        chat = next((c for c in session.chats if c.id == command.id), None)
        if command.retry:
            if chat is None or chat.kind != "consultation" or chat.status != "failed":
                raise AppError("再試行する相談が見つかりません。")
            chat.status, chat.reply = "pending", ""
            chat.replied_at = None
        elif chat is None:
            session.chats.append(
                Chat(
                    id=command.id,
                    text=command.text.strip(),
                    kind="consultation",
                    reply="",
                    status="pending",
                    created_at=now,
                )
            )
        else:
            raise AppError("この相談はすでに登録されています。")
    elif command.type in ("chat-result", "chat-failed"):
        chat = next(
            (c for c in session.chats if c.id == command.id and c.kind == "consultation"), None
        )
        if chat and chat.status == "pending":
            chat.status = "applied" if command.type == "chat-result" else "failed"
            if command.type == "chat-result":
                chat.reply = command.reply
                chat.replied_at = now
    elif command.type == "minutes":
        if session.minutes is not None:
            raise AppError("要約済みの会議は再要約できません。")
        if session.status != "ended":
            raise AppError("会議を終了してから記録を作成してください。")
        session.minutes = command.minutes
    session.updated_at = now
    return Session.model_validate(session.wire())


def refine(session, command, now):
    result = command.result
    ids = set(command.expected_ids)
    originals = [t for t in session.transcripts if t.id in ids]
    if (
        not originals
        or len(ids) != len(command.expected_ids)
        or len(originals) != len(ids)
        or len(result.originals) != len(originals)
        or not result.text.strip()
        or any(
            t.corrected_at or t.source == "manual" or t.id != before.id or t.text != before.text
            for t, before in zip(originals, result.originals)
        )
    ):
        return  # An older async result must never overwrite newer or manual text.
    first = originals[0]
    merged = first.model_copy(deep=True)
    merged.text, merged.translation = result.text, result.translation
    merged.translation_language = result.translation_language
    merged.analyzed = True
    merged.corrected_at = now
    merged.live_text = "\n".join(t.text for t in originals)
    merged.live_segments = [
        LiveSegment(id=t.id, text=t.text, timestamp=t.timestamp, disposition=t.disposition)
        for t in originals
    ]
    merged.disposition = (
        first.disposition if all(t.disposition == first.disposition for t in originals) else "open"
    )
    session.transcripts = [
        merged if t.id == first.id else t
        for t in session.transcripts
        if t.id == first.id or t.id not in ids
    ]
