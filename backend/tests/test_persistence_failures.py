import asyncio
import base64
import threading
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ledad.meeting.documents import extract_document
from ledad.storage.files import compact


async def request(service, session_id, method, suffix="", data=None, file=None):
    return await service.dispatch({
        "id": str(uuid4()), "path": f"/api/sessions/{session_id}{suffix}", "method": method,
        **({"body": compact(data)} if data is not None else {}),
        **({"file": file} if file is not None else {}),
    })


def fail_session_replace(monkeypatch, target):
    replace = Path.replace

    def fail(path, destination):
        if destination == target:
            raise OSError("simulated disk failure")
        return replace(path, destination)

    monkeypatch.setattr(Path, "replace", fail)


async def test_failed_commit_keeps_state_and_receipt_retryable(service, monkeypatch):
    session = service.sessions.create()
    path = service.sessions.path(session.id) / "session.json"
    original = path.read_bytes()
    command_id = str(uuid4())
    data = {"commandId": command_id, "command": {
        "type": "chat-start", "id": str(uuid4()), "text": "Keep this question",
    }}
    with monkeypatch.context() as patch:
        fail_session_replace(patch, path)
        response = await request(service, session.id, "POST", "/commands", data)
    assert response.status == 502
    assert path.read_bytes() == original
    assert list(path.parent.glob("*.tmp")) == []

    for _ in range(2):
        assert (await request(service, session.id, "POST", "/commands", data)).status == 200
    saved = service.sessions.read(session.id)
    assert len(saved.chats) == 1
    assert saved.chats[0].text == "Keep this question"
    assert saved.applied_commands == [command_id]


async def test_failed_document_removal_keeps_original_until_metadata_is_saved(
    service, document, reference, monkeypatch,
):
    session = service.sessions.create()
    session.documents = [document]
    session.document_reference = reference
    service.sessions.save(session)
    directory = service.sessions.path(session.id)
    original = directory / document.id
    original.write_bytes(b"irreplaceable source")
    update = session.wire()
    update["documents"] = []

    with monkeypatch.context() as patch:
        fail_session_replace(patch, directory / "session.json")
        response = await request(service, session.id, "PUT", data=update)
    assert response.status == 502
    assert service.sessions.read(session.id) == session
    assert original.read_bytes() == b"irreplaceable source"
    assert list(directory.glob("*.tmp")) == []

    assert (await request(service, session.id, "PUT", data=update)).status == 200
    saved = service.sessions.read(session.id)
    assert saved.documents == []
    assert saved.document_reference.document_ids == []
    assert saved.document_reference.summary == ""
    assert not original.exists()


@pytest.mark.parametrize("interruption", ["deleted", "ended", "cancelled"])
async def test_upload_does_not_write_after_interruption(service, monkeypatch, interruption):
    session = service.sessions.create()
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()

    def extract(data, name):
        entered.set()
        try:
            assert release.wait(5), "test did not release extraction"
            return extract_document(data, name)
        finally:
            finished.set()

    monkeypatch.setattr("ledad.service.extract_document", extract)
    upload = asyncio.create_task(request(service, session.id, "POST", "/documents", file={
        "name": "memo.txt", "data": base64.b64encode(b"source").decode(), "kind": "reference",
    }))
    directory = service.sessions.path(session.id)
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        if interruption == "deleted":
            assert (await request(service, session.id, "DELETE")).status == 200
        elif interruption == "ended":
            assert (await request(service, session.id, "POST", "/commands", {
                "command": {"type": "end"},
            })).status == 200
        else:
            upload.cancel()
            with pytest.raises(asyncio.CancelledError):
                await upload
        release.set()
        assert await asyncio.to_thread(finished.wait, 2)
        if interruption != "cancelled":
            response = await asyncio.wait_for(upload, 2)
            assert response.status == (404 if interruption == "deleted" else 400)
        if interruption == "deleted":
            assert not directory.exists()
        else:
            assert {p.name for p in directory.iterdir()} == {"session.json"}
            assert service.sessions.read(session.id).documents == []
    finally:
        release.set()
        upload.cancel()
        await asyncio.gather(upload, return_exceptions=True)


async def test_cancelled_preparation_keeps_source_and_can_be_retried(service, document, reference):
    session = service.sessions.create()
    document.preparation_pending = True
    session.documents = [document]
    session.document_reference = reference
    service.sessions.save(session)
    original = service.sessions.path(session.id) / document.id
    original.write_bytes(b"source")
    entered = asyncio.Event()

    async def prepare(*_):
        entered.set()
        await asyncio.Event().wait()

    service.ai.prepare_document = AsyncMock(side_effect=prepare)
    task = asyncio.create_task(request(service, session.id, "POST", "/document-reference"))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        saved = service.sessions.read(session.id)
        assert saved.documents[0].preparation_pending
        assert saved.document_reference == session.document_reference
        assert original.read_bytes() == b"source"

        service.ai.prepare_document = AsyncMock(return_value={"summary": "retried", "glossary": []})
        response = await asyncio.wait_for(
            request(service, session.id, "POST", "/document-reference"), 2,
        )
        assert response.status == 200
        saved = service.sessions.read(session.id)
        assert not saved.documents[0].preparation_pending
        assert saved.document_reference.summary == "retried"
        assert original.read_bytes() == b"source"
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
