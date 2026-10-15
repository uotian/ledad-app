import re
import shutil
from uuid import uuid4

from ..errors import AppError
from ..meeting.models import ID_PATTERN, Session, Settings
from .files import now_iso, write_json


def require_id(value):
    if not isinstance(value, str) or not re.fullmatch(ID_PATTERN, value):
        raise AppError("会議が見つかりません。", 404)
    return value


class Sessions:
    def __init__(self, config):
        self.config = config

    def path(self, session_id):
        return self.config.data_dir / "sessions" / require_id(session_id)

    def read(self, session_id):
        try:
            return Session.model_validate_json((self.path(session_id) / "session.json").read_text())
        except AppError:
            raise
        except (OSError, ValueError):
            raise AppError("会議が見つかりません。削除された可能性があります。", 404) from None

    def save(self, session, *, remember_settings=False):
        session.record_meeting_times()
        if remember_settings:
            write_json(self.config.data_dir / "meeting-settings.json", session.settings.wire())
        write_json(self.path(session.id) / "session.json", session.wire())

    def default_settings(self):
        try:
            settings = Settings.model_validate_json(
                (self.config.data_dir / "meeting-settings.json").read_text()
            )
        except (FileNotFoundError, ValueError):
            settings = Settings(
                language="ja", input="mixed", voice="Kore"
            )
        return settings.wire()

    def create(self, title=None, session_id=None):
        # A retried first save must not create a second meeting or overwrite one.
        if session_id and (self.path(session_id) / "session.json").exists():
            return self.read(session_id)
        now = now_iso()
        session = Session.model_validate(
            {
                "id": session_id or str(uuid4()),
                "shareToken": str(uuid4()),
                "title": (title or "").strip() or "新しい会議",
                "mode": "audience",
                "status": "preparing",
                "createdAt": now,
                "updatedAt": now,
                "startedAt": None,
                "endedAt": None,
                "pricing": None,
                "settings": self.default_settings(),
                "documents": [],
                "scripts": [],
                "currentPage": 1,
                "presentationDocumentId": None,
                "transcripts": [],
                "candidates": [],
                "chats": [],
                "utterances": [],
                "minutes": None,
                "analyze": None,
                "caption": "",
            }
        )
        self.save(session)
        return session

    def _all(self):
        root = self.config.data_dir / "sessions"
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        for path in root.iterdir():
            try:
                yield self.read(path.name)
            except AppError:
                pass

    def list(self):
        fields = {
            "id",
            "title",
            "mode",
            "status",
            "created_at",
            "updated_at",
            "meeting_started_at",
            "meeting_last_at",
            "started_at",
            "ended_at",
        }
        summaries = [
            {**session.model_dump(include=fields, by_alias=True), "hasMinutes": session.minutes is not None}
            for session in self._all()
        ]
        return sorted(
            summaries,
            key=lambda s: s["createdAt"],
            reverse=True,
        )

    def delete(self, session_id):
        path = self.path(session_id)
        if path.exists():
            shutil.rmtree(path)
