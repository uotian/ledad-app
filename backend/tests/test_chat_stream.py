import asyncio
import base64
import json
from uuid import uuid4

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from openai import AsyncOpenAI

from ledad.ai.outputs import Consultation
from ledad.errors import AppError
from ledad.meeting.commands import ChatStart, apply_command
from ledad.service import Response
from ledad.transport.http import create_app
from ledad.transport.stdio import serve


@pytest.mark.parametrize('ending', ['completed', 'incomplete', 'failed', 'disconnected', 'invalid', 'error'])
async def test_provider_stream_requires_valid_completed_response(service, monkeypatch, ending):
    reply = '途中の日本語\n"引用"と\\記号'
    output = json.dumps({'reply': reply}, ensure_ascii=False)
    response = {
        'id': 'resp_stream', 'object': 'response', 'created_at': 1,
        'model': 'gpt-6.1-sol',
        'status': ending if ending in ('incomplete', 'failed') else 'completed',
        'output': [{'type': 'message', 'id': 'msg_1', 'role': 'assistant',
                    'status': 'completed', 'content': [{'type': 'output_text',
                    'text': '{}' if ending == 'invalid' else output, 'annotations': []}]}],
        'usage': {'input_tokens': 20, 'output_tokens': 30, 'total_tokens': 50,
                  'input_tokens_details': {'cached_tokens': 5},
                  'output_tokens_details': {'reasoning_tokens': 10}},
    }
    events = [{'type': 'response.output_text.delta', 'delta': c,
               'item_id': 'msg_1', 'output_index': 0, 'content_index': 0, 'sequence_number': i}
              for i, c in enumerate(output)]
    if ending == 'error':
        events.append({'type': 'error', 'message': 'failed', 'code': 'server_error', 'sequence_number': 99})
    elif ending != 'disconnected':
        events.append({'type': f'response.{response["status"]}', 'response': response, 'sequence_number': 99})

    def handle(request):
        assert json.loads(request.content)['stream'] is True
        return httpx.Response(200, headers={'Content-Type': 'text/event-stream'},
                              content=''.join(f'data: {json.dumps(e)}\n\n' for e in events))

    service.config.openai_key = 'test'
    monkeypatch.setattr('ledad.ai.openai.AsyncOpenAI', lambda **kwargs: AsyncOpenAI(
        **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle))))
    partials = []

    async def on_text(text):
        partials.append(text)

    call = service.ai.provider.structured(Consultation, 'meeting_consultation', 'test', {},
                                         service.sessions.create().id, on_text=on_text)
    if ending == 'completed':
        assert await call == {'reply': reply}
    else:
        with pytest.raises(AppError):
            await call
    assert partials[-1] == reply
    assert any(0 < len(text) < len(reply) for text in partials)
    record = service.usage.list()[0]
    assert record['status'] == ('completed' if ending == 'completed' else 'failed')
    if ending not in ('disconnected', 'error'):
        assert record['outputTokens'] == 30
        assert record['reasoningTokens'] == 10


async def test_http_chat_stream_is_transient_and_disconnect_cancels(service):
    session = service.sessions.create()
    session.status = "active"
    chat_id = str(uuid4())
    session = apply_command(session, ChatStart(type='chat-start', id=chat_id, text='質問'), '2026-10-15T00:00:00Z')
    service.sessions.save(session)
    cancelled = asyncio.Event()

    async def consult(session, chat_id, language, on_text):
        try:
            async with service.usage.measured('openai', 'meeting_consultation', 'test', session.id):
                await on_text('途中です')
                await asyncio.sleep(60)
        finally:
            cancelled.set()

    service.ai.consult = consult
    async with TestClient(TestServer(create_app(service), handler_cancellation=True)) as client:
        response = await client.post(f'/api/sessions/{session.id}/consult?stream=true',
                                     json={'chatId': chat_id, 'language': 'ja'})
        assert json.loads(await response.content.readline()) == {'text': '途中です'}
        chat = service.sessions.read(session.id).chats[0]
        assert chat.status == 'pending' and chat.reply == '' and chat.replied_at is None
        response.close()
        await asyncio.wait_for(cancelled.wait(), 2)
    assert service.usage.list()[0]['status'] == 'cancelled'
    assert service.sessions.read(session.id).chats[0].reply == ''


@pytest.mark.parametrize('cancel', [False, True])
async def test_stdio_delivers_partial_before_terminal_response(service, cancel):
    release = asyncio.Event()
    partial = asyncio.Event()
    messages = []

    async def dispatch(message, on_text):
        await on_text('途中')
        await release.wait()
        return Response({'reply': '完成'})

    def send(message):
        messages.append(message)
        if 'text' in message:
            partial.set()

    service.dispatch = dispatch
    reader = asyncio.StreamReader()
    task = asyncio.create_task(serve(service, reader, send))
    reader.feed_data(b'{"id":"chat","path":"/api/test/consult","method":"POST","stream":true}\n')
    await asyncio.wait_for(partial.wait(), 2)
    assert messages == [{'id': 'chat', 'text': '途中'}]
    if cancel:
        reader.feed_data(b'{"cancel":"chat"}\n')
    else:
        release.set()
    for _ in range(100):
        if len(messages) > 1:
            break
        await asyncio.sleep(0.001)
    reader.feed_eof()
    await task
    assert messages[-1]['status'] == (499 if cancel else 200)
    if not cancel:
        assert json.loads(base64.b64decode(messages[-1]['body'])) == {'reply': '完成'}
