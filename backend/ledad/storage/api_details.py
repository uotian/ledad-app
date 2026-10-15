"""Request/response bodies, stored separately from the frequently polled usage ledger."""

import re
from datetime import date, datetime


def safe_body(value, secrets=()):
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json", exclude_none=True)
    elif hasattr(value, "__dict__"):
        value = vars(value)
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            normalized = re.sub(r"[-_]", "", key).lower()
            if normalized in {"authorization", "apikey", "token", "accesstoken", "refreshtoken"}:
                result[key] = "[redacted]"
            elif key == "data" and (
                value.get("type") in {"audio", "image", "video"}
                or "mime_type" in value
                or "mimeType" in value
            ):
                result[key] = {"omitted": "binary", "encodedCharacters": len(item or "")}
            else:
                result[key] = safe_body(item, secrets)
        return result
    if isinstance(value, (list, tuple)):
        return [safe_body(item, secrets) for item in value]
    if isinstance(value, bytes):
        return {"omitted": "binary", "bytes": len(value)}
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, str):
        if value.startswith("data:") and ";base64," in value[:100]:
            return {"omitted": "binary", "encodedCharacters": len(value)}
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
        value = re.sub(r'\bBearer\s+[^\s"\'<>]+', "Bearer [redacted]", value, flags=re.I)
        value = re.sub(r"\b(?:sk-[a-zA-Z0-9_-]+|AIza[a-zA-Z0-9_-]+)", "[redacted]", value)
        return re.sub(
            r'([?&](?:key|api_key|token)=)[^\s&#"\']+', r"\1[redacted]", value, flags=re.I
        )
    return value
