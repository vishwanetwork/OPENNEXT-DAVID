# Handover: moving the Bot, gateway and web to the new platform

This guide is for whoever runs the new platform. It covers:

- what runs today;
- what the new platform must provide;
- how the live data and secrets reach you;
- the order of the cutover, so customers and running GPU servers keep working.

Everything you need is in this repository, except the secrets and the data. Those come as a
private bundle on the day; see [Secrets and data](#secrets-and-data).

## Where everything is

| Path                                                    | What it is                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/spotbot/`                                     | Source of the core Bot and the gateway; its `Dockerfile` builds the image both run                                                             |
| `Dockerfile` (root)                                     | The web image: front-end, legacy API and the bundled adapter (`SPOTBOT_SOURCE=local`)                                                          |
| [`bot-host/`](bot-host/README.md)                       | **How the Bot and gateway run today** (Docker Compose): commands, ports, users, health checks, mounts, deploy, rollback. The reference runtime |
| `bot-host/compose.bot.yaml`, `compose.gateway.yaml`     | The exact runtime of each process                                                                                                              |
| `bot-host/openresty/`                                   | The live HTTPS sites: host names, timeouts, body limits                                                                                        |
| `bot-host/aws-config.example`                           | The Bot's AWS profile chain                                                                                                                    |
| `services/spotbot/.env.example`, `.env.gateway.example` | Every setting, documented                                                                                                                      |
| `.github/workflows/deploy.yml`                          | How production web is built and deployed today (1Panel)                                                                                        |
| `docs/SPOTBOT_ADAPTER.md`                               | The web container's adapter settings                                                                                                           |
| [`k8s/`](k8s/README.md)                                 | A ready Kustomize deployment of all three services for EKS, with the migration scripts. Use it, or translate the runtime above into your own   |
| `k8s/scripts/export-*.sh`, `import.sh`                  | Export the live data and settings from the old hosts; load them into the cluster                                                               |
| `k8s/scripts/aws-access.sh`                             | The two AWS changes in the GPU accounts (plan by default, `--apply` to change)                                                                 |

## What runs today

| Process                   | Where                          | Image              | State                                                              |
| ------------------------- | ------------------------------ | ------------------ | ------------------------------------------------------------------ |
| Web (`opennext-homepage`) | 1Panel web host `18.188.54.73` | root `Dockerfile`  | `/app/.opennext-data`: accounts, Credit, adapter SQLite, KYB files |
| Core Bot                  | bot host `44.248.155.24`       | `services/spotbot` | MySQL `spot_order_bot` on the bot host                             |
| Gateway                   | bot host `44.248.155.24`       | `services/spotbot` | MySQL `spot_order_gateway` on the bot host                         |

| Public name                             | Goes to                                                 | Who uses it                                                   |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `opennextlab.ai`, `terminal.`, `admin.` | web, port 4188                                          | customers, operators                                          |
| `spotbot.test.vishwalab.com`            | Bot, port 8000 in the image (18082 on the host today)   | the web adapter, the legacy API, **every running GPU server** |
| `gpu-gateway.test.vishwalab.com`        | gateway API, port 18084                                 | the web adapter                                               |
| `r-<rental>.test.vishwalab.com`         | gateway, port 18084 (proxy timeout 650 s, no buffering) | customers' model endpoints                                    |
| `gpu-ssh.test.vishwalab.com`            | gateway, TCP `22100-22199`, one port per rental         | customers' SSH                                                |

The public names must not change. Running GPU servers and customers already hold them.

## What the new platform must provide

1. **One replica of each process, never two.** Each is the single writer of its state. Deploys
   must stop the old copy before starting the new one (Kubernetes: `Recreate`).
2. **A fixed public address for the gateway's SSH ports `22100-22199`**, reachable from the
   internet. A load balancer would need one listener per port. `k8s/` uses host networking on
   one node with an Elastic IP.
3. **A fixed egress address shared by the Bot and the gateway.** GPU servers accept SSH (22) and
   the health port (8000) only from the allow-listed address, today `44.248.155.24`.
   `k8s/scripts/aws-access.sh` adds the new address next to it.
4. **AWS identity.** The Bot calls AWS as `SpotOrderBotEC2Role` in account `860165147463`, and from
   there assumes the B300 account's role. The new platform needs a role that may assume
   `SpotOrderBotEC2Role`; `aws-access.sh` adds that trust. Nothing else in the GPU accounts changes.
5. **MySQL 8**, with the two databases restored from the dump.
6. **A persistent volume** for the web data directory.
7. **HTTPS routing** for the names above, with the timeouts and body limits in
   `bot-host/openresty/`.
8. **Internal addresses.** The services may call each other on the private network: web to Bot and
   gateway, gateway to Bot, Bot to gateway (events). `k8s/` sets these URLs. The Bot's
   public name must still work, for the GPU servers.

## Secrets and data

Secrets never go in this repository or in chat. On the day, the export scripts write two
private bundles on the old hosts:

- **Bot bundle**, from `k8s/scripts/export-bot-host.sh` on the bot host:
  - the effective environment of the Bot and the gateway;
  - both MySQL dumps;
  - the AWS config;
  - checksums.
- **Web bundle**, from `k8s/scripts/export-web-host.sh` on the web host:
  - the web container's environment;
  - its data directory;
  - checksums.

Copy them over SSH to the operator machine and keep them on encrypted storage. `k8s/scripts/import.sh`
turns them into Kubernetes Secrets, creates the database users, loads the dumps and restores the
volume. It prints no secret values. If you do not use `k8s/`, the env files in the bundles are
plain `KEY=VALUE` lists. Use them as they are, except for the internal URLs above.

## Cutover

The full commands are in [`k8s/README.md`](k8s/README.md#cutover). In short:

1. **Rehearse.**
   - Build the platform. Run the exports with `--allow-running`.
   - **Before importing, defuse the copies.** A rehearsal Bot holds the live AWS identity and the
     same rentals as the real one, and the rehearsal web holds real customer emails.
     - In `bot.env`, set `SPOTBOT_RENTALS_ENABLED=false`, which stops the rental worker and its
       AWS interruption queue consumer, and `SPOTBOT_LIVE_ORDERS_ENABLED=false`.
     - In `web.env`, empty `SMTP_HOST` and `SPOTBOT_OPENNEXT_SMTP_HOST`.
   - Import, deploy, and check inside the cluster with `k8s/scripts/verify.sh`. Price
     collection, sign-in, the market and the Console should all work.
   - Nothing public changes in this step. Afterwards, delete the `opennext` namespace, with its workloads and web volume, and both
     databases. The real copy is taken in the window and must start clean: `import.sh` refuses to run
     over existing workloads or web data.
2. **Prepare.**
   - Run `aws-access.sh --apply` with the new role and address. This adds to the allow lists and
     takes nothing away.
   - Lower the TTL of every public name to 60 s a day ahead.
   - Note the release commit; its images must exist.
3. **Window.** Expect about 30 minutes. Customer SSH sessions drop. GPU servers keep running and
   retry.
   1. Stop the old web, Bot and gateway containers.
   2. Export both bundles.
   3. Import.
   4. Deploy, then run `verify.sh`.
   5. Switch DNS: the web, Bot and gateway names to the new ingress, and `gpu-ssh` to the
      gateway's public address.
   6. Run `verify.sh --public`, sign in, open Instances, SSH into a rental, and call a model
      endpoint.
4. **Rollback.**
   - Before DNS moves, start the old containers again.
   - After DNS moves, point DNS back and start them. Anything written on the new platform in
     between is lost, so decide quickly.
   - The old hosts stay untouched for a week.
5. **Afterwards.** Remove `44.248.155.24` from the GPU security groups and retire the old hosts.

## Before the window

- The old bot host must keep running until the cutover. Releases there go through
  `bot-host/deploy.sh` (see its README). Do not deploy to it during the window.
- The export reads the live containers' settings, so a change made on the old hosts before the
  export carries over. One made after it does not.
- Check that the new platform's clock is synchronised, and that it can reach AWS APIs in
  `us-west-2`, `us-east-1` and `us-east-2`.
