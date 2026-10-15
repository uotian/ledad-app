import asyncio
import json
from contextlib import asynccontextmanager
from threading import Lock
from typing import Literal
from uuid import uuid4

from pydantic import Field

from ..errors import AppError, status_of
from ..meeting.models import Id, Model, Nonnegative
from .api_details import safe_body
from .diagnostics import provider_details
from .files import now_iso, write_json
from .sessions import require_id


class LiveReport(Model):
    at: str
    input_tokens: Nonnegative | None
    output_tokens: Nonnegative | None
    total_tokens: Nonnegative | None


class UsageRecord(Model):
    id: Id
    session_id: Id | None
    provider: Literal["openai", "gemini"]
    operation: str = Field(max_length=80)
    model: str = Field(max_length=120)
    started_at: str
    ended_at: str | None
    status: Literal["running", "completed", "failed", "cancelled"]
    input_tokens: Nonnegative | None = None
    output_tokens: Nonnegative | None = None
    cached_tokens: Nonnegative | None = None
    cache_write_tokens: Nonnegative | None = None
    reasoning_tokens: Nonnegative | None = None
    total_tokens: Nonnegative | None = None
    audio_input_seconds: Nonnegative | None = None
    audio_output_seconds: Nonnegative | None = None
    input_characters: Nonnegative | None = None
    provider_request_id: str | None = Field(default=None, max_length=200)
    error_code: str | None = Field(default=None, max_length=80)
    error_details: dict | None = None
    unused: bool = False
    live_reports: list[LiveReport] = Field(default_factory=list, max_length=10000)

    def wire(self):
        data = super().wire()
        if self.error_details is None:
            data.pop("errorDetails")
        return data


class Usage:
    def __init__(self, config):
        self.config = config
        self._cache = {}
        self._cache_lock = Lock()

    def path(self, record_id):
        return self.config.data_dir / "usage" / (require_id(record_id) + ".json")

    def save(self, record):
        # Revalidate changes before they reach the on-disk contract.
        validated = UsageRecord.model_validate(record.wire())
        write_json(self.path(record.id), validated.wire())

    def read(self, record_id):
        try:
            return UsageRecord.model_validate_json(self.path(record_id).read_text())
        except (OSError, ValueError):
            raise AppError("利用記録が見つかりません。", 404) from None

    def detail_path(self, record):
        root = self.config.data_dir
        if record.session_id:
            root = root / "sessions" / require_id(record.session_id)
        return root / "usage-details" / (require_id(record.id) + ".json")

    def details(self, record):
        try:
            return json.loads(self.detail_path(record).read_text())
        except FileNotFoundError:
            return {"request": None, "response": None, "error": None}

    def capture(self, record, **parts):
        # A late API completion must not recreate a deleted meeting's private bodies.
        if record.session_id and not (
            self.config.data_dir / "sessions" / require_id(record.session_id) / "session.json"
        ).exists():
            return
        details = self.details(record)
        details.update(safe_body(parts, (self.config.openai_key, self.config.gemini_key)))
        write_json(self.detail_path(record), details)

    def list(self):
        # Cost polling must not parse the entire historical ledger every time.
        # Paths and file metadata detect external updates, deletion and data-dir changes.
        # The lock serializes overlapping scans; callers run this work off the event loop.
        with self._cache_lock:
            return self._list()

    def _list(self):
        records = []
        seen = set()
        for path in (self.config.data_dir / "usage").glob("*.json"):
            seen.add(path)
            try:
                stat = path.stat()
                version = (stat.st_mtime_ns, stat.st_size)
                cached = self._cache.get(path)
                if cached is None or cached[0] != version:
                    record = UsageRecord.model_validate_json(path.read_text()).wire()
                    self._cache[path] = (version, record)
                records.append(self._cache[path][1])
            except (OSError, ValueError):
                self._cache.pop(path, None)
                pass
        for path in self._cache.keys() - seen:
            del self._cache[path]
        return sorted(records, key=lambda r: r["startedAt"], reverse=True)

    def new(self, provider, operation, model, session_id):
        return UsageRecord(
            id=str(uuid4()),
            session_id=session_id,
            provider=provider,
            operation=operation,
            model=model,
            started_at=now_iso(),
            ended_at=None,
            status="running",
        )

    @asynccontextmanager
    async def measured(self, provider, operation, model, session_id):
        record = self.new(provider, operation, model, session_id)
        self.save(record)
        try:
            yield record
            record.status = "completed"
        except asyncio.CancelledError:
            record.status = "cancelled"
            record.error_code = "cancelled"
            raise
        except Exception as error:
            error.ai_provider = provider
            error.ai_operation = operation
            record.status = "failed"
            status = status_of(error)
            record.error_code = str(status) if isinstance(status, int) else "failed"
            record.error_details = provider_details(error)
            self.capture(
                record,
                error={
                    "status": status,
                    "message": str(error),
                    "body": getattr(error, "body", None) or getattr(error, "response_json", None),
                },
            )
            raise
        finally:
            record.ended_at = now_iso()
            self.save(record)
