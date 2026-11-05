# Handover: moving OpenNEXT to the new platform

OpenNEXT is three applications, all built from this repository. Deploy all three on the new
platform under new domain names for the bot and the gateway. All three start with empty storage. The AWS
accounts that supply GPUs do not change: `860165147463` and the B300 account `413287184831`.

## The three applications

| Application | Image                                          | Command                                       | Port                                           | Health check              |
| ----------- | ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------------------- |
| **web**     | `ghcr.io/vishwanetwork/opennext-web:<sha>`     | image default                                 | 4188                                           | `GET /api/pricing/status` |
| **bot**     | `ghcr.io/vishwanetwork/opennext-spotbot:<sha>` | `spotbot serve --host 0.0.0.0 --port 8000`    | 8000                                           | `GET /health`             |
| **gateway** | `ghcr.io/vishwanetwork/opennext-spotbot:<sha>` | `spotbot gateway --host 0.0.0.0 --port 18084` | 18084, plus TCP `22100-22199` for customer SSH | `GET /health` on 18084    |

`.github/workflows/images.yml` publishes both images for every commit on `main`, tagged with the
commit SHA. Deploy all three from the same commit. The web needs a commit that includes the MySQL
fix for KYB case ids (pull request #34) to run its adapter on MySQL.

| Application | Data                                                                                                                                                                                                          | Runs as   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| web         | MySQL database `spot_order_adapter`: the adapter's records and the legacy API's documents (accounts, Credit top-ups, marketplace, leads). A persistent volume at `/app/.opennext-data` for the KYB files only | uid 1000  |
| bot         | MySQL database `spot_order_bot`                                                                                                                                                                               | uid 10001 |
| gateway     | MySQL database `spot_order_gateway`                                                                                                                                                                           | uid 10002 |

**Rules**

- Run **one copy of each application**, never two. Each is the only writer of its data. Stop the
  old copy before starting the new one.
- The **gateway** needs a public IP where TCP ports `22100-22199` are open to the internet. Each
  rental gets one of these ports for SSH.
- The **bot and the gateway** must reach the internet from **one fixed IP**. GPU servers only accept
  SSH (22) and port 8000 from an allow-listed address.

`bot-host/compose.bot.yaml` and `bot-host/compose.gateway.yaml` show exactly how the bot and the
gateway run today.

## Domain names

The web keeps `opennextlab.ai`, `terminal.opennextlab.ai` and `admin.opennextlab.ai`. The
`*.test.vishwalab.com` names are retired. Choose new names for the other four roles:

| Role            | Today                            | New (your choice)    | DNS and routing                                                                                                                    |
| --------------- | -------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Bot API         | `spotbot.test.vishwalab.com`     | `<bot-host>`         | HTTPS to the bot, port 8000                                                                                                        |
| Gateway API     | `gpu-gateway.test.vishwalab.com` | `<gateway-host>`     | HTTPS to the gateway, port 18084                                                                                                   |
| Model endpoints | `r-*.test.vishwalab.com`         | `r-*.<model-domain>` | Wildcard DNS and a wildcard certificate, HTTPS to the gateway on 18084. Read timeout 650 s, no response buffering, body up to 1 GB |
| Customer SSH    | `gpu-ssh.test.vishwalab.com`     | `<ssh-host>`         | An A record for the gateway's public IP. DNS only, no HTTP                                                                         |

**GPU servers keep the bot address they were started with.** A server started before the move
keeps calling the old name, so **no rental may be running at the move**. Every server started
afterwards uses the new name.

## Settings

Each application's settings are environment variables. Take them from the running containers on
moving day (see below), and use them as they are, with these changes.

**Databases**

| Application | Variable                    | New value                                                                                |
| ----------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| bot         | `SPOTBOT_MYSQL_URL`         | `mysql+pymysql://<user>:<password>@<mysql-host>:3306/spot_order_bot?charset=utf8mb4`     |
| gateway     | `SPOTBOT_GATEWAY_MYSQL_URL` | `mysql+pymysql://<user>:<password>@<mysql-host>:3306/spot_order_gateway?charset=utf8mb4` |
| web         | `SPOTBOT_STORAGE_BACKEND`   | `mysql`. The adapter and the legacy API then both keep their data in `SPOTBOT_MYSQL_URL` |
| web         | `SPOTBOT_MYSQL_URL`         | `mysql+pymysql://<user>:<password>@<mysql-host>:3306/spot_order_adapter?charset=utf8mb4` |

**Domain names**

| Application | Variable                             | New value                                         |
| ----------- | ------------------------------------ | ------------------------------------------------- |
| bot         | `SPOTBOT_RENTAL_PUBLIC_URL`          | `https://<bot-host>`, public: GPU servers call it |
| bot         | `SPOTBOT_GATEWAY_WEBHOOK_URL`        | `https://<gateway-host>/v1/gateway/events`        |
| gateway     | `SPOTBOT_GATEWAY_BOT_URL`            | `https://<bot-host>`                              |
| gateway     | `SPOTBOT_GATEWAY_PUBLIC_SSH_HOST`    | `<ssh-host>`                                      |
| gateway     | `SPOTBOT_GATEWAY_PUBLIC_HTTP_DOMAIN` | `<model-domain>`                                  |
| web         | `SPOTBOT_OPENNEXT_BOT_URL`           | `https://<bot-host>`                              |
| web         | `OPENNEXT_SPOTBOT_URL`               | `https://<bot-host>`, HTTPS only                  |
| web         | `SPOTBOT_OPENNEXT_GATEWAY_URL`       | `https://<gateway-host>`                          |

The applications may reach each other on the private network instead: every URL above except
`SPOTBOT_RENTAL_PUBLIC_URL` and `OPENNEXT_SPOTBOT_URL`. The gateway accepts `http://` for the
bot only on loopback, or on a name ending in `.svc` or `.svc.cluster.local`.

**AWS access (bot)**

- The bot must call AWS as the role `arn:aws:iam::860165147463:role/SpotOrderBotEC2Role`. Give the
  bot credentials for that role as its default AWS profile.
- Mount the AWS config file read-only at `/app/aws/config`, and set `AWS_CONFIG_FILE=/app/aws/config`.
- In that file, the `spotbot-b300` profile says `credential_source = Ec2InstanceMetadata`. Replace
  that line with `source_profile = default`.

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

**Nothing.** All three applications start with empty storage. The bot and the gateway create their
tables in MySQL, and so does the web. The web's volume only receives the KYB files buyers upload.

This is safe because, at the time of the move:

- no rental is running (checked on moving day, below);
- no buyer has passed KYB, nobody holds Credit, and no bank transfer is pending. Check Buyer KYB,
  Credit and Payment review in the Console before the move.

Users sign in again, and their accounts are created anew. Enter the Console settings again.

Keep archives of the old data anyway; moving day below writes them. Today the web keeps its data
in JSON files and SQLite on the old volume; that archive is for reference only.

## Moving day (about 30 minutes)

The old hosts are the web host `18.188.54.73` (root) and the bot host `44.248.155.24` (user
`admin`, with sudo).

**Before the day:**

- Set up DNS and certificates for the new names.
- Make the AWS changes.
- Lower the DNS TTL of the `opennextlab.ai` names to 60 s.

1. **Stop the web** (`docker stop opennext-homepage` on the web host). No new orders can start.
2. **Check that no rental is running.** Each of these must print nothing. Use account
   `860165147463` in `us-west-2`, `us-east-1` and `us-east-2`, and account `413287184831` in
   `us-west-2`:

   ```sh
   aws ec2 describe-instances --region <region> --filters Name=instance-lifecycle,Values=spot \
     Name=instance-state-name,Values=pending,running --query 'Reservations[].Instances[].InstanceId' --output text
   ```

   If one is still running, wait until it ends.

3. **Stop the bot and the gateway** (`docker stop spot-order-bot spot-order-gateway` on the bot host).
4. **Export.** Run as root:

   ```sh
   # Web host: settings, and an archive of the data
   docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' opennext-homepage > web.env
   docker cp opennext-homepage:/app/.opennext-data - | gzip > web-data.tar.gz

   # Bot host: settings, AWS config, and an archive of both databases without the price history
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

   - The archive is about 25 MB instead of 5 GB. The bot collects prices again by itself.
   - The env files also contain the image's own variables (`PATH`, `HOME`, `LANG`, `HOSTNAME`,
     `PYTHON_*`, `NODE_VERSION`, `YARN_VERSION`, `GPG_KEY`). Drop them.
   - Apply the changes listed under [Settings](#settings).
   - These files hold every secret. Copy them over SSH only. Never commit them or paste them
     anywhere.

5. **Prepare the data.**
   - In the new MySQL, create the empty databases `spot_order_bot`, `spot_order_gateway` and
     `spot_order_adapter`. Create one user for each, limited to its own database. The applications
     create their tables when they start.
   - Give the web an empty volume at `/app/.opennext-data`, writable by uid 1000. It holds the KYB files;
     the price caches and virus signatures there are rebuilt after a restart.
6. **Start** web, bot and gateway on the new platform, and check that each health endpoint answers.
   On the gateway, `/health` also shows `"bot_reachable": true`.
7. **Point the `opennextlab.ai` names at the new web.** Then check:
   - sign in on `terminal.opennextlab.ai`;
   - the market lists offers. The bot needs a few minutes to collect prices after starting empty.

   A full check rents the cheapest server, connects to it over SSH through `<ssh-host>`, and
   releases it. This is a real purchase.

**Rollback:** point the `opennextlab.ai` names back and start the old containers. Anything written
on the new platform in between is lost. Keep the old hosts untouched for a week.

## After the move

- Merging into `main` still runs `.github/workflows/deploy.yml`, which updates the **old** web
  container on 1Panel. Replace that step with a deploy to the new platform, or disable it.
- Deploy new versions of the bot and the gateway from the same images, tagged with the commit SHA.
- After a week, retire the old hosts and the `*.test.vishwalab.com` names, and remove
  `44.248.155.24` from the GPU security groups.

## Rehearsal (recommended)

The new names make a rehearsal easy: until the move, they only reach the new platform.

1. Run the export commands while the old applications keep running.
2. Before starting the copies, change their settings so they cannot touch real customers:
   - In `bot.env`, set `SPOTBOT_RENTALS_ENABLED=false` and `SPOTBOT_LIVE_ORDERS_ENABLED=false`. The
     copy then cannot buy servers or consume the AWS interruption queues the live bot reads.
   - In `web.env`, empty `SMTP_HOST` and `SPOTBOT_OPENNEXT_SMTP_HOST`. The copy then sends no email.
3. Check the bot and the gateway on their new names, and the web on its health endpoint. Leave the
   `opennextlab.ai` names alone.
4. Delete the copies' data before the real move.
