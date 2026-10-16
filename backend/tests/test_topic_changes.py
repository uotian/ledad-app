from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from ledad.ai.analyze_ids import AnalyzeIds
from ledad.ai.outputs import Analysis
from ledad.meeting.models import Analyze, AnalyzeContext
from ledad.transport.requests import AnalyzeRequest


def state():
    conversation = [
        {'id': f'00000000-0000-4000-8000-{i:012d}', 'text': f'議題{i}', 'timestamp': f'2026-10-15T00:0{i}:00Z'}
        for i in range(1, 4)
    ]
    previous = Analyze.model_validate({
        'topics': [{'id': f'topic-{i}', 'title': f'議題{i}', 'summary': f'概要{i}'} for i in range(1, 4)],
        'topicEvidence': {f'topic-{i}': f'00000000-0000-4000-8000-{i:012d}' for i in range(1, 4)},
        'mentions': [], 'updatedAt': '2026-10-15T00:04:00Z',
        'profileKey': '{"name":"","aliases":""}', 'language': 'ja', 'inputKey': 'old',
    })
    delta = dict(glossary=[], topicUpdates=[], topicAdditions=[], topicDeletions=[], mentions=[],
                 suggestedQuestions=[], suggestedMeetingQuestions=[], handoffSummary='')
    return conversation, previous, delta


def topic(key, evidence='c3'):
    return dict(id=key, title='更新した議題', summary='完成した要約', lastEvidenceId=evidence)


def test_empty_delta_preserves_all_topics_and_evidence_without_mutation():
    conversation, previous, delta = state()
    before = previous.wire()
    result = AnalyzeIds(conversation, previous).restore(delta)
    assert [item['id'] for item in result['topics']] == ['topic-1', 'topic-2', 'topic-3']
    assert result['topics'][0] == {**before['topics'][0], 'lastEvidenceId': '00000000-0000-4000-8000-000000000001'}
    assert previous.wire() == before
    assert 'topicUpdates' not in result
    assert 'topics' not in Analysis.model_json_schema()['properties']
    Analysis.model_validate(delta)


async def test_merge_split_and_resume_apply_atomically_and_sort_by_evidence(service):
    conversation, previous, delta = state()
    # Merge 1+2 into 1, keep 3, and split a new topic from 1.
    delta.update(topicUpdates=[topic('t1')], topicAdditions=[topic('n1', 'c2')], topicDeletions=['t2'])
    service.ai.provider.structured = AsyncMock(return_value=delta)
    request = AnalyzeRequest.model_validate(dict(conversation=conversation, previous=previous.wire(), profile={}, language='ja'))
    before = request.previous.wire()
    result = await service.ai.analyze(service.sessions.create(), request)
    assert len(service.ai.provider.structured.call_args.args[3]['previous']['topics']) == 3
    assert len(result['topics']) == 3
    assert result['topics'][0]['id'] not in ('topic-1', 'topic-2', 'topic-3')
    assert result['topics'][1]['id'] == 'topic-1'
    assert result['topics'][2] == before['topics'][2]
    assert 'topic-2' not in result['topicEvidence']
    assert result['topicEvidence']['topic-1'] == '00000000-0000-4000-8000-000000000003'
    assert request.previous.wire() == before


@pytest.mark.parametrize('changes', [
    {'topicUpdates': [topic('t9')]},
    {'topicDeletions': ['t9']},
    {'topicDeletions': ['t1', 't1']},
    {'topicUpdates': [topic('t1')], 'topicDeletions': ['t1']},
    {'topicAdditions': [topic('t1')]},
    {'topicAdditions': [topic('n1'), topic('n1')]},
    {'topicUpdates': [topic('t1', 'c99')]},
])
def test_invalid_delta_keeps_previous_intact(changes):
    conversation, previous, delta = state()
    before = deepcopy(previous.wire())
    with pytest.raises(ValueError):
        AnalyzeIds(conversation, previous).restore({**delta, **changes})
    assert previous.wire() == before


def test_delete_all_topics():
    conversation, previous, delta = state()
    delta['topicDeletions'] = ['t1', 't2', 't3']
    assert AnalyzeIds(conversation, previous).restore(delta)['topics'] == []


async def test_context_rebuild_still_sends_all_topics_and_keeps_unchanged_ones(service):
    conversation, previous, delta = state()
    # A changed archived prefix resets handoff, not the Topics sent for correction.
    previous.context = AnalyzeContext(
        summary='古い内容', covered_count=1, source_key='outdated',
    )
    service.ai.provider.structured = AsyncMock(return_value=delta)
    request = AnalyzeRequest.model_validate(dict(conversation=conversation, previous=previous.wire(), profile={}, language='ja'))
    result = await service.ai.analyze(service.sessions.create(), request)
    data = service.ai.provider.structured.call_args.args[3]
    assert len(data['previous']['topics']) == 3
    assert len(data['conversation']) == 3
    assert data['handoff'] == ''
    assert result['topics'] == previous.wire()['topics']
    assert result['topicEvidence'] == previous.topic_evidence
    assert not any(key in result for key in ('topicUpdates', 'topicAdditions', 'topicDeletions'))
