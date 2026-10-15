import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI

from ledad.errors import AppError
from ledad.meeting.pricing import create_pricing_snapshot, estimate_usd


@pytest.mark.parametrize('mode', ['success', 'refusal', 'missing', 'duplicate', 'unknown', 'nan', 'bool', 'http', 'cancel'])
async def test_decisions_sdk_wire_validation_usage_and_failures(service, monkeypatch, mode):
    captured = []

    def handle(request):
        assert request.url.path == '/v1/decisions'
        captured.append(json.loads(request.content))
        if mode == 'cancel':
            raise asyncio.CancelledError()
        if mode == 'http':
            return httpx.Response(429, json={'error': {'message': 'quota', 'type': 'rate_limit'}})
        answer = {'type': 'predicate', 'name': 'c1', 'probability': .8}
        if mode == 'refusal':
            answer = {'type': 'refusal', 'name': 'c1'}
        if mode == 'unknown':
            answer['name'] = 'unknown'
        if mode == 'nan':
            answer['probability'] = 'NaN'
        if mode == 'bool':
            answer['probability'] = True
        answers = [] if mode == 'missing' else [answer]
        if mode == 'duplicate':
            answers *= 2
        return httpx.Response(200, json={'id': 'decision_test', 'answers': answers,
                                        'usage': {'input_tokens': 100, 'output_tokens': 10}})

    service.config.openai_key = 'test'
    monkeypatch.setattr('ledad.ai.openai.AsyncOpenAI', lambda **kwargs: AsyncOpenAI(
        **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle))))
    targets = ['c1', 'c2'] if mode == 'duplicate' else ['c1']
    call = service.ai.provider.decisions({'names': ['内藤'], 'conversation': []}, targets,
                                         service.sessions.create().id)
    if mode == 'success':
        assert await call == {'c1': .8}
    else:
        expected = asyncio.CancelledError if mode == 'cancel' else Exception if mode == 'http' else AppError
        with pytest.raises(expected):
            await call
    assert len(captured) == 1
    assert captured[0]['model'] == 'gpt-6-luna'
    assert captured[0]['questions'][0]['type'] == 'predicate'
    assert json.loads(captured[0]['input'])['names'] == ['内藤']
    record = service.usage.list()[0]
    assert record['operation'] == 'mention_detection'
    assert record['status'] == ('completed' if mode == 'success' else 'cancelled' if mode == 'cancel' else 'failed')
    if mode not in ['http', 'cancel']:
        assert record['inputTokens'] == 100
        assert record['outputTokens'] == 0
        assert record['providerRequestId'] == 'decision_test'
        assert estimate_usd(record, create_pricing_snapshot()) == pytest.approx(.00001)


def test_decisions_pricing_does_not_discount_cached_input_or_bill_output():
    record = {'provider': 'openai', 'operation': 'mention_detection', 'model': 'gpt-6-luna',
              'inputTokens': 300_000, 'cachedTokens': 200_000, 'cacheWriteTokens': 100_000, 'outputTokens': 999}
    assert estimate_usd(record, create_pricing_snapshot()) == pytest.approx(.06)
