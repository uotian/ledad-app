import asyncio
import base64
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from google import genai
from google.genai import types
from openai import AsyncOpenAI

from ledad.ai.audio import wav_bytes
from ledad.ai.outputs import Consultation
from ledad.errors import AppError


async def test_openai_connection_reuse_and_key_rotation(service, monkeypatch):
    clients = []

    class Client:
        def __init__(self, api_key, **kwargs):
            self.key = api_key
            self.closed = False
            clients.append(self)

        async def close(self):
            self.closed = True

    monkeypatch.setattr("ledad.ai.openai.AsyncOpenAI", Client)
    service.config.openai_key = "first"
    provider = service.ai.provider
    async with provider.client() as first:
        async with provider.client() as reused:
            assert reused is first
        service.config.openai_key = "second"
        async with provider.client() as second:
            assert second is not first
            assert not first.closed
        assert not first.closed
    assert first.closed
    assert not second.closed
    await service.close()
    assert second.closed
    assert [client.key for client in clients] == ["first", "second"]


@pytest.mark.parametrize(
    ("name", "model", "effort", "include_usage_id"),
    [
        ("meeting_consultation", "gpt-6.1-sol", "low", False),
        ("meeting_candidates", "gpt-6-luna", "none", False),
        ("transcript_preview", "gpt-6-luna", "none", True),
        ("meeting_analyze", "gpt-6-luna", "low", False),
    ],
)
async def test_openai_real_sdk_serialization_and_usage(
    service, monkeypatch, name, model, effort, include_usage_id
):
    requests = []
    timeouts = []

    def handle(request):
        requests.append(json.loads(request.content))
        timeouts.append(request.extensions["timeout"])
        return httpx.Response(
            200,
            json={
                "id": "resp_test",
                "object": "response",
                "created_at": 1,
                "model": model,
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "id": "msg_1",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {"type": "output_text", "text": '{"reply":"返答"}', "annotations": []}
                        ],
                    }
                ],
                "usage": {
                    "input_tokens": 120,
                    "output_tokens": 80,
                    "total_tokens": 200,
                    "input_tokens_details": {"cached_tokens": 20, "cache_write_tokens": 30},
                    "output_tokens_details": {"reasoning_tokens": 40},
                },
            },
        )

    service.config.openai_key = "test"
    monkeypatch.setattr(
        "ledad.ai.openai.AsyncOpenAI",
        lambda **kwargs: AsyncOpenAI(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        ),
    )
    result = await service.ai.provider.structured(
        Consultation,
        name,
        "指示",
        {"language": "ja", "text": "test"},
        service.sessions.create().id,
        ["language"],
        include_usage_id=include_usage_id,
    )
    record = service.usage.list()[0]
    assert result == {"reply": "返答", **({"usageId": record["id"]} if include_usage_id else {})}
    request = requests[0]
    assert timeouts[0]["read"] == (120 if name == "meeting_analyze" else 60)
    assert request["model"] == model
    assert request["reasoning"] == {"effort": effort}
    assert request["store"] is False
    assert request["prompt_cache_options"] == {"mode": "explicit", "ttl": "30m"}
    assert request["text"]["format"]["strict"] is True
    assert json.loads("".join(c["text"] for c in request["input"][1]["content"])) == {
        "language": "ja",
        "text": "test",
    }
    assert record["status"] == "completed"
    assert record["cachedTokens"] == 20
    assert record["cacheWriteTokens"] == 30
    assert record["reasoningTokens"] == 40
    detail = service.usage.details(service.usage.read(record["id"]))
    assert detail["request"]["text"]["format"] == request["text"]["format"]
    assert detail["request"]["input"][0] == request["input"][0]
    assert detail["response"]["output"][0]["content"][0]["text"] == '{"reply":"返答"}'
    assert "request" not in record


@pytest.mark.parametrize(
    ("status", "text"),
    [
        ("incomplete", '{"reply":"途中"}'),
        ("completed", ""),
        ("completed", "not json"),
        ("completed", '{"reply":""}'),
    ],
)
async def test_openai_invalid_response_preserves_usage_and_fails(service, monkeypatch, status, text):
    service.config.openai_key = "test"
    response = SimpleNamespace(
        id="resp_invalid",
        model="test-model",
        status=status,
        output_text=text,
        usage=SimpleNamespace(
            input_tokens=10,
            output_tokens=3,
            total_tokens=13,
            input_tokens_details=None,
            output_tokens_details=None,
        ),
    )
    client = AsyncMock()
    client.responses.create.return_value = response
    monkeypatch.setattr("ledad.ai.openai.AsyncOpenAI", lambda **kwargs: client)
    with pytest.raises(AppError, match="AIが回答を完成できませんでした") as failure:
        await service.ai.provider.structured(
            Consultation, "meeting_consultation", "指示", {}, service.sessions.create().id
        )
    assert failure.value.status == 502
    record = service.usage.list()[0]
    assert record["status"] == "failed"
    assert record["totalTokens"] == 13
    assert record["providerRequestId"] == "resp_invalid"


def gemini_mock(service, monkeypatch, handler):
    service.config.gemini_key = "test"
    monkeypatch.setattr(
        service.gemini,
        "client",
        lambda: genai.Client(
            api_key="test",
            http_options=types.HttpOptions(
                api_version="v1beta",
                timeout=60000,
                retry_options=types.HttpRetryOptions(attempts=0),
                httpx_async_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            ),
        ),
    )


@pytest.mark.parametrize(
    ("language", "code"), [("ja", "ja-JP"), ("en", "en-US"), ("zh", "cmn-Hans-CN"), ("fr", "fr-FR")]
)
@pytest.mark.parametrize("vad_ms", [50, 100, 200, 300, 500])
async def test_gemini_auth_token_wire_constraints(service, monkeypatch, language, code, vad_ms):
    service.config.save_mode("gemini")
    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"name": "auth_tokens/test"})

    gemini_mock(service, monkeypatch, handle)
    session = service.sessions.create()
    session.settings.language = language
    session.settings.vad_silence_ms = vad_ms
    service.sessions.save(session)
    session = service.sessions.read(session.id)
    response = await service.dispatch({
        "id": str(uuid4()),
        "path": "/api/live-token",
        "method": "POST",
        "body": json.dumps({
            "sessionId": session.id,
            "profile": {"name": "ポケカメン kimono コレコレ", "aliases": ""},
        }),
    })
    assert response.status == 200
    result = response.value
    config = result["config"]
    assert (
        config["realtimeInputConfig"]["automaticActivityDetection"]["silenceDurationMs"] == vad_ms
    )
    assert (
        requests[0]["bidiGenerateContentSetup"]["realtimeInputConfig"][
            "automatic_activity_detection"
        ]["silence_duration_ms"]
        == vad_ms
    )
    assert config["inputAudioTranscription"]["languageCodes"] == [code]
    assert "customVocabulary" not in config["inputAudioTranscription"]
    assert requests[0]["bidiGenerateContentSetup"]["inputAudioTranscription"] == {
        "language_codes": [code],
    }
    assert "test" not in json.dumps(service.config.public())
    assert service.usage.read(result["usageId"]).status == "running"
    token_record = next(r for r in service.usage.list() if r["operation"] == "live_token")
    details = service.usage.details(service.usage.read(token_record["id"]))
    assert details["response"]["name"] == "[redacted]"
    assert "auth_tokens/test" not in json.dumps(details)


@pytest.mark.parametrize(("language", "text", "style"), [("ja", "こんにちは", "日本語"), ("fr", "Bonjour", "Français")])
async def test_gemini_speech_actual_sdk_request(service, monkeypatch, language, text, style):
    requests = []
    audio = wav_bytes(bytes(3200))

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "interaction-test",
                "model": "gemini-3.8-flash-lite-tts",
                "status": "completed",
                "steps": [
                    {
                        "type": "model_output",
                        "content": [
                            {
                                "type": "audio",
                                "data": base64.b64encode(audio).decode(),
                                "mime_type": "audio/wav",
                            }
                        ],
                    }
                ],
                "usage": {"total_input_tokens": 10, "total_output_tokens": 20, "total_tokens": 30},
            },
        )

    gemini_mock(service, monkeypatch, handle)
    result, mime = await service.gemini.speech(service.sessions.create().id, text, language, "Kore")
    assert result == audio and mime == "audio/wav"
    assert len(requests) == 1
    assert requests[0]["store"] is False
    assert requests[0]["generation_config"]["speech_config"] == [{"voice": "Kore"}]
    record = service.usage.list()[0]
    assert record["status"] == "completed"
    assert record["audioOutputSeconds"] == 0.1
    assert record["totalTokens"] == 30
    detail = service.usage.details(service.usage.read(record["id"]))
    assert detail["request"]["input"][0]["content"][0]["text"] == text
    assert requests[0]["input"][0]["content"][0]["annotations"][0]["style"].startswith(style)
    assert base64.b64encode(audio).decode() not in json.dumps(detail)
    assert detail["response"]["steps"][0]["content"][0]["data"]["omitted"] == "binary"


async def test_gemini_no_hidden_sdk_retries(service, monkeypatch):
    calls = 0

    def handle(request):
        nonlocal calls
        calls += 1
        return httpx.Response(
            429,
            json={
                "error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota exceeded"}
            },
        )

    gemini_mock(service, monkeypatch, handle)
    with pytest.raises(Exception):
        await service.gemini.speech(str(uuid4()), "test", "en", "Kore")
    assert calls == 1
    assert service.usage.list()[0]["status"] == "failed"


async def test_gemini_refine_translates_recording_not_live_fragments(service, monkeypatch, document, reference):
    service.config.save_mode("gemini")
    service.config.save_refinement_provider("gemini")
    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "fix-test",
                "model": "gemini-3.5-transcribe",
                "status": "completed",
                "steps": [
                    {
                        "type": "model_output",
                        "content": [{"type": "text", "text": "導入費用は年間10万円です。"}],
                    }
                ],
                "usage": {
                    "total_input_tokens": 100,
                    "total_output_tokens": 12,
                    "total_tokens": 112,
                },
            },
        )

    gemini_mock(service, monkeypatch, handle)
    session = service.sessions.create()
    session.documents = [document]
    session.document_reference = reference
    service.ai.translate = AsyncMock(
        return_value={"translation": "100,000 yen per year."}
    )
    result = await service.refinement.run(session, bytes(32000), [], "en", ["内藤"])
    assert result["text"] == "導入費用は年間10万円です。"
    assert result["translationLanguage"] == "en"
    assert service.ai.translate.call_args.args == ("導入費用は年間10万円です。", [], "en", session)
    assert base64.b64decode(requests[0]["input"][0]["content"][0]["data"])[:4] == b"RIFF"
    assert requests[0]["generation_config"]["transcription_config"]["custom_vocabulary"] == ["内藤"]
    assert "CONTEXT-2391" not in json.dumps(requests, ensure_ascii=False)
    assert "prompt" not in requests[0]


@pytest.mark.parametrize("cancelled", [False, True])
async def test_speech_timeout_is_failed_but_user_cancellation_is_cancelled(
    service, monkeypatch, cancelled
):
    async def handle(request):
        if cancelled:
            raise asyncio.CancelledError()
        raise TimeoutError()

    gemini_mock(service, monkeypatch, handle)
    with pytest.raises(asyncio.CancelledError if cancelled else AppError) as caught:
        await service.gemini.speech(str(uuid4()), "test", "en", "Kore")
    if not cancelled:
        assert caught.value.status == 504
    assert service.usage.list()[0]["status"] == ("cancelled" if cancelled else "failed")


@pytest.mark.parametrize("succeeds", [False, True])
async def test_refinement_translation_retry_does_not_retranscribe_or_return_partial(
    service, monkeypatch, succeeds
):
    service.config.save_mode("gemini")
    service.config.save_refinement_provider("gemini")
    calls = 0
    private_text = "PRIVATE_RECORDING_123"

    def handle(request):
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "id": "fix-test",
                "model": "gemini-3.5-transcribe",
                "status": "completed",
                "steps": [
                    {"type": "model_output", "content": [{"type": "text", "text": private_text}]}
                ],
            },
        )

    gemini_mock(service, monkeypatch, handle)
    session = service.sessions.create()
    error = httpx.ReadTimeout("PRIVATE_ERROR_456")
    service.ai.translate = AsyncMock(
        side_effect=[error, {"translation": "translated"}]
        if succeeds
        else [error] * 3
    )
    monkeypatch.setattr("ledad.ai.retry.asyncio.sleep", AsyncMock())
    if succeeds:
        result = await service.refinement.run(session, bytes(32000), [], "en", [])
        assert result["text"] == private_text
        assert service.ai.translate.await_count == 2
    else:
        with pytest.raises(httpx.ReadTimeout):
            await service.refinement.run(session, bytes(32000), [], "en", [])
        assert service.ai.translate.await_count == 3
        log = (service.config.data_dir / "logs/errors.jsonl").read_text()
        assert private_text not in log and "PRIVATE_ERROR_456" not in log
        assert json.loads(log)["stage"] == "translation"
    assert calls == 1
    assert service.sessions.read(session.id).transcripts == []


@pytest.mark.parametrize("result_text", ["音声を聞き直しました。", ""])
@pytest.mark.parametrize("use_context", [False, True])
async def test_openai_fixed_wav_upload_translation_and_empty_guard(
    service, monkeypatch, document, reference, result_text, use_context
):
    from email.parser import BytesParser
    from email.policy import default

    captured = []

    def handle(request):
        message = BytesParser(policy=default).parsebytes(
            b"Content-Type: "
            + request.headers["content-type"].encode()
            + b"\r\n\r\n"
            + request.content
        )
        fields = {
            p.get_param("name", header="content-disposition"): p.get_payload(decode=True)
            for p in message.iter_parts()
        }
        captured.append(fields)
        assert request.url.path == "/v1/audio/transcriptions"
        return httpx.Response(
            200,
            json={"text": result_text, "languages": [{"code": "ja"}]},
            headers={"x-request-id": "transcription-test"},
        )

    service.config.openai_key = "test"
    monkeypatch.setattr(
        "ledad.ai.openai.AsyncOpenAI",
        lambda **kwargs: AsyncOpenAI(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        ),
    )
    service.gemini.transcribe = AsyncMock(side_effect=AssertionError("Unexpected Gemini call"))
    service.ai.translate = AsyncMock(return_value={"translation": "translated"})
    session = service.sessions.create()
    reference.summary = "参考文" if use_context else ""
    session.documents = [document]
    session.document_reference = reference
    args = (session, bytes(32000), [], "en", ["内藤", "invalid<hint>"])
    if result_text:
        result = await service.refinement.run(*args)
        assert result["text"] == result_text
        service.ai.translate.assert_awaited_once_with(result_text, [], "en", session)
    else:
        with pytest.raises(AppError):
            await service.refinement.run(*args)
        service.ai.translate.assert_not_awaited()
    fields = captured[0]
    assert fields["model"] == b"gpt-transcribe"
    assert fields["file"] == wav_bytes(bytes(32000))
    assert fields["languages[]"] == b"ja"
    assert fields["keywords[]"].decode() == "内藤"
    assert "prompt" not in fields
    assert "CONTEXT-2391" not in str(fields)
    usage = service.usage.list()[0]
    assert usage["provider"] == "openai" and usage["model"] == "gpt-transcribe"
    assert usage["audioInputSeconds"] == 1
    assert usage["providerRequestId"] == "transcription-test"
    assert usage["status"] == ("completed" if result_text else "failed")
    assert not list(service.config.data_dir.rglob("*.wav"))


@pytest.mark.parametrize("error", [httpx.ReadTimeout("private"), asyncio.CancelledError()])
async def test_openai_fixed_failure_keeps_live_without_fallback(service, monkeypatch, error):
    service.ai.provider.transcribe = AsyncMock(side_effect=error)
    service.gemini.transcribe = AsyncMock()
    service.ai.translate = AsyncMock()
    monkeypatch.setattr("ledad.ai.retry.asyncio.sleep", AsyncMock())
    session = service.sessions.create()
    with pytest.raises(type(error)):
        await service.refinement.run(session, bytes(32000), [], "en", [])
    service.gemini.transcribe.assert_not_awaited()
    service.ai.translate.assert_not_awaited()
    assert service.ai.provider.transcribe.await_count == (
        1 if isinstance(error, asyncio.CancelledError) else 3
    )
    assert all(
        r["status"] == ("cancelled" if isinstance(error, asyncio.CancelledError) else "failed")
        for r in service.usage.list()
    )
    assert service.sessions.read(session.id).transcripts == []


@pytest.mark.parametrize('name,data', [
    ('memo.md', b'Product LEDAD, meeting assistant'),
    ('screen.png', b'\x89PNG\r\n\x1a\nimage-payload'),
    ('slides.pdf', None),
])
async def test_document_preparation_media_model_output_and_usage(service, monkeypatch, name, data):
    from pathlib import Path

    from ledad.meeting.documents import extract_document

    if data is None:
        data = (Path(__file__).parent / 'fixtures/sample.pdf').read_bytes()
    content = extract_document(data, name)['content']
    expected = {'summary': 'Product overview (p.1)', 'glossary': ['LEDAD']}
    captured = []

    def handle(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={
            'id': 'resp_document', 'object': 'response', 'created_at': 1,
            'model': 'gpt-6-luna', 'status': 'completed',
            'output': [{'type': 'message', 'id': 'msg_1', 'role': 'assistant',
                        'status': 'completed', 'content': [{'type': 'output_text',
                        'text': json.dumps(expected), 'annotations': []}]}],
            'usage': {'input_tokens': 400, 'output_tokens': 80, 'total_tokens': 480},
        })

    service.config.openai_key = 'test'
    monkeypatch.setattr('ledad.ai.openai.AsyncOpenAI', lambda **kwargs: AsyncOpenAI(
        **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
    ))
    session = service.sessions.create()
    assert await service.ai.prepare_document(session, [content]) == expected
    assert len(captured) == 1
    request = captured[0]
    assert request['model'] == 'gpt-6-luna'
    assert request['reasoning']['effort'] == 'low'
    assert request['store'] is False
    assert request['input'][0]['content'] == [content]
    assert request['text']['format']['schema']['required'] == ['summary', 'glossary']
    properties = request['text']['format']['schema']['properties']
    assert properties['summary']['maxLength'] == 6000
    assert properties['glossary']['items']['type'] == 'string'
    assert properties['glossary']['items']['maxLength'] == 50
    assert properties['glossary']['maxItems'] == 100
    record = service.usage.read(service.usage.list()[0]['id'])
    assert record.operation == 'document_preparation' and record.total_tokens == 480
    assert record.model == 'gpt-6-luna'
    detail = service.usage.details(record)
    if name.endswith(('.png', '.pdf')):
        assert 'data:' not in json.dumps(detail['request'])
        assert 'binary' in json.dumps(detail['request'])


@pytest.mark.parametrize("status", [200, 429])
async def test_openai_speech_sdk_audio_and_usage(service, monkeypatch, status):
    calls = []
    pcm = b"\0\0" * 24000
    audio = wav_bytes(pcm, sample_rate=24000)

    def handle(request):
        calls.append(json.loads(request.content))
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "rate limited"}})
        events = [
            {"type": "speech.audio.delta", "audio": base64.b64encode(pcm[:123]).decode()},
            {"type": "speech.audio.delta", "audio": base64.b64encode(pcm[123:]).decode()},
            {"type": "speech.audio.done", "usage": {
                "input_tokens": 50, "output_tokens": 25, "total_tokens": 75,
            }},
        ]
        return httpx.Response(200, content=speech_events(events), headers={
            "content-type": "text/event-stream", "x-request-id": "speech-test",
        })

    service.config.openai_key = "test"
    monkeypatch.setattr(
        "ledad.ai.openai.AsyncOpenAI",
        lambda **kwargs: AsyncOpenAI(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        ),
    )
    session = service.sessions.create()
    if status == 200:
        result = await service.ai.provider.speech(session.id, "こんにちは。", "ja", "marin")
        assert result == (audio, "audio/wav")
    else:
        with pytest.raises(Exception, match="rate limited"):
            await service.ai.provider.speech(session.id, "こんにちは。", "ja", "marin")
    assert calls[0]["model"] == "gpt-4o-mini-tts"
    assert calls[0]["voice"] == "marin"
    assert calls[0]["response_format"] == "pcm"
    assert calls[0]["stream_format"] == "sse"
    assert calls[0]["input"] == "こんにちは。"
    record = service.usage.list()[0]
    assert record["provider"] == "openai"
    assert record["operation"] == "speech"
    assert record["status"] == ("completed" if status == 200 else "failed")
    assert record["inputCharacters"] == 6
    if status == 200:
        assert record["inputTokens"] == 50
        assert record["outputTokens"] == 25
        assert record["totalTokens"] == 75
        assert record["audioOutputSeconds"] == 1
        assert record["providerRequestId"] == "speech-test"


async def test_openai_speech_requires_key_and_records_failure(service):
    with pytest.raises(AppError, match="OpenAI APIキー"):
        await service.ai.provider.speech(service.sessions.create().id, "Hello", "en", "cedar")
    assert service.usage.list()[0]["status"] == "failed"


def speech_events(events):
    return "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events).encode()


@pytest.mark.parametrize("events", [
    [],
    [{"type": "speech.audio.delta", "audio": "AAAA"}],
    [{"type": "speech.audio.done", "usage": {"input_tokens": 1}}],
    [{"type": "speech.audio.done", "usage": {
        "input_tokens": 1, "output_tokens": -1, "total_tokens": 0,
    }}],
    [{"type": "speech.audio.done", "usage": {
        "input_tokens": 1, "output_tokens": 2, "total_tokens": 3,
    }}],
])
async def test_openai_speech_rejects_incomplete_stream(service, monkeypatch, events):
    service.config.openai_key = "test"
    monkeypatch.setattr(
        "ledad.ai.openai.AsyncOpenAI",
        lambda **kwargs: AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(
                200, content=speech_events(events), headers={"content-type": "text/event-stream"}
            ))
        )),
    )
    with pytest.raises(AppError):
        await service.ai.provider.speech(service.sessions.create().id, "Hello", "en", "cedar")
    assert service.usage.list()[0]["status"] == "failed"


async def test_openai_live_token_constraints_and_secret_redaction(service, monkeypatch):
    requests = []

    def handle(request):
        assert request.url.path == '/v1/realtime/client_secrets'
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={'value': 'ephemeral-secret', 'expires_at': 123})

    monkeypatch.setattr('ledad.ai.openai.AsyncOpenAI', lambda **kwargs: AsyncOpenAI(
        **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
    ))
    service.config.openai_key = 'test-key'
    session = service.sessions.create()
    token = await service.ai.provider.live_token(session, ['Ledad', 'bad\nword', '<bad>'])
    assert token['token'] == 'ephemeral-secret'
    settings = requests[0]['session']['audio']['input']
    assert settings['format'] == {'type': 'audio/pcm', 'rate': 24000}
    assert settings['turn_detection'] is None
    assert settings['transcription'] == {
        'model': 'gpt-live-transcribe', 'languages': [session.settings.language],
        'delay': 'low', 'keywords': ['Ledad'],
    }
    assert requests[0]['expires_after']['seconds'] == 60
    usage = service.usage.read(token['usageId'])
    assert usage.provider == 'openai'
    assert usage.operation == 'live_transcription'
    assert 'ephemeral-secret' not in ''.join(
        path.read_text() for path in service.config.data_dir.rglob('*.json')
    )


@pytest.mark.parametrize('status', [503, 307])
async def test_custom_endpoint_routes_all_openai_requests_without_fallback(service, monkeypatch, status):
    seen = []
    def handle(request):
        seen.append(request)
        return httpx.Response(status, headers={'location': 'https://api.openai.com/v1/responses'}, json={'error': {'message': 'unavailable'}})
    monkeypatch.setattr('ledad.ai.openai.DefaultAsyncHttpxClient', lambda **kwargs: httpx.AsyncClient(transport=httpx.MockTransport(handle), **kwargs))
    service.config.openai_key = 'gateway-key'
    service.config.save_base_url('https://gateway.example/company/v1')
    provider = service.ai.provider
    session = service.sessions.create()
    for name in ['document_preparation', 'meeting_consultation', 'meeting_analyze']:
        with pytest.raises(Exception):
            await provider.structured(Consultation, name, 'test', {}, session.id)
    async with service.usage.measured('openai', 'file_transcription', service.config.openai_stt_model, session.id) as record:
        with pytest.raises(Exception):
            await provider.transcribe(bytes(32000), 'ja', [], record)
    with pytest.raises(Exception):
        await provider.speech(session.id, 'Hello', 'en', 'marin')
    assert [r.url.path for r in seen] == ['/company/v1/responses'] * 3 + ['/company/v1/audio/transcriptions', '/company/v1/audio/speech']
    assert all(r.url.host == 'gateway.example' for r in seen)
    assert all(r.headers['authorization'] == 'Bearer gateway-key' for r in seen)
    assert [json.loads(r.content)['model'] for r in seen[:3]] == ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna']


async def test_endpoint_rotation_replaces_client_and_default_ignores_environment(service, monkeypatch):
    monkeypatch.setenv('OPENAI_BASE_URL', 'https://unselected.example/v1')
    service.config.openai_key = 'test'
    provider = service.ai.provider
    async with provider.client() as original:
        assert str(original.base_url) == 'https://api.openai.com/v1/'
        service.config.save_base_url('https://gateway.example/v1')
        async with provider.client() as custom:
            assert str(custom.base_url) == 'https://gateway.example/v1/'
            assert not original.is_closed()
    assert original.is_closed()
    service.config.save_base_url('')
    async with provider.client() as restored:
        assert str(restored.base_url) == 'https://api.openai.com/v1/'
        assert restored is not original
    assert custom.is_closed()
