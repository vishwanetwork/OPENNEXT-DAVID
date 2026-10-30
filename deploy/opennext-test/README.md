# OpenNEXT test site

One OpenNEXT container from `vishwanetwork/OPENNEXT-DAVID`, built with the bundled SpotOrderBot
adapter and ClamAV (`SPOTBOT_SOURCE=image`, run with `OPENNEXT_ADAPTER=1`, as production would),
plus Mailpit, on the bot test host, against the staging bot.

| URL | What |
| --- | --- |
| https://opennext.test.vishwalab.com | Public site |
| https://opennext-terminal.test.vishwalab.com | Terminal (sign in with any email; the code arrives in Mailpit) |
| https://opennext-admin.test.vishwalab.com | Operations Console (administrator token) |
| https://opennext-mail.test.vishwalab.com | Mailpit inbox: sign-in codes and every notice |

Secrets live only on the host, in `/opt/opennext-test/{web,adapter,mailpit}.env` (mode 600):
the administrator token (`OPENNEXT_ADMIN_TOKEN` in `web.env`) and the Mailpit login
(`MP_UI_AUTH` in `mailpit.env`, `user:password`).

Deploy: build `spot-order-bot:<sha>` from this repository, then `opennext-test-web:<sha>` from
the web repository with `SPOTBOT_SOURCE=image`, `SPOTBOT_IMAGE=spot-order-bot:<sha>` and the
three test hosts as build arguments, then

```sh
cd /opt/opennext-test && sudo WEB_RELEASE=<sha> docker compose up -d --remove-orphans
```

`start-test.cjs` enables email-code sign-in through Mailpit for this site only (production
uses OAuth), then runs the image's own `docker/start.cjs`. The adapter keeps its own SQLite
database in the `web-data` volume, so the
Console's Instances page, which reads the bot database, stays empty here. Purchases are real:
each Buy Now orders an AWS Spot server through the staging bot.
