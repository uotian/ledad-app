from ledad.meeting.models import Analyze, Transcript
from ledad.meeting.policy import glossary_entries, glossary_for


def test_glossary_priority_and_invalidated_sources(service, document, reference):
    session = service.sessions.create()
    session.documents = [document]
    session.document_reference = reference
    reference.glossary = ['Ledad', 'Sakana AI', 'bad<term', 'a' * 51]
    transcript = Transcript(
        id=session.id, text='内藤芳彦とLedadとSakana AIとOpenSearchの話',
        timestamp=session.created_at, source='display', translation='', analyzed=True,
        disposition='open', corrected_at=session.created_at,
    )
    session.transcripts = [transcript]
    session.analyze = Analyze(
        topics=[], mentions=[], updated_at=session.created_at, language='ja', profile_key='{}', input_key='',
        glossary=[{'term': term, 'evidenceId': transcript.id} for term in ['内藤芳彦', 'Ledad', 'Sakana AI', 'OpenSearch']],
    )
    assert glossary_entries(session) == [
        {'term': 'Ledad', 'source': 'document'}, {'term': 'Sakana AI', 'source': 'document'},
        {'term': '内藤芳彦', 'source': 'analyze'}, {'term': 'OpenSearch', 'source': 'analyze'},
    ]
    assert glossary_for(session) == ['Ledad', 'Sakana AI', '内藤芳彦', 'OpenSearch']
    # 資料削除と原文訂正後に、以前の用語を認識ヒントとして使いません。
    session.documents = []
    transcript.text = 'Ledadの話'
    assert glossary_entries(session) == [
        {'term': 'Ledad', 'source': 'analyze'},
    ]
    transcript.corrected_at = None
    assert glossary_entries(session) == []


def test_glossary_caps_actual_hints_and_defaults_legacy_analyze(service, document, reference):
    session = service.sessions.create()
    assert glossary_entries(session) == []
    session.documents = [document]
    session.document_reference = reference
    reference.glossary = [f'term{i}' for i in range(110)]
    assert len(glossary_for(session)) == 100
