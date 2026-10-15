"""Meeting AI use cases, independent of React, IPC and HTTP."""

import hashlib
from datetime import datetime
from pathlib import Path

from ..meeting.models import Minutes
from ..meeting.policy import documents_for, glossary_for, meeting_evidence
from ..storage.files import compact, now_iso
from .analyze_context import prepare_context, updated_context
from .analyze_ids import AnalyzeIds
from .mentions import analyze_mentions
from .outputs import (
    Analysis,
    Candidates,
    Confirmation,
    Consultation,
    DocumentReference,
    Translation,
)

LANGUAGES = {"ja": "日本語", "en": "English", "zh": "简体中文", "fr": "Français"}


def prompt(name):
    return (Path(__file__).with_name("prompts") / f"{name}.txt").read_text()


class MeetingAI:
    def __init__(self, provider):
        self.provider = provider

    async def prepare_document(self, session, content):
        return await self.provider.structured(
            DocumentReference, "document_preparation", prompt("document"), {}, session.id,
            content=content,
        )

    async def translate(self, text, context, language, session):
        return await self.provider.structured(
            Translation,
            "transcript_translation",
            prompt("translation"),
            {
                "text": text,
                "precedingContext": context,
                "translationLanguage": LANGUAGES[language],
                "glossary": glossary_for(session),
            },
            session.id,
            ["translationLanguage", "glossary", "precedingContext"],
        )

    async def preview(self, session, text, language, previous):
        return await self.provider.structured(
            Translation,
            "transcript_preview",
            prompt("preview"),
            {
                "text": text,
                "targetLanguage": LANGUAGES[language],
                "glossary": glossary_for(session),
                "context": [t.text for t in session.transcripts[-3:]],
                "previous": previous,
            },
            session.id,
            ["targetLanguage", "glossary", "context"],
            include_usage_id=True,
        )

    async def minutes(self, session):
        return await self.provider.structured(
            Minutes, "meeting_minutes", prompt("minutes"), meeting_evidence(session), session.id
        )

    async def consult(self, session, chat_id, language, on_text=None):
        index = next(i for i, c in enumerate(session.chats) if c.id == chat_id)
        meeting = meeting_evidence(session)
        for transcript in meeting["transcripts"]:
            del transcript["translation"]
        return await self.provider.structured(
            Consultation,
            "meeting_consultation",
            prompt("consultation"),
            {
                "replyLanguage": LANGUAGES[language],
                "question": session.chats[index].text,
                "meeting": meeting,
                "documents": documents_for(session),
                "history": [
                    {"user": c.text, "assistant": c.reply}
                    for c in session.chats[:index]
                    if c.kind == "consultation" and c.status == "applied"
                ][-12:],
            },
            session.id,
            ["replyLanguage", "documents"],
            on_text=on_text,
        )

    async def candidates(self, session, target_id, instruction):
        target = next((t for t in session.transcripts if t.matches(target_id)), None)
        target_language = session.settings.translation_language or "ja"
        data = {
            "translationLanguage": LANGUAGES[target_language],
            "userRequest": instruction,
            "speechLanguage": LANGUAGES[session.settings.language],
            "meeting": meeting_evidence(session),
            "documents": documents_for(session),
            "previousCandidates": [
                {"text": c.text, "spokenText": c.spoken_text} for c in session.candidates[-3:]
            ],
        }
        if target:
            data["targetQuestion"] = target.wire()
        result = await self.provider.structured(
            Candidates, "meeting_candidates", prompt("candidates"), data, session.id
        )
        if session.settings.language != target_language and result["candidates"]:
            confirmation = await self.provider.structured(
                Confirmation,
                "candidate_confirmation",
                prompt("confirmation"),
                {
                    "translationLanguage": LANGUAGES[target_language],
                    "note": result["note"],
                    "candidates": [
                        {k: c[k] for k in ("spokenText", "title", "caution")}
                        for c in result["candidates"]
                    ],
                },
                session.id,
            )
            if len(confirmation["candidates"]) != len(result["candidates"]):
                raise ValueError("確認文が不足しています")
            result["note"] = confirmation["note"]
            for candidate, translated in zip(result["candidates"], confirmation["candidates"]):
                candidate.update(translated)
        for candidate in result["candidates"]:
            candidate["translationLanguage"] = target_language
        return result

    async def mentions(self, session, body):
        return await analyze_mentions(self.provider, session.id, body)

    async def analyze(self, session, body):
        started_at = now_iso()
        conversation = [c.wire() for c in body.conversation]
        ordered = sorted(conversation, key=lambda entry: datetime.fromisoformat(entry["timestamp"]))
        profile_key = compact(body.profile.wire())
        documents = documents_for(session)
        _, context, covered, end = prepare_context(
            ordered, body.previous, profile_key, body.language
        )
        previous = body.previous
        ids = AnalyzeIds(ordered, previous)
        previous_data = None
        if previous:
            previous_data = {
                "topics": [
                    {**topic.wire(), "id": ids.topics[topic.id],
                     "lastEvidenceId": ids.evidence.get(previous.topic_evidence.get(topic.id))}
                    for topic in previous.topics
                ],
            }
        result = await self.provider.structured(
            Analysis,
            "meeting_analyze",
            prompt("analyze"),
            {
                "language": body.language,
                "names": body.profile.names(),
                "documents": documents,
                "handoff": context.summary if context else "",
                "summarizeThroughId": ids.evidence[ordered[end - 1]["id"]] if end > covered else None,
                "conversation": ids.conversation([
                    {key: entry[key] for key in ("id", "text", "timestamp")}
                    for entry in ordered[covered:]
                ]),
                "previous": previous_data,
            },
            session.id,
            ["language", "names", "documents"],
            "conversation",
        )
        result = ids.restore(result)
        # AIの配列順ではなく、根拠発言の時刻で話題を並べます。
        evidence_order = {
            entry["id"]: index
            for index, entry in enumerate(ordered)
        }
        if any(topic.get("lastEvidenceId") not in evidence_order for topic in result["topics"]):
            raise ValueError("話題の最終発言が会話内に見つかりません")
        topics = [
            {key: value for key, value in topic.items() if key != "lastEvidenceId"}
            for topic in sorted(
                result["topics"], key=lambda topic: evidence_order[topic["lastEvidenceId"]]
            )
        ]
        next_context = updated_context(
            ordered, context, covered, end, result["handoffSummary"]
        )
        payload = {
            "version": 16,
            "conversation": conversation,
            "profileKey": profile_key,
            "language": body.language,
            "documents": documents,
        }
        return {
            **{key: value for key, value in result.items() if key != "handoffSummary"},
            "topics": topics,
            "mentions": [],
            "mentionSources": {},
            "startedAt": started_at,
            "topicEvidence": {topic["id"]: topic["lastEvidenceId"] for topic in result["topics"]},
            "context": next_context.wire() if next_context else None,
            "updatedAt": now_iso(),
            "language": body.language,
            "profileKey": profile_key,
            "inputKey": hashlib.sha256(compact(payload).encode()).hexdigest(),
        }
