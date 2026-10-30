# OpenNEXT test site

The OpenNEXT web app from `vishwanetwork/OPENNEXT-DAVID` (`feat/rental-instances`), the
SpotOrderBot adapter, ClamAV and Mailpit, on the bot test host, against the staging bot.

| URL | What |
| --- | --- |
| https://opennext.test.vishwalab.com | Public site |
| https://opennext-terminal.test.vishwalab.com | Terminal (sign in with any email; the code arrives in Mailpit) |
| https://opennext-admin.test.vishwalab.com | Operations Console (administrator token) |
| https://opennext-mail.test.vishwalab.com | Mailpit inbox: sign-in codes and every notice |

Secrets live only on the host, in `/opt/opennext-test/{web,adapter,mailpit}.env` (mode 600):
the administrator token (`OPENNEXT_ADMIN_TOKEN` in `web.env`) and the Mailpit login
(`MP_UI_AUTH` in `mailpit.env`, `user:password`).

Deploy: build `opennext-test-web:<sha>` from the web repository with the three test hosts as
build arguments, and `spot-order-bot:<sha>` from this repository, then

```sh
cd /opt/opennext-test && sudo WEB_RELEASE=<sha> BOT_RELEASE=<sha> docker compose up -d
```

`start-test.cjs` enables email-code sign-in through Mailpit for this site only; production
uses OAuth. The adapter keeps its own SQLite database (`adapter-data` volume), so the
Console's Instances page, which reads the bot database, stays empty here. Purchases are real:
each Buy Now orders an AWS Spot server through the staging bot.
