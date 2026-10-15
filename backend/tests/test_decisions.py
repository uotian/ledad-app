"""Legacy Decisions records must retain their historical pricing."""
import pytest

from ledad.meeting.pricing import create_pricing_snapshot, estimate_usd


def test_decisions_pricing_does_not_discount_cached_input_or_bill_output():
    record = {'provider': 'openai', 'operation': 'mention_detection', 'model': 'gpt-6-luna',
              'inputTokens': 300_000, 'cachedTokens': 200_000, 'cacheWriteTokens': 100_000, 'outputTokens': 999}
    assert estimate_usd(record, create_pricing_snapshot()) == pytest.approx(.06)
