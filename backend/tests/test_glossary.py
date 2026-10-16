from ledad.meeting.models import Analyze, Transcript
from ledad.meeting.policy import glossary_entries, vocabulary_for
from ledad.transport.requests import Profile


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
    profile = Profile(name='内藤芳彦 Ledad ledad')
    assert glossary_entries(session, profile.terms()) == [
        {'term': '内藤芳彦', 'source': 'profile'}, {'term': 'Ledad', 'source': 'profile'},
        {'term': 'Sakana AI', 'source': 'document'}, {'term': 'OpenSearch', 'source': 'analyze'},
    ]
    assert vocabulary_for(session, profile.terms()) == ['内藤芳彦', 'Ledad', 'Sakana AI', 'OpenSearch']
    # 資料削除と原文訂正後に、以前の用語を認識ヒントとして使いません。
    session.documents = []
    transcript.text = 'Ledadの話'
    assert glossary_entries(session, profile.terms()) == [
        {'term': '内藤芳彦', 'source': 'profile'}, {'term': 'Ledad', 'source': 'profile'},
    ]
    transcript.corrected_at = None
    profile.name = ''
    assert glossary_entries(session, profile.terms()) == []


def test_glossary_caps_actual_hints_and_defaults_legacy_analyze(service):
    session = service.sessions.create()
    assert len(vocabulary_for(session, [f'term{i}' for i in range(110)])) == 100
    assert glossary_entries(session) == []
