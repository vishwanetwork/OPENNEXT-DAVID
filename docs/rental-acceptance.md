# Controlled staging recovery acceptance

`spotbot rental-acceptance` exercises the deployed bot and managed gateway APIs.
It never calls AWS procurement APIs directly. The default command only prints
an execution plan. `--execute` creates a real rental, tests it, and requests its
release. Do not execute until the deployment, permission changes, networking,
DNS/TLS and RFQ spending limits have been approved.

## Prepare

1. Deploy and check the [rental backend](rentals.md),
   [AWS infrastructure](aws-recovery-deployment.md), and [gateway](gateway.md).
   Use a dedicated staging tenant and new test RFQ. Do not use a customer's
   existing rental. Confirm the regional key pair corresponds to the local SSH
   private key and the selected image supports Python 3, sudo, systemd and CUDA.
2. Copy `.env.acceptance.example` to `.env.acceptance` on the **operator machine**,
   outside source control. Set the bot/gateway URLs, service tokens, tenant,
   private-key path and a dedicated known-hosts file. The gateway never receives
   the private key. The bot administrator token is used with the tenant header.
3. Default SSH mode requires preverified known-hosts entries. For a controlled
   staging VM whose first key is not known in advance, an operator may explicitly
   set `SPOTBOT_ACCEPTANCE_TRUST_NEW_HOST_KEYS=true`. This uses OpenSSH
   `accept-new`: the first key is trusted on first use, while changed keys fail.
   The report records this distinction. This is not independent verification of
   the initial server host key and is not a production host-key policy.
4. Generate a current request and review GPU, price ceiling, budget, Regions,
   acquisition deadline, expiry and disk sizes. The helper retains the existing
   H100 sample defaults; change them to the approved test offering and spending
   limits. Neither the helper nor the runner selects a cheaper GPU automatically.

Cold encrypted root snapshots can outlast the default per-stage wait. Configure
`SPOTBOT_ACCEPTANCE_STAGE_TIMEOUT_SECONDS` and the RFQ lifetime deliberately;
the tool's timeout is not an AWS completion guarantee. An approved, pre-encrypted
clean GPU base can reduce GPU idle time spent preparing the first recovery point.
Select it through RFQ `initial_image_ids` and use its actual SSH user and disk
requirements. Private initial images require explicit administrator enrollment;
never enroll an image containing tenant data as a shared factory image.

```sh
python examples/rental_request.py --ssh-key staging-key --acceptance > /tmp/rental-test.json
```

The runner requires gateway acknowledgement, at least one data disk, no older
rollback, expiry within three hours, and final backup retention of at most five
minutes. The helper sets retention to 60 seconds. RFQ budgets are operating
estimates; they are not a provider invoice cap. Include allowance for images,
retained disks, snapshots, transfer and other provider charges.

## Plan and execute

Choose a fresh UUID and retain it with the journal. First inspect the plan:

```sh
spotbot rental-acceptance --rfq /tmp/rental-test.json \
  --run-id YOUR_NEW_UUID
```

After approval, use the same RFQ/run ID with `--execute`:

```sh
spotbot rental-acceptance --rfq /tmp/rental-test.json \
  --run-id YOUR_NEW_UUID --execute
```

The default journal is `logs/acceptance/<run-id>.json`, with mode 600. Override
it with `--report` if needed. The tool refuses to overwrite an existing journal,
and a known preexisting rental is left untouched. A stable tenant/run idempotency
key prevents an uncertain create response from purchasing a second rental.
The local journal includes the predicted rental ID using this repository's
matching server/client identity scheme. Use compatible bot and tool versions.

The runner waits for an active acknowledged generation, obtains the stable SSH
entry, writes random test files to root and every RFQ data mount, verifies GPU
telemetry, and requests a manual backup. It then requests latest-state recovery,
waits for a newer acknowledged generation, verifies unchanged gateway SSH/HTTP
entry points, and compares file checksums, modes and ownership. Optional HTTP
checks verify unauthenticated access is rejected and token-authenticated health
access succeeds before and after recovery. Customer HTTP access tokens remain
in memory and are never stored in the journal or passed to SSH.

## Release and failure handling

Release runs in a `finally` block, including SSH errors, corrupt restores,
cancellation and uncertain submission. Transient polling/release errors retry
within the configured deadline. The tool waits for `CLOSED`, then for backups
and enrolled generation volumes to be reported deleted after retention. A
successful run ends with `status=passed` and
`cleanup=storage_deletion_reported`. This is the control plane's resource record,
not a cloud billing reconciliation or independent invoice verification.

A closed request that never allocated a VM has no snapshots or disks to wait
for. Empty resource lists are valid only alongside a closed rental and known
terminal generations. Unknown creation outcomes and allocated instances with
missing disk inventories still require operator investigation.

If an earlier run reports cleanup timeout, the server continues its durable
release/retention workflow. Later API inspection and an independent AWS audit can
establish that resources were removed; preserve the original failed journal and
record that later verification separately. A test that cannot allocate its
replacement is still a failed restore acceptance, even after successful cleanup.

If cleanup cannot be confirmed, the journal records `status=failed`,
`cleanup=unconfirmed` and a sanitized cleanup error. Inspect the rental ID through
the bot and cloud console immediately; retained storage may still incur charges.
A hard process kill, machine failure, or network partition can prevent the final
release request. The RFQ's absolute expiry remains the bot's fallback. Never
discard an unresolved journal or run another purchase blindly.

The current harness explicitly requests recovery through the bot API; it does
not inject a real AWS reclamation warning. Separately verify EventBridge/SQS
delivery and an unannounced instance loss in an approved staging test. It does
not validate large-disk restore throughput, arbitrary customer application
consistency, billing settlement, load capacity, or a gateway failover cluster.

Local tests use fake APIs/SSH for the runner. Gateway tests additionally use real
loopback SSH bytes and HTTP streaming. No paid cloud action is performed by the
automated test suite.
