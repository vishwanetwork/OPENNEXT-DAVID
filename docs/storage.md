# Storage Backends

The same API and order lifecycle support SQLite, MySQL, and Amazon DynamoDB. Select one backend with `SPOTBOT_STORAGE_BACKEND`. Switching backends selects a different data store; it does not migrate existing records. Stop the service before switching, and preserve the old store for any required migration. Existing SQLite files remain compatible.

## SQLite

```dotenv
SPOTBOT_STORAGE_BACKEND=sqlite
SPOTBOT_DATABASE_PATH=data/spotbot.sqlite3
```

SQLite is the default and needs no additional packages. Snapshots, order state, and events use the existing schema. Atomic writes and file locks coordinate one local process. Database permissions are restricted; startup scripts can contain sensitive data.

## MySQL

Install the optional adapter:

```sh
python -m pip install -e '.[mysql]'
```

Configure an existing database and its application credentials:

```dotenv
SPOTBOT_STORAGE_BACKEND=mysql
SPOTBOT_MYSQL_URL=mysql+pymysql://spotbot:replace-password@127.0.0.1:3306/spotbot?charset=utf8mb4
```

URL-encode special characters in usernames and passwords. Keep the URL in the ignored `.env`, not in source control. The application creates missing tables in the configured database; it does not create the database itself. The account needs appropriate schema setup and runtime access. Use vendor-recommended TLS configuration for remote connections.

The adapter uses InnoDB transactions, binary string comparisons, a unique idempotency constraint, and row locks for conditional order transitions. Orders and outbox events commit together. Catalog batches commit atomically. `GET_LOCK` holds a database-scoped singleton worker lock on a dedicated connection; a second process is rejected. A lost lock prevents subsequent resource operations. MySQL releases the advisory lock when its owning connection ends.

## DynamoDB

Install the optional adapter:

```sh
python -m pip install -e '.[dynamodb]'
```

For AWS:

```dotenv
SPOTBOT_STORAGE_BACKEND=dynamodb
SPOTBOT_DYNAMODB_TABLE=SpotOrderBot
SPOTBOT_DYNAMODB_REGION=us-east-1
SPOTBOT_DYNAMODB_ENDPOINT_URL=
SPOTBOT_DYNAMODB_CREATE_TABLE=false
```

Use the AWS SDK credential chain: an IAM role, a shared credentials/profile configuration, or credentials exported into the process environment. The application's `.env` does not export arbitrary AWS SDK variables into the process environment. Do not commit AWS access keys.

The table must have string partition key `pk` and string sort key `sk`. No secondary indexes are required. Provision it separately for production. Setting `SPOTBOT_DYNAMODB_CREATE_TABLE=true` explicitly permits the application to create a missing on-demand table. Table creation remains off by default. Restrict item read/write and conditional transaction permissions to the selected table; allow table creation only when required.

The adapter uses strongly consistent base-table reads. Catalog snapshots are written in batches of at most 25 items; only after all writes succeed does a transaction publish the collection marker and current-catalog pointer. Partial or unprocessed batches remain invisible to latest and history APIs. Order creation atomically writes its idempotency record, order, and initial event. Revision conditions protect state transitions, and event delivery updates both outbox and per-order views atomically.

Partitions:

| Partition | Stored records |
|---|---|
| `PROVIDER#<name>` | Latest collection status and successful catalog pointer |
| `COLLECTION#<name>` | Committed collection markers |
| `PRICE#<name>` | Timestamp-ordered price snapshots |
| `ORDERS` | Orders with version conditions |
| `IDEMP#<hash>` | Business-key lookup |
| `EVENT#<order_id>` | Per-order events |
| `OUTBOX` | Delivery state |
| `EVENTID#<event_id>` | Event lookup |
| `WORKER` / `LOCK` | Singleton worker ownership |

The worker lock is deliberately persistent, with no TTL or automatic takeover. Graceful shutdown removes its own lock. After an unclean crash, first verify that the owning process is stopped, then remove the stale `pk=WORKER, sk=LOCK` item before restarting. Automatic takeover could replay a billable request whose outcome is unknown. Transactions check lock ownership, and uncertain creation markers are reconciled on startup.

The compatible `limit/offset` and total-count history API reads relevant provider partitions and applies filters in the adapter. It handles DynamoDB response pagination, including responses larger than 1 MB, but long histories can consume substantial read capacity. Add access-pattern-specific indexes and cursor APIs before operating at large scale. Unpublished partial batches and historical snapshots currently have no automatic cleanup. Snapshot IDs are opaque and may differ in type between backends.

## Local compatibility testing

Install test and adapter dependencies:

```sh
python -m pip install -e '.[dev,mysql,dynamodb]'
pytest -q
```

Default tests cover SQLite and the Moto DynamoDB emulator. To include real MySQL and AWS DynamoDB Local:

```sh
export SPOTBOT_TEST_MYSQL_URL='mysql+pymysql://root:local-test-only@127.0.0.1:13306'
export SPOTBOT_TEST_DYNAMODB_ENDPOINT='http://127.0.0.1:18000'
pytest -q
```

The MySQL account needs permission to create and drop randomly named `spotbot_test_*` databases. Tests do not drop existing databases. DynamoDB Local tests use dummy credentials and temporary tables; remote AWS endpoints are rejected by the test fixture. GitHub Actions runs the contract tests against MySQL 8.4 and DynamoDB Local as well as unit checks on Python 3.11 and 3.12.

Shared contract tests cover committed snapshots, failed and empty collection behavior, time filters, pagination, case-sensitive idempotency, concurrent creation and claims, state/event consistency, recovery, singleton ownership, and the service's procurement/release flow. Additional checks cover SQL rollback, interrupted DynamoDB bulk writes, lock loss, and large catalogs.
