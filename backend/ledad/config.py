"""Explicit runtime configuration; transport owns credentials initialization."""

import json
import os
from dataclasses import dataclass
from pathlib import Path

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
            tts_model=os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts"),
        )

    def _state(self):
        path = self.data_dir / "state.json"
        migrated = False
        try:
            try:
                state = json.loads(path.read_text())
            except FileNotFoundError:
                state = {"liveProvider": "gemini", "refinementProvider": "openai"}
                for key, filename in (
                    ("liveProvider", "live.json"),
                    ("refinementProvider", "refinement.json"),
                ):
                    try:
                        state[key] = json.loads((self.data_dir / filename).read_text())["provider"]
                        migrated = True
                    except FileNotFoundError:
                        pass
            if (
                not isinstance(state, dict)
                or state["liveProvider"] not in ("gemini", "apple")
                or state["refinementProvider"] not in ("openai", "gemini")
            ):
                raise ValueError()
        except (OSError, ValueError, KeyError, TypeError):
            raise AppError("文字起こしの設定を読み込めません。", 500) from None
        if migrated:
            write_json(path, state)
        return state

    def refinement_provider(self):
        return self._state()["refinementProvider"]

    def save_refinement_provider(self, provider):
        if provider not in ("openai", "gemini"):
            raise AppError("Fixedの文字起こし先を選んでください。")
        state = self._state()
        state["refinementProvider"] = provider
        write_json(self.data_dir / "state.json", state)

    def live_provider(self):
        return self._state()["liveProvider"]

    def save_live_provider(self, provider):
        if provider not in ("gemini", "apple"):
            raise AppError("Liveの文字起こし先を選んでください。")
        state = self._state()
        state["liveProvider"] = provider
        write_json(self.data_dir / "state.json", state)

    def refinement_models(self):
        return {"openai": self.openai_stt_model, "gemini": self.fix_stt_model}

    def public(self):
        provider = self.refinement_provider()
        live_provider = self.live_provider()
        live_models = {"gemini": self.stt_model, "apple": "Apple SpeechTranscriber"}
        return {
            "openai": bool(self.openai_key),
            "gemini": bool(self.gemini_key),
            "refinementProvider": provider,
            "liveProvider": live_provider,
            "liveModels": live_models,
            "refinementModels": self.refinement_models(),
            "models": {
                "generation": self.openai_model,
                "transcription": live_models[live_provider],
                "refinement": self.refinement_models()[provider],
                "consultation": self.consultation_model,
                "speech": self.tts_model,
            },
        }
