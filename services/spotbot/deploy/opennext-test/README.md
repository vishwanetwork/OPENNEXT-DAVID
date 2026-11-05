# OpenNEXT test site

One OpenNEXT container from this repository, built with the bundled SpotOrderBot
adapter and ClamAV (`SPOTBOT_SOURCE=local`, run with `OPENNEXT_ADAPTER=1`, as production would),
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

Deploy from a checkout of this repository on the operator machine:

```sh
bash depoly/bot-host/deploy.sh <commit> test-web
```

It builds `opennext-test-web:<commit>` on the host with `SPOTBOT_SOURCE=local` and the three
test hosts, copies `compose.yaml` and `start-test.cjs` from this directory to
`/opt/opennext-test`, and restarts the site. See `depoly/bot-host/README.md`.

`start-test.cjs` enables email-code sign-in through Mailpit for this site only (production
uses OAuth), then runs the image's own `docker/start.cjs`. The adapter keeps its own SQLite
database in the `web-data` volume, so the
Console's Instances page, which reads the bot database, stays empty here. Purchases are real:
each Buy Now orders an AWS Spot server through the staging bot.
