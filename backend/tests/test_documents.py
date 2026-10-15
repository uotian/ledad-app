from pathlib import Path

import pytest

from ledad.errors import AppError
from ledad.meeting.documents import extract_document


def test_document_reference_limits_generated_summary_and_terms():
    from pydantic import ValidationError

    from ledad.ai.outputs import DocumentReference

    terms = [f'{index:03}' + '語' * 47 for index in range(100)]
    assert DocumentReference(summary='a' * 6000, glossary=terms).glossary == terms
    for value in [
        {'summary': 'a' * 6001, 'glossary': []},
        {'summary': '要約', 'glossary': ['']},
        {'summary': '要約', 'glossary': ['語' * 51]},
        {'summary': '要約', 'glossary': terms + ['追加']},
        {'summary': '要約', 'glossary': [{'term': 'Ledad', 'meaning': '説明'}]},
    ]:
        with pytest.raises(ValidationError):
            DocumentReference.model_validate(value)


def test_same_pdf_fixture_preserves_text_and_original_bytes():
    data = (Path(__file__).parent / "fixtures/sample.pdf").read_bytes()
    original = bytes(data)
    result = extract_document(data, "slides.pdf")
    assert len(result["pages"]) == 2
    assert "800ms to 300ms" in result["pages"][0]["text"]
    assert "Cost: to be confirmed." in result["pages"][1]["text"]
    assert data == original


def test_markdown_keeps_page_breaks_and_complete_text():
    result = extract_document(
        "最初の原稿。\n\n追加の説明。\n---\n二つ目の原稿。".encode(), "script.md"
    )
    assert result["pages"] == [
        {"number": 1, "text": "最初の原稿。\n\n追加の説明。"},
        {"number": 2, "text": "二つ目の原稿。"},
    ]


@pytest.mark.parametrize(
    "data,name",
    [
        (bytes([255, 254, 255]), "bad.txt"),
        (b"bad pdf", "slides.pdf"),
        (b"test", "slides.pptx"),
        (b" ", "empty.md"),
    ],
)
def test_invalid_files_are_not_reported_as_success(data, name):
    with pytest.raises(AppError):
        extract_document(data, name)


def test_pptx_converts_to_pdf_before_model_input(monkeypatch):
    import base64
    import io
    import zipfile

    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as archive:
        archive.writestr('ppt/presentation.xml', '<presentation/>')
    original = data.getvalue()
    pdf = (Path(__file__).parent / 'fixtures/sample.pdf').read_bytes()
    monkeypatch.setattr('ledad.meeting.documents.shutil.which', lambda _: '/test/soffice')

    def convert(args, **kwargs):
        source = Path(args[-1])
        assert source.read_bytes() == original
        assert args[1].startswith('-env:UserInstallation=file:')
        source.with_suffix('.pdf').write_bytes(pdf)

    monkeypatch.setattr('ledad.meeting.documents.subprocess.run', convert)
    result = extract_document(original, 'slides.pptx')
    assert result['format'] == 'presentation' and len(result['pages']) == 2
    assert base64.b64decode(result['content']['file_data'].split(',')[1]) == pdf


def test_glossary_deduplicates_and_limits_repeated_input(service, document, reference):
    from ledad.meeting.policy import glossary_for

    session = service.sessions.create()
    session.documents = [document]
    session.document_reference = reference
    terms = [f'{index:03}' + '語' * 47 for index in range(101)]
    entries = ['語' * 51, '   ', terms[0], *terms]
    reference.glossary = entries
    assert glossary_for(session) == terms[:100]
    assert entries[0] == '語' * 51
    session.documents = []
    assert glossary_for(session) == []


def test_legacy_document_results_are_not_used(service, document):
    from ledad.meeting.models import Document
    from ledad.meeting.policy import documents_for, glossary_for

    legacy = Document.model_validate({**document.wire(), 'markdown': '旧要約',
                                      'glossary': [{'term': '旧語', 'reading': '', 'meaning': ''}]})
    session = service.sessions.create()
    session.documents = [legacy]
    assert 'markdown' not in legacy.wire() and 'glossary' not in legacy.wire()
    assert documents_for(session) == ''
    assert glossary_for(session) == []


@pytest.mark.parametrize("term", ["<term", "term>", "a\rb", "a\nb"])
def test_document_glossary_rejects_unsupported_characters(term):
    from pydantic import ValidationError

    from ledad.ai.outputs import DocumentReference

    with pytest.raises(ValidationError):
        DocumentReference(summary="要約", glossary=[term])


def test_glossary_migrates_legacy_entries_to_strings():
    from ledad.meeting.models import MeetingDocumentReference

    reference = MeetingDocumentReference(document_ids=[], glossary=[
        {"term": "Ledad", "reading": "レダッド", "meaning": "説明"}, "Gemini",
    ])
    assert reference.wire()["glossary"] == ["Ledad", "Gemini"]
    assert MeetingDocumentReference.model_validate(reference.wire()) == reference


def test_document_summary_preserves_saved_markdown():
    from ledad.meeting.models import MeetingDocumentReference

    old = {"documentIds": [], "markdown": "保存済みの要約", "glossary": []}
    reference = MeetingDocumentReference.model_validate(old)
    assert reference.wire() == {"documentIds": [], "summary": "保存済みの要約", "glossary": []}
    assert MeetingDocumentReference.model_validate({**old, "summary": "新しい要約"}).summary == "新しい要約"
