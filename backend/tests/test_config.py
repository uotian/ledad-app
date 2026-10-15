import json

import pytest

from ledad.config import Config
from ledad.errors import AppError


def test_state_persists_both_choices(tmp_path):
    config = Config(tmp_path)
    assert config.live_provider() == "gemini"
    assert config.refinement_provider() == "openai"
    config.save_live_provider("apple")
    config.save_refinement_provider("gemini")
    assert json.loads((tmp_path / "state.json").read_text()) == {
        "liveProvider": "apple",
        "refinementProvider": "gemini",
    }
    restored = Config(tmp_path)
    restored.save_live_provider("gemini")
    assert restored.refinement_provider() == "gemini"
    assert not (tmp_path / "live.json").exists()
    assert not (tmp_path / "refinement.json").exists()


@pytest.mark.parametrize("legacy", ["both", "live", "refinement"])
def test_legacy_choices_migrate_once(tmp_path, legacy):
    if legacy in ("both", "live"):
        (tmp_path / "live.json").write_text('{"provider":"apple"}')
    if legacy in ("both", "refinement"):
        (tmp_path / "refinement.json").write_text('{"provider":"gemini"}')
    config = Config(tmp_path)
    assert config.live_provider() == ("apple" if legacy != "refinement" else "gemini")
    assert config.refinement_provider() == ("gemini" if legacy != "live" else "openai")
    assert (tmp_path / "state.json").exists()
    config.save_live_provider("gemini")
    config.save_refinement_provider("openai")
    assert Config(tmp_path).live_provider() == "gemini"
    assert Config(tmp_path).refinement_provider() == "openai"


@pytest.mark.parametrize(
    "contents",
    [
        "{",
        "[]",
        "null",
        "{}",
        '{"liveProvider":"invalid","refinementProvider":"openai"}',
        '{"liveProvider":"apple","refinementProvider":"invalid"}',
    ],
)
def test_invalid_state_is_not_overwritten(tmp_path, contents):
    path = tmp_path / "state.json"
    path.write_text(contents)
    with pytest.raises(AppError):
        Config(tmp_path).save_live_provider("gemini")
    assert path.read_text() == contents


def test_invalid_legacy_does_not_create_state(tmp_path):
    (tmp_path / "live.json").write_text('{"provider":"apple"}')
    (tmp_path / "refinement.json").write_text('{"provider":"invalid"}')
    with pytest.raises(AppError):
        Config(tmp_path).public()
    assert not (tmp_path / "state.json").exists()


def test_failed_write_keeps_previous_state(tmp_path, monkeypatch):
    config = Config(tmp_path)
    config.save_live_provider("apple")
    previous = (tmp_path / "state.json").read_text()

    def fail_write(*args):
        raise OSError("disk full")

    monkeypatch.setattr("ledad.config.write_json", fail_write)
    with pytest.raises(OSError):
        config.save_refinement_provider("gemini")
    assert (tmp_path / "state.json").read_text() == previous
