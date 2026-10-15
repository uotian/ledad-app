import asyncio
from contextlib import asynccontextmanager

from openai import AsyncOpenAI
from openai.lib._pydantic import to_strict_json_schema
from pydantic_core import from_json

from ..errors import AppError
from .audio import wav_bytes
from .cache import prompt_cache_request


class OpenAIProvider:
    def __init__(self, config, usage):
        self.config, self.usage = config, usage
        self._client = None
        self._key = None
        self._active = {}
        self._retired = set()

    @asynccontextmanager
    async def client(self):
        key = self.config.openai_key
        if not key:
            raise AppError("設定からOpenAI APIキーを登録してください。")
        if key != self._key:
            replacement = AsyncOpenAI(api_key=key, timeout=60, max_retries=0)
            if self._client:
                self._retired.add(self._client)
            self._client = replacement
            self._key = key
        client = self._client
        self._active[client] = self._active.get(client, 0) + 1
        try:
            for old in tuple(self._retired):
                if old not in self._active:
                    self._retired.remove(old)
                    await old.close()
            yield client
        finally:
            self._active[client] -= 1
            if not self._active[client]:
                del self._active[client]
                if client in self._retired:
                    self._retired.remove(client)
                    await client.close()

    async def close(self):
        clients = self._retired | ({self._client} if self._client else set())
        self._client = self._key = None
        self._retired.clear()
        await asyncio.gather(*(client.close() for client in clients))

    async def transcribe(self, pcm, language, vocabulary, record):
        if not self.config.openai_key:
            raise AppError("設定からOpenAI APIキーを登録してください。")
        # Keywords are literal hints; unsupported characters reject the entire request.
        keywords = [word for word in vocabulary if not any(c in word for c in "<>\r\n")]
        request = {
            "model": record.model,
            "file": ("recording.wav", wav_bytes(pcm), "audio/wav"),
            "extra_body": {
                "languages": [language],
                **({"keywords": keywords} if keywords else {}),
            },
        }
        self.usage.capture(
            record,
            request={
                **{key: value for key, value in request.items() if key != "extra_body"},
                **request["extra_body"],
            },
        )
        async with self.client() as client:
            response = await client.audio.transcriptions.create(**request)
        self.usage.capture(record, response=response)
        record.provider_request_id = getattr(response, "_request_id", None)
        return response.text

    async def structured(
        self,
        schema,
        name,
        instructions,
        data,
        session_id,
        stable_keys=None,
        history_key=None,
        include_usage_id=False,
        content=None,
        on_text=None,
    ):
        cfg = self.config
        consultation = name == "meeting_consultation"
        document = name == "document_preparation"
        model = "gpt-6-luna" if document else (
            cfg.consultation_model if consultation else cfg.openai_model
        )
        request = (
            {"instructions": instructions, "input": [{"role": "user", "content": content}],
             "truncation": "disabled"}
            if content is not None
            else prompt_cache_request(model, instructions, data, stable_keys, history_key)
        )
        # Extra body keeps new cache fields usable even if the SDK's typed arguments lag.
        extra = (
            {"prompt_cache_options": request.pop("prompt_cache_options")}
            if "prompt_cache_options" in request
            else {}
        )
        async with self.usage.measured("openai", name, model, session_id) as record:
            if not cfg.openai_key:
                raise AppError("設定からOpenAI APIキーを登録してください。")
            arguments = {
                "model": model,
                "reasoning": {"effort": "low" if consultation or document or name == "meeting_analyze" else "none"},
                "store": False,
                **request,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": name,
                        "strict": True,
                        "schema": to_strict_json_schema(schema),
                    }
                },
            }
            if consultation and on_text is not None:
                arguments["stream"] = True
            self.usage.capture(record, request={**arguments, **extra})
            async with self.client() as client:
                response = await client.responses.create(
                    **arguments, extra_body=extra,
                    timeout=180 if document else 120 if name == "meeting_analyze" else 60
                )
                if arguments.get("stream"):
                    stream = response
                    response = None
                    partial = ""
                    previous = ""
                    async with stream:
                        async for event in stream:
                            if event.type == "response.output_text.delta":
                                partial += event.delta
                                if len(partial) > 1_200_000:
                                    raise AppError("AIの回答が長すぎます。", 502)
                                try:
                                    value = from_json(partial, allow_partial="trailing-strings")
                                except ValueError:
                                    continue
                                text = value.get("reply", "") if isinstance(value, dict) else ""
                                if isinstance(text, str) and text != previous:
                                    await on_text(text)
                                    previous = text
                            elif event.type in ("response.completed", "response.incomplete", "response.failed"):
                                response = event.response
                                break
                            elif event.type == "error":
                                raise AppError("AIの回答を受信できませんでした。", 502)
                    if response is None:
                        raise AppError("AIの回答が途中で切れました。再試行してください。", 502)
            self.usage.capture(record, response=response)
            record.model = response.model
            record.provider_request_id = response.id
            if response.usage:
                usage = response.usage
                record.input_tokens, record.output_tokens, record.total_tokens = (
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.total_tokens,
                )
                record.cached_tokens = getattr(usage.input_tokens_details, "cached_tokens", None)
                record.cache_write_tokens = getattr(
                    usage.input_tokens_details, "cache_write_tokens", None
                )
                record.reasoning_tokens = getattr(
                    usage.output_tokens_details, "reasoning_tokens", None
                )
            try:
                if response.status != "completed" or not response.output_text:
                    raise ValueError("Incomplete AI response")
                result = schema.model_validate_json(response.output_text).wire()
                return {**result, "usageId": record.id} if include_usage_id else result
            except ValueError:
                raise AppError(
                    "AIが回答を完成できませんでした。指示を短くするか、内容を確認して再試行してください。",
                    502,
                ) from None
