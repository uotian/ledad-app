import asyncio
import json
import stat
from uuid import uuid4

import pytest

from ledad.storage.api_details import safe_body


async def request(service, path, method="GET", body=None):
    return await service.dispatch(
        {
            "id": str(uuid4()),
            "path": path,
            "method": method,
            "body": json.dumps(body) if body else None,
        }
    )


def test_body_preserves_prompts_but_excludes_credentials_and_audio():
    prompt = "日本語の指示\n" * 1000
    result = safe_body(
        {
            "input": prompt,
            "Authorization": "Bearer secret",
            "api_key": "not-prefixed",
            "file": ("file.wav", bytes(12), "audio/wav"),
            "audio": {"mimeType": "audio/pcm", "data": "base64payload"},
            "error": "secret-actual https://example.test?key=secret-query Bearer bearer-value",
        },
        ("secret-actual",),
    )
    assert result["input"] == prompt
    encoded = json.dumps(result)
    assert all(
        secret not in encoded
        for secret in ["secret", "not-prefixed", "base64payload", "bearer-value"]
    )
    assert result["file"][1] == {"omitted": "binary", "bytes": 12}


async def test_detail_scope_legacy_running_completion_and_delete(service):
    session, other = service.sessions.create(), service.sessions.create()
    record = service.usage.new("openai", "meeting_analyze", "model", session.id)
    service.usage.save(record)
    path = f"/api/sessions/{session.id}/usage/{record.id}"
    legacy = await request(service, path)
    assert legacy.status == 200 and legacy.value["request"] is None
    service.usage.capture(record, request={"input": "全文"})
    running = await request(service, path)
    assert running.value["request"] == {"input": "全文"}
    assert running.value["response"] is None
    assert (await request(service, f"/api/sessions/{other.id}/usage/{record.id}")).status == 404
    assert (await request(service, f"/api/sessions/{session.id}/usage/{uuid4()}")).status == 404
    service.usage.capture(record, response={"output": "応答"})
    record.status = "completed"
    service.usage.save(record)
    complete = await request(service, path)
    assert complete.value["record"]["status"] == "completed"
    assert complete.value["request"] == {"input": "全文"}
    assert complete.value["response"] == {"output": "応答"}
    assert stat.S_IMODE(service.usage.detail_path(record).stat().st_mode) == 0o600
    listed = await request(service, f"/api/sessions/{session.id}/usage")
    assert "request" not in listed.value[0] and "response" not in listed.value[0]
    await request(service, f"/api/sessions/{session.id}", "DELETE")
    assert not service.usage.detail_path(record).exists()
    service.usage.capture(record, response={"late": True})
    assert not service.usage.detail_path(record).exists()


async def test_failure_and_cancel_preserve_request(service):
    session = service.sessions.create()
    service.config.openai_key = "a-private-key"
    with pytest.raises(ValueError):
        async with service.usage.measured("openai", "test", "model", session.id) as record:
            service.usage.capture(record, request={"prompt": "質問"})
            error = ValueError("a-private-key failed")
            error.body = {"error": {"message": "原因", "api_key": "other-key"}}
            raise error
    detail = service.usage.details(record)
    assert detail["request"] == {"prompt": "質問"}
    assert detail["error"]["body"]["error"]["message"] == "原因"
    assert "a-private-key" not in json.dumps(detail) and "other-key" not in json.dumps(detail)
    with pytest.raises(asyncio.CancelledError):
        async with service.usage.measured("openai", "test", "model", session.id) as cancelled:
            service.usage.capture(cancelled, request={"prompt": "取消"})
            raise asyncio.CancelledError()
    assert service.usage.read(cancelled.id).status == "cancelled"
    assert service.usage.details(cancelled)["request"] == {"prompt": "取消"}


async def test_live_messages_are_recorded_and_invalid_json_rejected(service):
    session = service.sessions.create()
    record = service.usage.new("gemini", "live_transcription", "live", session.id)
    service.usage.save(record)
    service.usage.capture(record, request={"model": "live"})
    report = {
        "id": record.id,
        "sessionId": session.id,
        "status": "running",
        "audioInputSeconds": 1,
        "liveMessages": [
            json.dumps({"serverContent": {"inputTranscription": {"text": "こんにちは"}}})
        ],
    }
    assert (await request(service, "/api/usage", "POST", report)).status == 200
    detail = service.usage.details(record)
    assert (
        detail["response"]["messages"][0]["serverContent"]["inputTranscription"]["text"]
        == "こんにちは"
    )
    assert detail["request"] == {"model": "live"}
    report["liveMessages"] = ["not json"]
    assert (await request(service, "/api/usage", "POST", report)).status == 400
