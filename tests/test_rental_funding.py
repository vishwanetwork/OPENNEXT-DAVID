"""Mock-cloud acceptance: funding pause retains data and cumulative time, never END."""

from datetime import timedelta
from types import SimpleNamespace

import pytest

from spotbot import guest_lease
from spotbot.funding_models import ExecutionGrant, ExecutionPolicy
from spotbot.rentals import service_seconds
from tests.test_rentals import cycle, deliver, report_ready
from tests.test_rentals import rental_env as rental_env  # noqa: F401


@pytest.fixture
def floating(rental_env, monkeypatch):
    env = rental_env
    monkeypatch.setattr("spotbot.rental_funding.utcnow", env.clock.now)
    env.service.settings.spotbot_floating_enabled = True
    env.request.rfq.funding = ExecutionPolicy(
        purchased_seconds=3600, max_retail_hourly_cents=500, max_total_cents=5000,
        storage_reserve_cents=350, grant_expires_at=env.clock.now()+timedelta(seconds=120),
    )
    return env


def command(env, row, action, key):
    return ExecutionGrant(idempotency_key=key, expected_revision=row["funding_revision"],
                          action=action, expires_at=env.clock.now()+timedelta(seconds=120))


async def paused(env, row):
    row = await env.engine.execution_grant(row["id"], "tenant-a", command(env,row,"pause","pause"))
    for _ in range(40):
        current = env.engine.current(row)
        if current and current["state"] not in {"STOPPED", "REJECTED"}:
            await report_ready(env, row["id"])
        await cycle(env)
        row = env.engine.get(row["id"], "tenant-a")
        if row["state"] == "PAUSED_FOR_FUNDS":
            return row
    raise AssertionError("Funding pause did not complete")


async def test_pause_restore_preserves_disks_and_only_remaining_running_time(floating):
    env = floating
    row, _ = env.engine.create(env.request,"tenant-a","floating-restore")
    row = await deliver(env,row["id"])
    first = env.engine.current(row)
    for v in first["volumes"]:
        env.cloud.files[v["volume_id"]]["customer-model"] = "checkpoint"
    env.clock.advance(30)
    row = await paused(env,row)
    assert not row["end_requested"] and row["connection"] is None
    used = service_seconds(row, env.clock.now())
    assert used >= 30
    backup = env.engine.db.get("backup",row["current_backup_id"])
    assert backup["state"] == "AVAILABLE"
    assert env.cloud.terminations and not env.cloud.deleted_volumes
    env.clock.advance(3600)
    await cycle(env)
    row = env.engine.get(row["id"],"tenant-a")
    assert row["state"] == "PAUSED_FOR_FUNDS"
    assert service_seconds(row,env.clock.now()) == used
    env.service.store.record_collection("aws",[env.offer.model_copy(update={"observed_at":env.clock.now().isoformat()})])
    request = command(env,row,"resume","resume")
    row = await env.engine.execution_grant(row["id"],"tenant-a",request)
    assert (await env.engine.execution_grant(row["id"],"tenant-a",request))["funding_revision"] == 2
    row = await deliver(env,row["id"])
    assert row["generation"] == 2 and row["state"] == "ACTIVE"
    assert service_seconds(row,env.clock.now()) < used+30
    for v in env.engine.current(row)["volumes"]:
        assert env.cloud.files[v["volume_id"]]["customer-model"] == "checkpoint"


async def test_expired_execution_grant_never_acquires_an_instance(floating):
    env=floating
    row,_=env.engine.create(env.request,"tenant-a","expired-grant")
    env.clock.advance(121)
    await cycle(env,2)
    row=env.engine.get(row["id"],"tenant-a")
    assert row["state"] == "PAUSED_FOR_FUNDS" and not row["end_requested"]
    assert not env.cloud.creates
    with pytest.raises(ValueError,match="bounded"):
        await env.engine.execution_grant(row["id"],"tenant-a",ExecutionGrant(
            idempotency_key="bad",expected_revision=0,action="resume",
            expires_at=env.clock.now()+timedelta(hours=1)))


async def test_seven_day_retention_expires_without_starting_a_second_retention_window(floating):
    env=floating
    row,_=env.engine.create(env.request,"tenant-a","retention-expiry")
    row=await deliver(env,row["id"])
    row=await paused(env,row)
    env.clock.advance(7*86400+1)
    await cycle(env,10)
    row=env.engine.get(row["id"],"tenant-a")
    assert row["state"] == "CLOSED" and row["end_cause"] == "funding_retention_expired"
    assert row["rfq"]["backup"]["final_retention_seconds"] == 0
    assert all(b["state"] == "DELETED" for b in env.engine.backups(row))
    assert env.cloud.deleted_volumes


def test_guest_deadline_follows_renewals_and_shuts_down_independently(tmp_path,monkeypatch):
    import json

    path=tmp_path/"lease.json"
    path.write_text(json.dumps(dict(expires_at=100)))
    clocks=iter([90,105,130])
    monkeypatch.setattr(guest_lease.time,"time",lambda:next(clocks))
    sleeps=[]
    def renew(_):
        sleeps.append(True)
        path.write_text(json.dumps(dict(expires_at=120)))
    monkeypatch.setattr(guest_lease.time,"sleep",renew)
    commands=[]
    monkeypatch.setattr(guest_lease.subprocess,"run",lambda args,**kw:commands.append(args))
    guest_lease.watch(path)
    assert len(sleeps)==2 and commands==[["/sbin/shutdown","-h","now"]]


def test_guest_lease_never_contains_credentials_or_accepts_an_unbounded_deadline(tmp_path,monkeypatch):
    monkeypatch.setattr(guest_lease,"ROOT",tmp_path)
    monkeypatch.setattr(guest_lease.time,"time",lambda:100)
    monkeypatch.setattr(guest_lease.subprocess,"run",lambda *a,**k:SimpleNamespace(stdout=b"active"))
    guest_lease.step(dict(expires_at="1970-01-01T00:03:20+00:00"))
    assert "200" in (tmp_path/"lease.json").read_text()
    with pytest.raises(ValueError,match="too_distant"):
        guest_lease.step(dict(expires_at="2099-01-01T00:00:00+00:00"))
