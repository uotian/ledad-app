"""Request-local short IDs and atomic application of topic changes."""

import re
from uuid import uuid4


class AnalyzeIds:
    def __init__(self, conversation, previous):
        self.evidence = {entry['id']: f'c{i}' for i, entry in enumerate(conversation, 1)}
        self.topics = {
            topic.id: f't{i}' for i, topic in enumerate(previous.topics, 1)
        } if previous else {}
        self.original_evidence = {short: original for original, short in self.evidence.items()}
        self.original_topics = {short: original for original, short in self.topics.items()}
        self.previous = {
            topic.id: {**topic.wire(), 'lastEvidenceId': previous.topic_evidence.get(topic.id)}
            for topic in previous.topics
        } if previous else {}

    def conversation(self, entries):
        return [{**entry, 'id': self.evidence[entry['id']]} for entry in entries]

    def restore(self, result):
        updates = result['topicUpdates']
        additions = result['topicAdditions']
        deletions = result['topicDeletions']
        changed = [topic['id'] for topic in updates] + deletions
        added = [topic['id'] for topic in additions]
        if len(set(changed)) != len(changed) or len(set(added)) != len(added):
            raise ValueError('話題IDが重複しています')
        if any(key not in self.original_topics for key in changed):
            raise ValueError('未知の話題IDです')
        if any(not re.fullmatch(r'n[1-9]\d*', key) for key in added):
            raise ValueError('新規話題IDが不正です')
        topics = dict(self.previous)
        for key in deletions:
            del topics[self.original_topics[key]]
        for topic in [*updates, *additions]:
            evidence = self.original_evidence.get(topic['lastEvidenceId'])
            if evidence is None:
                raise ValueError('話題の最終発言が会話内に見つかりません')
            original = self.original_topics.get(topic['id']) or str(uuid4())
            topics[original] = {**topic, 'id': original, 'lastEvidenceId': evidence}
        return {
            **{key: value for key, value in result.items()
               if key not in ('topicUpdates', 'topicAdditions', 'topicDeletions')},
            'topics': list(topics.values()),
            'mentions': [
                {**mention, 'evidenceId': self.original_evidence.get(mention['evidenceId'], mention['evidenceId'])}
                for mention in result.get('mentions', [])
            ],
        }
