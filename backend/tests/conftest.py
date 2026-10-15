from uuid import uuid4

import pytest

from ledad.config import Config
from ledad.meeting.models import Document, MeetingDocumentReference
from ledad.service import Service


@pytest.fixture
def document():
    return Document.model_validate(
        {
            "id": str(uuid4()),
            "name": "事前資料.txt",
            "kind": "reference",
            "format": "text",
            "pages": [{"number": 1, "text": "録音の事前情報CONTEXT-2391"}],
            "size": 100,
        }
    )


@pytest.fixture
async def service(tmp_path):
    instance = Service(Config(data_dir=tmp_path))
    yield instance
    await instance.close()


@pytest.fixture
def reference(document):
    return MeetingDocumentReference.model_validate({
        'documentIds': [document.id], 'summary': '資料の要点REFERENCE-7315',
        'glossary': ['Ledad'],
    })
