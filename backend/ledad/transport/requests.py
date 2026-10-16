import re
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from ..meeting.models import Analyze, Id, Language, Model
from ..storage.usage import LiveReport


class FileInput(Model):
    name: str = Field(min_length=1, max_length=250)
    data: str = Field(max_length=28_000_000)
    kind: Literal["presentation", "reference", "script"]


class Request(Model):
    id: str = Field(min_length=1, max_length=200)
    path: str = Field(max_length=1000)
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
    body: str | None = Field(default=None, max_length=12_000_000)
    file: FileInput | None = None
    stream: bool = False


class CreateSession(Model):
    id: Id | None = None
    # Older clients may still send audience. Presenter creation is retired.
    mode: Literal["audience"] = "audience"
    title: str | None = Field(default=None, max_length=120)


class ConnectionSettings(Model):
    base_url: str = Field(max_length=2048)


class AIModeSettings(Model):
    mode: Literal["openai", "gemini"]


class RefinementSettings(Model):
    provider: Literal["openai", "gemini"]


class LiveSettings(Model):
    provider: Literal["gemini", "apple", "openai"]


class Profile(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=601)] = ""
    aliases: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""

    def terms(self):
        return list(dict.fromkeys(filter(None, re.split(r"[\s,、]+", f"{self.name} {self.aliases}"))))

    def names(self):
        names = []
        for name in re.split(r"[,、\n]", ",".join([self.name, self.aliases])):
            normalized = " ".join(name.split())
            names.extend([normalized, *normalized.split(" ")])
        return list(dict.fromkeys(n for n in names if n))


class LiveToken(Model):
    session_id: Id
    provider: Literal["gemini", "openai"] | None = None
    profile: Profile = Field(default_factory=Profile)


class Speech(Model):
    session_id: Id
    text: str = Field(min_length=1, max_length=4000)
    language: Language
    voice: Literal["Kore", "Puck", "Aoede", "Charon", "marin", "cedar"]


class Consultation(Model):
    chat_id: Id
    language: Language


class Generation(Model):
    target_id: Id | None
    instruction: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)] = ""


class TextInput(Model):
    text: str = Field(min_length=1, max_length=20_000)


class Translation(TextInput):
    translation_language: Language = "ja"


class Draft(Model):
    text: str = Field(max_length=20_000)
    translation: str = Field(max_length=40_000)


class Preview(TextInput):
    translation_language: Language
    previous: Draft | None = None


class ConversationItem(Model):
    id: Id
    text: str = Field(max_length=100_000)
    timestamp: str = Field(max_length=100)
    settled: bool = False
    end_timestamp: str | None = None

    def wire(self):
        data = super().wire()
        if not self.settled:
            data.pop("settled")
        if self.end_timestamp is None:
            data.pop("endTimestamp")
        return data


class AnalyzeRequest(Model):
    language: Language
    profile: Profile
    conversation: list[ConversationItem] = Field(max_length=20_000)
    previous: Analyze | None


class Refinement(Model):
    profile: Profile = Field(default_factory=Profile)
    pcm: str = Field(min_length=4, max_length=8_106_668, pattern=r"^[A-Za-z0-9+/]*={0,2}$")
    transcript_ids: list[Id] = Field(min_length=1, max_length=300)
    translation_language: Language


class UsageReport(Model):
    id: Id
    session_id: Id
    status: Literal["running", "completed", "failed", "cancelled"]
    audio_input_seconds: float = Field(ge=0, le=86400)
    live_reports: list[LiveReport] = Field(default_factory=list, max_length=10000)
    live_messages: list[Annotated[str, StringConstraints(max_length=2_000_000)]] = Field(
        default_factory=list, max_length=2000
    )
    live_messages_truncated: bool = False


class ErrorNotice(Model):
    session_id: Id
    occurred_at: str
    message: str = Field(min_length=1, max_length=2000)
