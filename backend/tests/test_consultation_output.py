import pytest
from pydantic import ValidationError

from ledad.ai.outputs import Consultation
from ledad.meeting.models import Chat


def test_consultation_reply_length_boundaries():
    assert Consultation(reply='あ').reply == 'あ'
    assert len(Consultation(reply='あ' * 3000).reply) == 3000
    assert len(Consultation(reply='あ' * 100_000).reply) == 100_000
    for reply in ['', 'あ' * 100_001]:
        with pytest.raises(ValidationError):
            Consultation(reply=reply)


def test_saved_long_reply_remains_readable():
    chat = Chat.model_validate({
        'id': '00000000-0000-0000-0000-000000000001',
        'kind': 'consultation', 'text': '説明して', 'reply': 'あ' * 16000,
        'createdAt': '2026-10-14T00:00:00Z', 'status': 'applied',
    })
    assert len(chat.wire()['reply']) == 16000
