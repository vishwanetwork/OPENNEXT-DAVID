# Single-host deployment

Use `compose.production.yaml` on a Linux host with an existing MySQL server and an HTTPS reverse proxy. The application listens on `127.0.0.1:18082`. Host networking lets the container reach host-local MySQL at `127.0.0.1:3306`; the application port must remain bound to loopback.

Create a dedicated database and user. Grant the user privileges only on the application database. When MySQL itself runs in a container with a published port, match the database user's host restriction to the source address MySQL observes after Docker forwarding.

Create a `.env` file with mode `600` in the deployment directory. Copy provider credentials securely outside Git and configure:

```dotenv
SPOTBOT_STORAGE_BACKEND=mysql
SPOTBOT_MYSQL_URL=mysql+pymysql://spotbot:URL_ENCODED_PASSWORD@127.0.0.1:3306/spot_order_bot?charset=utf8mb4
SPOTBOT_API_KEY=GENERATED_SERVICE_TOKEN
SPOTBOT_LIVE_ORDERS_ENABLED=false
SPOTBOT_ENABLED_PROVIDERS=lambda,vultr,shadeform
```

The storage adapter creates its own tables in the existing database. Switching from SQLite does not migrate historical records. Keep live ordering disabled until paid procurement has been validated and the upstream scheduler is configured.

```sh
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps
```

Configure a separate reverse proxy virtual host with a certificate covering the selected domain. Redirect HTTP to HTTPS and forward HTTPS requests to `http://127.0.0.1:18082`, preserving `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`. Validate the proxy configuration before reloading it.

`/health` and `/docs` are public. All `/v1` endpoints require `Authorization: Bearer <SPOTBOT_API_KEY>`. Check public health, an unauthorized request returning HTTP 401, and authenticated catalog queries. Confirm fresh snapshots exist in MySQL and survive a service restart.

For updates, retain the old source release and image, build the new image, and recreate only the SpotOrderBot container. Never run two workers against the same database. A previous image can be restored if its storage schema remains compatible. Back up MySQL independently of container releases.

Inspect logs with `docker logs --tail 100 spot-order-bot`; Docker rotates them automatically. Do not print `.env` or connection strings into logs. Maintain DNS, certificate renewal, database backups, disk capacity, and monitoring through the host's existing operational tooling.
