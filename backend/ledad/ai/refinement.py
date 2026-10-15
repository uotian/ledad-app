import asyncio
import time

from ..errors import AppError
from .retry import retry_transient


class Refinement:
    def __init__(self, config, usage, diagnostics, meeting_ai, gemini):
        self.config, self.usage = config, usage
        self.diagnostics, self.meeting_ai, self.gemini = diagnostics, meeting_ai, gemini

    async def run(self, session, pcm, transcripts, target_language, vocabulary):
        deadline = time.monotonic() + 90
        stage, usage_id, characters = "transcription", None, 0
        provider = self.config.refinement_provider()
        model = self.config.refinement_models()[provider]
        transcriber = self.meeting_ai.provider if provider == "openai" else self.gemini

        async def transcribe():
            nonlocal usage_id
            async with self.usage.measured(
                provider, "file_transcription", model, session.id
            ) as record:
                usage_id = record.id
                record.audio_input_seconds = len(pcm) / 32000
                args = (pcm, session.settings.language, vocabulary, record)
                text = await transcriber.transcribe(*args)
                if not text.strip():
                    raise AppError("録音の再認識に失敗したため、Liveの会話を残しています。", 502)
                return text.strip()

        try:
            async with asyncio.timeout(90):
                text = await retry_transient(transcribe, deadline)
                characters = len(text)
                stage = "translation"
                translation = await retry_transient(
                    lambda: self.meeting_ai.translate(text, [], target_language, session), deadline
                )
                return {
                    "originals": [{"id": t.id, "text": t.text} for t in transcripts],
                    "text": text,
                    **translation,
                    "translationLanguage": target_language,
                }
        except (Exception, asyncio.CancelledError) as error:
            error.ai_provider = provider if stage == "transcription" else "openai"
            error.ai_operation = (
                "file_transcription" if stage == "transcription" else "transcript_translation"
            )
            self.diagnostics.log(
                {
                    "source": "refinement",
                    "sessionId": session.id,
                    "stage": stage,
                    "usageId": usage_id,
                    "message": str(error)
                    if isinstance(error, AppError)
                    else "録音の再認識処理に失敗しました。",
                    "audioSeconds": len(pcm) / 32000,
                    "transcriptCount": len(transcripts),
                    "sourceCharacters": sum(len(t.text) for t in transcripts),
                    "resultCharacters": characters,
                    "cancelled": isinstance(error, asyncio.CancelledError),
                },
                error,
            )
            raise
