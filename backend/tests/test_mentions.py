import copy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ledad.ai.mentions import merge_mentions, prepare_mentions
from ledad.meeting.models import Analyze
from ledad.storage.files import compact
from ledad.transport.requests import AnalyzeRequest

PROFILE = {'name': '内藤', 'aliases': 'よし'}


def entry(text, minute=0, settled=True):
    return {'id': str(uuid4()), 'text': text, 'timestamp': f'2026-10-14T10:{minute:02d}:00Z',
            **({'settled': True} if settled else {})}


def mention(source, kind='mention'):
    return {'kind': kind, 'summary': '確認の依頼', 'evidenceId': source['id'], 'quote': source['text']}


def previous(conversation, mentions):
    sources, _, _ = prepare_mentions(conversation, None, compact(PROFILE), 'ja', ['内藤'])
    return Analyze.model_validate({
        "topics": [],
        'mentions': mentions, 'mentionSources': sources, 'language': 'ja',
        'profileKey': compact(PROFILE), 'inputKey': 'old', 'updatedAt': '2026-10-14T10:04:00Z',
    })


def request(conversation, old=None, profile=PROFILE):
    return AnalyzeRequest.model_validate({'conversation': conversation, 'profile': profile,
                                           'language': 'ja', 'previous': old})


def output(mentions=()):
    return {"topicUpdates": [], "topicAdditions": [], "topicDeletions": [],
            "suggestedQuestions": [], "suggestedMeetingQuestions": [],
            "handoffSummary": "背景の要約", "mentions": list(mentions)}


async def test_single_analyze_call_detects_and_summarizes_mentions(service):
    conversation = [entry('背景です。', i) for i in range(8)]
    conversation[4]['text'] = '内藤さん、確認してください。'
    item = mention({**conversation[4], 'id': 'c5'}, 'request')
    service.ai.provider.structured = AsyncMock(return_value=output([item, item]))
    assert not hasattr(service.ai.provider, 'decisions')
    session = service.sessions.create()
    result = await service.ai.analyze(session, request(conversation))
    assert result['mentions'] == [mention(conversation[4], 'request')]
    service.ai.provider.structured.assert_awaited_once()
    args = service.ai.provider.structured.call_args.args
    assert args[1] == 'meeting_analyze'
    assert len(args[3]['conversation']) == 8
    assert args[3]['mentionTargetIds'] == [f'c{i}' for i in range(1, 9)]
    service.ai.provider.structured.return_value = output()
    again = await service.ai.analyze(session, request(conversation, result))
    assert again['mentions'] == result['mentions']
    assert service.ai.provider.structured.call_args.args[3]['mentionTargetIds'] == []


async def test_live_carries_forward_until_fix_even_when_text_does_not_change(service):
    live = entry('内藤さん、確認してください。', settled=False)
    fixed = entry('以前の会話です。')
    old = previous([fixed, live], [mention(live)])
    service.ai.provider.structured = AsyncMock(return_value=output([mention({**live, 'id': 'c2'})]))
    session = service.sessions.create()
    for _ in range(2):
        result = await service.ai.analyze(session, request([fixed, live], old.wire()))
        assert service.ai.provider.structured.call_args.args[3]['mentionTargetIds'] == ['c2']
        assert len(result['mentions']) == 1
        old = Analyze.model_validate(result)
    live['settled'] = True
    result = await service.ai.analyze(session, request([fixed, live], old.wire()))
    assert service.ai.provider.structured.call_args.args[3]['mentionTargetIds'] == ['c2']
    service.ai.provider.structured.return_value = output()
    await service.ai.analyze(session, request([fixed, live], result))
    assert service.ai.provider.structured.call_args.args[3]['mentionTargetIds'] == []


def test_fix_merge_removes_deleted_ids_and_can_retract_false_positive():
    first, second, third = entry('内藤さん', settled=False), entry('質問です', 1, False), entry('内藤さんの案', 2)
    old = previous([first, second, third], [mention(first), mention(second), mention(third)])
    fixed = {**first, 'settled': True, 'text': '別人の話です。'}
    sources, targets, retained = prepare_mentions([fixed, third], old, compact(PROFILE), 'ja', ['内藤'])
    assert [item['id'] for item in targets] == [first['id']]
    assert second['id'] not in sources
    assert merge_mentions([fixed, third], targets, retained, []) == [mention(third)]


@pytest.mark.parametrize('cancelled', [False, True])
async def test_failure_does_not_consume_sources_or_previous_mentions(service, cancelled):
    import asyncio
    first = entry('内藤さん')
    old = previous([first], [mention(first)])
    body = request([{**first, 'text': '訂正します。'}], old.wire())
    before = copy.deepcopy(body.previous.wire())
    error = asyncio.CancelledError if cancelled else RuntimeError
    service.ai.provider.structured = AsyncMock(side_effect=error())
    with pytest.raises(error):
        await service.ai.analyze(service.sessions.create(), body)
    assert body.previous.wire() == before


async def test_no_match_clears_corrected_mention_without_second_request(service):
    first = entry('内藤さん')
    old = previous([first], [mention(first)])
    fixed = {**first, 'text': 'よし、次に進もう。'}
    service.ai.provider.structured = AsyncMock(return_value=output())
    result = await service.ai.analyze(service.sessions.create(), request([fixed], old.wire()))
    assert result['mentions'] == []
    assert first['id'] in result['mentionSources']
    service.ai.provider.structured.assert_awaited_once()


@pytest.mark.parametrize('invalid', ['source', 'quote', 'retained'])
async def test_rejects_unknown_or_non_target_sources_and_fabricated_quotes(service, invalid):
    first, other = entry('内藤さん'), entry('別の発言', 1)
    old = previous([other], [])
    item = mention({**first, 'id': 'c1'})
    item.update({'evidenceId': 'unknown'} if invalid == 'source' else
                {'evidenceId': 'c2'} if invalid == 'retained' else {'quote': '架空の引用'})
    service.ai.provider.structured = AsyncMock(return_value=output([item]))
    with pytest.raises(ValueError, match='抽出対象'):
        await service.ai.analyze(service.sessions.create(), request([first, other], old.wire()))


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
    service.ai.provider.structured = AsyncMock(return_value=output())
    wire = {'id': str(uuid4()), 'method': 'POST', 'path': f'/api/sessions/{session.id}/analyze',
            'body': compact(request([entry('次へ')]).wire())}
    response = await service.dispatch(wire)
    assert response.status == 200
    assert service.sessions.read(session.id).analyze is None
    session.status = 'ended'
    service.sessions.save(session)
    assert (await service.dispatch(wire)).status == 400


async def test_old_compacted_topics_recheck_mentions_from_original_speech(service):
    from ledad.ai.analyze_context import source_key
    first = entry('内藤さん、お願いします。')
    old = previous([first], [])
    old.mention_sources = {}  # Former topic-only Analyze never processed this source.
    from ledad.meeting.models import AnalyzeContext
    old.context = AnalyzeContext(summary='昔の要約', covered_count=1, source_key=source_key([first]))
    old.started_at = '2026-10-14T10:05:00Z'
    service.ai.provider.structured = AsyncMock(return_value=output([mention({**first, 'id': 'c1'})]))
    result = await service.ai.analyze(service.sessions.create(), request([first], old.wire()))
    sent = service.ai.provider.structured.call_args.args[3]
    assert sent['handoff'] == ''
    assert sent['conversation'][0]['text'] == first['text']
    assert sent['mentionTargetIds'] == ['c1']
    assert result['mentions'] == [mention(first)]
    assert result['context']['coveredCount'] == 1


async def test_without_names_analyze_still_runs_but_never_extracts_mentions(service):
    first = entry('次の議題です。')
    service.ai.provider.structured = AsyncMock(return_value=output())
    result = await service.ai.analyze(
        service.sessions.create(), request([first], profile={'name': '', 'aliases': ''}))
    service.ai.provider.structured.assert_awaited_once()
    assert service.ai.provider.structured.call_args.args[3]['mentionTargetIds'] == []
    assert result['mentions'] == []
