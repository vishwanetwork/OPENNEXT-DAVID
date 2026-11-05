"""Staging acceptance for a real AWS Spot interruption, injected with AWS FIS.

Runs the acceptance harness unchanged except for its recovery request: after the manual
backup it writes a late file to the data disk, then starts an FIS experiment that sends
the live instance a Spot interruption warning (two minutes before AWS stops it). The bot
must react to the warning on its own (EventBridge/SQS or the guest's metadata check),
capture the final disks and restore; the late file must survive.

Requires an FIS role limited to bot-managed instances (`--fis-role-arn`). Each run creates
a single-target experiment template and deletes it afterwards.
"""
import argparse
import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import boto3

from spotbot.rental_acceptance import Acceptance, AcceptanceError, AcceptanceSettings
from spotbot.rental_models import RentalRequest

parser = argparse.ArgumentParser()
parser.add_argument("run_id")
parser.add_argument("rfq", type=Path)
parser.add_argument("journal", type=Path)
parser.add_argument("--fis-role-arn", required=True)
args = parser.parse_args()
settings = AcceptanceSettings().model_copy(update={"stage_timeout_seconds": 5400})
request = RentalRequest.model_validate_json(args.rfq.read_text())
data = "/data/" + request.rfq.data_disks[0].device.rsplit("/", 1)[1]
late = f"{data}/.spotbot-acceptance/{args.run_id}/late.dat"

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
    runner = Acceptance(settings, request, args.run_id, args.journal)
    original_api, original_ssh = runner.api, runner.ssh
    state = {"connection": None, "calls": 0, "late": None, "template": None, "region": None}

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
            region, instance = live["region"], live["instance_id"]
            account = boto3.client("sts").get_caller_identity()["Account"]
            fis = boto3.client("fis", region_name=region)
            template = fis.create_experiment_template(
                clientToken=args.run_id + "-template",
                description=f"SpotOrderBot staging acceptance {args.run_id}: one Spot warning",
                roleArn=args.fis_role_arn,
                stopConditions=[{"source": "none"}],
                targets={
                    "spot": {
                        "resourceType": "aws:ec2:spot-instance",
                        "resourceArns": [f"arn:aws:ec2:{region}:{account}:instance/{instance}"],
                        "selectionMode": "ALL",
                    }
                },
                actions={
                    "interrupt": {
                        "actionId": "aws:ec2:send-spot-instance-interruptions",
                        "parameters": {"durationBeforeInterruption": "PT2M"},
                        "targets": {"SpotInstances": "spot"},
                    }
                },
                tags={"ManagedBy": "SpotOrderBot", "spotbot-acceptance": args.run_id},
            )["experimentTemplate"]
            state.update(template=template["id"], region=region)
            # Client tokens are shared across FIS operations; reusing one is a conflict.
            experiment = fis.start_experiment(
                clientToken=args.run_id + "-start", experimentTemplateId=template["id"]
            )["experiment"]
            runner.report["spot_interruption"] = dict(
                instance_id=instance,
                region=region,
                experiment_id=experiment["id"],
                started_at=datetime.now(UTC).isoformat(),
                late_write_sha256=state["late"],
            )
            runner.checkpoint("fis_spot_interruption_started")
            return {"state": "spot_interruption_injected"}
        return await original_api(path, **kwargs)

    runner.api, runner.ssh = api, ssh
    try:
        return await runner.execute()
    finally:
        await runner.close()
        if state["template"]:
            fis = boto3.client("fis", region_name=state["region"])
            experiment = runner.report.get("spot_interruption", {}).get("experiment_id")
            if experiment:
                runner.report["spot_interruption"]["experiment_state"] = fis.get_experiment(
                    id=experiment
                )["experiment"]["state"]
            fis.delete_experiment_template(id=state["template"])
            runner.report["fis_template_deleted"] = True
            runner.checkpoint()


try:
    print(json.dumps(asyncio.run(main()), indent=2))
except AcceptanceError as exc:
    print(json.dumps({"error": str(exc), "journal": str(args.journal)}))
    raise SystemExit(1) from None
