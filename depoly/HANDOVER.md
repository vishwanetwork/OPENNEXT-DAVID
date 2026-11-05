# Handover: moving OpenNEXT to the new platform

OpenNEXT is three applications, all built from this repository. Deploy all three on the new
platform and move their data. The AWS accounts that supply GPUs do not change: `860165147463`
and the B300 account `413287184831`.

## The three applications

| Application | Image                                          | Command                                       | Port                                           | Health check              |
| ----------- | ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------------------- |
| **web**     | `ghcr.io/vishwanetwork/opennext-web:<sha>`     | image default                                 | 4188                                           | `GET /api/pricing/status` |
| **bot**     | `ghcr.io/vishwanetwork/opennext-spotbot:<sha>` | `spotbot serve --host 0.0.0.0 --port 8000`    | 8000                                           | `GET /health`             |
| **gateway** | `ghcr.io/vishwanetwork/opennext-spotbot:<sha>` | `spotbot gateway --host 0.0.0.0 --port 18084` | 18084, plus TCP `22100-22199` for customer SSH | `GET /health` on 18084    |

`.github/workflows/images.yml` publishes both images for every commit on `main`, tagged with the
commit SHA. Deploy all three from the same commit.

| Application | Data                                                                              | Runs as   |
| ----------- | --------------------------------------------------------------------------------- | --------- |
| web         | a persistent volume at `/app/.opennext-data`: accounts, Credit, orders, KYB files | uid 1000  |
| bot         | MySQL database `spot_order_bot`                                                   | uid 10001 |
| gateway     | MySQL database `spot_order_gateway`                                               | uid 10002 |

**Rules**

- Run **one copy of each application**, never two. Each is the only writer of its data. Stop the
  old copy before starting the new one.
- The **gateway** needs a public IP where TCP ports `22100-22199` are open to the internet. Each
  rental gets one of these ports for SSH.
- The **bot and the gateway** must reach the internet from **one fixed IP**. GPU servers only accept
  SSH (22) and port 8000 from an allow-listed address.

`bot-host/compose.bot.yaml` and `bot-host/compose.gateway.yaml` show exactly how the bot and the
gateway run today.

## Public names

Keep these names. Customers and the running GPU servers already use them.

| Name                                                                | Goes to                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `opennextlab.ai`, `terminal.opennextlab.ai`, `admin.opennextlab.ai` | web, port 4188                                                                  |
| `spotbot.test.vishwalab.com`                                        | bot, port 8000                                                                  |
| `gpu-gateway.test.vishwalab.com`, `r-*.test.vishwalab.com`          | gateway, port 18084. Read timeout 650 s, no response buffering, body up to 1 GB |
| `gpu-ssh.test.vishwalab.com`                                        | the gateway's public IP (DNS only, no HTTP)                                     |

## Settings

Each application's settings are environment variables. Take them from the running containers on
moving day (see below), and use them as they are, with three changes:

1. **bot:** in `SPOTBOT_MYSQL_URL`, set the new MySQL host, user and password.
2. **gateway:** in `SPOTBOT_GATEWAY_MYSQL_URL`, set the new MySQL host, user and password.
3. **bot, AWS access:**
   - The bot must call AWS as the role `arn:aws:iam::860165147463:role/SpotOrderBotEC2Role`. Give
     the bot credentials for that role as its default AWS profile.
   - Mount the AWS config file read-only at `/app/aws/config`, and set
     `AWS_CONFIG_FILE=/app/aws/config`.
   - In that file, the `spotbot-b300` profile says `credential_source = Ec2InstanceMetadata`.
     Replace that line with `source_profile = default`.

The applications call each other by their public names, so nothing else needs to change.

## AWS changes (same accounts)

Make both changes the day before the move.

1. **Trust.** Add your platform's role to the trust policy of `SpotOrderBotEC2Role` in
   `860165147463`, so it can assume that role:

   ```json
   {
     "Sid": "OpenNEXTNewPlatform",
     "Effect": "Allow",
     "Principal": { "AWS": "<your role ARN>" },
     "Action": "sts:AssumeRole"
   }
   ```

2. **Firewall.** Allow your fixed egress IP on TCP 22 and TCP 8000 in these security groups:
   - account `860165147463`: `spotbot-gpu` in `us-west-2`, `us-east-1` and `us-east-2`;
   - account `413287184831`: `spotbot-b300-gpu` in `us-west-2`.

Both changes only add access. Remove the old address `44.248.155.24` a week after the move.

## Which data to move

| Data                                                                                  | Move it?                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **web data** (`/app/.opennext-data`: accounts, Credit, orders, KYB, Console settings) | **Recommended.** It is one command and small. You may skip it if nobody holds Credit or has a bank transfer pending (check Payment review and Credit in the Console). Users then sign in again, pending KYB is resubmitted and the Console settings are entered again. |
| **bot and gateway databases**                                                         | **Not needed if no rental is running at the move.** Start with two empty databases; the applications create their tables. Keep a dump as an archive of past orders and rentals. If a rental is running, load that dump instead.                                        |

If you move the web data, keep `SPOTBOT_OPENNEXT_FILES_KEY` and `SPOTBOT_OPENNEXT_CONSOLE_KEY`
unchanged. They decrypt the KYB files and the stored provider credentials.

The dump below leaves out the price history: about 25 MB instead of 5 GB. The bot collects prices
again by itself.

## Moving day (about 30 minutes)

The old hosts are the web host `18.188.54.73` (root) and the bot host `44.248.155.24` (user
`admin`, with sudo). Lower the DNS TTL of the public names to 60 s the day before.

1. **Stop the web** (`docker stop opennext-homepage` on the web host). No new orders can start.
2. **Check that no rental is running.** Each of these must print nothing. Use account
   `860165147463` in `us-west-2`, `us-east-1` and `us-east-2`, and account `413287184831` in
   `us-west-2`:

   ```sh
   aws ec2 describe-instances --region <region> --filters Name=instance-lifecycle,Values=spot \
     Name=instance-state-name,Values=pending,running --query 'Reservations[].Instances[].InstanceId' --output text
   ```

   If one is running, wait until it ends, or plan to load the databases (step 5).

3. **Stop the bot and the gateway** (`docker stop spot-order-bot spot-order-gateway` on the bot host).
4. **Export.** Run as root:

   ```sh
   # Web host: settings, and the data unless you skip it
   docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' opennext-homepage > web.env
   docker cp opennext-homepage:/app/.opennext-data - | gzip > web-data.tar.gz

   # Bot host: settings, AWS config, and both databases without the price history
   docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' spot-order-bot > bot.env
   docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' spot-order-gateway > gateway.env
   cp /opt/spot-order-bot/reference-pricing/config aws-config   # or /opt/spot-order-bot/aws/config
   for db in spot_order_bot spot_order_gateway; do
     docker exec 1Panel-mysql-ej72 sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot \
       --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF \
       --default-character-set=utf8mb4 \
       --ignore-table=spot_order_bot.prices --ignore-table=spot_order_bot.collections \
       --ignore-table=spot_order_bot.aws_spot_changes --ignore-table=spot_order_bot.aws_spot_coverage \
       --databases "$0"' "$db" | gzip > "$db.sql.gz"
   done
   ```

   - The env files also contain the image's own variables (`PATH`, `HOME`, `LANG`, `HOSTNAME`,
     `PYTHON_*`, `NODE_VERSION`, `YARN_VERSION`, `GPG_KEY`). Drop them.
   - These files hold every secret. Copy them over SSH only. Never commit them or paste them
     anywhere.

5. **Prepare the data.**
   - In the new MySQL, create the databases `spot_order_bot` and `spot_order_gateway`. Create one
     user for each, limited to its own database.
   - Leave both databases empty. If a rental is running, or you want the old records, restore the
     two dumps into them instead.
   - Unpack `web-data.tar.gz` into the web volume, unless you skip it. Its top directory is
     `.opennext-data`. The files must belong to uid 1000.

6. **Start** web, bot and gateway on the new platform with the settings above, and check that each
   health endpoint answers.
7. **Switch DNS** to the new platform. Until then, the applications still look for each other at
   the old hosts. Then check:
   - the gateway's `/health` shows `"bot_reachable": true`;
   - sign in on `terminal.opennextlab.ai`;
   - the market lists offers. The bot needs a few minutes to collect prices when it starts empty;
   - if you loaded the databases, SSH into a running rental through `gpu-ssh.test.vishwalab.com`.

If rentals were running and you loaded the databases, customer SSH sessions drop during the window.
The GPU servers keep running and reconnect by themselves.

**Rollback:** point DNS back and start the old containers again. Anything written on the new
platform in between is lost. Keep the old hosts untouched for a week.

## After the move

- Merging into `main` still runs `.github/workflows/deploy.yml`, which updates the **old** web
  container on 1Panel. Replace that step with a deploy to the new platform, or disable it.
- Deploy new versions of the bot and the gateway from the same images, tagged with the commit SHA.

## Rehearsal (recommended)

You can test the whole move without stopping anything:

1. Run the export commands while the old applications keep running.
2. Before starting the copies, change their settings so they cannot touch the real ones:
   - In `bot.env`, set `SPOTBOT_RENTALS_ENABLED=false` and `SPOTBOT_LIVE_ORDERS_ENABLED=false`. The
     copy then cannot touch live rentals or buy servers.
   - In `web.env`, empty `SMTP_HOST` and `SPOTBOT_OPENNEXT_SMTP_HOST`. The copy then sends no email.
   - Point the copies at each other, not at the public names, which still reach the real
     applications:
     - `SPOTBOT_GATEWAY_WEBHOOK_URL` in `bot.env` goes to the copied gateway, `<gateway>/v1/gateway/events`;
     - `SPOTBOT_GATEWAY_BOT_URL` in `gateway.env` goes to the copied bot;
     - `SPOTBOT_OPENNEXT_BOT_URL` and `SPOTBOT_OPENNEXT_GATEWAY_URL` in `web.env` go to the copied
       bot and gateway.

     The gateway accepts an `http://` bot address only on loopback or on a name ending in `.svc`
     or `.svc.cluster.local`. Otherwise use `https://`.

3. Leave DNS alone.
4. Delete the copies' data before the real move.
