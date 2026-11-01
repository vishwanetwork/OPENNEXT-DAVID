"""Private revision-bound PDF/ZIP exports preserve original document bytes."""

import base64
import io
import json
import zipfile

from pypdf import PdfReader

from spotbot.opennext_files import StorageUnavailable
from spotbot.opennext_ops import KYB, OperationError
from tests.test_opennext_market import env  # noqa: F401
from tests.test_opennext_ops import ADMIN, PDF, submit_kyb


async def test_package_contains_frozen_form_and_every_original(env, tmp_path):  # noqa: F811
    client, *_ = env
    case = (await submit_kyb(client)).json()["verification"]
    url = f"/api/admin/buyer-kyb/{case['id']}/bundle?accountId=U4&revision=1"
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url.replace("U4", "U2"), headers=ADMIN)).status_code == 404
    assert (
        await client.get(url.replace("revision=1", "revision=2"), headers=ADMIN)
    ).status_code == 409
    response = await client.get(url, headers=ADMIN)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    result = response.json()
    assert result["documents"] == case["documents"]
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(result["dataBase64"]))) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert len(manifest["documents"]) == 5
        assert all(package.read(d["archivePath"]) == PDF for d in manifest["documents"])
        pdf = package.read("submitted-form.pdf")
        assert len(pdf) == result["form"]["sizeBytes"]
        text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
        assert "Example Pte Ltd" in text and "Accepted" in text and "201912345A" in text
        (tmp_path / "kyb-form.pdf").write_bytes(pdf)
    audits = await client._transport.app.state.console_backend.documents("console_audit")
    assert any(a["action"] == "KYB package downloaded" for a in audits)
    ops = client._transport.app.state.ops
    original = await ops._get(KYB, case["id"])
    await ops._save(
        dict(original, revision=2, company={**original["company"], "companyName": "Later edit"})
    )
    new = await client.get(url.replace("revision=1", "revision=2"), headers=ADMIN)
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(new.json()["dataBase64"]))) as package:
        text = "".join(
            p.extract_text()
            for p in PdfReader(io.BytesIO(package.read("submitted-form.pdf"))).pages
        )
        assert "Example Pte Ltd" in text and "Later edit" not in text


async def test_export_fails_closed_when_scanning_is_unavailable(env, monkeypatch):  # noqa: F811
    client, *_ = env
    case = (await submit_kyb(client)).json()["verification"]
    ops = client._transport.app.state.ops

    def refuse(_):
        raise StorageUnavailable("unavailable")

    monkeypatch.setattr(ops.vault, "check", refuse)
    result = await client.get(
        f"/api/admin/buyer-kyb/{case['id']}/bundle?accountId=U4&revision=1", headers=ADMIN
    )
    assert result.status_code == 503 and "dataBase64" not in result.text


def test_form_retains_cjk_fields(tmp_path):
    from spotbot.opennext_kyb_bundle import form_pdf

    case = dict(
        id="KYB-fixture",
        account="u1",
        revision=1,
        mode="Auto",
        company={"companyName": "测试科技有限公司"},
        submitted_at="2026-11-01T00:00:00Z",
    )
    try:
        pdf = form_pdf(case)
    except OperationError as exc:
        assert exc.status == 503 and "Unicode font" in exc.message
        return
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
    assert "测试科技有限公司" in text
    assert "Not recorded in the historical submission" in text
