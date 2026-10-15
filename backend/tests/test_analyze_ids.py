from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from ledad.ai.analyze_ids import AnalyzeIds
from ledad.meeting.models import Analyze
from ledad.transport.requests import AnalyzeRequest


async def test_short_ids_restore_identity_across_updates_and_fixed_mentions(service):
    source_id = str(uuid4())
    conversation = [{'id': source_id, 'text': '内藤さん確認してください。', 'timestamp': '2026-10-14T10:00:00Z'}]
    output = {
        'topicUpdates': [], 'topicDeletions': [],
        'topicAdditions': [{'id': 'n1', 'title': '確認', 'summary': '確認依頼', 'lastEvidenceId': 'c1'}],
        'mentions': [{'kind': 'request', 'summary': '確認依頼', 'evidenceId': 'c1', 'quote': '内藤さん'}],
        'handoffSummary': '', 'suggestedQuestions': [], 'suggestedMeetingQuestions': [],
    }
    provider = AsyncMock(return_value=output)
    service.ai.provider.structured = provider
    body = AnalyzeRequest.model_validate({'conversation': conversation, 'profile': {'name': '内藤'}, 'language': 'ja', 'previous': None})
    session = service.sessions.create()
    first = await service.ai.analyze(session, body)
    topic_id = first['topics'][0]['id']
    UUID(topic_id)
    assert first['topicEvidence'] == {topic_id: source_id}
    assert first['mentions'] == []
    assert provider.call_args.args[3]['conversation'][0]['id'] == 'c1'
    body.previous = Analyze.model_validate(first)
    body.conversation[0].text = '内藤さんへの確認は訂正します。'
    provider.return_value = {**output, 'topicUpdates': [{**output['topicAdditions'][0], 'id': 't1'}], 'topicAdditions': [], 'mentions': []}
    second = await service.ai.analyze(session, body)
    assert second['topics'][0]['id'] == topic_id
    assert second['topicEvidence'] == first['topicEvidence']
    assert second['mentions'] == []
    sent = provider.call_args.args[3]
    assert sent['previous']['topics'][0]['id'] == 't1'
    assert sent['previous']['topics'][0]['lastEvidenceId'] == 'c1'
    assert 'mentionConversation' not in sent


def test_duplicate_and_unknown_topic_ids_are_rejected():
    ids = AnalyzeIds([], None)
    topic = {'id': 'n1', 'lastEvidenceId': 'c1'}
    with pytest.raises(ValueError, match='重複'):
        ids.restore({'topicAdditions': [topic, topic], 'topicUpdates': [], 'topicDeletions': [], 'mentions': []})
    with pytest.raises(ValueError, match='未知'):
        ids.restore({'topicUpdates': [{**topic, 'id': 't99'}], 'topicAdditions': [], 'topicDeletions': [], 'mentions': []})
