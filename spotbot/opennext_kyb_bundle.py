"""Server-produced KYB packages with a frozen form and byte-identical originals."""

import asyncio
import base64
import hashlib
import io
import json
import os
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from fastapi import Request
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from spotbot.opennext_files import Infected, StorageUnavailable
from spotbot.opennext_ops import COMPANY_FIELDS, KYB, MAX_TOTAL, OperationError, document_view

MAX_ARCHIVE = 100 * 1024 * 1024


def form_pdf(case):
    """Only submitted values enter the PDF; never render HTML or fetch external resources."""
    submission = case.get("submission_snapshot") or dict(
        company=case["company"],
        mode=case["mode"],
        consent=None,
        revision=max(case.get("submission_keys", {}).values(), default=1),
        submitted_at=case["submitted_at"],
    )
    import reportlab

    font = next(
        (
            Path(p)
            for p in [
                os.environ.get("OPENNEXT_KYB_PDF_FONT", ""),
                "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                "/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc",
                "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            ]
            if p and Path(p).is_file()
        ),
        Path(reportlab.__file__).parent / "fonts" / "Vera.ttf",
    )
    pdfmetrics.registerFont(TTFont("OpenNEXTForm", str(font)))
    if any(
        ord(c) not in pdfmetrics.getFont("OpenNEXTForm").face.charToGlyph
        for c in json.dumps(submission, ensure_ascii=False)
        if ord(c) > 31
    ):
        raise OperationError(
            503, "Install a Unicode font or configure OPENNEXT_KYB_PDF_FONT for this submission."
        )
    style = ParagraphStyle(
        "FormValue", fontName="OpenNEXTForm", fontSize=11, leading=16, wordWrap="CJK", spaceAfter=12
    )
    styles = getSampleStyleSheet()
    content = [Paragraph("OpenNEXT - Business verification", styles["Title"]), Spacer(1, 16)]
    fields = [
        ("Case", case["id"]),
        ("Account", case["account"]),
        ("Submission revision", str(submission["revision"])),
        ("Submitted at", submission["submitted_at"]),
        ("Mode", submission["mode"]),
        (
            "Consent",
            "Accepted" if submission["consent"] else "Not recorded in the historical submission",
        ),
        *[
            (
                re.sub(r"(?<!^)([A-Z])", r" \1", field).capitalize(),
                submission["company"].get(field, ""),
            )
            for field in COMPANY_FIELDS
        ],
    ]
    for label, value in fields:
        content.append(Paragraph(escape(label), styles["Heading4"]))
        content.append(
            Paragraph(escape(str(value or "Not provided")).replace("\n", "<br/>"), style)
        )
    output = io.BytesIO()

    def footer(canvas, doc):
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.setFont("Helvetica", 9)
        canvas.drawString(42, 25, "Private - submitted business verification record")
        canvas.drawRightString(550, 25, str(doc.page))

    SimpleDocTemplate(
        output,
        leftMargin=42,
        rightMargin=42,
        topMargin=38,
        bottomMargin=44,
        title="OpenNEXT business verification submission",
    ).build(content, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def archive(case, pdf, originals):
    manifest = dict(
        caseId=case["id"],
        accountId=case["account"],
        revision=case["revision"],
        form=dict(fileName="submitted-form.pdf", contentType="application/pdf", sizeBytes=len(pdf)),
        documents=[],
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("submitted-form.pdf", pdf)
        for index, (doc, data) in enumerate(originals):
            name = re.sub(r"[^a-zA-Z0-9._-]", "_", doc["file_name"]).strip(".")[:150] or "document"
            path = f"originals/{index + 1:02d}-{doc['id']}-{name}"
            package.writestr(path, data)
            manifest["documents"].append(
                dict(document_view(doc), archivePath=path, sha256=hashlib.sha256(data).hexdigest())
            )
        package.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    data = output.getvalue()
    if len(data) > MAX_ARCHIVE or len(pdf) > 20 * 1024 * 1024:
        raise OperationError(413, "The KYB package exceeds the download limit.")
    with zipfile.ZipFile(io.BytesIO(data)) as checked:
        if checked.testzip() or len(checked.namelist()) != len(originals) + 2:
            raise OperationError(500, "The KYB package could not be verified.")
        for item, (_, original) in zip(manifest["documents"], originals, strict=True):
            if checked.read(item["archivePath"]) != original:
                raise OperationError(500, "The original document integrity check failed.")
    return manifest, data


async def build_bundle(ops, case_id, account, revision):
    case = await ops._get(KYB, case_id)
    if not case or case["account"] != account:
        raise OperationError(404, "Business verification case not found.")
    if case["revision"] != revision:
        raise OperationError(409, "This case changed. Refresh before downloading.")
    if not case.get("documents") or not (case.get("company") or {}).get("companyName"):
        raise OperationError(409, "This case has no complete original submission to export.")
    if sum(d["size_bytes"] for d in case["documents"]) > MAX_TOTAL:
        raise OperationError(413, "The submitted documents exceed the download limit.")
    originals = [await ops.kyb_document(case_id, d["id"], revision) for d in case["documents"]]
    pdf = await asyncio.to_thread(form_pdf, case)
    manifest, data = await asyncio.to_thread(archive, case, pdf, originals)
    try:
        # Scan the resulting archive, including the generated form. Fail closed outside explicit dev mode.
        await asyncio.to_thread(ops.vault.check, data)
    except Infected as exc:
        raise OperationError(400, "The package failed its malware scan.") from exc
    except StorageUnavailable as exc:
        raise OperationError(503, "Package scanning is temporarily unavailable.") from exc
    latest = await ops._get(KYB, case_id)
    if not latest or latest["revision"] != revision or latest["documents"] != case["documents"]:
        raise OperationError(409, "This case changed. Refresh before downloading.")
    return dict(
        confirmed=True,
        caseId=case_id,
        accountId=account,
        revision=revision,
        fileName=f"kyb-{case_id}-r{revision}.zip",
        contentType="application/zip",
        form=manifest["form"],
        documents=[document_view(d) for d in case["documents"]],
        sha256=hashlib.sha256(data).hexdigest(),
        dataBase64=base64.b64encode(data).decode(),
    )


def install(app, ctx, operator):
    @app.get("/api/admin/buyer-kyb/{case_id}/bundle")
    async def download(request: Request, case_id: str, accountId: str, revision: int):
        scope, failed = await operator(request, write=False)
        if failed:
            return failed
        try:
            value = await build_bundle(ctx.ops, case_id, accountId, revision)
            ctx.audit(
                "kyb_bundle_download",
                case=case_id,
                revision=revision,
                operator=scope,
                sha256=value["sha256"],
            )
            await ctx.accounts.console.audit(
                scope,
                "KYB package downloaded",
                case_id,
                f"Revision {revision}; SHA-256 {value['sha256']}",
            )
            result = ctx.no_store(value)
            result.headers["Content-Disposition"] = (
                f'attachment; filename="{value["fileName"]}.json"'
            )
            return result
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)
