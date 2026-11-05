#!/usr/bin/env bash
# Export the Bot and gateway from the current Docker host into a private migration bundle:
#   bot.env, gateway.env    the containers' effective environment (docker inspect, raw values)
#   bot.sql.gz, gateway.sql.gz   consistent dumps of their MySQL databases
#   aws-config              the Bot's AWS profile chain (converted by import.sh)
#   SHA256SUMS
# Run as root on the Bot host after stopping both containers, so nothing changes during the
# dump. The bundle holds every Bot secret: keep it on encrypted, private storage only.
#
#   sudo bash export-bot-host.sh --out /root/opennext-migration/bot-$(date -u +%Y%m%dT%H%M%SZ)
set -euo pipefail

BOT_CONTAINER=${BOT_CONTAINER:-spot-order-bot}
GATEWAY_CONTAINER=${GATEWAY_CONTAINER:-spot-order-gateway}
MYSQL_CONTAINER=${MYSQL_CONTAINER:-1Panel-mysql-ej72}
BOT_DB=${BOT_DB:-spot_order_bot}
GATEWAY_DB=${GATEWAY_DB:-spot_order_gateway}
# Default: whatever file the Bot container mounts as its AWS config, in either host layout.
AWS_CONFIG=${AWS_CONFIG:-}

out="" allow_running=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --allow-running) allow_running=1; shift ;; # Rehearsal only: the dump is not a cutover copy.
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "usage: $0 --out DIR [--allow-running]" >&2; exit 2; }
[ ! -e "$out" ] || { echo "$out already exists; choose a new directory" >&2; exit 1; }

for c in "$BOT_CONTAINER" "$GATEWAY_CONTAINER"; do
  state=$(docker inspect -f '{{.State.Running}}' "$c")
  if [ "$state" = true ] && [ "$allow_running" != 1 ]; then
    echo "$c is running; stop it first (docker stop $c) or pass --allow-running for a rehearsal" >&2
    exit 1
  fi
done

if [ -z "$AWS_CONFIG" ]; then
  AWS_CONFIG=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/aws/config"}}{{.Source}}{{end}}{{end}}' "$BOT_CONTAINER")
fi
[ -f "$AWS_CONFIG" ] || { echo "no AWS config found for $BOT_CONTAINER; set AWS_CONFIG" >&2; exit 1; }

umask 077
mkdir -p "$out"
env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed '/^$/d'; }
env_of "$BOT_CONTAINER" > "$out/bot.env"
env_of "$GATEWAY_CONTAINER" > "$out/gateway.env"
cp "$AWS_CONFIG" "$out/aws-config"

dump() {
  # The root password stays inside the MySQL container (MYSQL_PWD, never on a command line).
  docker exec "$MYSQL_CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot \
    --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF \
    --default-character-set=utf8mb4 --databases "$0"' "$1" | gzip -6 > "$out/$2"
}
dump "$BOT_DB" bot.sql.gz
dump "$GATEWAY_DB" gateway.sql.gz

(cd "$out" && sha256sum bot.env gateway.env aws-config bot.sql.gz gateway.sql.gz > SHA256SUMS)
echo "Bot bundle written to $out:"
(cd "$out" && ls -l | sed 1d | awk '{print "  " $5 "\t" $9}')
