"""Explicit runtime configuration; transport owns credentials initialization."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .errors import AppError
from .storage.files import write_json


@dataclass
class Config:
    data_dir: Path
    openai_key: str = ""
    gemini_key: str = ""
    openai_model: str = "gpt-6-luna"
    consultation_model: str = "gpt-6.1-sol"
    stt_model: str = "gemini-3.5-transcribe-live"
    fix_stt_model: str = "gemini-3.5-transcribe"
    openai_stt_model: str = "gpt-transcribe"
    openai_live_stt_model: str = "gpt-live-transcribe"
    openai_tts_model: str = "gpt-4o-mini-tts"
    tts_model: str = "gemini-3.8-flash-lite-tts"

    @classmethod
    def from_environment(cls):
        return cls(
            data_dir=Path(os.environ.get("LEDAD_DATA_DIR", ".data")).resolve(),
            openai_key=os.environ.get("OPENAI_API_KEY", ""),
            gemini_key=os.environ.get("GEMINI_API_KEY", ""),
            openai_model=os.environ.get("OPENAI_MODEL", "gpt-6-luna"),
            consultation_model=os.environ.get("OPENAI_CONSULTATION_MODEL", "gpt-6.1-sol"),
            stt_model=os.environ.get("GEMINI_STT_MODEL", "gemini-3.5-transcribe-live"),
            fix_stt_model=os.environ.get("GEMINI_FIX_STT_MODEL", "gemini-3.5-transcribe"),
            openai_stt_model=os.environ.get("OPENAI_STT_MODEL", "gpt-transcribe"),
            openai_live_stt_model=os.environ.get("OPENAI_LIVE_STT_MODEL", "gpt-live-transcribe"),
            openai_tts_model=os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
            tts_model=os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts"),
        )

    def _state(self):
        path = self.data_dir / "state.json"
        migrated = False
        try:
            try:
                state = json.loads(path.read_text())
            except FileNotFoundError:
                legacy = {}
                for key, filename in (
                    ("liveProvider", "live.json"),
                    ("refinementProvider", "refinement.json"),
                ):
                    try:
                        legacy[key] = json.loads((self.data_dir / filename).read_text())["provider"]
                    except FileNotFoundError:
                        pass
                state = (
                    {"liveProvider": "gemini", "refinementProvider": "openai", **legacy}
                    if legacy
                    else {
                        "aiMode": "openai",
                        "modes": self._defaults(),
                    }
                )
            if not isinstance(state, dict):
                raise ValueError()
            if "aiMode" not in state:
                self._validate_choices(state, "gemini")
                state = {"aiMode": "gemini", "modes": {**self._defaults(), "gemini": state}}
                migrated = True
            if state["aiMode"] not in ("openai", "gemini"):
                raise ValueError()
            state["baseUrl"] = self._validate_base_url(state.get("baseUrl", ""))
            for mode in ("openai", "gemini"):
                self._validate_choices(state["modes"][mode], mode)
        except (OSError, ValueError, KeyError, TypeError):
            raise AppError("AI設定を読み込めません。", 500) from None
        if migrated:
            write_json(path, state)
        return state

    @staticmethod
    def _defaults():
        return {
            "openai": {"liveProvider": "openai", "refinementProvider": "openai"},
            "gemini": {"liveProvider": "gemini", "refinementProvider": "openai"},
        }

    @staticmethod
    def _validate_choices(choices, mode):
        if (
            not isinstance(choices, dict)
            or choices["liveProvider"]
            not in (("openai", "apple", "gemini") if mode == "gemini" else ("openai", "apple"))
            or choices["refinementProvider"]
            not in (("openai", "gemini") if mode == "gemini" else ("openai",))
        ):
            raise ValueError()

    @staticmethod
    def _validate_base_url(value):
        if not isinstance(value, str) or len(value) > 2048:
            raise ValueError()
        value = value.strip()
        if not value:
            return ""
        url = urlsplit(value)
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or "?" in value
            or "#" in value
            or "\\" in value
            or any(c.isspace() or ord(c) < 32 for c in value)
        ):
            raise ValueError()
        _ = url.port
        return value.rstrip("/")

    def base_url(self):
        return self._state()["baseUrl"]

    def save_base_url(self, value):
        try:
            value = self._validate_base_url(value)
        except (ValueError, TypeError):
            raise AppError(
                "接続先URLには認証情報・クエリ・フラグメントを含まないHTTP(S) URLを入力してください。"
            ) from None
        state = self._state()
        state["baseUrl"] = value
        write_json(self.data_dir / "state.json", state)

    def save_mode(self, mode):
        if mode not in ("openai", "gemini"):
            raise AppError("利用するAIを選んでください。")
        state = self._state()
        if state["baseUrl"]:
            raise AppError("カスタム接続先の使用中はGeminiを利用できません。")
        state["aiMode"] = mode
        write_json(self.data_dir / "state.json", state)

    def _save_provider(self, key, provider):
        state = self._state()
        if state["baseUrl"]:
            raise AppError("カスタム接続先の使用中は文字起こし先を変更できません。")
        choices = {**state["modes"][state["aiMode"]], key: provider}
        try:
            self._validate_choices(choices, state["aiMode"])
        except (ValueError, TypeError):
            raise AppError("この利用モードでは選択できないプロバイダーです。") from None
        state["modes"][state["aiMode"]] = choices
        write_json(self.data_dir / "state.json", state)

    def refinement_provider(self):
        state = self._state()
        return (
            "openai" if state["baseUrl"] else state["modes"][state["aiMode"]]["refinementProvider"]
        )

    def save_refinement_provider(self, provider):
        self._save_provider("refinementProvider", provider)

    def live_provider(self):
        state = self._state()
        return "apple" if state["baseUrl"] else state["modes"][state["aiMode"]]["liveProvider"]

    def save_live_provider(self, provider):
        self._save_provider("liveProvider", provider)

    def refinement_models(self):
        return {"openai": self.openai_stt_model, "gemini": self.fix_stt_model}

    def public(self):
        state = self._state()
        mode = "openai" if state["baseUrl"] else state["aiMode"]
        provider = "openai" if state["baseUrl"] else state["modes"][mode]["refinementProvider"]
        live_provider = "apple" if state["baseUrl"] else state["modes"][mode]["liveProvider"]
        live_models = {
            "openai": self.openai_live_stt_model,
            "gemini": self.stt_model,
            "apple": "Apple SpeechTranscriber",
        }
        return {
            "baseUrl": state["baseUrl"],
            "aiMode": mode,
            "openai": bool(self.openai_key),
            "gemini": bool(self.gemini_key),
            "refinementProvider": provider,
            "liveProvider": live_provider,
            "liveModels": live_models,
            "refinementModels": self.refinement_models(),
            "speechModels": {"openai": self.openai_tts_model, "gemini": self.tts_model},
            "models": {
                "generation": self.openai_model,
                "transcription": live_models[live_provider],
                "refinement": self.refinement_models()[provider],
                "consultation": self.consultation_model,
                "speech": self.openai_tts_model if mode == "openai" else self.tts_model,
            },
        }
