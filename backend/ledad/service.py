"""Application entry points shared by stdio and the development HTTP adapter."""

import asyncio
import base64
import binascii
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from .ai.gemini import GeminiProvider
from .ai.openai import OpenAIProvider
from .ai.refinement import Refinement
from .ai.tasks import MeetingAI
from .errors import AI_OPERATIONS, AppError, ai_error_message, is_timeout, status_of
from .meeting.commands import SessionCommand, apply_command
from .meeting.documents import MIME_TYPES, extract_document
from .meeting.models import ID_PATTERN, MeetingDocumentReference, Session
from .meeting.policy import reference_is_current, vocabulary_for
from .meeting.pricing import create_pricing_snapshot, estimate_usd, meeting_cost
from .storage.diagnostics import Diagnostics
from .storage.files import compact, now_iso
from .storage.sessions import Sessions
from .storage.usage import Usage
from .transport import requests as contracts


@dataclass
class Response:
    value: object
    status: int = 200
    content_type: str = "application/json"

    def bytes(self):
        return self.value if isinstance(self.value, bytes) else compact(self.value).encode()

    def envelope(self, request_id):
        return {
            "id": request_id,
            "status": self.status,
            "contentType": self.content_type,
            "body": base64.b64encode(self.bytes()).decode(),
        }


def body(request, model):
    if not request.body:
        raise AppError("入力データを読み取れませんでした。")
    if len(request.body.encode()) > 12_000_000:
        raise AppError("データが大きすぎます。", 413)
    try:
        data = json.loads(request.body)
    except ValueError:
        raise AppError("入力データを読み取れませんでした。") from None
    return model.model_validate(data)


class Service:
    def __init__(self, config):
        self.config = config
        self.sessions = Sessions(config)
        self.usage = Usage(config)
        self.diagnostics = Diagnostics(config)
        self.ai = MeetingAI(OpenAIProvider(config, self.usage))
        self.gemini = GeminiProvider(config, self.usage)
        self.refinement = Refinement(config, self.usage, self.diagnostics, self.ai, self.gemini)
        self.document_preparation_lock = asyncio.Lock()

    async def close(self):
        await self.ai.provider.close()

    async def dispatch(self, input, on_text=None):
        request = None
        failure = None
        try:
            request = contracts.Request.model_validate(input)
            return await self.route(request, on_text)
        except asyncio.CancelledError:
            raise
        except AppError as error:
            failure = error
            result = Response({"error": str(error)}, error.status)
        except ValidationError:
            result = Response(
                {
                    "error": "入力内容を確認してください。文字数・ファイル数・形式が制限を超えている可能性があります。"
                },
                400,
            )
        except Exception as error:
            failure = error
            status = status_of(error)
            input_limit = (request is not None and request.path.endswith("/document-reference")
                           and (status == 413 or getattr(error, "code", None) in {
                               "context_length_exceeded", "input_too_large", "file_too_large",
                           }))
            message = (
                "資料全体がAPIの入力上限を超えました。資料を減らして再試行してください。"
                if input_limit
                else "AIの応答待ちがタイムアウトしました。"
                if is_timeout(error)
                else "APIキーまたはモデルの利用権限を確認してください。設定後にもう一度お試しください。"
                if status in (401, 403)
                else "AIサービスの利用上限に達しました。少し待つか、APIの利用枠を確認して再試行してください。"
                if status == 429
                else "AIサービス側でエラーが発生しました。少し待って再試行してください。"
                if isinstance(status, int) and 500 <= status < 600
                else "処理を完了できませんでした。接続と設定を確認し、もう一度お試しください。"
            )
            result = Response({"error": message}, 413 if input_limit else 429 if status == 429 else 502)
        result.value["error"] = ai_error_message(failure, result.value["error"])
        parts = request.path.split("/") if request else []
        resource = parts[2] if len(parts) > 2 else "unknown"
        session_id = (
            parts[3]
            if resource == "sessions"
            and len(parts) > 3
            and re.fullmatch(ID_PATTERN, parts[3])
            else None
        )
        # Never persist arbitrary paths (filenames or submitted text).
        operations = {
            "config",
            "diagnostics",
            "usage",
            "live-token",
            "speech",
            "sessions",
            "cost",
            "documents",
            "generate",
            "consult",
            "translate",
            "minutes",
            "translate-transcript",
            "analyze",
            "mentions",
            "refine-transcripts",
            "commands",
        }
        action = parts[4] if resource == "sessions" and len(parts) > 4 else resource
        operation = action if action in operations else "unknown"
        self.diagnostics.log(
            {
                "source": "service",
                "sessionId": session_id,
                "operation": f"{request.method if request else 'INVALID'} {operation}",
                "message": result.value["error"],
                "status": result.status,
            },
            failure,
        )
        return result

    async def route(self, request, on_text=None):
        path, verb = request.path, request.method
        if path == "/api/meeting-settings" and verb == "GET":
            return Response(self.sessions.default_settings())
        if path == "/api/config" and verb == "GET":
            return Response(self.config.public())
        if path == "/api/config" and verb == "PUT":
            settings = body(request, contracts.RefinementSettings)
            self.config.save_refinement_provider(settings.provider)
            return Response(self.config.public())
        if path == "/api/live-settings" and verb == "PUT":
            settings = body(request, contracts.LiveSettings)
            self.config.save_live_provider(settings.provider)
            return Response(self.config.public())
        if path == "/api/diagnostics" and verb == "POST":
            notice = body(request, contracts.ErrorNotice)
            saved = self.diagnostics.log({**notice.wire(), "source": "meeting"})
            return Response({"saved": saved}, 200 if saved else 503)
        if path == "/api/usage":
            if verb == "GET":
                return Response(await asyncio.to_thread(self.usage.list))
            if verb == "POST":
                report = body(request, contracts.UsageReport)
                record = self.usage.read(report.id)
                if (
                    record.operation != "live_transcription"
                    or record.session_id != report.session_id
                ):
                    raise AppError("利用記録と会議が一致しません。")
                if record.status == "running":
                    record.audio_input_seconds = max(
                        record.audio_input_seconds or 0, report.audio_input_seconds
                    )
                    record.status = report.status
                    record.live_reports = report.live_reports
                    try:
                        messages = [json.loads(message) for message in report.live_messages]
                    except ValueError:
                        raise AppError("API応答の記録を読み取れませんでした。") from None
                    self.usage.capture(record, response={
                        "messages": messages,
                        "truncated": report.live_messages_truncated,
                        "audioInputSeconds": report.audio_input_seconds,
                    })
                    record.ended_at = None if record.status == "running" else now_iso()
                    self.usage.save(record)
                return Response({"saved": True})
        if path == "/api/live-token" and verb == "POST":
            data = body(request, contracts.LiveToken)
            session = self.sessions.read(data.session_id)
            # 登録名への認識バイアスを避け、プロフィールは言及検出だけに使います。
            return Response(await self.gemini.live_token(session, vocabulary_for(session)))
        if path == "/api/speech" and verb == "POST":
            data = body(request, contracts.Speech)
            self.sessions.read(data.session_id)
            audio, mime = await self.gemini.speech(
                data.session_id, data.text, data.language, data.voice
            )
            return Response(audio, content_type=mime)
        if path == "/api/sessions":
            if verb == "GET":
                return Response(self.sessions.list())
            if verb == "POST":
                data = body(request, contracts.CreateSession)
                return Response(self.sessions.create(data.title, data.id).wire(), 201)
        parts = path.split("/")
        if len(parts) >= 4 and parts[:3] == ["", "api", "sessions"]:
            session = self.sessions.read(parts[3])
            if len(parts) == 6 and parts[4] == "usage" and verb == "GET":
                record = self.usage.read(parts[5])
                if record.session_id != session.id:
                    raise AppError("利用記録が見つかりません。", 404)
                details = await asyncio.to_thread(self.usage.details, record)
                return Response({"record": record.wire(), **details})
            if len(parts) == 7 and parts[4] == "usage" and parts[6] == "unused" and verb == "POST":
                record = self.usage.read(parts[5])
                if (
                    record.session_id != session.id
                    or record.provider != "openai"
                    or record.operation != "transcript_preview"
                    or record.status != "completed"
                ):
                    raise AppError("利用記録と会議が一致しません。")
                record.unused = True
                self.usage.save(record)
                return Response({"saved": True})
            if len(parts) == 4:
                if verb == "GET":
                    return Response(session.wire())
                if verb == "DELETE":
                    self.sessions.delete(session.id)
                    return Response({"deleted": True})
                if verb == "PUT":
                    return self.update_session(session, body(request, Session))
            if len(parts) == 5:
                action = parts[4]
                if action == "usage" and verb == "GET":
                    records = await asyncio.to_thread(self.usage.list)
                    result = []
                    for record in records:
                        if record["sessionId"] != session.id:
                            continue
                        usd = estimate_usd(record, session.pricing) if session.pricing else None
                        result.append({
                            **record,
                            "operationLabel": AI_OPERATIONS.get(record["operation"], record["operation"]),
                            "yen": usd * session.pricing.usd_to_jpy if usd is not None else None,
                        })
                    return Response(result)
                if action == "cost" and verb == "GET":
                    records = await asyncio.to_thread(self.usage.list)
                    return Response(meeting_cost(session, records))
                if action == "document-reference" and verb == "POST":
                    return await self.prepare_documents(session.id)
                if action == "documents" and verb == "POST":
                    return await self.upload(session, request.file)
                if action == "commands" and verb == "POST":
                    data = body(request, SessionCommand)
                    if data.command_id in session.applied_commands:
                        return Response(session.wire())
                    updated = apply_command(data.snapshot or session, data.command, now_iso())
                    self.update_session(session, updated, command_id=data.command_id)
                    return Response(updated.wire())
                if verb == "POST":
                    return await self.meeting_action(session, action, request, on_text)
            if len(parts) == 6 and parts[4] == "documents" and verb == "GET":
                return self.document_file(session, parts[5])
        raise AppError("操作が見つかりません。", 404)

    def update_session(self, previous, session, command_id=None):
        if previous.id != session.id or previous.share_token != session.share_token:
            raise AppError("会議の識別情報が一致しません。")
        if previous.minutes is not None and (
            session.status != previous.status or session.minutes != previous.minutes
        ):
            raise AppError("要約済みの会議は再開・再要約できません。")
        if previous.status == "ended" and session.status == "preparing":
            raise AppError("終了した会議は準備状態に戻せません。")
        if previous.status == "ended" and session.status == "active":
            raise AppError("終了した会議は再開できません。")
        previous_files = {d.id: d for d in previous.documents}
        changed = [d for d in session.documents if d.id not in previous_files
                   or (d.name, d.size, d.format, d.pages) != (
                       previous_files[d.id].name, previous_files[d.id].size,
                       previous_files[d.id].format, previous_files[d.id].pages)]
        ids = [d.id for d in session.documents]
        if changed or ids != [d.id for d in previous.documents]:
            changed_ids = {d.id for d in changed}
            retained = all(d.id in ids and d.id not in changed_ids for d in previous.documents)
            session.document_reference = (previous.document_reference if retained
                                          else MeetingDocumentReference(document_ids=[]))
            for document in session.documents:
                document.preparation_pending = True
        elif reference_is_current(previous) or not reference_is_current(session):
            # A stale snapshot must not erase a successfully saved shared result.
            session.document_reference = previous.document_reference
            for document in session.documents:
                document.preparation_pending = previous_files[document.id].preparation_pending
        session.pricing = previous.pricing or (
            create_pricing_snapshot() if session.status == "active" else None
        )
        session.record_meeting_times()
        changed = session.model_copy(
            update={"updated_at": previous.updated_at, "applied_commands": previous.applied_commands}
        ) != previous
        session.updated_at = now_iso() if changed else previous.updated_at
        # Receipts live in the same atomic file as the state change. A lost reply
        # can be retried without generating duplicate candidates or chat records.
        session.applied_commands = (
            previous.applied_commands + ([command_id] if command_id else [])
        )[-128:]
        self.sessions.save(session, remember_settings=session.settings != previous.settings)
        retained = {d.id for d in session.documents}
        for document in previous.documents:
            if document.id not in retained:
                (self.sessions.path(session.id) / document.id).unlink(missing_ok=True)
        return Response({"saved": True})

    async def upload(self, session, file):
        if session.status == "ended":
            raise AppError("終了した会議には資料を追加できません。")
        if len(session.documents) >= 30:
            raise AppError("資料は30件まで登録できます。")
        if file is None:
            raise AppError("ファイルと資料の種類を指定してください。")
        try:
            data = base64.b64decode(file.data, validate=True)
        except binascii.Error:
            raise AppError("ファイルを読み取れませんでした。") from None
        if len(data) > 20 * 1024 * 1024:
            raise AppError("ファイルは20MB以内にしてください。")
        result = await asyncio.to_thread(extract_document, data, file.name)
        session = self.sessions.read(session.id)
        if session.status == "ended" or len(session.documents) >= 30:
            raise AppError("会議の更新状態を確認してください。")
        result.pop("content")
        document_id = str(uuid4())
        path = self.sessions.path(session.id) / document_id
        with path.open("xb") as stream:
            os.chmod(path, 0o600)
            stream.write(data)
        warning = result.pop("warning")
        return Response(
            {
                "document": {
                    "id": document_id,
                    "name": file.name,
                    "kind": file.kind,
                    "size": len(data),
                    **result,
                    "preparationPending": True,
                },
                "warning": warning,
            }
        )

    async def prepare_documents(self, session_id):
        async with self.document_preparation_lock:
            session = self.sessions.read(session_id)
            if session.minutes is not None:
                raise AppError("要約済みの会議の資料は読み取れません。")
            ids = [d.id for d in session.documents]
            reference = session.document_reference
            if reference is not None and reference.document_ids == ids and not any(
                    d.preparation_pending for d in session.documents):
                return Response(reference.wire())
            if not ids:
                return Response(MeetingDocumentReference(document_ids=[]).wire())
            content = await asyncio.to_thread(self.document_inputs, session)
            latest = self.preparation_session(session)
            if latest.pricing is None:
                latest.pricing = create_pricing_snapshot()
                self.sessions.save(latest)
            result = await self.ai.prepare_document(latest, content)
            latest = self.preparation_session(session)
            reference = MeetingDocumentReference.model_validate({**result, "documentIds": ids})
            updated = latest.model_copy(deep=True)
            updated.document_reference = reference
            for document in updated.documents:
                document.preparation_pending = False
            self.update_session(latest, updated)
            return Response(reference.wire())

    def document_inputs(self, session):
        content, file_size = [], 0
        for document in session.documents:
            data = (self.sessions.path(session.id) / document.id).read_bytes()
            result = extract_document(data, document.name)
            part = result["content"]
            if part["type"] == "input_file":
                file_size += len(base64.b64decode(part["file_data"].split(",", 1)[1]))
                if file_size > 50_000_000:
                    raise AppError("資料全体がAPIのファイル入力上限（合計50MB）を超えました。資料を減らして再試行してください。", 413)
            content.append(part)
        return content

    def preparation_session(self, snapshot):
        session = self.sessions.read(snapshot.id)
        if (session.status != snapshot.status or session.minutes is not None
                or session.documents != snapshot.documents):
            raise AppError("会議または資料が変更されました。もう一度お試しください。")
        return session

    def document_file(self, session, document_id):
        document = next((d for d in session.documents if d.id == document_id), None)
        if document is None:
            raise AppError("資料が見つかりません。", 404)
        return Response(
            (self.sessions.path(session.id) / document.id).read_bytes(),
            content_type=MIME_TYPES.get(Path(document.name).suffix.lower(), "application/octet-stream"),
        )

    async def meeting_action(self, session, action, request, on_text=None):
        if action == "generate":
            data = body(request, contracts.Generation)
            return Response(await self.ai.candidates(session, data.target_id, data.instruction))
        if action == "consult":
            data = body(request, contracts.Consultation)
            chat = next((c for c in session.chats if c.id == data.chat_id), None)
            if chat is None or chat.kind != "consultation" or chat.status != "pending":
                raise AppError("相談内容が見つかりません。")
            return Response(await self.ai.consult(session, chat.id, data.language, on_text=on_text))
        if action == "translate":
            data = body(request, contracts.Translation)
            return Response(
                await self.ai.translate(
                    data.text,
                    [t.text for t in session.transcripts[-5:]],
                    data.translation_language,
                    session,
                )
            )
        if action == "minutes":
            if session.minutes is not None:
                raise AppError("要約済みの会議は再要約できません。")
            if session.status != "ended":
                raise AppError("会議を終了してから記録を作成してください。")
            return Response(await self.ai.minutes(session))
        if action == "translate-transcript":
            if session.status != "active":
                raise AppError("会議を開始してから翻訳してください。")
            data = body(request, contracts.Preview)
            return Response(
                await self.ai.preview(
                    session,
                    data.text,
                    data.translation_language,
                    data.previous.wire() if data.previous else None,
                )
            )
        if action == "analyze":
            data = body(request, contracts.AnalyzeRequest)
            if session.status != "active":
                raise AppError("会話分析は会議中に更新できます。")
            if not data.conversation:
                raise AppError("会話がまだありません。")
            return Response(await self.ai.analyze(session, data))
        if action == "refine-transcripts":
            if session.status == "preparing":
                raise AppError("会議を開始してから翻訳してください。")
            data = body(request, contracts.Refinement)
            try:
                pcm = base64.b64decode(data.pcm, validate=True)
            except binascii.Error:
                raise AppError("音声の形式を確認してください。") from None
            if (
                not pcm
                or len(pcm) % 2
                or len(pcm) > 190 * 32000
                or len(set(data.transcript_ids)) != len(data.transcript_ids)
            ):
                raise AppError("音声の形式を確認してください。")
            transcripts = [t for t in session.transcripts if t.id in data.transcript_ids]
            if len(transcripts) != len(data.transcript_ids) or any(
                t.source == "manual" or t.corrected_at for t in transcripts
            ):
                raise AppError("会話の更新状態を確認してください。")
            return Response(
                await self.refinement.run(
                    session, pcm, transcripts, data.translation_language, vocabulary_for(session)
                )
            )
        raise AppError("操作が見つかりません。", 404)
