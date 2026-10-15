import copy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ledad.ai.mentions import merge_mentions, prepare_mentions
from ledad.meeting.models import MentionAnalysis
from ledad.storage.files import compact
from ledad.transport.requests import MentionsRequest

PROFILE = {'name': '内藤', 'aliases': 'よし'}


def entry(text, minute=0, settled=True):
    return {'id': str(uuid4()), 'text': text, 'timestamp': f'2026-10-14T10:{minute:02d}:00Z',
            **({'settled': True} if settled else {})}


def mention(source, kind='mention'):
    return {'kind': kind, 'summary': '確認の依頼', 'evidenceId': source['id'], 'quote': source['text']}


def previous(conversation, mentions):
    sources, _, _ = prepare_mentions(conversation, None, compact(PROFILE), 'ja', ['内藤'])
    return MentionAnalysis.model_validate({
        'mentions': mentions, 'mentionSources': sources, 'language': 'ja',
        'profileKey': compact(PROFILE), 'inputKey': 'old', 'updatedAt': '2026-10-14T10:04:00Z',
    })


def request(conversation, old=None, profile=PROFILE):
    return MentionsRequest.model_validate({'conversation': conversation, 'profile': profile,
                                           'language': 'ja', 'previous': old})


async def test_two_stages_full_context_then_only_neighbors_and_source_ids(service):
    conversation = [entry('背景です。', i) for i in range(8)]
    conversation[4]['text'] = '内藤さん、確認してください。'
    service.ai.provider.decisions = AsyncMock(return_value={f'c{i}': 0.9 if i == 5 else 0.1 for i in range(1, 9)})
    item = mention({**conversation[4], 'id': 'c5'}, 'request')
    service.ai.provider.structured = AsyncMock(return_value={'mentions': [item, item]})
    session = service.sessions.create()
    result = await service.ai.mentions(session, request(conversation))
    assert result['mentions'] == [mention(conversation[4], 'request')]
    data, targets, _ = service.ai.provider.decisions.call_args.args
    assert len(data['conversation']) == 8
    assert targets == [f'c{i}' for i in range(1, 9)]
    generated = service.ai.provider.structured.call_args.args[3]
    assert generated['targetIds'] == ['c5']
    assert [item['id'] for item in generated['conversation']] == ['c3', 'c4', 'c5', 'c6', 'c7']
    service.ai.provider.decisions.reset_mock()
    service.ai.provider.structured.reset_mock()
    again = await service.ai.mentions(session, request(conversation, result))
    assert again['mentions'] == result['mentions']
    service.ai.provider.decisions.assert_not_awaited()
    service.ai.provider.structured.assert_not_awaited()


async def test_live_carries_forward_until_fix_even_when_text_does_not_change(service):
    live = entry('内藤さん、確認してください。', settled=False)
    fixed = entry('以前の会話です。')
    old = previous([fixed, live], [mention(live)])
    service.ai.provider.decisions = AsyncMock(return_value={'c2': 0.9})
    service.ai.provider.structured = AsyncMock(return_value={'mentions': [mention({**live, 'id': 'c2'})]})
    session = service.sessions.create()
    for _ in range(2):
        result = await service.ai.mentions(session, request([fixed, live], old.wire()))
        assert service.ai.provider.decisions.call_args.args[1] == ['c2']
        assert len(result['mentions']) == 1
        old = MentionAnalysis.model_validate(result)
    live['settled'] = True
    result = await service.ai.mentions(session, request([fixed, live], old.wire()))
    assert service.ai.provider.decisions.await_count == 3
    await service.ai.mentions(session, request([fixed, live], result))
    assert service.ai.provider.decisions.await_count == 3


def test_fix_merge_removes_deleted_ids_and_can_retract_false_positive():
    first, second, third = entry('内藤さん', settled=False), entry('質問です', 1, False), entry('内藤さんの案', 2)
    old = previous([first, second, third], [mention(first), mention(second), mention(third)])
    fixed = {**first, 'settled': True, 'text': '別人の話です。'}
    sources, targets, retained = prepare_mentions([fixed, third], old, compact(PROFILE), 'ja', ['内藤'])
    assert [item['id'] for item in targets] == [first['id']]
    assert second['id'] not in sources
    assert merge_mentions([fixed, third], targets, retained, []) == [mention(third)]


@pytest.mark.parametrize('stage', ['detect', 'extract'])
async def test_failure_does_not_consume_queue_or_previous_mentions(service, stage):
    first = entry('内藤さん')
    old = previous([first], [mention(first)])
    changed = {**first, 'text': '訂正します。'}
    body = request([changed], old.wire())
    before = copy.deepcopy(body.previous.wire())
    service.ai.provider.decisions = AsyncMock(return_value={'c1': 0.9},
                                             side_effect=RuntimeError('failed') if stage == 'detect' else None)
    service.ai.provider.structured = AsyncMock(side_effect=RuntimeError('failed'))
    with pytest.raises(RuntimeError):
        await service.ai.mentions(service.sessions.create(), body)
    assert body.previous.wire() == before


async def test_negative_detection_skips_generation_and_commits_settled_sources(service):
    first = entry('よし、次に進もう。')
    service.ai.provider.decisions = AsyncMock(return_value={'c1': 0.1})
    service.ai.provider.structured = AsyncMock()
    result = await service.ai.mentions(service.sessions.create(), request([first]))
    assert result['mentions'] == []
    assert first['id'] in result['mentionSources']
    service.ai.provider.structured.assert_not_awaited()


@pytest.mark.parametrize('invalid', ['source', 'quote'])
async def test_rejects_unselected_sources_and_fabricated_quotes(service, invalid):
    first, other = entry('内藤さん'), entry('別の発言', 1)
    item = mention({**first, 'id': 'c1'})
    item.update({'evidenceId': 'c2'} if invalid == 'source' else {'quote': '架空の引用'})
    service.ai.provider.decisions = AsyncMock(return_value={'c1': .9, 'c2': .1})
    service.ai.provider.structured = AsyncMock(return_value={'mentions': [item]})
    with pytest.raises(ValueError, match='抽出対象'):
        await service.ai.mentions(service.sessions.create(), request([first, other]))


def test_profile_and_language_changes_recheck_fix_and_clear_retained():
    first = entry('内藤さん')
    old = previous([first], [mention(first)])
    for profile, language, names in [('different', 'ja', ['別名']), (compact(PROFILE), 'en', ['内藤']), ('empty', 'ja', [])]:
        _, targets, retained = prepare_mentions([first], old, profile, language, names)
        assert bool(targets) == bool(names)
        assert retained == []


async def test_endpoint_keeps_sessions_read_only_and_checks_lifecycle(service):
    session = service.sessions.create()
    session.status = 'active'
    service.sessions.save(session)
    service.ai.provider.decisions = AsyncMock(return_value={'c1': .1})
    wire = {'id': str(uuid4()), 'method': 'POST', 'path': f'/api/sessions/{session.id}/mentions',
            'body': compact(request([entry('次へ')]).wire())}
    response = await service.dispatch(wire)
    assert response.status == 200
    assert service.sessions.read(session.id).mention_analysis is None
    session.status = 'ended'
    service.sessions.save(session)
    assert (await service.dispatch(wire)).status == 400
