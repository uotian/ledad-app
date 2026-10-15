"""Accumulate name mentions by source revision, independently of topic memory."""

import hashlib
from datetime import datetime

from ..storage.files import compact


def prepare_mentions(conversation, previous, profile_key, language, names):
    if previous and (previous.profile_key != profile_key or previous.language != language):
        previous = None
    sources = {
        entry["id"]: hashlib.sha256(compact([entry["text"], entry.get("settled", False)]).encode()).hexdigest()
        for entry in conversation
    }
    known = previous.mention_sources if previous else {}
    changed = {entry["id"] for entry in conversation
               if not entry.get("settled") or known.get(entry["id"]) != sources[entry["id"]]}
    retained = [
        mention.wire() for mention in previous.mentions
        if mention.evidence_id in sources and mention.evidence_id not in changed
    ] if previous and names else []
    targets = [
        {key: entry[key] for key in ("id", "text", "timestamp")}
        for entry in conversation if entry["id"] in changed
    ] if names else []
    return sources, targets, retained


def merge_mentions(conversation, targets, retained, extracted):
    text_by_id = {entry["id"]: entry["text"] for entry in targets}
    for mention in extracted:
        text = text_by_id.get(mention["evidenceId"])
        if text is None or not mention["quote"] or mention["quote"] not in text:
            raise ValueError("言及の引用が抽出対象の発言に見つかりません")
    order = {
        entry["id"]: index for index, entry in enumerate(sorted(
            conversation, key=lambda entry: datetime.fromisoformat(entry["timestamp"])
        ))
    }
    seen = set()
    merged = []
    for mention in [*retained, *extracted]:
        key = tuple(mention[field] for field in ("evidenceId", "kind", "quote", "summary"))
        if key not in seen:
            seen.add(key)
            merged.append(mention)
    return sorted(merged, key=lambda mention: order[mention["evidenceId"]])


async def analyze_mentions(provider, session_id, body):
    from pathlib import Path

    from ..storage.files import compact, now_iso
    from .outputs import Mentions

    ordered = sorted((item.wire() for item in body.conversation),
                     key=lambda item: datetime.fromisoformat(item['timestamp']))
    if len({item['id'] for item in ordered}) != len(ordered):
        raise ValueError('発言IDが重複しています')
    profile_key = compact(body.profile.wire())
    sources, targets, retained = prepare_mentions(
        ordered, body.previous, profile_key, body.language, body.profile.names()
    )
    extracted = []
    if targets:
        ids = {item['id']: f'c{i}' for i, item in enumerate(ordered, 1)}
        originals = {short: key for key, short in ids.items()}
        conversation = [{**item, 'id': ids[item['id']]} for item in ordered]
        # The full conversation is evidence; only queued revisions are questions.
        probabilities = await provider.decisions(
            {'names': body.profile.names(), 'conversation': conversation},
            [ids[item['id']] for item in targets], session_id,
        )
        # shortcut: provisional recall-oriented threshold; calibrate on labeled Japanese meetings.
        selected = {key for key, probability in probabilities.items() if probability >= 0.5}
        if selected:
            indexes = {index for index, item in enumerate(conversation) if item['id'] in selected}
            context_indexes = {i for index in indexes
                               for i in range(max(0, index - 2), min(len(conversation), index + 3))}
            result = await provider.structured(
                Mentions, 'meeting_mentions',
                (Path(__file__).with_name('prompts') / 'mentions.txt').read_text(),
                {'language': body.language, 'names': body.profile.names(),
                 'targetIds': [item['id'] for item in conversation if item['id'] in selected],
                 'conversation': [item for i, item in enumerate(conversation) if i in context_indexes]},
                session_id, ['language', 'names'],
            )
            for item in result['mentions']:
                if item['evidenceId'] not in selected:
                    raise ValueError('言及の引用が抽出対象の発言に見つかりません')
                extracted.append({**item, 'evidenceId': originals[item['evidenceId']]})
    return {
        'mentions': merge_mentions(ordered, targets, retained, extracted),
        'mentionSources': sources,
        'language': body.language, 'profileKey': profile_key, 'updatedAt': now_iso(),
        'inputKey': hashlib.sha256(compact({
            'version': 1, 'conversation': [item.wire() for item in body.conversation],
            'profileKey': profile_key, 'language': body.language,
        }).encode()).hexdigest(),
    }
