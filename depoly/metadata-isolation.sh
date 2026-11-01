#!/usr/bin/env bash
# Run on the Linux Docker host after Docker creates DOCKER-USER. Requires root.
# This bridge deployment uses explicit Bot-only AWS credentials, not host instance-role access.
set -euo pipefail
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PRIVATE_DIR="${1:-$DEPLOY_DIR/private}"
CIDR="$(python3 - "$DEPLOY_DIR" "$PRIVATE_DIR" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from config import load
print(load(sys.argv[2])['network_cidr'])
PY
)"
test "$(id -u)" -eq 0 || { echo 'Run metadata isolation as root.' >&2; exit 1; }
iptables -N DOCKER-USER 2>/dev/null || true
iptables -nL DOCKER-USER >/dev/null
if ! iptables -C DOCKER-USER -s "$CIDR" -d 169.254.169.254/32 -m comment --comment opennext-production-imds -j REJECT 2>/dev/null; then
  iptables -I DOCKER-USER 1 -s "$CIDR" -d 169.254.169.254/32 -m comment --comment opennext-production-imds -j REJECT
fi
echo 'Installed the production bridge IMDS deny rule. IPv6 is disabled on this bridge.'
echo 'Persist this rule with the host firewall and verify it again after reboot.'
