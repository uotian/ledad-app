from .models import Session


def reference_is_current(session: Session):
    return (session.document_reference is not None
            and session.document_reference.document_ids == [d.id for d in session.documents]
            and not any(d.preparation_pending for d in session.documents))


def reference_is_available(session: Session):
    reference = session.document_reference
    return (reference is not None and bool(reference.document_ids)
            and set(reference.document_ids).issubset(d.id for d in session.documents))


def documents_for(session: Session):
    return session.document_reference.summary if reference_is_available(session) else ""


def glossary_entries(session: Session):
    entries, seen = [], set()
    sources = []
    if reference_is_available(session):
        sources.append(("document", session.document_reference.glossary))
    conversation = {
        t.id: t.text for t in session.transcripts if t.corrected_at or t.source == "manual"
    } | {
        u.id: u.completed_text for u in session.utterances if u.status != "playing"
    }
    if session.analyze:
        sources.append(("analyze", [
            entry.term for entry in session.analyze.glossary
            if entry.term in conversation.get(entry.evidence_id, "")
        ]))
    for source, terms in sources:
        for term in terms:
            term = term.strip()
            key = term.lower()
            if not key or key in seen or len(term) > 50 or any(c in term for c in "<>\r\n"):
                continue
            seen.add(key)
            entries.append({"term": term, "source": source})
            if len(entries) == 100:
                return entries
    return entries


def glossary_for(session: Session):
    return [entry["term"] for entry in glossary_entries(session)]


def meeting_evidence(session: Session):
    return {
        "transcripts": [
            dict(
                id=t.id,
                text=t.text,
                translation=t.translation,
                timestamp=t.timestamp,
                source=t.source,
                **(
                    {"sourceIds": [p.id for p in t.live_segments]}
                    if t.live_segments is not None
                    else {}
                ),
            )
            for t in session.transcripts
        ],
        "utterances": [
            {
                "id": u.id,
                "kind": u.kind,
                "text": u.completed_text,
                "status": u.status,
                "startedAt": u.started_at,
                "targetId": u.target_id,
                "note": "音声を途中で停止。textは再生完了を確認した区間だけ。最後の区間の途中まで聞こえた可能性がある。"
                if u.status != "completed"
                else "",
            }
            for u in session.utterances
            if u.completed_text or u.elapsed_seconds > 0
        ],
    }
