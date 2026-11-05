# Bundled SpotOrderBot adapter

The Terminal's Spot purchases, Credit charges, instance SSH keys, END, usage and billing, Buyer
KYB, bank transfers, payment review and order notices are served by the SpotOrderBot adapter
(`spotbot opennext-api`, in `services/spotbot`). It sits in front of the
legacy API: it answers those routes and passes every other request through unchanged.

Instead of a separate service, the OpenNEXT image can carry it. Built with
`SPOTBOT_SOURCE=local`, the image installs the spotbot package from `services/spotbot` in the
same commit, and ClamAV. With
`OPENNEXT_ADAPTER=1`, `docker/start.cjs` runs these processes, all on loopback:

| Process    | Address                         |
| ---------- | ------------------------------- |
| legacy API | `127.0.0.1:4189`                |
| ClamAV     | `127.0.0.1:3310`                |
| adapter    | `127.0.0.1:4191`                |
| front-end  | `:4188`, pointed at the adapter |

The adapter's database (SQLite), the encrypted KYB documents and the ClamAV signatures live in
the data volume (`/app/.opennext-data/spotbot`, `/app/.opennext-data/clamav`). Without
`OPENNEXT_ADAPTER=1` the container behaves exactly as before.

## Enabling it in production

Production builds (`.github/workflows/deploy.yml`) always use `SPOTBOT_SOURCE=local`, so the
adapter ships with the front-end from the same commit. The repository variables
`SPOTBOT_SOURCE` and `SPOTBOT_IMAGE` are no longer read. `SPOTBOT_SOURCE=image` still builds
from a pinned `ghcr.io/vishwanetwork/spot-order-bot` image, for the `depoly/` kit only.

The adapter must still be switched on in the container:

1. Add these variables to the `opennext-homepage` container (1Panel → Containers → edit), then
   restart it:

   | Variable                                                             | Value                                                  |
   | -------------------------------------------------------------------- | ------------------------------------------------------ |
   | `OPENNEXT_ADAPTER`                                                   | `1`                                                    |
   | `SPOTBOT_API_KEY`                                                    | the bot API key                                        |
   | `SPOTBOT_OPENNEXT_BOT_URL`                                           | the bot API, e.g. `https://spotbot.test.vishwalab.com` |
   | `SPOTBOT_OPENNEXT_GATEWAY_URL`, `SPOTBOT_OPENNEXT_GATEWAY_TOKEN`     | the gateway API and its API key (SSH entry points)     |
   | `SPOTBOT_OPENNEXT_FILES_KEY`                                         | base64 of 32 random bytes: `openssl rand -base64 32`   |
   | `SPOTBOT_OPENNEXT_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM` | the same account as `SMTP_*`                           |
   | `SPOTBOT_OPENNEXT_PUBLIC_URL`                                        | `https://terminal.opennextlab.ai`                      |

   Keep a copy of `SPOTBOT_OPENNEXT_FILES_KEY` outside the server: without it, the stored KYB
   documents cannot be read.

2. Check the result:
   - `https://terminal.opennextlab.ai/api/marketplace/public` lists rows with `"sourceType":"spotbot"`.
   - `/api/buyer-kyb/me` answers 401 when signed out, instead of 404.
   - The container log shows `Uvicorn running on http://127.0.0.1:4191` and `clamd` self-checking.

Resources: about 1 GB more memory, mostly ClamAV's signatures, and about 300 MB more image.
`OPENNEXT_CLAMAV=0` turns ClamAV off, and KYB uploads are then refused.

Rollback: set `OPENNEXT_ADAPTER=0` (or remove it) and restart. The site returns to the legacy
API alone; the adapter's data stays in the volume.

Test site: the same image runs on the bot test host (`opennext-terminal.test.vishwalab.com`,
files in `services/spotbot/deploy/opennext-test/`, deployed with `depoly/bot-host/deploy.sh`). It uses email-code sign-in and a Mailpit
inbox.
