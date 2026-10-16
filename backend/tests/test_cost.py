from uuid import uuid4

import pytest

from ledad.meeting.pricing import create_pricing_snapshot, meeting_cost


def record(session, **changes):
    return {
        "sessionId": session.id,
        "provider": "openai",
        "operation": "meeting_candidates",
        "model": "gpt-6-luna",
        "inputTokens": 1000,
        "outputTokens": 200,
        "cachedTokens": 800,
        "reasoningTokens": 100,
        **changes,
    }


def test_cached_input_cache_writes_reasoning_and_other_meetings(service):
    session = service.sessions.create()
    session.pricing = create_pricing_snapshot("2026-10-05T00:00:00Z")
    for model, expected in [
        ("gpt-6-luna", (100 * 0.1 + 100 * 0.125 + 800 * 0.01 + 200 * 0.5) / 1e6 * 157.58),
        ("gpt-6.1-sol", (100 * 2 + 100 * 2.5 + 800 * 0.1 + 200 * 10) / 1e6 * 157.58),
        ("gpt-5.4-mini-2026-03-17", (200 * 0.75 + 800 * 0.075 + 200 * 4.5) / 1e6 * 157.58),
    ]:
        records = [
            record(session, model=model, cacheWriteTokens=100),
            record(session, sessionId=str(uuid4())),
        ]
        result = meeting_cost(session, records)
        assert result["openai"]["yen"] == pytest.approx(expected)
        assert result["openai"]["incomplete"] is False
        assert result["gemini"]["yen"] == 0
    for count in [272000, 272001]:
        long = count > 272000
        expected = (
            (
                ((count - 800) * 0.1 + 800 * 0.01) * (2 if long else 1)
                + 200 * 0.5 * (1.5 if long else 1)
            )
            / 1e6
            * 157.58
        )
        assert meeting_cost(session, [record(session, inputTokens=count)])["openai"][
            "yen"
        ] == pytest.approx(expected)


def test_live_seconds_tts_fallback_and_historical_snapshot(service):
    session = service.sessions.create()
    session.pricing = create_pricing_snapshot("2026-10-05T00:00:00Z")
    live = record(
        session,
        provider="gemini",
        operation="live_transcription",
        model="gemini-3.5-transcribe-live",
        audioInputSeconds=60,
        liveReports=[{"inputTokens": 999999, "outputTokens": 999999}],
    )
    assert meeting_cost(session, [live])["gemini"]["yen"] == pytest.approx(0.008925 * 157.58)
    tts = record(
        session,
        provider="gemini",
        operation="speech",
        model="gemini-3.8-flash-lite-tts",
        inputTokens=100,
        outputTokens=500,
        cachedTokens=None,
        audioOutputSeconds=10,
    )
    before = meeting_cost(session, [tts])["gemini"]["yen"]
    assert before == pytest.approx(0.00305 * 157.58)
    assert meeting_cost(session, [{**tts, "outputTokens": None}])["gemini"]["yen"] == pytest.approx(
        0.00155 * 157.58
    )
    session.pricing = create_pricing_snapshot("2027-01-01T00:00:00Z")
    assert meeting_cost(session, [tts])["gemini"]["yen"] == pytest.approx(before * 2)


def test_unknown_usage_is_not_zero_and_known_failed_usage_counts(service):
    session = service.sessions.create()
    assert meeting_cost(session, [])["openai"] == {"yen": None, "incomplete": True}
    session.pricing = create_pricing_snapshot("2026-10-05T00:00:00Z")
    unknown = record(session, model="unknown")
    assert meeting_cost(session, [unknown])["openai"] == {"yen": None, "incomplete": True}
    known = record(session, status="failed")
    result = meeting_cost(session, [known, unknown])["openai"]
    assert result["yen"] > 0 and result["incomplete"]
    zero = record(session, inputTokens=0, outputTokens=0, cachedTokens=0)
    assert meeting_cost(session, [zero])["openai"] == {"yen": 0, "incomplete": False}
    missing = record(session, inputTokens=None, outputTokens=None)
    assert meeting_cost(session, [missing])["openai"]["yen"] is None


def test_file_transcription_cost_uses_audio_minutes_and_keeps_old_snapshots(service):
    session = service.sessions.create()
    session.pricing = create_pricing_snapshot()
    audio = record(
        session,
        model="gpt-transcribe",
        operation="file_transcription",
        status="completed",
        audioInputSeconds=90,
        inputTokens=None,
        outputTokens=None,
    )
    assert meeting_cost(session, [audio])["openai"]["yen"] == pytest.approx(1.5 * 0.0045 * 157.58)
    assert meeting_cost(session, [{**audio, "status": "failed"}])["openai"]["incomplete"]
    session.pricing.rates = [r for r in session.pricing.rates if r.model != "gpt-transcribe"]
    assert meeting_cost(session, [audio])["openai"] == {"yen": None, "incomplete": True}


@pytest.mark.parametrize('model', ['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15'])
def test_openai_tts_actual_usage_and_missing_legacy_rate(service, model):
    session = service.sessions.create()
    session.pricing = create_pricing_snapshot()
    speech = record(session, operation='speech', model=model,
                    inputTokens=50, outputTokens=25, cachedTokens=None)
    expected = (50 * 0.6 + 25 * 12) / 1e6 * session.pricing.usd_to_jpy
    assert meeting_cost(session, [speech])['openai']['yen'] == pytest.approx(expected)
    rate = next(r for r in session.pricing.rates if r.model == 'gpt-4o-mini-tts')
    rate.output_usd_per_million = 24
    assert meeting_cost(session, [speech])['openai']['yen'] > expected
    session.pricing.rates.remove(rate)
    original = session.pricing.wire()
    assert meeting_cost(session, [speech])['openai']['yen'] == pytest.approx(expected)
    assert session.pricing.wire() == original
    missing = {**speech, 'inputTokens': None, 'outputTokens': None, 'audioOutputSeconds': 10}
    assert meeting_cost(session, [missing])['openai'] == {'yen': None, 'incomplete': True}


@pytest.mark.parametrize('status', ['running', 'completed', 'failed', 'cancelled'])
def test_openai_live_duration_and_old_snapshot(service, status):
    session = service.sessions.create()
    session.pricing = create_pricing_snapshot()
    live = record(session, model='gpt-live-transcribe', operation='live_transcription',
                  audioInputSeconds=90, status=status)
    for old_snapshot in (False, True):
        if old_snapshot:
            session.pricing.rates = [r for r in session.pricing.rates if r.model != 'gpt-live-transcribe']
        cost = meeting_cost(session, [live])['openai']
        assert cost['yen'] == pytest.approx(1.5 * .017 * 157.58)
        assert cost['incomplete'] is False
