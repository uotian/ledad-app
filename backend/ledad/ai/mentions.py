"""Accumulate name mentions by source revision, within a single Analyze result."""

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
