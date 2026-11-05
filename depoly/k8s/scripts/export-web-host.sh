#!/usr/bin/env bash
# Export the production web container (front-end, legacy API, adapter) into a private bundle:
#   web.env           the container's effective environment (docker inspect, raw values)
#   web-data.tar.gz   /app/.opennext-data: accounts, Credit, the adapter's SQLite database,
#                     encrypted KYB documents and pricing state
#   SHA256SUMS
# Run as root on the web host after stopping the container (docker cp reads a stopped
# container), so SQLite and the account files are consistent. Keep the bundle private.
#
#   sudo bash export-web-host.sh --out /root/opennext-migration/web-$(date -u +%Y%m%dT%H%M%SZ)
set -euo pipefail

WEB_CONTAINER=${WEB_CONTAINER:-opennext-homepage}
DATA_DIR=${DATA_DIR:-/app/.opennext-data}

out="" allow_running=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --allow-running) allow_running=1; shift ;; # Rehearsal only.
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "usage: $0 --out DIR [--allow-running]" >&2; exit 2; }
[ ! -e "$out" ] || { echo "$out already exists; choose a new directory" >&2; exit 1; }
if [ "$(docker inspect -f '{{.State.Running}}' "$WEB_CONTAINER")" = true ] && [ "$allow_running" != 1 ]; then
  echo "$WEB_CONTAINER is running; stop it first or pass --allow-running for a rehearsal" >&2
  exit 1
fi

umask 077
mkdir -p "$out"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$WEB_CONTAINER" | sed '/^$/d' > "$out/web.env"
# The archive's top directory is the data directory's own name; import.sh strips it.
docker cp "$WEB_CONTAINER:$DATA_DIR" - | gzip -6 > "$out/web-data.tar.gz"

(cd "$out" && sha256sum web.env web-data.tar.gz > SHA256SUMS)
echo "Web bundle written to $out:"
(cd "$out" && ls -l | sed 1d | awk '{print "  " $5 "\t" $9}')
