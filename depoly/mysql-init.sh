#!/bin/sh
# Called once by the official MySQL image on an empty production data directory.
set -eu
for value in "$BOT_DB_PASSWORD" "$GATEWAY_DB_PASSWORD" "$ADAPTER_DB_PASSWORD"; do
  case "$value" in *[!a-f0-9]*|'') echo 'Invalid generated database credential' >&2; exit 1;; esac
  test "${#value}" -eq 64
done
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
mysql --protocol=socket -uroot <<SQL
CREATE DATABASE opennext_prod_bot CHARACTER SET utf8mb4;
CREATE DATABASE opennext_prod_gateway CHARACTER SET utf8mb4;
CREATE DATABASE opennext_prod_adapter CHARACTER SET utf8mb4;
CREATE USER 'onx_bot'@'%' IDENTIFIED BY '$BOT_DB_PASSWORD';
CREATE USER 'onx_gateway'@'%' IDENTIFIED BY '$GATEWAY_DB_PASSWORD';
CREATE USER 'onx_adapter'@'%' IDENTIFIED BY '$ADAPTER_DB_PASSWORD';
GRANT ALL PRIVILEGES ON opennext_prod_bot.* TO 'onx_bot'@'%';
GRANT ALL PRIVILEGES ON opennext_prod_gateway.* TO 'onx_gateway'@'%';
GRANT ALL PRIVILEGES ON opennext_prod_adapter.* TO 'onx_adapter'@'%';
SQL
