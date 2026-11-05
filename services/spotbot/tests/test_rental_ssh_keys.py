"""Customer SSH keys set after purchase and installed by the guest agent."""

import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from spotbot import guest_agent
from spotbot.api import create_app
from spotbot.rental_aws import authorized_key
from spotbot.rental_models import SshKeysRequest
from tests.test_rental_aws import openssh_key
from tests.test_rentals import deliver
from tests.test_rentals import rental_env as rental_env  # noqa: F401

KEY_A, KEY_B = openssh_key(comment="a@laptop"), openssh_key("ssh-rsa", 64, "b@laptop")


@pytest.fixture
def home(tmp_path, monkeypatch):
    user = SimpleNamespace(pw_dir=str(tmp_path), pw_uid=-1, pw_gid=-1)
    monkeypatch.setattr(guest_agent.pwd, "getpwnam", lambda name: user)
    monkeypatch.setattr(guest_agent.os, "chown", lambda *args: None)
    return tmp_path


def test_agent_replaces_only_its_block(home):
    path = home / ".ssh" / "authorized_keys"
    path.parent.mkdir()
    path.write_text("ssh-ed25519 OWNKEY operator\n")
    guest_agent.install_keys({"user": "ubuntu", "keys": [KEY_A, KEY_B]})
    lines = path.read_text().splitlines()
    assert lines == [
        "ssh-ed25519 OWNKEY operator",
        guest_agent.KEYS_BEGIN,
        KEY_A,
        KEY_B,
        guest_agent.KEYS_END,
    ]
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    # Removing a key rewrites the block; an injected line break is never written.
    guest_agent.install_keys({"user": "ubuntu", "keys": [KEY_B, "ssh-ed25519 X\nevil"]})
    assert path.read_text().splitlines()[1:] == [
        guest_agent.KEYS_BEGIN,
        KEY_B,
        guest_agent.KEYS_END,
    ]


def test_boot_block_is_the_block_the_agent_manages(home):
    """Run the bootstrap commands for real, then let the agent take over that block."""
    script = "\n".join(authorized_key("ubuntu", KEY_A))
    script = script.replace("$(getent passwd ubuntu | cut -d: -f6)", str(home))
    script = "\n".join(
        line for line in script.splitlines() if not line.startswith(("install -d", "chown"))
    )
    (home / ".ssh").mkdir()
    for _ in range(2):  # A restored disk runs it again without adding a second block.
        subprocess.run(["bash", "-euc", script], check=True)
    path = home / ".ssh" / "authorized_keys"
    assert path.read_text().splitlines() == [guest_agent.KEYS_BEGIN, KEY_A, guest_agent.KEYS_END]
    guest_agent.install_keys({"user": "ubuntu", "keys": []})
    assert path.read_text().splitlines() == [guest_agent.KEYS_BEGIN, guest_agent.KEYS_END]


def test_key_set_validation():
    assert SshKeysRequest(keys=[KEY_A, " " + KEY_A]).keys == [KEY_A]
    for bad in (["ssh-ed25519 AAAA"], [KEY_A + "\n" + KEY_B], [KEY_A] * 21):
        with pytest.raises(ValueError):
            SshKeysRequest(keys=bad)


async def test_keys_set_after_purchase_reach_the_agent(rental_env):
    env = rental_env
    rfq = env.request.rfq.model_copy(update={"ssh_key_name": None, "ssh_public_key": None})
    row, _ = env.engine.create(env.request.model_copy(update={"rfq": rfq}), "tenant-a", "keys")
    assert env.engine.ssh_keys(row) == dict(
        version=1, keys=[], applied_version=None, installed=False
    )
    row = await deliver(env, row["id"])
    view = await env.engine.set_ssh_keys(row["id"], "tenant-a", [KEY_A])
    assert view["version"] == 2 and view["keys"] == [KEY_A] and not view["installed"]
    gen = env.engine.current(env.engine.get(row["id"], "tenant-a"))
    instructions = await env.engine.agent_report(_report(env, row["id"], gen, None))
    assert instructions["authorized_keys"] == {"version": 2, "user": "ubuntu", "keys": [KEY_A]}
    await env.engine.agent_report(_report(env, row["id"], gen, 2))
    assert env.engine.ssh_keys(env.engine.get(row["id"], "tenant-a"))["installed"] is True
    # Unchanged keys keep the version; a closed rental refuses changes.
    assert (await env.engine.set_ssh_keys(row["id"], "tenant-a", [KEY_A]))["version"] == 2
    await env.engine.release(row["id"], "tenant-a")
    with pytest.raises(ValueError, match="rental_ended"):
        await env.engine.set_ssh_keys(row["id"], "tenant-a", [KEY_B])


def _report(env, rental_id, gen, version):
    from spotbot.rental_models import AgentReport

    return AgentReport(
        rental_id=rental_id,
        generation=gen["generation"],
        instance_id=gen["instance_id"],
        token=gen["agent_token"],
        ssh_ready=True,
        ssh_keys_version=version,
    )


def test_key_api_is_tenant_scoped(rental_env):
    env = rental_env
    client = TestClient(create_app(env.service.settings, env.service))
    headers = {"Authorization": "Bearer " + "a" * 32, "Idempotency-Key": "api-keys"}
    rental = client.post("/v1/rentals", headers=headers, json=env.request.model_dump(mode="json"))
    path = "/v1/rentals/" + rental.json()["rental"]["id"] + "/ssh-keys"
    assert client.get(path, headers=headers).json()["keys"] == []
    put = client.put(path, headers=headers, json={"keys": [KEY_A]})
    assert put.status_code == 200 and put.json()["version"] == 2
    assert client.put(path, headers=headers, json={"keys": ["nope"]}).status_code == 422
    other = {"Authorization": "Bearer " + "b" * 32}
    assert client.get(path, headers=other).status_code == 404
