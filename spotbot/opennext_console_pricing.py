"""Durable encrypted credentials for the existing read-only price collectors."""

import asyncio
import os
from urllib.parse import urlsplit

import httpx
from starlette.requests import Request

from spotbot.opennext_ops import OperationError
from spotbot.rental_tasks import Sealer
from spotbot.storage.workflows import ConflictError

KIND = "console_credential"


class CollectorBridge:
    def __init__(self, db, key, origin, client, headers):
        self.db, self.origin, self.client, self.headers = db, origin, client, headers
        self.sealer = Sealer(key)
        self.lock = asyncio.Lock()

    async def call(self, request, method, path, body=None):
        headers = [
            (k, v)
            for k, v in self.headers(request)
            if k.lower()
            not in {
                "content-type",
                "accept-encoding",
                "if-none-match",
                "if-modified-since",
                "origin",
            }
        ]
        # The administrator was already verified by the adapter. Keep the original host
        # and cookies; the legacy service still enforces its own administrator policy.
        scheme = (
            "https" if request.headers.get("x-forwarded-proto") == "https" else request.url.scheme
        )
        headers += [("Origin", f"{scheme}://{request.headers.get('host', '')}")]
        try:
            response = await self.client.request(
                method,
                self.origin + path,
                headers=headers,
                **({"json": body} if body is not None else {}),
            )
            value = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OperationError(503, "The price collector is temporarily unavailable.") from exc
        if response.status_code >= 400:
            raise OperationError(
                response.status_code
                if response.status_code in {400, 401, 403, 404, 409, 501}
                else 503,
                "The collector could not complete this operation.",
            )
        return value

    async def providers(self, request):
        async with self.lock:
            value = await self.call(request, "GET", "/api/admin/pricing/providers")
            providers = value.get("providers")
            if not isinstance(providers, list):
                raise OperationError(503, "The collector returned an incomplete source registry.")
            # Reapplying a credential is harmless and also handles a legacy process restart
            # independent of the adapter. Never retain an operator cookie for background use.
            saved = await asyncio.to_thread(self.db.list, KIND, "operations")
            by_id = {p["id"]: p for p in providers}
            for doc in saved:
                provider = by_id.get(doc["provider"])
                if not provider or provider.get("adapterStatus") != "implemented":
                    continue
                try:
                    secret = self.sealer.open(
                        doc["sealed"], "console-credential:" + doc["provider"]
                    )["credential"]
                except (ValueError, KeyError) as exc:
                    raise OperationError(
                        503, "The Console encryption key cannot unlock saved credentials."
                    ) from exc
                await self.call(
                    request,
                    "POST",
                    f"/api/admin/pricing/providers/{doc['provider']}/credential",
                    {"credential": secret},
                )
                provider.update(
                    credentialConfigured=True,
                    configured=True,
                    credentialStorage="encrypted_database",
                )
                if provider.get("status") == "needs_credentials":
                    provider["status"] = "not_synced"
            if saved:
                value = await self.call(request, "GET", "/api/admin/pricing/providers")
                saved_ids = {d["provider"] for d in saved}
                for provider in value.get("providers", []):
                    if provider["id"] in saved_ids:
                        provider["credentialStorage"] = "encrypted_database"
            value["credentialPersistence"] = "encrypted_database"
            return value

    async def credential(self, request, provider, credential):
        if (
            not isinstance(credential, str)
            or not 5 <= len(credential) <= 4096
            or any(c in credential for c in "\r\n\x00")
        ):
            raise OperationError(400, "Enter a valid provider credential.")
        async with self.lock:
            value = await self.call(request, "GET", "/api/admin/pricing/providers")
            selected = next((p for p in value.get("providers", []) if p["id"] == provider), None)
            if (
                not selected
                or selected.get("adapterStatus") != "implemented"
                or not selected.get("credentialEnv")
            ):
                raise OperationError(400, "This source has no implemented credential adapter.")
            try:
                sealed = self.sealer.seal(
                    {"credential": credential.strip()}, "console-credential:" + provider
                )
            except ValueError as exc:
                raise OperationError(
                    503, "Configure SPOTBOT_OPENNEXT_CONSOLE_KEY before saving credentials."
                ) from exc
            identity = "source-" + provider
            current = await asyncio.to_thread(self.db.get, KIND, identity)
            doc = dict(
                id=identity, kind=KIND, tenant_id="operations", provider=provider, sealed=sealed
            )
            try:
                await asyncio.to_thread(self.db.save, doc, (current or {}).get("version", 0))
            except ConflictError as exc:
                raise OperationError(409, "This source changed. Refresh and try again.") from exc
            await self.call(
                request,
                "POST",
                f"/api/admin/pricing/providers/{provider}/credential",
                {"credential": credential.strip()},
            )
            return {
                "ok": True,
                "configured": True,
                "storage": "encrypted_database",
                "message": "Credential encrypted and saved to the server database.",
            }

    async def restore(self):
        if not await asyncio.to_thread(self.db.list, KIND, "operations"):
            return
        origin = urlsplit(self.origin)
        token = os.environ.get("OPENNEXT_ADMIN_TOKEN", "")
        admin_host = os.environ.get("ADMIN_HOST", "")
        if (admin_host or origin.hostname not in {"localhost", "127.0.0.1", "::1"}) and not token:
            raise OperationError(
                503,
                "Configure an administrator service credential for remote collector restoration.",
            )
        headers = [(b"host", (admin_host or origin.netloc).encode())]
        if admin_host:
            # The legacy listener is private and already trusts this reverse-proxy hop.
            # The bearer token remains mandatory; a forged forwarding header is not auth.
            headers.append((b"x-forwarded-proto", b"https"))
        if token:
            headers.append((b"authorization", ("Bearer " + token).encode()))
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "scheme": origin.scheme,
                "path": "/",
                "query_string": b"",
                "headers": headers,
            }
        )
        await self.providers(request)
