import pytest
from pydantic import TypeAdapter, ValidationError

from ledad.errors import AppError
from ledad.meeting.models import Id
from ledad.storage.sessions import require_id


@pytest.mark.parametrize(
    "value",
    ["abcdef12-3456-7890-abcd-ef1234567890", "ABCDEF12-3456-7890-ABCD-EF1234567890"],
)
def test_ids_preserve_spelling_across_requests_and_storage(value):
    assert TypeAdapter(Id).validate_python(value) == require_id(value) == value


@pytest.mark.parametrize(
    "value",
    [
        None,
        123,
        "",
        "../outside",
        "abcdef1234567890abcdef1234567890",
        "abcdef12-3456-7890-abcd-ef1234567890\n",
        "abcdef12-3456-7890-abcd-ef123456789g",
        "abcdef12-3456-7890-abcd-ef1234567890/other",
    ],
)
def test_ids_reject_invalid_paths_at_both_boundaries(value):
    with pytest.raises(ValidationError):
        TypeAdapter(Id).validate_python(value)
    with pytest.raises(AppError) as failure:
        require_id(value)
    assert failure.value.status == 404
