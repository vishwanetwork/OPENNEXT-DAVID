"""SSH public keys saved on an OpenNEXT account (the Terminal's key library)."""

import asyncio
import base64
import hashlib
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator

from spotbot.models import timestamp
from spotbot.rental_models import valid_public_key
from spotbot.storage.common import dump

KIND = "opennext_ssh_key"
MAX_KEYS = 50


def fingerprint(public_key):
    """OpenSSH SHA256 fingerprint, e.g. `SHA256:jJNm…`."""
    blob = base64.b64decode(public_key.split()[1])
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def public_key(value):
    value = value.strip()
    if len(value) > 4096 or not valid_public_key(value):
        raise ValueError("invalid_ssh_public_key")
    return value


class KeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=80)
    publicKey: str = Field(min_length=1, max_length=4096)

    @field_validator("publicKey")
    @classmethod
    def valid(cls, value):
        return public_key(value)


class InstanceKeysRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keys: list[str] = Field(max_length=20)

    @field_validator("keys")
    @classmethod
    def valid(cls, values):
        return list(dict.fromkeys(public_key(v) for v in values))


def key_view(record):
    return dict(
        id=record["id"],
        label=record["label"],
        publicKey=record["public_key"],
        fingerprint=fingerprint(record["public_key"]),
        createdAt=record["created_at"],
    )


class KeyLibrary:
    def __init__(self, db):
        self.db = db

    @staticmethod
    def owner(user_id):
        return "opennext:" + user_id

    async def list(self, user_id):
        records = await asyncio.to_thread(self.db.list, KIND, self.owner(user_id))
        live = [r for r in records if not r.get("deleted_at")]
        return sorted(live, key=lambda r: r["created_at"])

    async def add(self, user_id, label, value):
        records = await self.list(user_id)
        same = next((r for r in records if r["public_key"].split()[:2] == value.split()[:2]), None)
        if same:
            return same
        if len(records) >= MAX_KEYS:
            raise ValueError("too_many_keys")
        identity = str(uuid5(NAMESPACE_URL, dump(["opennext-key", user_id, value.split()[1]])))
        existing = await asyncio.to_thread(self.db.get, KIND, identity)
        record = dict(
            id=identity,
            kind=KIND,
            tenant_id=self.owner(user_id),
            label=label.strip(),
            public_key=value,
            created_at=timestamp(),
            version=0,
        )
        await asyncio.to_thread(self.db.save, record, existing["version"] if existing else 0)
        return record

    async def remove(self, user_id, key_id):
        record = await asyncio.to_thread(self.db.get, KIND, key_id)
        if not record or record["tenant_id"] != self.owner(user_id) or record.get("deleted_at"):
            raise LookupError("key_not_found")
        await asyncio.to_thread(
            self.db.save, dict(record, deleted_at=timestamp()), record["version"]
        )
