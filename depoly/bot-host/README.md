# Bot host (Docker Compose)

This is how the SpotOrderBot runs today. One host runs three Docker Compose projects:

- the core Bot;
- the rental gateway;
- the OpenNEXT test site.

The host is the bot test host `44.248.155.24` (Debian, 1Panel, OpenResty). Production
`terminal.opennextlab.ai` runs elsewhere (see [Production web](#production-web)), but its adapter
calls this Bot and gateway, so they serve production too.

To hand the services over to a new platform, start with [`../HANDOVER.md`](../HANDOVER.md).

`depoly/k8s/` describes the planned move to Kubernetes. This directory keeps the current hosts
working and is the reference for what each service needs.

## What runs

| Service    | Container                      | Compose project | Listens on                                                    | Public names                                                                                    | Settings                                                     |
| ---------- | ------------------------------ | --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `spotbot`  | `spot-order-bot`               | `spotbot`       | `127.0.0.1:18082`                                             | `spotbot.test.vishwalab.com`                                                                    | `/opt/spot-order-bot/.env`, `/opt/spot-order-bot/aws/config` |
| `gateway`  | `spot-order-gateway`           | `spotgateway`   | API on `127.0.0.1:18084`; SSH on `22100-22199`, all addresses | `gpu-gateway.test.vishwalab.com`, `r-<rental>.test.vishwalab.com`, `gpu-ssh.test.vishwalab.com` | `/opt/spot-order-bot/.env.gateway`                           |
| `test-web` | `opennext-test-web-1`, Mailpit | `opennext-test` | `127.0.0.1:18188`, Mailpit `127.0.0.1:18025`                  | `opennext{,-terminal,-admin,-mail}.test.vishwalab.com`                                          | `/opt/opennext-test/{web,adapter,mailpit}.env`               |

- **Images.** The Bot and the gateway share `opennext-spotbot:<commit>`, built from
  `services/spotbot`. The test site runs `opennext-test-web:<commit>`, built from the repository root
  with `SPOTBOT_SOURCE=local`.
- **Networking.** All three use host networking. OpenResty terminates TLS and proxies to the
  loopback ports. The configs are [`openresty/spotbot.conf`](openresty/spotbot.conf) and
  [`openresty/gateway.conf`](openresty/gateway.conf), copies of the live 1Panel sites. The test site's
  config is `services/spotbot/deploy/opennext-test/openresty.conf`.
- **Data.**
  - The Bot and the gateway keep their data in the host's 1Panel MySQL (container
    `1Panel-mysql-ej72`): databases `spot_order_bot` and `spot_order_gateway`, users `spotbot` and
    `spotgateway`, at `127.0.0.1:3306`. Their Docker volumes stay empty.
  - The test site's adapter uses SQLite in the volume `opennext-test_web-data`.
- **AWS.** The Bot uses the host's EC2 instance role `SpotOrderBotEC2Role` (account
  `860165147463`). `aws/config` adds the B300 account's `SpotOrderBotCrossAccountRole`, assumed
  from that role. The GPU security groups allow ports 22 and 8000 only from this host's address.
  The gateway never gets AWS credentials.
- **One of each.** Every service is a single writer. Never start a second copy.

## Host layout

```text
/opt/spot-order-bot/
  .env                  Bot settings, mode 600 (template: services/spotbot/.env.example)
  .env.gateway          gateway settings, mode 600 (template: services/spotbot/.env.gateway.example)
  aws/config            AWS profiles, owner 10001, mode 400 (template: aws-config.example)
  releases/<commit12>/  source of each deployed commit (git archive of this repository)
  state/<service>.env   running image, previous image, release directory
  state/adopted         written by adopt.py; releases of the Bot and gateway require it
  current               -> release of the running Bot
/opt/opennext-test/
  compose.yaml, start-test.cjs      copied from services/spotbot/deploy/opennext-test by each release
  web.env, adapter.env, mailpit.env secrets, mode 600
```

## Deploy

Deploy from a checkout of this repository on your own machine. The commit must be on `origin/main`;
pass `--allow-unmerged` to deploy one that is not.

```sh
bash depoly/bot-host/deploy.sh <commit> spotbot gateway   # Bot and gateway
bash depoly/bot-host/deploy.sh <commit> test-web          # test site
```

`deploy.sh` uploads the commit and runs [`release.sh`](release.sh) on the host for each service.
`release.sh` does the following:

1. Builds the image on the host, unless it already exists.
2. Loads the settings with the new image, before it touches the running container:
   `spotbot check-config` for the Bot, and the gateway settings for the gateway.
3. Replaces the container.
4. Waits up to five minutes for it to be healthy. If it is not, it switches back to the previous
   image and fails.

The script reaches the host with `ssh admin@44.248.155.24`, which needs sudo. Use
`--ssh "<command>"` or `BOT_HOST_SSH` for another way in.

Other commands:

```sh
bash depoly/bot-host/deploy.sh --rollback spotbot   # back to the image that ran before
bash depoly/bot-host/deploy.sh --restart spotbot    # same image, re-read .env after an edit
```

To change a setting, edit `.env` or `.env.gateway` on the host. Copy the file to
`.env.bak-<date>-<reason>` first. Then run `--restart`. Running GPU servers keep running through a Bot or gateway
restart: their agents retry. A gateway restart drops open customer SSH sessions; customers
reconnect to the same port.

## First time: adopt the current host

Before this directory existed, the Bot and the gateway were started from hand-kept compose
overlays:

- `reference-pricing/` held the B300 price profile and the AWS config mount;
- `account-fulfillment/` held the AWS accounts;
- `inference/` held the gateway's inference timeout.

Those overlays also pinned the image. [`adopt.py`](adopt.py) moves those settings into `.env` and
`.env.gateway`, and copies the AWS config to `aws/config`. It then checks that the new compose
files would start each container with exactly the environment it runs with now.

It restarts nothing and prints key names only, never values.

```sh
bash depoly/bot-host/deploy.sh <commit>    # upload only
ssh admin@44.248.155.24 sudo python3 /opt/spot-order-bot/releases/<commit12>/depoly/bot-host/adopt.py
ssh admin@44.248.155.24 sudo python3 /opt/spot-order-bot/releases/<commit12>/depoly/bot-host/adopt.py --write
bash depoly/bot-host/deploy.sh <commit> spotbot gateway
```

Keep the old overlay directories for a week, then remove them.

On a new host, there is nothing to adopt. Write `.env`, `.env.gateway` and `aws/config` from
the templates, then `sudo mkdir -p /opt/spot-order-bot/state && sudo touch
/opt/spot-order-bot/state/adopted`.

## DNS

Every name below is an A record pointing at the host: `spotbot.test.vishwalab.com`,
`gpu-gateway.test.vishwalab.com`, `gpu-ssh.test.vishwalab.com`, the `opennext*.test.vishwalab.com`
names, and the model endpoints `r-<rental>.test.vishwalab.com`. The model endpoints need a
wildcard (`*.test.vishwalab.com`) or one record per rental.

The certificate is the `*.test.vishwalab.com` wildcard that 1Panel keeps under the
`agent-cp.test.vishwalab.com` site.

## Production web

`terminal.opennextlab.ai`, `opennextlab.ai` and `admin.opennextlab.ai` run as one container,
`opennext-homepage`, on the 1Panel web host. `.github/workflows/deploy.yml` builds and replaces it
on every merge into `main`. It uses `SPOTBOT_SOURCE=local`, so the bundled adapter is
`services/spotbot` from the same commit.

Its settings are the container's environment in 1Panel. The adapter's part is listed in
`docs/SPOTBOT_ADAPTER.md`, including `SPOTBOT_OPENNEXT_BOT_URL=https://spotbot.test.vishwalab.com`
and `SPOTBOT_OPENNEXT_GATEWAY_URL=https://gpu-gateway.test.vishwalab.com`.

Its data, the adapter's SQLite and the KYB files, lives in `/app/.opennext-data` in that
container.

## Files

| File                                               | Purpose                                                   |
| -------------------------------------------------- | --------------------------------------------------------- |
| `compose.bot.yaml`                                 | The core Bot                                              |
| `compose.gateway.yaml`                             | The rental gateway                                        |
| `deploy.sh`                                        | Upload a commit and release services (operator machine)   |
| `release.sh`                                       | Build, check, switch, roll back, restart (host)           |
| `adopt.py`                                         | One-time move from the old overlays to these files (host) |
| `aws-config.example`                               | The Bot's AWS profiles                                    |
| `openresty/spotbot.conf`, `openresty/gateway.conf` | The Bot's and the gateway's HTTPS sites                   |
