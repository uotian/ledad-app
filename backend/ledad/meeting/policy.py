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


def glossary_for(session: Session):
    if not reference_is_available(session):
        return []
    entries, seen = [], set()
    for term in session.document_reference.glossary:
        key = term.strip().casefold()
        if not key or key in seen or len(term) > 50:
            continue
        seen.add(key)
        entries.append(term)
        if len(entries) == 100:
            break
    return entries


def vocabulary_for(session: Session):
    return glossary_for(session)


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
