import asyncio
import hashlib
import ssl
import subprocess

import httpx
import pytest

from spotbot.gateway import create_gateway_app
from spotbot.gateway_inference import client_for
from tests.test_gateway import Body, event  # noqa: F401
from tests.test_gateway import environment as environment


@pytest.fixture
def certificate(tmp_path):
    key, cert = tmp_path / "key.pem", tmp_path / "cert.pem"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-subj",
            "/CN=test",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
        ],
        check=True,
        capture_output=True,
    )
    return cert.read_text(), cert, key


async def test_model_readiness_and_key_rotation_preserve_ssh(environment, certificate):
    env, cert = environment, certificate[0]
    gateway, rid = env["gateway"], env["id"]
    env["rental"]["rfq"]["inference"] = {"preset_id": "deepseek-r1-distill-70b"}
    env["rental"]["inference"] = dict(state="downloading", model="deepseek-r1-distill-70b")
    await gateway.ingest(event(env))
    await gateway.reconcile(rid)
    assert gateway.authorized(rid) and gateway.live[rid]["target"]["http"] is None
    old_key = gateway.access_token(rid)
    ssh = asyncio.create_task(asyncio.sleep(60))
    gateway.sessions.setdefault(rid, set()).add(ssh)
    env["rental"]["inference"].update(state="ready", certificate=cert, backend_token="private" * 8)
    await gateway.reconcile(rid)
    assert not ssh.cancelled() and gateway.access_token(rid) == old_key
    assert gateway.public(gateway.db.get("gateway", rid))["inference"]["base_url"].endswith("/v1")
    requests = []

    async def engine(request):
        requests.append(request)
        return httpx.Response(
            200,
            stream=Body(b'data: {"choices":[]}\n\ndata: [DONE]\n\n'),
            headers={"content-type": "text/event-stream"},
        )

    backend = httpx.AsyncClient(transport=httpx.MockTransport(engine))
    gateway.inference_clients[(rid, hashlib.sha256(cert.encode()).hexdigest())] = backend
    app = create_gateway_app(env["config"], gateway)
    base = f"https://r-{rid}.gpu.example.com"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=base) as client:
        result = await client.post(
            "/v1/chat/completions",
            headers={"authorization": "Bearer " + old_key},
            json={"stream": True},
        )
        assert result.status_code == 200 and "[DONE]" in result.text
        assert requests[-1].url.scheme == "https"
        assert requests[-1].headers["authorization"] == "Bearer " + "private" * 8
        assert (
            await client.post("/invocations", headers={"authorization": "Bearer " + old_key})
        ).status_code == 404
        pending = asyncio.create_task(asyncio.sleep(60))
        gateway.http_sessions.setdefault(rid, set()).add(pending)
        headers = {"authorization": "Bearer " + "a" * 40, "x-spotbot-tenant": "tenant-a"}
        rotation = await client.post(
            f"http://control/v1/gateway/rentals/{rid}/inference-key",
            headers=headers,
            json={"expected_version": 0},
        )
        assert rotation.status_code == 200
        await asyncio.sleep(0)
        assert pending.cancelled() and not ssh.cancelled()
        assert (
            await client.get("/v1/models", headers={"authorization": "Bearer " + old_key})
        ).status_code == 401
        new_key = rotation.json()["http_access_token"]
        assert new_key != old_key
        assert (
            await client.get("/v1/models", headers={"authorization": "Bearer " + new_key})
        ).status_code == 200
        headers["x-spotbot-tenant"] = "other-tenant"
        assert (
            await client.post(
                f"http://control/v1/gateway/rentals/{rid}/inference-key",
                headers=headers,
                json={"expected_version": 1},
            )
        ).status_code == 404
    ssh.cancel()
    await asyncio.gather(ssh, pending, return_exceptions=True)


async def test_backend_requires_pinned_certificate(environment, certificate):
    env, (pem, cert, key) = environment, certificate
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)

    async def serve(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(serve, "127.0.0.1", 0, ssl=context)
    port = server.sockets[0].getsockname()[1]
    client = client_for(env["gateway"], env["id"], dict(certificate=pem))
    try:
        assert (await client.get(f"https://127.0.0.1:{port}/health")).text == "OK"
        async with httpx.AsyncClient(trust_env=False) as untrusted:
            with pytest.raises(httpx.ConnectError):
                await untrusted.get(f"https://127.0.0.1:{port}/health")
    finally:
        server.close()
        await server.wait_closed()
