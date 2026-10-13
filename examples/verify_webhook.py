"""Gateway-side verification: use RAW request bytes, then deduplicate event_id."""

import hashlib
import hmac
import json
import time


def verify(body: bytes, headers: dict, secret: str, max_age_seconds: int = 300) -> dict:
    normalized = {k.lower(): v for k, v in headers.items()}
    sent_at = normalized["x-spotbot-timestamp"]
    if abs(time.time() - int(sent_at)) > max_age_seconds:
        raise ValueError("expired webhook")
    expected = "sha256=" + hmac.new(
        secret.encode(), sent_at.encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, normalized["x-spotbot-signature"]):
        raise ValueError("invalid signature")
    event = json.loads(body)
    if event["event_id"] != normalized["x-spotbot-event-id"]:
        raise ValueError("event ID mismatch")
    return event
