import json
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


def now_iso():
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f"{path.name}.{uuid4()}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            os.chmod(temporary, 0o600)
            stream.write(compact(value))
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
