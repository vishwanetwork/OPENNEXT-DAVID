"""Private storage for Buyer KYB documents: malware scan, then AES-256-GCM encryption at rest.

Each file is written as `ONX1 || nonce (12 bytes) || ciphertext+tag`, with the document id as
associated data, so a file cannot be swapped onto another document. Scanning uses a ClamAV
daemon (`INSTREAM`); a failed or unavailable scan refuses the upload.
"""

import base64
import os
import socket
import struct
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"ONX1"
CHUNK = 64 * 1024


class StorageUnavailable(Exception):
    """Document storage or scanning is not configured or not reachable."""


class Infected(Exception):
    """The malware scanner reported the file."""


def clamd_scan(address, data, timeout=30):
    """Scan bytes with clamd's INSTREAM command; raises Infected or StorageUnavailable."""
    host, _, port = address.rpartition(":")
    try:
        with socket.create_connection((host or "127.0.0.1", int(port)), timeout=timeout) as conn:
            conn.sendall(b"zINSTREAM\0")
            for start in range(0, len(data), CHUNK):
                chunk = data[start : start + CHUNK]
                conn.sendall(struct.pack(">I", len(chunk)) + chunk)
            conn.sendall(struct.pack(">I", 0))
            reply = b""
            while not reply.endswith(b"\0"):
                part = conn.recv(4096)
                if not part:
                    break
                reply += part
    except (OSError, ValueError) as exc:
        raise StorageUnavailable("malware_scanner_unavailable") from exc
    text = reply.rstrip(b"\0").decode(errors="replace")
    if text.endswith("FOUND"):
        raise Infected(text)
    if not text.endswith("OK"):
        raise StorageUnavailable("malware_scan_failed")


class Vault:
    def __init__(self, root, key_base64="", clamd="", allow_unscanned=False):
        self.root = Path(root)
        self.clamd = clamd
        self.allow_unscanned = allow_unscanned
        key = base64.b64decode(key_base64) if key_base64 else b""
        self.aead = AESGCM(key) if len(key) == 32 else None

    @classmethod
    def from_settings(cls, settings, root=None):
        if settings is None:
            return cls(root or "data/opennext-kyb")
        return cls(
            root or settings.spotbot_opennext_files_dir,
            settings.spotbot_opennext_files_key.get_secret_value(),
            settings.spotbot_opennext_clamd,
            settings.spotbot_opennext_allow_unscanned,
        )

    def check(self, data):
        """Scan before storing; returns the scan result recorded with the document."""
        if self.aead is None:
            raise StorageUnavailable("document_key_not_configured")
        if self.clamd:
            clamd_scan(self.clamd, data)
            return "clean"
        if self.allow_unscanned:
            return "not_scanned"
        raise StorageUnavailable("malware_scanner_not_configured")

    def write(self, relative, document_id, data):
        path = self.root / relative
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        nonce = os.urandom(12)
        sealed = MAGIC + nonce + self.aead.encrypt(nonce, data, document_id.encode())
        with open(path, "xb", opener=lambda p, f: os.open(p, f, 0o600)) as out:
            out.write(sealed)

    def read(self, relative, document_id):
        if self.aead is None:
            raise StorageUnavailable("document_key_not_configured")
        sealed = (self.root / relative).read_bytes()
        if not sealed.startswith(MAGIC):
            raise StorageUnavailable("unknown_document_format")
        nonce, body = sealed[4:16], sealed[16:]
        return self.aead.decrypt(nonce, body, document_id.encode())

    def delete(self, relative):
        try:
            (self.root / relative).unlink()
        except FileNotFoundError:
            pass
