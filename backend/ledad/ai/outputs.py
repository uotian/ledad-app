from typing import Annotated

from pydantic import Field

from ..meeting.models import CandidateDraft, ConversationTerm, Mention, Model, Topic


class AnalyzedTopic(Topic):
    last_evidence_id: str


class Analysis(Model):
    glossary: list[ConversationTerm] = Field(max_length=100)
    suggested_questions: list[str]
    suggested_meeting_questions: list[str]
    topic_updates: list[AnalyzedTopic]
    topic_additions: list[AnalyzedTopic]
    topic_deletions: list[str]
    handoff_summary: str = Field(max_length=6000)
    mentions: list[Mention]


class DocumentReference(Model):
    summary: str = Field(min_length=1, max_length=6_000)
    glossary: list[Annotated[str, Field(min_length=1, max_length=50, pattern=r"^[^<>\r\n]+$")]] = Field(max_length=100)



class Translation(Model):
    translation: str


class Consultation(Model):
    reply: str = Field(min_length=1, max_length=100_000)


class Candidates(Model):
    note: str
    candidates: list[CandidateDraft]
