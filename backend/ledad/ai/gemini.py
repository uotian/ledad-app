import asyncio
import base64
from datetime import UTC, datetime, timedelta

from google import genai
from google.genai import types

from ..errors import AppError
from .audio import wav_bytes, wav_duration

LANGUAGE_CODES = {"ja": "ja-JP", "en": "en-US", "zh": "cmn-Hans-CN", "fr": "fr-FR"}


def record_interaction(record, response):
    record.model = response.model or record.model
    record.provider_request_id = response.id or None
    if response.usage:
        for target, source in [
            ("input_tokens", "total_input_tokens"),
            ("output_tokens", "total_output_tokens"),
            ("total_tokens", "total_tokens"),
            ("cached_tokens", "total_cached_tokens"),
            ("reasoning_tokens", "total_thought_tokens"),
        ]:
            setattr(record, target, getattr(response.usage, source, None))


class GeminiProvider:
    def __init__(self, config, usage):
        self.config, self.usage = config, usage

    def client(self):
        if not self.config.gemini_key:
            raise AppError("設定からGemini APIキーを登録してください。")
        return genai.Client(
            api_key=self.config.gemini_key,
            http_options=types.HttpOptions(
                api_version="v1beta",
                timeout=60000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )

    @staticmethod
    def interactions(client):
        resource = client.interactions
        # google-genai 2.28 maps the single-attempt setting to one *retry* for
        # Interactions, unlike auth_tokens. Disable it here so retry_transient
        # owns every attempt, deadline and usage record. SDK HTTP tests guard this.
        resource.sdk_configuration.retry_config.max_retries = 0
        return resource

    async def live_token(self, session, vocabulary):
        model = self.config.stt_model
        # This camel-case config is consumed by the browser's Google GenAI SDK.
        config = {
            "responseModalities": ["TEXT"],
            "realtimeInputConfig": {
                "automaticActivityDetection": {
                    "disabled": False,
                    "silenceDurationMs": session.settings.vad_silence_ms,
                }
            },
            "inputAudioTranscription": {
                "languageCodes": [LANGUAGE_CODES[session.settings.language]],
                **({"customVocabulary": vocabulary} if vocabulary else {}),
            },
        }
        now = datetime.now(UTC)
        async with self.usage.measured("gemini", "live_token", model, session.id) as record:
            request = {
                "uses": 1,
                "expire_time": now + timedelta(minutes=30),
                "new_session_expire_time": now + timedelta(minutes=1),
                "live_connect_constraints": {"model": model, "config": config},
            }
            self.usage.capture(record, request={"config": request})
            async with self.client().aio as client:
                token = await client.auth_tokens.create(config=request)
            self.usage.capture(
                record, response={**token.model_dump(mode="json"), "name": "[redacted]"}
            )
            if not token.name:
                raise AppError("聞き取り用の接続を準備できませんでした。再試行してください。", 502)
        usage = self.usage.new("gemini", "live_transcription", model, session.id)
        self.usage.save(usage)
        self.usage.capture(usage, request={"model": model, "config": config})
        return {"token": token.name, "model": model, "config": config, "usageId": usage.id}

    async def speech(self, session_id, text, language, voice):
        async with self.usage.measured(
            "gemini", "speech", self.config.tts_model, session_id
        ) as record:
            record.input_characters = len(text)
            request = dict(
                model=self.config.tts_model,
                input=[
                    {
                        "type": "user_input",
                        "content": [
                            {
                                "type": "text",
                                "text": text,
                                "annotations": [
                                    {
                                        "type": "speech_metadata",
                                        "style": f"{ {'ja': '日本語', 'en': 'English', 'zh': '普通话', 'fr': 'Français'}[language] }。落ち着いた明瞭な会議の発言。入力された文章をそのまま読む。",
                                    }
                                ],
                            }
                        ],
                    }
                ],
                response_format={"type": "audio"},
                generation_config={"speech_config": [{"voice": voice}]},
                store=False,
                timeout=60,
            )
            self.usage.capture(record, request={k: v for k, v in request.items() if k != "timeout"})
            try:
                async with asyncio.timeout(60), self.client().aio as client:
                    response = await self.interactions(client).create(**request)
                self.usage.capture(record, response=response)

            except TimeoutError:
                raise AppError(
                    "音声生成が60秒以内に完了しませんでした。接続を確認し、「再開」で再試行してください。",
                    504,
                ) from None
            record_interaction(record, response)
            audio = response.output_audio
            if not audio or not audio.data:
                raise AppError(
                    "音声を生成できませんでした。内容を短くして再試行してください。", 502
                )
            data = base64.b64decode(audio.data)
            record.audio_output_seconds = wav_duration(data)
            return data, audio.mime_type or "audio/wav"

    async def transcribe(self, pcm, language, vocabulary, record):
        request = dict(
            model=record.model,
            input=[
                {
                    "type": "audio",
                    "data": base64.b64encode(wav_bytes(pcm)).decode(),
                    "mime_type": "audio/wav",
                }
            ],
            generation_config={
                "transcription_config": {
                    "language_codes": [LANGUAGE_CODES[language]],
                    "mode": "smart",
                    **({"custom_vocabulary": vocabulary} if vocabulary else {}),
                }
            },
            store=False,
            timeout=60,
        )
        self.usage.capture(record, request={k: v for k, v in request.items() if k != "timeout"})
        async with self.client().aio as client:
            response = await self.interactions(client).create(**request)
        self.usage.capture(record, response=response)
        record_interaction(record, response)
        return response.output_text or ""
