"""Migration regressions: privacy boundaries, AI context and legacy data."""

import json
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from ledad.ai.cache import prompt_cache_request
from ledad.ai.tasks import MeetingAI
from ledad.meeting.models import (
    Chat,
    Document,
    MeetingDocumentReference,
    Script,
    Session,
    Transcript,
    Utterance,
)
from ledad.meeting.policy import documents_for, meeting_evidence
from ledad.transport.requests import AnalyzeRequest, Profile


def document(**changes):
    return Document.model_validate(
        {
            "id": str(uuid4()),
            "name": "非公開背景",
            "kind": "reference",
            "classification": "private",
            "allowGeneration": True,
            "allowDisclosure": False,
            "allowSharing": False,
            "format": "text",
            "pages": [{"number": 1, "text": "非公開の事情PRIVATE-2187。秘密の99万円。"}],
            "size": 100,
            **changes,
        }
    )


def chat(session, **changes):
    return Chat.model_validate(
        {
            "id": str(uuid4()),
            "kind": "consultation",
            "text": "本人だけの相談",
            "reply": "前の回答",
            "status": "applied",
            "createdAt": session.created_at,
            **changes,
        }
    )


@pytest.mark.parametrize("classification", ["public", "internal", "restricted", "private"])
@pytest.mark.parametrize("generation", [False, True])
@pytest.mark.parametrize("disclosure", [False, True])
def test_legacy_document_migration_does_not_expand_usage(classification, generation, disclosure):
    restored = document(
        classification=classification, allowGeneration=generation, allowDisclosure=disclosure
    )
    assert "markdown" not in restored.wire() and "glossary" not in restored.wire()
    assert "classification" not in restored.wire()
    assert "allowGeneration" not in restored.wire()
    assert Document.model_validate(restored.wire()) == restored
    assert restored.pages[0].text == "非公開の事情PRIVATE-2187。秘密の99万円。"


@pytest.mark.parametrize("changes", [
    {"markdown": None}, {"glossary": [{"term": "", "reading": "", "meaning": ""}]},
    {"markdown": "a" * 30_001},
])
def test_retired_individual_results_are_ignored(changes):
    restored = document(**changes)
    assert "markdown" not in restored.wire() and "glossary" not in restored.wire()


async def test_ai_receives_only_prepared_summary_or_glossary(service):
    session = service.sessions.create()
    session.documents = [document(), document()]
    session.document_reference = MeetingDocumentReference.model_validate({
        'documentIds': [d.id for d in session.documents], 'summary': 'REFERENCE-7315',
        'glossary': ['Ledad'],
    })
    session.chats = [chat(session)]
    provider = AsyncMock()
    provider.structured.return_value = {"note": "", "candidates": []}
    ai = MeetingAI(provider)
    await ai.translate("発言", [], "en", session)
    await ai.preview(session, "発言", "en", None)
    await ai.consult(session, session.chats[0].id, "ja")
    await ai.candidates(session, None, "確認したい")
    provider.structured.return_value = {"topicUpdates": [], "topicAdditions": [], "topicDeletions": [], "mentions": [], "handoffSummary": ""}
    await ai.analyze(session, AnalyzeRequest(language="ja", profile=Profile(), conversation=[], previous=None))
    for index, call in enumerate(provider.structured.call_args_list):
        data = call.args[3]
        assert "PRIVATE-2187" not in json.dumps(data, ensure_ascii=False)
        if index < 2:
            assert "documents" not in data
            assert data["glossary"] == ["Ledad"]
            assert "REFERENCE-7315" not in json.dumps(data)
        else:
            assert data["documents"] == documents_for(session)
            assert data["documents"] == "REFERENCE-7315"
            assert "glossary" not in data


def test_minutes_exclude_unspoken_and_private_material(service):
    session = service.sessions.create()
    session.documents = [document()]
    session.chats = [chat(session)]
    session.scripts = [Script(page=1, original="私的な原稿", spoken="")]
    session.utterances = [
        Utterance.model_validate(
            {
                "id": str(uuid4()),
                "kind": "answer",
                "candidateId": None,
                "targetId": None,
                "page": None,
                "plannedText": "完了した区間。まだ話していない秘密。",
                "completedText": "完了した区間。",
                "status": "interrupted",
                "startedAt": session.created_at,
                "endedAt": session.created_at,
                "elapsedSeconds": 4,
            }
        )
    ]
    evidence = json.dumps(meeting_evidence(session), ensure_ascii=False)
    assert "完了した区間" in evidence
    for text in ("まだ話していない秘密", "本人だけの相談", "PRIVATE-2187", "私的な原稿"):
        assert text not in evidence


async def test_legacy_background_is_not_sent_to_ask_even_for_a_separate_ai_call(service):
    session = service.sessions.create()
    session.documents = [document()]
    session.chats = [chat(session)]
    provider = AsyncMock()
    candidate = {
        "title": "確認",
        "text": "確認します",
        "spokenText": "確認します",
        "caution": "",
    }
    provider.structured.return_value = {"note": "", "candidates": [candidate] * 4}
    result = await MeetingAI(provider).candidates(session, None, "費用について短く")
    provider.structured.assert_awaited_once()
    data = json.dumps(provider.structured.call_args.args[3], ensure_ascii=False)
    for text in ("PRIVATE-2187", "99万円", "非公開背景", "本人だけの相談"):
        assert text not in data
    assert "費用について短く" in data
    # Preserve the generated wording; do not add a heuristic filter.
    assert result == {"note": "", "candidates": [candidate] * 4}


async def test_consultation_uses_only_completed_prior_consultations(service):
    session = service.sessions.create()
    session.documents = [document(), document()]
    session.document_reference = MeetingDocumentReference(
        document_ids=[d.id for d in session.documents], summary="参照文")
    session.chats = [
        chat(session),
        chat(session, kind="instruction", text="旧指示"),
        chat(session, status="failed", text="失敗した相談"),
        chat(session, status="pending", text="現在の相談"),
        chat(session, text="未来の相談"),
    ]
    provider = AsyncMock()
    provider.structured.return_value = {"reply": "回答"}
    await MeetingAI(provider).consult(session, session.chats[3].id, "en")
    data = provider.structured.call_args.args[3]
    assert data["replyLanguage"] == "English"
    assert data["question"] == "現在の相談"
    assert data["history"] == [{"user": "本人だけの相談", "assistant": "前の回答"}]
    assert data["documents"] == "参照文"


@pytest.mark.parametrize("question", ["今の話を説明して", "この訳は正しい？ The deadline is Friday."])
async def test_consultation_omits_stored_translations_without_changing_evidence(service, question):
    session = service.sessions.create()
    session.transcripts = [Transcript(
        id=str(uuid4()), text="締め切りは金曜日です。", translation="The deadline is Friday.",
        timestamp=session.created_at, disposition="open", source="mixed", analyzed=False,
    )]
    session.chats = [chat(session, text=question)]
    original = session.wire()
    evidence = meeting_evidence(session)
    provider = AsyncMock()
    provider.structured.return_value = {"reply": "回答"}

    await MeetingAI(provider).consult(session, session.chats[0].id, "en")

    data = provider.structured.call_args.args[3]
    expected = {key: value for key, value in evidence["transcripts"][0].items()
                if key != "translation"}
    assert data["meeting"] == {**evidence, "transcripts": [expected]}
    assert data["question"] == question
    assert data["replyLanguage"] == "English"
    assert session.wire() == original
    assert meeting_evidence(session) == evidence


async def test_empty_candidates_skip_confirmation_and_foreign_speech_is_preserved(service):
    session = service.sessions.create()
    session.settings.language = "en"
    provider = AsyncMock()
    provider.structured.return_value = {"note": "候補なし", "candidates": []}
    assert (await MeetingAI(provider).candidates(session, None, ""))["candidates"] == []
    provider.structured.assert_awaited_once()
    provider.structured.reset_mock()
    provider.structured.side_effect = [
        {
            "note": "note",
            "candidates": [
                {
                    "title": "Cost",
                    "text": "Cost?",
                    "spokenText": "How much?",
                    "caution": "",

                }
            ],
        },
        {
            "note": "費用",
            "candidates": [{"title": "費用", "text": "いくらですか？", "caution": ""}],
        },
    ]
    candidate = (await MeetingAI(provider).candidates(session, None, ""))["candidates"][0]
    assert candidate["spokenText"] == "How much?"
    assert candidate["text"] == "いくらですか？"


@pytest.mark.parametrize(
    "name,aliases,expected",
    [
        ("", "内藤", ["内藤"]),
        ("", "", []),
        ("あ" * 601, "", ["あ" * 601]),
        ("内藤義彦、内藤さん、Naito, Yoshihiko", "", ["内藤義彦", "内藤さん", "Naito", "Yoshihiko"]),
        ("内藤、Naito\n内藤", "", ["内藤", "Naito"]),
        ("内藤", "内藤、Naito, Yoshihiko\nNaito", ["内藤", "Naito", "Yoshihiko"]),
        (
            " 内藤　 義彦 ",
            "Naito Yoshihiko、内藤\nYoshihiko",
            ["内藤 義彦", "内藤", "義彦", "Naito Yoshihiko", "Naito", "Yoshihiko"],
        ),
    ],
)
def test_vocabulary_accepts_combined_or_legacy_names_and_preserves_unique_parts(name, aliases, expected):
    assert Profile(name=name, aliases=aliases).names() == expected


@pytest.mark.parametrize(
    "field,value",
    [("listeningLimitMinutes", "60")],
)
def test_persisted_types_do_not_silently_change_permissions(service, field, value):
    data = service.sessions.create().wire()
    data["settings"][field] = value
    with pytest.raises(ValidationError):
        Session.model_validate(data)


@pytest.mark.parametrize("length", [0, 1, 9, 10, 11, 30, 35, 100])
def test_cache_keeps_exact_json_with_one_block_per_utterance(length):
    data = {
        "language": "ja",
        "names": ["内藤"],
        "conversation": [{"id": str(i), "text": '会話\n"引用"'} for i in range(length)],
        "previous": None,
    }
    request = prompt_cache_request(
        "gpt-6-luna", "instructions", data, ["language", "names"], "conversation"
    )
    messages = request["input"]
    assert json.loads("".join(c["text"] for c in messages[1]["content"])) == data
    content = messages[1]["content"]
    assert len(content) == length + 2
    assert all("prompt_cache_breakpoint" in block for block in content[:-1])
    assert "prompt_cache_breakpoint" not in content[-1]
    for entry, block in zip(data["conversation"], content[1:-1], strict=True):
        assert block["text"].endswith(json.dumps(entry, ensure_ascii=False, separators=(",", ":")))


def test_retired_question_fields_are_ignored(service):
    data = service.sessions.create().wire()
    data["settings"]["autoDetectQuestions"] = True
    data["transcripts"] = [{
        "id": str(uuid4()), "text": "質問ですか？", "translation": "",
        "timestamp": data["createdAt"], "source": "manual", "isQuestion": True,
        "analyzed": True, "disposition": "open",
    }]
    saved = Session.model_validate(data).wire()
    assert "autoDetectQuestions" not in saved["settings"]
    assert "isQuestion" not in saved["transcripts"][0]
    assert saved["transcripts"][0]["text"] == "質問ですか？"


async def test_ask_reference_uses_selected_translation_language(service):
    session = service.sessions.create()
    session.settings.language = "ja"
    session.settings.translation_language = "en"
    provider = AsyncMock()
    provider.structured.side_effect = [
        {"note": "", "candidates": [{"title": "確認", "text": "旧訳", "spokenText": "費用はいくらですか？", "caution": ""}]},
        {"note": "", "candidates": [{"title": "確認", "text": "How much does it cost?", "caution": ""}]},
    ]
    result = await MeetingAI(provider).candidates(session, None, "費用を確認")
    candidate = result["candidates"][0]
    schema = provider.structured.call_args_list[0].args[0].model_json_schema()
    assert "sources" not in schema["$defs"]["CandidateDraft"]["properties"]
    assert candidate["spokenText"] == "費用はいくらですか？"
    assert candidate["text"] == "How much does it cost?"
    assert candidate["translationLanguage"] == "en"
    assert provider.structured.call_args.args[3]["translationLanguage"] == "English"
    assert provider.structured.call_args_list[0].args[3]["speechLanguage"] == "日本語"


def test_cache_preserves_prefix_boundaries_when_conversation_grows():
    data = {"language": "ja", "conversation": [{"id": "1", "text": "最初"}], "previous": None}
    def blocks():
        return prompt_cache_request(
            "gpt-6-luna", "instructions", data, ["language"], "conversation"
        )["input"][1]["content"]
    first = blocks()
    data["conversation"].append({"id": "2", "text": "追加"})
    data["previous"] = {"topics": ["更新"]}
    second = blocks()
    assert second[:2] == first[:2]
    data["conversation"][0]["text"] = "訂正"
    corrected = blocks()
    assert corrected[0] == second[0]
    assert corrected[1] != second[1]


async def test_chat_and_ask_receive_all_transcripts_and_only_spoken_text(service):
    from ledad.meeting.models import Transcript

    session = service.sessions.create()
    session.chats = [chat(session)]
    session.transcripts = [Transcript(
        id=str(uuid4()), text=f"発言{index}", translation="", timestamp=session.created_at,
        disposition="open", source="manual", analyzed=False,
    ) for index in range(105)]
    session.utterances = [Utterance.model_validate({
        "id": str(uuid4()), "kind": "answer", "candidateId": None, "targetId": None,
        "page": None, "plannedText": "再生済み。未再生。", "completedText": "再生済み。",
        "status": "interrupted", "startedAt": session.created_at,
        "endedAt": session.created_at, "elapsedSeconds": 3,
    })]
    provider = AsyncMock()
    provider.structured.return_value = {"note": "", "candidates": []}
    ai = MeetingAI(provider)
    await ai.consult(session, session.chats[0].id, "ja")
    await ai.candidates(session, None, "確認したい")
    for call in provider.structured.call_args_list:
        meeting = call.args[3]["meeting"]
        assert [item["text"] for item in meeting["transcripts"]] == [
            transcript.text for transcript in session.transcripts
        ]
        assert meeting["utterances"][0]["text"] == "再生済み。"
        assert "未再生" not in json.dumps(meeting, ensure_ascii=False)
