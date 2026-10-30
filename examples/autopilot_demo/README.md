# Autopilot demonstration kit

Use `script.sh` unchanged in the **Script** field. Paste one matching `*.env.txt`
file into **Environment variables**. Set **Secrets** to the dummy value below:

```text
DEMO_SECRET=demo-only-not-a-real-credential
```

This is a deliberately public test value. Do not use a production credential.
Logs show only `secret_present`; neither checkpoint nor progress output contains the value.
Saving a task clears its secret input; reopening shows its stored name instead of its value.

## Presets and expected results

| Preset | Success | Failure | Replacement | Limit | Expected demonstration |
| --- | --- | --- | --- | --- | --- |
| `01-success-inspect` | Keep | Keep | Rerun | 5 min | About 60 seconds; running logs, 12 checkpoints, succeeded; server stays available |
| `02-success-end` | End | Keep | Rerun | 5 min | About 30 seconds; succeeded, ending, ended; usage settlement and final snapshot |
| `03-failure-inspect` | Keep | Keep | Rerun | 5 min | Intentional exit 42 after step 4, about 20 seconds; failed, server available for SSH |
| `04-failure-end` | Keep | End | Rerun | 5 min | Same exit 42; rental ends automatically |
| `05-timeout` | Keep | Keep | Rerun | 1 min | Task would run 50 minutes; systemd stops it at the limit; failed, server stays available |
| `06-stop` | Keep | Keep | Rerun | 10 min | Click Stop while running; stopped, server stays available; do not click END to test task-only stop |
| `07-replacement-rerun` | Keep | Keep | Rerun | 30 min | Operator-triggered replacement; new attempt logs resumed=true and loads the restored checkpoint |
| `08-replacement-no-rerun` | Keep | Keep | Do not rerun | 30 min | Replacement succeeds but the task is not launched again; interrupted outcome |

Exact API-shaped options are in `presets.json` (camelCase fields). Add the contents of
`script.sh` as `script` if submitting the options through the customer API.

## Recommended live presentation

1. Use a low-cost, whole-GPU Spot offer shown in the current market. The scripts need
   Python 3 and `nvidia-smi`; they do not download models or install dependencies.
   PyTorch CUDA matrix work is optional and used only when already available. Otherwise
   the workload is a Python checksum, with GPU inventory verified separately.
2. Start with `01-success-inspect`. Prefer setting it while the order waits for capacity.
   Confirm the choices before pressing **Save autopilot**. The guest starts it after delivery.
3. Observe waiting, running and progress output. Reports/polling introduce a delay; a short
   run may finish between two refreshes. Increasing `DEMO_STEPS` to 24 makes it last two minutes.
4. Reopen the task: its secret value is absent. Once dispatched, editing/removal is refused;
   **Stop** remains available while the task runs. A finished task cannot be reused for
   another scenario through the current product. Use a separate rental for each preset.
5. On success, keep the server for SSH inspection, then use **END** when finished.
6. Demonstrate `03-failure-inspect`, then either `02-success-end` or `04-failure-end` on another
   rental. Inspect Instances, Billing and History after ending. Snapshots can remain during
   retention; ended compute does not imply that all storage charges have stopped.
7. Demonstrate task-only Stop and the time limit using their dedicated presets.

The current purchase flow has a **one-hour minimum once delivered**. Repeating short scenarios
on new rentals can therefore incur multiple minimum charges. Capacity acquisition and recovery
can take much longer than script runtime. Existing waiting orders do not guarantee delivery.
This kit never purchases, ends, or interrupts a server by itself; those actions require
the customer or operator to select the corresponding product action.

## Files and SSH inspection

Files are on the protected root disk, not temporary `/tmp` or GPU memory:

```bash
cat "$HOME/autopilot-demo/01-success-inspect/checkpoint.json"
```

The checkpoint records progress, attempt, state and a configuration fingerprint. A normal
successful run has `completed_steps: 12` and `state: succeeded`. Failure has step 4 and
`state: failed`. SIGTERM produces `state: interrupted`, which describes the script checkpoint;
the platform independently labels a user Stop as `stopped`, or a time limit as `failed`.

Guest logs live under `/var/log/spotbot-task/<version>-<attempt>.log`. The UI keeps a limited
log tail. For supported GPU images, connect with the instance's SSH command and inspect:

```bash
ls -l /var/log/spotbot-task/
```

## Replacement demonstrations

Use preset 07 or 08. Wait for at least two progress lines, then wait for a successful backup
that includes the demo files. An operator can request replacement of this exact rental:

```bash
# Set the bot URL, execution token and rental UUID explicitly. Never use the gateway token.
curl --fail-with-body -X POST "$BOT_URL/v1/rentals/$RENTAL_ID/recover" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H 'X-SpotBot-Tenant: opennext' \
  -H 'Content-Type: application/json' -d '{}'
```

This **replaces the server** and can incur further cloud charges. It is a requested recovery,
not an AWS Spot-reclamation test. Do not use END or Stop as a replacement simulation.
Actual AWS warning delivery is tested separately with `examples/acceptance_spot_interruption.py`
and approved FIS infrastructure; this kit never invokes FIS.

With rerun, logs contain `resumed: true`, a different `attempt`, and `checkpoint_loaded`.
Progress resumes from the selected snapshot, which may precede the last visible log line;
the example does not promise zero lost work. A missing checkpoint is explicitly logged and
restarts the demo. Snapshot rollback can repeat work, so production side effects need their
own idempotency. With no rerun, inspect the restored files through SSH instead.

## Local script checks

The pytest checks run without purchasing a GPU, using temporary HOME directories and
`DEMO_REQUIRE_GPU=0`, `DEMO_GPU_WORK=0`. They cover success, intentional failure, signal
checkpointing and checkpoint resumption. They do not replace a real GPU/systemd/FIS acceptance.
