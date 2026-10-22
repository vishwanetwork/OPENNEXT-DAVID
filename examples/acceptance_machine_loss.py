"""Staging acceptance for an unannounced server loss.

Runs Acceptance.execute unchanged except for its recovery request: instead of asking the
bot to recover, it writes a late file on the data disk (after the manual backup), then
terminates the instance directly through EC2 without telling the bot. The bot must notice
the loss, capture the retained disks, and restore; the late file proves the final state
(not the earlier manual backup) was restored.
"""
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import boto3

from spotbot.rental_acceptance import Acceptance, AcceptanceError, AcceptanceSettings
from spotbot.rental_models import RentalRequest

run_id, rfq_path, journal = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
settings = AcceptanceSettings().model_copy(update={"stage_timeout_seconds": 5400})
request = RentalRequest.model_validate_json(rfq_path.read_text())
data = "/data/" + request.rfq.data_disks[0].device.rsplit("/", 1)[1]
late = f"{data}/.spotbot-acceptance/{run_id}/late.dat"

WRITE = f"""import hashlib, json, os
path = {late!r}
os.makedirs(os.path.dirname(path), exist_ok=True)
body = os.urandom(4 * 1024 * 1024)
with open(path, "wb") as f:
    f.write(body); f.flush(); os.fsync(f.fileno())
os.sync()
print(json.dumps(dict(sha256=hashlib.sha256(body).hexdigest())))
"""
READ = f"""import hashlib, json
print(json.dumps(dict(sha256=hashlib.sha256(open({late!r}, "rb").read()).hexdigest())))
"""


async def main():
    runner = Acceptance(settings, request, run_id, journal)
    original_api, original_ssh = runner.api, runner.ssh
    state = {"connection": None, "calls": 0, "late": None}

    async def ssh(connection, script):
        state["calls"] += 1
        state["connection"] = connection
        result = await original_ssh(connection, script)
        if state["calls"] == 2:  # The replacement's restored-file check.
            found = await original_ssh(connection, READ)
            if found.get("sha256") != state["late"]:
                raise AcceptanceError("late_write_lost")
            runner.report["late_write_verified"] = True
        return result

    async def api(path="", **kwargs):
        if path.endswith("/recover") and kwargs.get("method") == "POST":
            written = await original_ssh(state["connection"], WRITE)
            state["late"] = written["sha256"]
            gens = await original_api(f"/v1/rentals/{runner.rental_id}/generations")
            live = [
                g for g in gens["items"]
                if g.get("instance_id") and g["state"] not in {"STOPPED", "REJECTED"}
            ][-1]
            ec2 = boto3.client("ec2", region_name=live["region"])
            ec2.terminate_instances(InstanceIds=[live["instance_id"]])
            runner.report["unannounced_loss"] = dict(
                instance_id=live["instance_id"],
                region=live["region"],
                terminated_at=datetime.now(UTC).isoformat(),
                late_write_sha256=state["late"],
            )
            runner.checkpoint("instance_terminated_outside_bot")
            return {"state": "terminated_outside_bot"}
        return await original_api(path, **kwargs)

    runner.api, runner.ssh = api, ssh
    try:
        return await runner.execute()
    finally:
        await runner.close()


try:
    print(json.dumps(asyncio.run(main()), indent=2))
except AcceptanceError as exc:
    print(json.dumps({"error": str(exc), "journal": str(journal)}))
    raise SystemExit(1) from None
