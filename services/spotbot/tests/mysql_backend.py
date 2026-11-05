"""Opt-in pytest plugin: every SQLite `Store` a test creates becomes a fresh MySQL database.

The adapter suites build their stores with `spotbot.storage.sqlite.Store`. Loaded with
`-p tests.mysql_backend` and `SPOTBOT_TEST_MYSQL_URL` set, they run unchanged against MySQL, the
backend production uses. Only databases created here are dropped; nothing else is touched.
"""

import atexit
import os
from uuid import uuid4

import sqlalchemy as sa

import spotbot.storage.sqlite as sqlite_storage
from spotbot.storage.mysql import MySQLStore

_URL = sa.engine.make_url(os.environ["SPOTBOT_TEST_MYSQL_URL"])
_ADMIN = sa.create_engine(_URL.set(database=None), hide_parameters=True)
_CREATED = []


class MySQLTestStore(MySQLStore):
    def __init__(self, *_args, **_kwargs):
        name = "spotbot_test_" + uuid4().hex
        with _ADMIN.begin() as c:
            c.exec_driver_sql(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4")
        _CREATED.append(name)
        super().__init__(_URL.set(database=name).render_as_string(hide_password=False))


sqlite_storage.Store = MySQLTestStore


@atexit.register
def _drop_created_databases():
    with _ADMIN.begin() as c:
        for name in _CREATED:
            c.exec_driver_sql(f"DROP DATABASE IF EXISTS `{name}`")
    _ADMIN.dispose()
