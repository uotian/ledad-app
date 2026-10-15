from httpx import TimeoutException
from openai import APITimeoutError


def is_timeout(error):
    return isinstance(error, (TimeoutError, TimeoutException, APITimeoutError))


class AppError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def status_of(error):
    return (
        getattr(error, "status_code", None)
        or getattr(error, "status", None)
        or getattr(error, "code", None)
    )


AI_OPERATIONS = {
    "document_preparation": "資料の読み取り",
    "live_transcription": "LiveSTT",
    "live_token": "LiveSTTの接続",
    "speech": "TTS",
    "file_transcription": "FixSTT",
    "transcript_analysis": "Fix翻訳",
    "transcript_translation": "Fix翻訳",
    "transcript_preview": "Live翻訳",
    "meeting_insights": "会話分析",
    "meeting_analyze": "Analyze",
    "mention_detection": "言及判定",
    "meeting_mentions": "言及整理",
    "meeting_consultation": "Chat",
    "meeting_candidates": "Ask",
    "candidate_confirmation": "Askの日本語確認文の生成",
    "background_guidance": "参考資料の解析",
    "meeting_minutes": "議事録の生成",
}


def ai_error_message(error, message):
    provider = {"openai": "OpenAI", "gemini": "Gemini"}.get(
        getattr(error, "ai_provider", None)
    )
    operation = AI_OPERATIONS.get(getattr(error, "ai_operation", None))
    return f"{provider} / {operation}：{message}" if provider and operation else message
