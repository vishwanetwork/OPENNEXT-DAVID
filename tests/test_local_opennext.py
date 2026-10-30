"""Local-only KYB testing cannot change production verification records."""

import httpx
import pytest

from examples.local_opennext import create_local_app
from spotbot.config import Settings


@pytest.fixture
def local_settings(tmp_path):
    return Settings(_env_file=None, spotbot_database_path=tmp_path / "local.db",
                    spotbot_opennext_files_dir=str(tmp_path / "files"),
                    spotbot_opennext_legacy_origin="http://127.0.0.1:4189",
                    spotbot_opennext_public_url="http://localhost:4188")


async def test_local_kyb_override_is_explicit_and_not_persisted(local_settings):
    async with httpx.AsyncClient() as client:
        regular = create_local_app(local_settings, client=client)
        bypass = create_local_app(local_settings, skip_kyb=True, client=client)
        assert not await regular.state.ops.kyb_approved("buyer")
        assert await bypass.state.ops.kyb_approved("buyer")
        assert not await regular.state.ops.kyb_approved("buyer")


@pytest.mark.parametrize("field", ["spotbot_opennext_legacy_origin", "spotbot_opennext_public_url"])
def test_local_kyb_tool_rejects_public_origins(local_settings, field):
    with pytest.raises(ValueError, match="requires_loopback"):
        create_local_app(local_settings.model_copy(update={field: "https://terminal.example.com"}), skip_kyb=True)
