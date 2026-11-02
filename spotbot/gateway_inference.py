"""Inference-only HTTPS policy; no untrusted backend URLs or public engine admin routes."""

import hashlib
import ssl

import httpx


def apply_target(target, rental):
    if not rental["rfq"].get("inference"):
        return target
    service = rental.get("inference") or {}
    target.update(
        http=None, inference=dict(state=service.get("state", "queued"), model=service.get("model"))
    )
    if service.get("state") == "ready":
        cert, key = service.get("certificate", ""), service.get("backend_token", "")
        if not cert or not key or len(key) < 32:
            raise ValueError("inference_credentials_missing")
        ssl.create_default_context(cadata=cert)  # Parse the pinned public certificate now.
        target.update(http=f"https://{target['host']}:8000", certificate=cert, backend_token=key)
    return target


def client_for(gateway, rental_id, target):
    if not target.get("certificate"):
        return gateway.backend_client
    fingerprint = hashlib.sha256(target["certificate"].encode()).hexdigest()
    key = (rental_id, fingerprint)
    if key not in gateway.inference_clients:
        gateway.inference_clients[key] = httpx.AsyncClient(
            verify=ssl.create_default_context(cadata=target["certificate"]),
            trust_env=False,
            follow_redirects=False,
            timeout=httpx.Timeout(gateway.settings.inference_read_timeout_seconds, connect=5),
        )
    return gateway.inference_clients[key]


def allowed(method, path):
    # API keys in the engine do not protect every endpoint. Expose only the public API.
    return (method, path) in {
        ("GET", "/v1/models"),
        ("POST", "/v1/chat/completions"),
        ("POST", "/v1/completions"),
    }
