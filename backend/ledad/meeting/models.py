"""Persisted/wire contracts. Camel-case aliases preserve existing meeting files."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

Language = Literal["ja", "en", "zh", "fr"]
# Legacy Presenter fields remain in the persisted contract to preserve existing files.
Mode = Literal["presenter", "audience"]
ID_PATTERN = r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"
Id = Annotated[str, StringConstraints(pattern=ID_PATTERN)]
Text = Annotated[str, StringConstraints(max_length=100_000)]
PositiveInt = Annotated[int, Field(strict=True, gt=0)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
        strict=True,
        allow_inf_nan=False,
    )

    def wire(self):
        return self.model_dump(by_alias=True, exclude_none=False, mode="json")


class Page(Model):
    number: PositiveInt
    text: Text


class Document(Model):
    id: Id
    name: str = Field(max_length=250)
    kind: Literal["presentation", "reference", "script"]
    format: Literal["pdf", "text", "image", "presentation"]
    pages: list[Page] = Field(max_length=200)
    size: Nonnegative
    # Only new uploads opt into preparation; legacy originals remain local.
    preparation_pending: bool = False


class Script(Model):
    page: PositiveInt
    original: Text
    spoken: Text


class MeetingDocumentReference(Model):
    document_ids: list[Id] = Field(max_length=30)
    summary: str = Field(default="", max_length=6_000, validation_alias=AliasChoices("summary", "markdown"))
    glossary: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(
        default_factory=list, max_length=100
    )

    @field_validator("glossary", mode="before")
    @classmethod
    def migrate_glossary(cls, value):
        # 旧会議の用語オブジェクトは読み込み時だけ変換します。
        if isinstance(value, list):
            return [entry.get("term") if isinstance(entry, dict) else entry for entry in value]
        return value


Disposition = Literal["open", "deferred", "skipped", "answered"]


class LiveSegment(Model):
    id: Id
    text: Text
    timestamp: str
    disposition: Disposition


class Transcript(LiveSegment):
    translation: Text
    source: Literal["microphone", "display", "mixed", "manual"]

    analyzed: bool
    live_segments: list[LiveSegment] | None = Field(default=None, max_length=300)
    live_text: Text | None = None
    corrected_at: str | None = None
    translation_language: Language | None = None

    def matches(self, target_id: str | None) -> bool:
        return bool(target_id) and (
            self.id == target_id or any(p.id == target_id for p in self.live_segments or [])
        )

    def wire(self):
        # Optional fields in the TS contract are absent, never null.
        return self.model_dump(by_alias=True, exclude_none=True, mode="json")


class CandidateDraft(Model):
    title: str
    text: str
    spoken_text: str
    translation_language: Language = "ja"
    caution: str


class Candidate(Model):
    id: Id
    title: str
    text: Text
    spoken_text: Text
    translation_language: Language = "ja"
    caution: str
    target_id: str | None
    created_at: str
    status: Literal["ready", "deferred", "skipped", "speaking", "spoken"]


class Utterance(Model):
    id: Id
    kind: Literal["speech", "presentation", "question", "answer"]
    candidate_id: str | None
    target_id: str | None
    page: PositiveInt | None
    planned_text: Text
    completed_text: Text
    status: Literal["playing", "interrupted", "completed", "failed"]
    started_at: str
    ended_at: str | None
    elapsed_seconds: Nonnegative


class Question(Model):
    question: str
    answer: str
    status: Literal["answered", "unanswered", "uncertain"]
    evidence_ids: list[str]


class Minutes(Model):
    summary: list[str]
    decisions: list[str]
    actions: list[str]
    questions: list[Question]
    caveats: list[str]


class Settings(Model):
    language: Language
    translation_language: Language | None = None
    input: Literal["microphone", "display", "mixed"]
    voice: Literal["Kore", "Puck", "Aoede", "Charon", "marin", "cedar"]
    vad_silence_ms: Literal[50, 100, 200, 300, 500] = 100
    fix_interval_seconds: Literal[15, 30, 60, 120] = 30
    listening_limit_minutes: Literal[10, 30, 60, 90] = 30

    @field_validator("listening_limit_minutes", mode="before")
    @classmethod
    def migrate_listening_limit(cls, value):
        return 10 if value == 3 else value

    @field_validator("input", mode="before")
    @classmethod
    def migrate_manual(cls, value):
        return "microphone" if value == "manual" else value


class Chat(Model):
    id: Id
    text: Text
    kind: Literal["instruction", "consultation"] = "instruction"
    reply: Text = ""
    created_at: str
    replied_at: str | None = None
    status: Literal["pending", "applied", "failed"]


class Topic(Model):
    id: str
    title: str
    summary: str


class Mention(Model):
    kind: Literal["mention", "question", "request"]
    summary: str
    evidence_id: str
    quote: str


class AnalyzeOutput(Model):
    suggested_questions: list[str]
    suggested_meeting_questions: list[str]
    topics: list[Topic]
    mentions: list[Mention]


class AnalyzeContext(Model):
    summary: str = Field(min_length=1, max_length=6000)
    covered_count: int = Field(ge=1)
    source_key: str


class Analyze(AnalyzeOutput):
    started_at: str | None = None
    context: AnalyzeContext | None = None
    topic_evidence: dict[str, str] = Field(default_factory=dict)
    mention_sources: dict[str, str] = Field(default_factory=dict)
    suggested_questions: list[str] = Field(default_factory=list)
    suggested_meeting_questions: list[str] = Field(default_factory=list)
    updated_at: str
    language: Language
    profile_key: str = Field(max_length=1000)
    input_key: str = Field(max_length=100)


class MentionAnalysis(Model):
    mentions: list[Mention] = Field(default_factory=list)
    mention_sources: dict[str, str] = Field(default_factory=dict)
    updated_at: str
    language: Language
    profile_key: str = Field(max_length=1000)
    input_key: str = Field(max_length=100)


class LongContext(Model):
    threshold: float = Field(gt=0)
    input_multiplier: float = Field(gt=0)
    output_multiplier: float = Field(gt=0)


class Rate(Model):
    provider: Literal["openai", "gemini"]
    model: str
    input_usd_per_million: Nonnegative
    cached_input_usd_per_million: Nonnegative
    output_usd_per_million: Nonnegative
    source: str
    cache_write_usd_per_million: Nonnegative | None = None
    long_context: LongContext | None = None
    audio_tokens_per_second: float | None = Field(default=None, gt=0)
    estimated_output_tokens_per_minute: Nonnegative | None = None
    audio_input_usd_per_minute: Nonnegative | None = None


class Pricing(Model):
    version: str
    captured_at: str
    checked_on: str
    usd_to_jpy: float = Field(gt=0)
    exchange_rate_date: str
    exchange_rate_source: str
    rates: list[Rate]


class Session(Model):
    id: Id
    share_token: Id
    title: str = Field(max_length=120)
    mode: Mode
    status: Literal["preparing", "active", "ended"]
    created_at: str
    updated_at: str
    meeting_started_at: str | None = None
    meeting_last_at: str | None = None
    started_at: str | None
    ended_at: str | None
    settings: Settings
    pricing: Pricing | None = None
    documents: list[Document] = Field(max_length=30)
    document_reference: MeetingDocumentReference | None = None
    scripts: list[Script] = Field(max_length=200)
    current_page: PositiveInt
    presentation_document_id: str | None
    transcripts: list[Transcript] = Field(max_length=10_000)
    candidates: list[Candidate] = Field(max_length=1000)
    chats: list[Chat] = Field(max_length=1000)
    utterances: list[Utterance] = Field(max_length=10_000)
    minutes: Minutes | None
    analyze: Analyze | None = Field(default=None, validation_alias=AliasChoices("analyze", "insights"))
    mention_analysis: MentionAnalysis | None = None
    caption: str = Field(max_length=4000)
    applied_commands: list[Id] = Field(default_factory=list, max_length=128)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value):
        return value.strip() or "新しい会議"

    @model_validator(mode="after")
    def record_meeting_times(self):
        entries = [
            (entry.text, entry.timestamp)
            for transcript in self.transcripts
            for entry in [transcript, *(transcript.live_segments or [])]
        ] + [(entry.completed_text, entry.started_at) for entry in self.utterances]
        times = []
        for text, timestamp in entries:
            if not text.strip():
                continue
            try:
                time = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            except ValueError:
                continue
            if time.tzinfo is not None:
                times.append(time.astimezone(UTC))
        self.meeting_started_at = (
            min(times).isoformat(timespec="milliseconds").replace("+00:00", "Z") if times else None
        )
        self.meeting_last_at = (
            max(times).isoformat(timespec="milliseconds").replace("+00:00", "Z") if times else None
        )
        return self

    def wire(self):
        data = super().wire()
        data["transcripts"] = [t.wire() for t in self.transcripts]
        if self.pricing:
            data["pricing"] = self.pricing.model_dump(by_alias=True, exclude_none=True)
        return data
