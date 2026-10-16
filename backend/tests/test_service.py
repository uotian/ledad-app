import asyncio
import base64
import io
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pypdf import PdfWriter

from ledad.meeting.models import Session
from ledad.service import Service
from ledad.storage.files import compact
from ledad.transport.stdio import serve


async def request(service, path, method="GET", data=None, file=None):
    return await service.dispatch(
        {
            "id": str(uuid4()),
            "path": path,
            "method": method,
            **({"body": compact(data)} if data is not None else {}),
            **({"file": file} if file else {}),
        }
    )


async def create(service, mode="audience"):
    result = await request(service, "/api/sessions", "POST", {"mode": mode})
    assert result.status == 201
    return result.value


@pytest.mark.parametrize("legacy_profile", [False, True])
async def test_profile_names_are_not_sent_as_transcription_hints(service, legacy_profile):
    service.config.save_mode("gemini")
    data = await create(service)
    extra = {"profile": {"name": "ポケカメン kimono コレコレ", "aliases": ""}} if legacy_profile else {}
    service.gemini.live_token = AsyncMock(return_value={"token": "test"})
    result = await request(
        service, "/api/live-token", "POST", {"sessionId": data["id"], **extra}
    )
    assert result.status == 200
    assert service.gemini.live_token.call_args.args[1] == []

    data["status"] = "active"
    transcript_id = str(uuid4())
    data["transcripts"] = [{
        "id": transcript_id,
        "text": "頭も良くて",
        "timestamp": data["createdAt"],
        "translation": "",
        "source": "display",

        "analyzed": False,
        "disposition": "open",
    }]
    service.sessions.save(Session.model_validate(data))
    service.refinement.run = AsyncMock(return_value={"text": "頭も良くて"})
    result = await request(
        service, f"/api/sessions/{data['id']}/refine-transcripts", "POST", {
            "pcm": base64.b64encode(bytes(32000)).decode(),
            "transcriptIds": [transcript_id],
            "translationLanguage": "en",
            **extra,
        }
    )
    assert result.status == 200
    assert service.refinement.run.call_args.args[-1] == []
    assert result.value["text"] == "頭も良くて"


async def test_session_order_uses_creation_time_and_viewing_preserves_dates(service, monkeypatch):
    later = service.sessions.create("後から開始")
    earlier = service.sessions.create("先に開始")
    legacy = service.sessions.create("開始日時のない旧記録")
    for session, created, started, updated in [
        (later, "06:00", "09:00", "10:00"),
        (earlier, "07:00", "08:00", "11:00"),
        (legacy, "08:30", None, "12:00"),
    ]:
        session.status = "ended"
        session.created_at = f"2026-10-08T{created}:00.000Z"
        session.started_at = f"2026-10-08T{started}:00.000Z" if started else None
        session.ended_at = "2026-10-08T09:30:00.000Z"
        session.updated_at = f"2026-10-08T{updated}:00.000Z"
        service.sessions.save(session)

    expected = [legacy.id, earlier.id, later.id]
    assert [row["id"] for row in (await request(service, "/api/sessions")).value] == expected
    path = f"/api/sessions/{earlier.id}"
    dates = {key: earlier.wire()[key] for key in (
        "createdAt", "startedAt", "endedAt", "updatedAt", "meetingStartedAt", "meetingLastAt",
    )}
    now = "2026-10-09T00:00:00.000Z"
    monkeypatch.setattr("ledad.service.now_iso", lambda: now)
    for _ in range(2):
        restored = await request(service, path + "/commands", "POST", {"command": {"type": "restore"}})
        assert restored.status == 200
        assert {key: restored.value[key] for key in dates} == dates
    saved = (await request(service, path)).value
    assert {key: saved[key] for key in dates} == dates
    assert [row["id"] for row in (await request(service, "/api/sessions")).value] == expected

    saved["title"] = "実際に編集した会議"
    assert (await request(service, path, "PUT", saved)).status == 200
    edited = (await request(service, path)).value
    assert edited["updatedAt"] == now
    assert edited["startedAt"] == dates["startedAt"] and edited["endedAt"] == dates["endedAt"]
    assert [row["id"] for row in (await request(service, "/api/sessions")).value] == expected

    edited["transcripts"] = [
        {
            "id": str(uuid4()),
            "text": "再開した会議の発言",
            "translation": "",
            "timestamp": now,
            "source": "manual",

            "analyzed": False,
            "disposition": "open",
        }
    ]
    assert (await request(service, path, "PUT", edited)).status == 200
    assert [row["id"] for row in (await request(service, "/api/sessions")).value] == expected


async def test_ended_meeting_cannot_resume_and_pricing_preserved(service):
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    data["status"] = "active"
    assert (await request(service, path, "PUT", data)).status == 200
    stored = (await request(service, path)).value
    assert stored["pricing"] is not None
    data["status"] = "ended"
    data["endedAt"] = data["createdAt"]
    assert (await request(service, path, "PUT", data)).status == 200
    data["status"] = "preparing"
    assert (await request(service, path, "PUT", data)).status == 400
    data["status"] = "active"
    assert (await request(service, path, "PUT", data)).status == 400
    assert (await request(service, path)).value["endedAt"] == data["endedAt"]
    assert (await request(service, path)).value["pricing"] == stored["pricing"]
    data["shareToken"] = str(uuid4())
    assert (await request(service, path, "PUT", data)).status == 400
    assert (await request(service, path, "DELETE")).status == 200
    assert (await request(service, path)).status == 404


async def test_legacy_defaults_roundtrip(service):
    data = await create(service)
    del data["pricing"], data["analyze"], data["settings"]["listeningLimitMinutes"]
    del data["settings"]["translationLanguage"]
    del data["settings"]["vadSilenceMs"], data["settings"]["fixIntervalSeconds"]
    data["settings"]["input"] = "manual"
    data["chats"] = [
        {"id": str(uuid4()), "text": "private", "createdAt": data["createdAt"], "status": "applied"}
    ]
    parsed = Session.model_validate(data).wire()
    assert parsed["settings"]["input"] == "microphone"
    assert parsed["settings"]["listeningLimitMinutes"] == 30
    assert parsed["settings"]["translationLanguage"] is None
    assert parsed["settings"]["vadSilenceMs"] == 100
    assert parsed["settings"]["fixIntervalSeconds"] == 30
    assert parsed["chats"][0]["kind"] == "instruction"
    assert parsed["pricing"] is None
    assert parsed["analyze"] is None


@pytest.mark.parametrize(("minutes", "expected"), [(3, 10), (10, 10), (30, 30), (60, 60), (90, 90)])
async def test_listening_limit_roundtrip(service, minutes, expected):
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    data["settings"]["listeningLimitMinutes"] = minutes
    assert (await request(service, path, "PUT", data)).status == 200
    saved = (await request(service, path)).value["settings"]
    assert saved["listeningLimitMinutes"] == expected


async def test_last_selected_settings_survive_restart_and_session_deletion(service):
    older = await create(service)
    previous_settings = older["settings"].copy()
    edited = await create(service)
    edited["settings"].update(
        language="en",
        translationLanguage="zh",
        voice="Aoede",
        input="microphone",
        listeningLimitMinutes=60,
        vadSilenceMs=500,
        fixIntervalSeconds=120,
    )
    path = "/api/sessions/" + edited["id"]
    assert (await request(service, path, "PUT", edited)).status == 200
    expected = edited["settings"].copy()

    # 再起動しても保持し、以前の会議の設定は変更しません。
    restarted = Service(service.config)
    fresh = await create(restarted)
    assert fresh["settings"] == expected
    assert (await request(restarted, "/api/sessions/" + older["id"])).value[
        "settings"
    ] == previous_settings
    # 古い会議のタイトル保存や会議開始は、最後に選んだ設定を巻き戻しません。
    older["title"] = "以前の会議を編集"
    older["status"] = "active"
    assert (await request(restarted, "/api/sessions/" + older["id"], "PUT", older)).status == 200
    assert (await create(restarted))["settings"] == expected

    # 保存を拒否した値は次回用の設定にも反映しません。
    edited["settings"]["vadSilenceMs"] = 999
    assert (await request(restarted, path, "PUT", edited)).status == 400
    assert (await create(restarted))["settings"] == expected
    edited["settings"]["vadSilenceMs"] = 200
    edited["settings"]["translationLanguage"] = None
    assert (await request(restarted, path, "PUT", edited)).status == 200
    expected = edited["settings"].copy()

    # 全件削除後も設定は残し、会議・資料・記録は引き継ぎません。
    for summary in (await request(restarted, "/api/sessions")).value:
        assert (await request(restarted, "/api/sessions/" + summary["id"], "DELETE")).status == 200
    fresh = await create(Service(service.config))
    assert fresh["settings"] == expected
    assert fresh["title"] == "新しい会議"
    assert fresh["documents"] == fresh["transcripts"] == []

    (service.config.data_dir / "meeting-settings.json").write_text('{"language":"invalid"}')
    assert (await create(restarted))["settings"] == previous_settings


@pytest.mark.parametrize("language", [None, "ja", "en", "zh"])
async def test_translation_language_roundtrip(service, language):
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    data["settings"]["translationLanguage"] = language
    assert (await request(service, path, "PUT", data)).status == 200
    saved = (await request(service, path)).value
    assert saved["settings"]["translationLanguage"] == language
    assert saved["settings"]["language"] == "ja"
    data["settings"]["translationLanguage"] = "invalid"
    assert (await request(service, path, "PUT", data)).status == 400
    assert (await request(service, path)).value["settings"]["translationLanguage"] == language


@pytest.mark.parametrize("vad_ms", [50, 100, 200, 300, 500])
async def test_vad_silence_roundtrip(service, vad_ms):
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    data["settings"]["vadSilenceMs"] = vad_ms
    assert (await request(service, path, "PUT", data)).status == 200
    assert (await request(service, path)).value["settings"]["vadSilenceMs"] == vad_ms
    for invalid in [0, 400, -1, "300", None]:
        data["settings"]["vadSilenceMs"] = invalid
        assert (await request(service, path, "PUT", data)).status == 400
    assert (await request(service, path)).value["settings"]["vadSilenceMs"] == vad_ms


async def test_pdf_storage_and_removed_share_routes(service):
    service.ai.prepare_document = AsyncMock(return_value={"summary": "## p.1\n参照文", "glossary": []})
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    writer = PdfWriter()
    writer.add_blank_page(300, 300)
    writer.add_blank_page(300, 300)
    stream = io.BytesIO()
    writer.write(stream)
    raw = stream.getvalue()
    result = await request(
        service,
        path + "/documents",
        "POST",
        file={"name": "slides.pdf", "data": base64.b64encode(raw).decode(), "kind": "presentation"},
    )
    assert result.status == 200
    document = result.value["document"]
    assert len(document["pages"]) == 2
    assert "markdown" not in document and "glossary" not in document
    assert document["preparationPending"] is True
    service.ai.prepare_document.assert_not_awaited()
    assert "content" not in document
    assert (await request(service, path)).value["pricing"] is None
    data["documents"] = [document]
    data["presentationDocumentId"] = document["id"]
    data["chats"] = [
        {
            "id": str(uuid4()),
            "text": "本人だけのコメント",
            "createdAt": data["createdAt"],
            "status": "applied",
        }
    ]
    assert (await request(service, path, "PUT", data)).status == 200
    share = "/api/share/" + data["shareToken"]
    assert (await request(service, share)).status == 404
    assert (await request(service, share + "/slide")).status == 404
    document.update(classification="public", allowSharing=True)
    assert (await request(service, path, "PUT", data)).status == 200
    result = await request(service, share)
    assert result.status == 404
    assert "本人だけ" not in compact(result.value)
    assert (await request(service, share + "/slide")).status == 404
    assert (await request(service, path + "/documents/" + document["id"])).value == raw
    assert (service.sessions.path(data["id"]) / document["id"]).stat().st_mode & 0o777 == 0o600
    data["status"] = "ended"
    await request(service, path, "PUT", data)
    assert (await request(service, share + "/slide")).status == 404
    data["documents"] = []
    await request(service, path, "PUT", data)
    assert not (service.sessions.path(data["id"]) / document["id"]).exists()


async def test_invalid_routes_and_validation(service):
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    for url, method in [
        (path + "/generate", "GET"),
        (path + "/extra/path", "DELETE"),
        ("/api/speech", "GET"),
        ("/api/sessions/../../usage", "GET"),
    ]:
        assert (await request(service, url, method)).status == 404
    assert (
        await request(
            service, path + "/translate", "POST", {"text": "test", "translationLanguage": "invalid"}
        )
    ).status == 400
    assert (await request(service, "/api/sessions", "POST", {"mode": "other"})).status == 400


@pytest.mark.parametrize("status", ["preparing", "ended"])
async def test_consultation_and_candidates_without_recording(service, status):
    data = await create(service)
    data["status"] = status
    chat = {
        "id": str(uuid4()),
        "kind": "consultation",
        "text": "ここまでの話を整理して",
        "reply": "",
        "status": "pending",
        "createdAt": data["createdAt"],
    }
    data["chats"] = [chat]
    session = Session.model_validate(data)
    service.sessions.save(session)
    service.ai.consult = AsyncMock(return_value={"reply": "確認事項を整理しました。"})
    service.ai.candidates = AsyncMock(
        return_value={"note": "", "candidates": []}
    )
    path = "/api/sessions/" + data["id"]
    assert (
        await request(service, path + "/consult", "POST", {"chatId": chat["id"], "language": "ja"})
    ).status == 200
    assert (
        await request(
            service, path + "/consult", "POST", {"chatId": str(uuid4()), "language": "ja"}
        )
    ).status == 400
    assert (await request(service, path + "/generate", "POST", {"targetId": None})).status == 200
    assert service.sessions.read(data["id"]).status == status
    assert service.sessions.read(data["id"]).utterances == []


async def test_preview_and_analysis_contract(service):
    data = await create(service)
    data["status"] = "active"
    service.sessions.save(Session.model_validate(data))
    service.ai.preview = AsyncMock(return_value={"translation": "Next week"})
    service.ai.translate = AsyncMock(return_value={"translation": ""})
    path = "/api/sessions/" + data["id"]
    previous = {"text": "来", "translation": "Next"}
    assert (
        await request(
            service,
            path + "/translate-transcript",
            "POST",
            {"text": "来週", "translationLanguage": "en", "previous": previous},
        )
    ).value == {"translation": "Next week"}
    assert service.ai.preview.call_args.args[3] == previous
    assert (
        await request(
            service,
            path + "/translate-transcript",
            "POST",
            {"text": "来週", "translationLanguage": "en", "previous": {"text": "来"}},
        )
    ).status == 400
    await request(service, path + "/translate", "POST", {"text": "来週"})
    assert service.ai.translate.call_args.args[2] == "ja"
    assert service.sessions.read(data["id"]).transcripts == []


async def test_stdio_concurrency_cancel_and_bad_input(service):
    entered = asyncio.Event()
    finalized = asyncio.Event()
    original = service.dispatch

    async def dispatch(message):
        if message["path"] == "/slow":
            entered.set()
            try:
                await asyncio.sleep(60)
            finally:
                finalized.set()
        return await original(message)

    service.dispatch = dispatch
    reader = asyncio.StreamReader()
    responses = []
    server = asyncio.create_task(serve(service, reader, responses.append))

    def send(value):
        reader.feed_data((compact(value) + "\n").encode())

    reader.feed_data(b"bad json\n[]\n")
    send({"id": "slow", "path": "/slow", "method": "GET"})
    await asyncio.wait_for(entered.wait(), 2)
    send({"id": "fast", "path": "/api/config", "method": "GET"})
    for _ in range(20):
        await asyncio.sleep(0.005)
        if responses:
            break
    assert responses[0]["id"] == "fast"
    send({"cancel": "slow"})
    await asyncio.wait_for(finalized.wait(), 2)
    reader.feed_eof()
    await server
    assert any(r["id"] == "slow" and r["status"] == 499 for r in responses)


async def test_stdio_eof_cancels_pending_work_and_finalizes_usage(service):
    entered = asyncio.Event()
    responses = []

    async def dispatch(message):
        async with service.usage.measured("openai", "test", "test", None):
            entered.set()
            await asyncio.Event().wait()

    service.dispatch = dispatch
    reader = asyncio.StreamReader()
    server = asyncio.create_task(serve(service, reader, responses.append))
    reader.feed_data(b'{"id":"pending","path":"/slow","method":"GET"}\n')
    await asyncio.wait_for(entered.wait(), 2)
    reader.feed_eof()
    await asyncio.wait_for(server, 2)

    assert len(responses) == 1
    assert responses[0]["id"] == "pending"
    assert responses[0]["status"] == 499
    assert service.usage.list()[0]["status"] == "cancelled"


async def test_usage_finalized_when_cancelled(service):
    entered = asyncio.Event()

    async def work():
        async with service.usage.measured("openai", "test", "test-model", None):
            entered.set()
            await asyncio.sleep(60)

    task = asyncio.create_task(work())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    record = service.usage.list()[0]
    assert record["status"] == "cancelled"
    assert record["endedAt"] is not None


async def test_live_usage_only_updates_own_running_record(service):
    data = await create(service)
    record = service.usage.new("gemini", "live_transcription", "live", data["id"])
    service.usage.save(record)
    report = {
        "id": record.id,
        "sessionId": data["id"],
        "status": "running",
        "audioInputSeconds": 5,
        "liveReports": [],
    }
    assert (await request(service, "/api/usage", "POST", report)).status == 200
    report["audioInputSeconds"] = 3
    report["status"] = "completed"
    await request(service, "/api/usage", "POST", report)
    assert service.usage.read(record.id).audio_input_seconds == 5
    report["audioInputSeconds"] = 10
    await request(service, "/api/usage", "POST", report)
    assert service.usage.read(record.id).audio_input_seconds == 5
    report["sessionId"] = str(uuid4())
    assert (await request(service, "/api/usage", "POST", report)).status == 400


async def test_credentials_never_returned(service):
    service.config.save_mode("gemini")
    service.config.openai_key = "sk-test-secret"
    service.config.stt_model = "test-live"
    service.config.fix_stt_model = "test-fixed"
    service.config.openai_stt_model = "test-openai-fixed"
    service.config.openai_model = "test-generation"
    service.config.consultation_model = "test-consultation"
    service.config.tts_model = "test-speech"
    result = await request(service, "/api/config")
    assert result.value["openai"] is True
    assert result.value["models"] == {
        "transcription": "test-live",
        "refinement": "test-openai-fixed",
        "generation": "test-generation",
        "consultation": "test-consultation",
        "speech": "test-speech",
    }
    assert "sk-test" not in compact(result.value)
    service.diagnostics.log(
        {"source": "meeting", "message": "Bearer sensitive sk-test-secret ?key=secret"}
    )
    logs = (service.config.data_dir / "logs/errors.jsonl").read_text()
    assert "sensitive" not in logs and "sk-test" not in logs and "key=secret" not in logs


async def test_refinement_provider_persists_and_rejects_unknown_values(service):
    from ledad.config import Config

    assert (await request(service, "/api/config")).value["refinementProvider"] == "openai"
    service.config.save_mode("gemini")
    for provider, model in [("gemini", "gemini-3.5-transcribe"), ("openai", "gpt-transcribe")]:
        result = await request(service, "/api/config", "PUT", {"provider": provider})
        assert result.status == 200
        assert result.value["models"]["refinement"] == model
        assert Config(service.config.data_dir).public()["refinementProvider"] == provider
    for invalid in ["invalid", None, 1]:
        assert (await request(service, "/api/config", "PUT", {"provider": invalid})).status == 400
    assert service.config.refinement_provider() == "openai"


async def test_live_provider_persists_and_keeps_fixed_choice(service):
    from ledad.config import Config

    service.config.save_mode("gemini")
    service.config.save_refinement_provider("gemini")
    for provider, model in [("apple", "Apple SpeechTranscriber"), ("gemini", service.config.stt_model), ("openai", service.config.openai_live_stt_model)]:
        result = await request(service, "/api/live-settings", "PUT", {"provider": provider})
        assert result.status == 200
        assert result.value["models"]["transcription"] == model
        assert result.value["refinementProvider"] == "gemini"
        assert Config(service.config.data_dir).public()["liveProvider"] == provider
    for invalid in ["invalid", None, 1]:
        assert (await request(service, "/api/live-settings", "PUT", {"provider": invalid})).status == 400


async def test_usage_scan_does_not_block_unrelated_requests(service, monkeypatch):
    import threading

    entered, release = threading.Event(), threading.Event()

    def scan():
        entered.set()
        release.wait(3)
        return []

    monkeypatch.setattr(service.usage, "list", scan)
    slow = asyncio.create_task(request(service, "/api/usage"))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        assert (await asyncio.wait_for(request(service, "/api/config"), 0.5)).status == 200
    finally:
        release.set()
        await slow


def test_usage_index_observes_changes_deletion_and_data_directory(service, tmp_path):
    record = service.usage.new("openai", "test", "test", None)
    service.usage.save(record)
    assert service.usage.list()[0]["status"] == "running"
    record.status = "completed"
    service.usage.save(record)
    assert service.usage.list()[0]["status"] == "completed"
    service.usage.path(record.id).write_text("invalid")
    assert service.usage.list() == []
    service.usage.save(record)
    assert len(service.usage.list()) == 1
    service.usage.path(record.id).unlink()
    assert service.usage.list() == []
    service.usage.save(record)
    service.config.data_dir = tmp_path / "other"
    assert service.usage.list() == []


async def test_presenter_retired_but_saved_material_survives_meeting_updates(service):
    data = (await request(service, "/api/sessions", "POST", {"title": "以前の発表"})).value
    assert data["mode"] == "audience" and data["scripts"] == []
    assert (await request(service, "/api/sessions", "POST", {"mode": "presenter"})).status == 400
    # Simulate an on-disk record from the previous version, including unspoken originals.
    data.update(
        mode="presenter",
        scripts=[{"page": 1, "original": "保存する原稿", "spoken": "Saved script"}],
        currentPage=1,
        caption="以前の字幕",
        utterances=[
            {
                "id": str(uuid4()),
                "kind": "presentation",
                "candidateId": None,
                "targetId": None,
                "page": 1,
                "plannedText": "発表の全文",
                "completedText": "実際に話した部分",
                "status": "interrupted",
                "startedAt": data["createdAt"],
                "endedAt": data["createdAt"],
                "elapsedSeconds": 1,
            }
        ],
    )
    service.sessions.save(Session.model_validate(data))
    path = "/api/sessions/" + data["id"]
    loaded = (await request(service, path)).value
    assert loaded["scripts"] == data["scripts"]
    loaded["title"] = "会議として続ける"
    loaded["settings"]["language"] = "en"
    assert (await request(service, path, "PUT", loaded)).status == 200
    for action in ("restore", "start", "end"):
        result = await request(service, path + "/commands", "POST", {"command": {"type": action}})
        assert result.status == 200
        for field in ("mode", "scripts", "currentPage", "caption", "shareToken", "utterances"):
            assert result.value[field] == data[field]
    assert (await request(service, "/api/share/" + data["shareToken"])).status == 404
    assert (await request(service, "/api/share/" + data["shareToken"] + "/slide")).status == 404


async def test_home_settings_read_and_idempotent_first_save(service):
    settings = await request(service, "/api/meeting-settings")
    assert settings.status == 200
    assert settings.value["input"] == "mixed"
    assert settings.value["listeningLimitMinutes"] == 30
    assert settings.value["fixIntervalSeconds"] == 30
    assert settings.value["vadSilenceMs"] == 100
    assert service.sessions.list() == []
    session_id = str(uuid4())
    created = await request(service, "/api/sessions", "POST", {"id": session_id, "title": "準備"})
    assert created.status == 201
    assert created.value["id"] == session_id
    assert created.value["settings"]["input"] == "mixed"
    session = service.sessions.read(session_id)
    session.title = "保存した編集"
    session.settings.language = "en"
    session.settings.input = "display"
    service.sessions.save(session, remember_settings=True)
    retried = await request(service, "/api/sessions", "POST", {"id": session_id, "title": "準備"})
    assert retried.value["title"] == "保存した編集"
    assert retried.value["shareToken"] == created.value["shareToken"]
    assert len(service.sessions.list()) == 1
    assert (await request(service, "/api/meeting-settings")).value["language"] == "en"
    assert (await request(service, "/api/meeting-settings")).value["input"] == "display"
    invalid = await request(service, "/api/sessions", "POST", {"id": "../invalid"})
    assert invalid.status == 400


@pytest.mark.parametrize("seconds", [15, 30, 60, 120])
async def test_fix_interval_roundtrip(service, seconds):
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    data["settings"]["fixIntervalSeconds"] = seconds
    assert (await request(service, path, "PUT", data)).status == 200
    assert (await request(service, path)).value["settings"]["fixIntervalSeconds"] == seconds
    assert (await request(service, "/api/meeting-settings")).value["fixIntervalSeconds"] == seconds
    for invalid in [0, 90, 180, -1, "60", None]:
        data["settings"]["fixIntervalSeconds"] = invalid
        assert (await request(service, path, "PUT", data)).status == 400
    assert (await request(service, path)).value["settings"]["fixIntervalSeconds"] == seconds


@pytest.mark.parametrize(
    'provider,operation,label,status',
    [
        ('openai', 'transcript_analysis', 'Fix翻訳', 500),
        ('openai', 'meeting_analyze', 'Analyze', 429),
        ('gemini', 'live_token', 'LiveSTTの接続', 403),
        ('gemini', 'speech', 'TTS', 503),
        ('gemini', 'file_transcription', 'FixSTT', 500),
    ],
)
async def test_ai_error_identifies_actual_provider_and_operation(
    service, monkeypatch, provider, operation, label, status
):
    class ProviderError(Exception):
        status_code = status

    original = ProviderError('private transcript sk-secret')

    async def fail(_request, on_text=None):
        async with service.usage.measured(provider, operation, 'test-model', None):
            raise original

    monkeypatch.setattr(service, 'route', fail)
    result = await request(service, '/api/sessions')
    assert result.status == (429 if status == 429 else 502)
    assert result.value['error'].startswith(f"{'OpenAI' if provider == 'openai' else 'Gemini'} / {label}：")
    assert 'private transcript' not in result.value['error']
    assert 'sk-secret' not in result.value['error']
    if status == 500:
        assert 'AIサービス側でエラー' in result.value['error']
        assert '設定' not in result.value['error']
    record = service.usage.list()[0]
    assert record['errorCode'] == str(status)
    assert record['status'] == 'failed'


async def test_ai_app_error_preserves_specific_reason_and_cancellation(service, monkeypatch):
    from ledad.errors import AppError

    async def fail(_request, on_text=None):
        async with service.usage.measured('gemini', 'speech', 'test-model', None):
            raise AppError('音声を生成できませんでした。', 502)

    monkeypatch.setattr(service, 'route', fail)
    result = await request(service, '/api/speech')
    assert result.value['error'] == 'Gemini / TTS：音声を生成できませんでした。'

    async def cancel(_request, on_text=None):
        async with service.usage.measured('openai', 'transcript_preview', 'test-model', None):
            raise asyncio.CancelledError()

    monkeypatch.setattr(service, 'route', cancel)
    with pytest.raises(asyncio.CancelledError):
        await request(service, '/api/sessions')


@pytest.mark.parametrize('kind', ['openai', 'httpx', 'builtin'])
async def test_analyze_timeout_keeps_provider_reason_and_safe_diagnostics(service, monkeypatch, kind):
    import httpx
    from openai import APITimeoutError

    error = {
        'openai': APITimeoutError(request=httpx.Request('POST', 'https://api.openai.com/v1/responses')),
        'httpx': httpx.ReadTimeout('private transcript sk-secret'),
        'builtin': TimeoutError('private transcript sk-secret'),
    }[kind]

    async def fail(_request, on_text=None):
        async with service.usage.measured('openai', 'meeting_analyze', 'gpt-6-luna', None):
            raise error

    monkeypatch.setattr(service, 'route', fail)
    result = await request(service, '/api/sessions')
    assert result.status == 502
    assert result.value['error'] == 'OpenAI / Analyze：AIの応答待ちがタイムアウトしました。'
    record = service.usage.list()[0]
    assert record['errorDetails']['reason'] == 'timeout'
    assert 'private transcript' not in compact(record)
    assert 'sk-secret' not in compact(record)


async def test_session_usage_is_scoped_and_newest_first(service):
    first = service.sessions.create('first')
    second = service.sessions.create('second')
    records = []
    for session_id, provider, operation, started in [
        (first.id, 'openai', 'meeting_analyze', '2026-10-08T14:00:00Z'),
        (second.id, 'openai', 'meeting_consultation', '2026-10-08T14:05:00Z'),
        (first.id, 'gemini', 'live_transcription', '2026-10-08T14:02:00Z'),
        (None, 'openai', 'meeting_analyze', '2026-10-08T14:06:00Z'),
    ]:
        record = service.usage.new(provider, operation, 'test-model', session_id)
        record.started_at = started
        service.usage.save(record)
        records.append(record)
    result = await request(service, f'/api/sessions/{first.id}/usage')
    assert result.status == 200
    assert [r['id'] for r in result.value] == [records[2].id, records[0].id]
    assert [r['operationLabel'] for r in result.value] == ['LiveSTT', 'Analyze']
    assert (await request(service, f'/api/sessions/{uuid4()}/usage')).status == 404


async def test_completed_live_translation_can_be_marked_unused_without_changing_usage(service):
    session = service.sessions.create('first')
    other = service.sessions.create('other')
    record = service.usage.new('openai', 'transcript_preview', 'test-model', session.id)
    record.status = 'completed'
    record.input_tokens = 400
    record.output_tokens = 20
    service.usage.save(record)
    path = f'/api/sessions/{session.id}/usage/{record.id}/unused'
    assert (await request(service, f'/api/sessions/{other.id}/usage/{record.id}/unused', 'POST')).status == 400
    assert (await request(service, path, 'POST')).status == 200
    assert (await request(service, path, 'POST')).status == 200
    saved = service.usage.read(record.id)
    assert (saved.status, saved.unused, saved.input_tokens, saved.output_tokens) == (
        'completed', True, 400, 20
    )
    listed = (await request(service, f'/api/sessions/{session.id}/usage')).value
    assert listed[0]['status'] == 'completed' and listed[0]['unused'] is True

    unrelated = service.usage.new('openai', 'transcript_analysis', 'test-model', session.id)
    unrelated.status = 'completed'
    service.usage.save(unrelated)
    assert (
        await request(service, f'/api/sessions/{session.id}/usage/{unrelated.id}/unused', 'POST')
    ).status == 400


async def test_mixed_audio_roundtrip(service):
    data = await create(service)
    path = "/api/sessions/" + data["id"]
    data["settings"]["input"] = "mixed"
    data["transcripts"] = [{
        "id": str(uuid4()), "text": "双方の発言", "translation": "",
        "timestamp": data["createdAt"], "source": "mixed",
        "analyzed": False, "disposition": "open",
    }]
    assert (await request(service, path, "PUT", data)).status == 200
    saved = (await request(service, path)).value
    assert saved["settings"]["input"] == "mixed"
    assert saved["transcripts"][0]["source"] == "mixed"
    assert (await create(Service(service.config)))["settings"]["input"] == "mixed"


@pytest.mark.parametrize('failure', ['api', 'ended', 'deleted', 'removed'])
async def test_document_preparation_failure_keeps_original_without_restoring_deleted_data(service, failure):
    data = await create(service)
    path = '/api/sessions/' + data['id']

    async def prepare(session, content):
        if failure == 'api':
            raise ValueError('test preparation failure')
        if failure == 'deleted':
            service.sessions.delete(session.id)
        elif failure == 'removed':
            latest = service.sessions.read(session.id)
            updated = latest.model_copy(update={'documents': []})
            service.update_session(latest, updated)
        else:
            latest = service.sessions.read(session.id)
            latest.status = 'ended'
            service.sessions.save(latest)
        return {'summary': 'reference', 'glossary': []}

    service.ai.prepare_document = AsyncMock(side_effect=prepare)
    result = await request(service, path + '/documents', 'POST', file={
        'name': 'memo.md', 'data': base64.b64encode(b'memo').decode(), 'kind': 'reference',
    })
    assert result.status == 200
    document = result.value['document']
    data['documents'] = [document]
    assert (await request(service, path, 'PUT', data)).status == 200
    result = await request(service, path + '/document-reference', 'POST')
    assert result.status >= 400
    if failure == 'deleted':
        assert not service.sessions.path(data['id']).exists()
    elif failure == 'removed':
        assert service.sessions.read(data['id']).documents == []
        assert {p.name for p in service.sessions.path(data['id']).iterdir()} == {'session.json'}
    else:
        saved = service.sessions.read(data['id'])
        assert len(saved.documents) == 1
        assert saved.documents[0].preparation_pending is True
        assert 'markdown' not in saved.documents[0].wire()
        assert (service.sessions.path(data['id']) / document['id']).read_bytes() == b'memo'


@pytest.mark.parametrize('status', ['preparing', 'active'])
async def test_upload_saves_without_ai_and_preparation_is_reused_after_restart(service, status):
    data = await create(service)
    data['status'] = status
    path = '/api/sessions/' + data['id']
    assert (await request(service, path, 'PUT', data)).status == 200
    service.ai.prepare_document = AsyncMock(return_value={
        'summary': '## p.1\nLedadの資料',
        'glossary': ['Ledad'],
    })
    uploaded = await request(service, path + '/documents', 'POST', file={
        'name': 'memo.md', 'data': base64.b64encode(b'Ledad').decode(), 'kind': 'reference',
    })
    assert uploaded.status == 200
    document = uploaded.value['document']
    service.ai.prepare_document.assert_not_awaited()
    assert (service.sessions.path(data['id']) / document['id']).read_bytes() == b'Ledad'
    data['documents'] = [document]
    assert (await request(service, path, 'PUT', data)).status == 200
    prepare_path = path + '/document-reference'
    first, duplicate = await asyncio.gather(
        request(service, prepare_path, 'POST'), request(service, prepare_path, 'POST'),
    )
    assert first.status == duplicate.status == 200
    assert first.value == duplicate.value
    assert first.value['documentIds'] == [document['id']]
    assert first.value['summary'] == '## p.1\nLedadの資料'
    service.ai.prepare_document.assert_awaited_once()
    assert service.ai.prepare_document.call_args.args[1][0]['text'] == '## p.1\nLedad'
    # A response lost after saving may be followed by a stale frontend snapshot.
    data['title'] = '生成中の編集'
    assert (await request(service, path, 'PUT', data)).status == 200
    saved = (await request(service, path)).value
    assert saved['title'] == '生成中の編集'
    assert saved['documents'][0]['preparationPending'] is False
    assert saved['documentReference'] == first.value
    assert saved['status'] == status
    assert saved['pricing'] is not None
    restarted = Service(service.config)
    restarted.ai.prepare_document = AsyncMock(side_effect=AssertionError('Do not regenerate'))
    try:
        assert (await request(restarted, prepare_path, 'POST')).value == first.value
    finally:
        await restarted.close()


async def test_shared_preparation_retries_all_files_and_regenerates_on_add_remove(service):
    from ledad.meeting.policy import documents_for, glossary_for

    data = await create(service)
    path = '/api/sessions/' + data['id']
    async def add(name):
        result = await request(service, path + '/documents', 'POST', file={
            'name': name, 'data': base64.b64encode(name.encode()).decode(), 'kind': 'reference',
        })
        data['documents'].append(result.value['document'])
        assert (await request(service, path, 'PUT', data)).status == 200
    await add('first.txt')
    await add('second.txt')
    service.ai.prepare_document = AsyncMock(side_effect=[
        ValueError('failure'),
        {'summary': 'shared reference', 'glossary': ['Shared']},
        {'summary': 'three files', 'glossary': []},
        {'summary': 'second and third', 'glossary': []},
    ])
    url = path + '/document-reference'
    assert (await request(service, url, 'POST')).status == 502
    saved = service.sessions.read(data['id'])
    assert all(d.preparation_pending for d in saved.documents)
    assert documents_for(saved) == ''
    assert glossary_for(saved) == []
    assert (await request(service, url, 'POST')).status == 200
    inputs = service.ai.prepare_document.call_args.args[1]
    assert [p['text'] for p in inputs if p['type'] == 'input_text' and p['text'].startswith('##')] == [
        '## p.1\nfirst.txt', '## p.1\nsecond.txt',
    ]
    assert (await request(service, url, 'POST')).status == 200
    assert service.ai.prepare_document.await_count == 2
    assert glossary_for(service.sessions.read(data['id'])) == ['Shared']
    await add('third.txt')
    existing = service.sessions.read(data['id'])
    assert documents_for(existing) == 'shared reference'
    assert glossary_for(existing) == ['Shared']
    assert (await request(service, url, 'POST')).value['summary'] == 'three files'
    removed = data['documents'].pop(0)
    assert (await request(service, path, 'PUT', data)).status == 200
    assert not (service.sessions.path(data['id']) / removed['id']).exists()
    assert glossary_for(service.sessions.read(data['id'])) == []
    assert (await request(service, url, 'POST')).value['summary'] == 'second and third'
    assert len(service.ai.prepare_document.call_args.args[1]) == 2
    data['documents'] = []
    assert (await request(service, path, 'PUT', data)).status == 200
    assert (await request(service, url, 'POST')).value == {'documentIds': [], 'summary': '', 'glossary': []}
    assert service.ai.prepare_document.await_count == 4


async def test_api_file_limit_keeps_originals_and_does_not_call_ai(service, monkeypatch):
    import ledad.service as module

    data = await create(service)
    path = '/api/sessions/' + data['id']
    for i in range(3):
        uploaded = await request(service, path + '/documents', 'POST', file={
            'name': f'{i}.txt', 'data': base64.b64encode(b'original').decode(), 'kind': 'reference',
        })
        data['documents'].append(uploaded.value['document'])
    assert (await request(service, path, 'PUT', data)).status == 200
    # Simulate converted PDF sizes without allocating 50 MB of fixture data.
    monkeypatch.setattr(module, 'extract_document', lambda *_: {
        'content': {'type': 'input_file', 'filename': 'slides.pdf', 'file_data': 'data:application/pdf;base64,eA=='},
    })
    monkeypatch.setattr(module.base64, 'b64decode', lambda *_: range(20_000_000))
    service.ai.prepare_document = AsyncMock(side_effect=AssertionError('Do not call API'))
    result = await request(service, path + '/document-reference', 'POST')
    assert result.status == 413 and '合計50MB' in result.value['error']
    service.ai.prepare_document.assert_not_awaited()
    assert all(d.preparation_pending for d in service.sessions.read(data['id']).documents)
    for document in data['documents']:
        assert (service.sessions.path(data['id']) / document['id']).read_bytes() == b'original'


async def test_large_text_and_page_totals_have_no_extra_product_limit(service):
    data = await create(service)
    path = '/api/sessions/' + data['id']
    for i in range(3):
        uploaded = await request(service, path + '/documents', 'POST', file={
            'name': f'{i}.txt', 'data': base64.b64encode(('x' * 99_000).encode()).decode(), 'kind': 'reference',
        })
        data['documents'].append(uploaded.value['document'])
    assert (await request(service, path, 'PUT', data)).status == 200
    service.ai.prepare_document = AsyncMock(return_value={'summary': 'all three', 'glossary': []})
    assert (await request(service, path + '/document-reference', 'POST')).status == 200
    inputs = service.ai.prepare_document.call_args.args[1]
    assert sum(len(p.get('text', '')) for p in inputs) > 200_000


@pytest.mark.parametrize('status,code', [(400, 'context_length_exceeded'), (413, None)])
async def test_api_input_limit_is_reported_and_originals_remain(service, status, code):
    import httpx
    from openai import APIStatusError

    data = await create(service)
    path = '/api/sessions/' + data['id']
    uploaded = await request(service, path + '/documents', 'POST', file={
        'name': 'memo.txt', 'data': base64.b64encode(b'original').decode(), 'kind': 'reference',
    })
    data['documents'] = [uploaded.value['document']]
    assert (await request(service, path, 'PUT', data)).status == 200
    response = httpx.Response(status, request=httpx.Request('POST', 'https://api.openai.com/v1/responses'))
    service.ai.prepare_document = AsyncMock(side_effect=APIStatusError(
        'input limit exceeded', response=response, body={'code': code},
    ))
    result = await request(service, path + '/document-reference', 'POST')
    assert result.status == 413 and '入力上限を超えました' in result.value['error']
    saved = service.sessions.read(data['id'])
    assert saved.documents[0].preparation_pending
    assert saved.document_reference is None or saved.document_reference.summary == ''
    assert (service.sessions.path(data['id']) / data['documents'][0]['id']).read_bytes() == b'original'


async def test_legacy_documents_remain_local_until_explicit_shared_preparation(service, document):
    from ledad.meeting.policy import documents_for

    session = service.sessions.create()
    session.documents = [document]
    service.sessions.save(session)
    restored = service.sessions.read(session.id)
    assert restored.document_reference is None
    assert not restored.documents[0].preparation_pending
    assert documents_for(restored) == ''
    (service.sessions.path(session.id) / document.id).write_bytes(b'legacy original')
    service.ai.prepare_document = AsyncMock(return_value={'summary': 'shared legacy', 'glossary': []})
    result = await request(service, '/api/sessions/' + session.id + '/document-reference', 'POST')
    assert result.status == 200
    assert result.value['summary'] == 'shared legacy'
    service.ai.prepare_document.assert_awaited_once()


async def test_live_token_receives_only_glossary_terms(service, document, reference):
    service.config.save_mode("gemini")
    session = service.sessions.create()
    session.documents = [document]
    session.document_reference = reference
    service.sessions.save(session)
    service.gemini.live_token = AsyncMock(return_value={})
    assert (await request(service, '/api/live-token', 'POST', {'sessionId': session.id})).status == 200
    assert service.gemini.live_token.call_args.args[1] == ['Ledad']


async def test_usage_returns_record_cost_from_meeting_snapshot(service):
    from ledad.meeting.pricing import create_pricing_snapshot, estimate_usd

    data = await create(service)
    session = service.sessions.read(data["id"])
    record = service.usage.new("openai", "analyze", "gpt-6-luna", session.id)
    record.input_tokens = 1000
    record.output_tokens = 100
    service.usage.save(record)
    path = f"/api/sessions/{session.id}/usage"
    assert (await request(service, path)).value[0]["yen"] is None
    session.pricing = create_pricing_snapshot()
    service.sessions.save(session)
    result = (await request(service, path)).value[0]
    assert result["yen"] == pytest.approx(estimate_usd(record.wire(), session.pricing) * session.pricing.usd_to_jpy)
    record.model = "unknown-model"
    service.usage.save(record)
    assert (await request(service, path)).value[0]["yen"] is None


@pytest.mark.parametrize("voice", ["marin", "cedar", "Kore", "Aoede", "Puck", "Charon"])
async def test_speech_routes_by_selected_voice(service, voice):
    session = await create(service)
    service.ai.provider.speech = AsyncMock(return_value=(b"openai", "audio/wav"))
    service.gemini.speech = AsyncMock(return_value=(b"gemini", "audio/wav"))
    result = await request(service, "/api/speech", "POST", {
        "sessionId": session["id"], "text": "Hello", "language": "en", "voice": voice,
    })
    assert result.status == 200
    is_openai = voice in ("marin", "cedar")
    assert result.value == (b"openai" if is_openai else b"gemini")
    selected = service.ai.provider if is_openai else service.gemini
    other = service.gemini if is_openai else service.ai.provider
    selected.speech.assert_awaited_once_with(session["id"], "Hello", "en", voice)
    other.speech.assert_not_awaited()


async def test_speech_rejects_unknown_voice_before_provider_call(service):
    session = await create(service)
    service.ai.provider.speech = AsyncMock()
    service.gemini.speech = AsyncMock()
    result = await request(service, "/api/speech", "POST", {
        "sessionId": session["id"], "text": "Hello", "language": "en", "voice": "unknown",
    })
    assert result.status == 400
    service.ai.provider.speech.assert_not_awaited()
    service.gemini.speech.assert_not_awaited()


async def test_openai_speech_cost_in_existing_meeting_history(service):
    from ledad.meeting.pricing import create_pricing_snapshot

    session = service.sessions.create()
    session.pricing = create_pricing_snapshot()
    session.pricing.rates = [r for r in session.pricing.rates if r.model != 'gpt-4o-mini-tts']
    service.sessions.save(session)
    async with service.usage.measured('openai', 'speech', 'gpt-4o-mini-tts', session.id) as record:
        record.input_tokens = 50
        record.output_tokens = 25
        record.total_tokens = 75
    history = await request(service, f'/api/sessions/{session.id}/usage')
    total = await request(service, f'/api/sessions/{session.id}/cost')
    assert history.status == total.status == 200
    assert history.value[0]['yen'] > 0
    assert total.value['openai']['yen'] == history.value[0]['yen']
    assert not total.value['openai']['incomplete']


async def test_ai_mode_api_restricts_and_restores_settings(service):
    assert (await request(service, "/api/config")).value["aiMode"] == "openai"
    assert (await request(service, "/api/config", "PUT", {"provider": "gemini"})).status == 400
    assert (await request(service, "/api/live-settings", "PUT", {"provider": "gemini"})).status == 400
    for invalid in ["invalid", None, 1]:
        assert (await request(service, "/api/ai-settings", "PUT", {"mode": invalid})).status == 400
    response = await request(service, "/api/ai-settings", "PUT", {"mode": "gemini"})
    assert response.status == 200
    assert response.value["liveProvider"] == "gemini"
    assert response.value["refinementProvider"] == "openai"
    assert (await request(service, "/api/config", "PUT", {"provider": "gemini"})).status == 200
    await request(service, "/api/ai-settings", "PUT", {"mode": "openai"})
    assert service.config.refinement_provider() == "openai"
    response = await request(service, "/api/ai-settings", "PUT", {"mode": "gemini"})
    assert response.value["refinementProvider"] == "gemini"


async def test_custom_endpoint_blocks_cloud_live_and_gemini_speech(service):
    session = await create(service)
    result = await request(service, '/api/connection-settings', 'PUT', {'baseUrl': 'https://gateway.example/v1'})
    assert result.status == 200
    assert result.value['liveProvider'] == 'apple'
    service.ai.provider.live_token = AsyncMock()
    service.gemini.live_token = AsyncMock()
    service.gemini.speech = AsyncMock()
    for provider in ['openai', 'gemini']:
        result = await request(service, '/api/live-token', 'POST', {'sessionId': session['id'], 'provider': provider})
        assert result.status == 400
    result = await request(service, '/api/speech', 'POST', {'sessionId': session['id'], 'text': 'Hello', 'language': 'en', 'voice': 'Kore'})
    assert result.status == 400
    service.ai.provider.live_token.assert_not_called()
    service.gemini.live_token.assert_not_called()
    service.gemini.speech.assert_not_called()
