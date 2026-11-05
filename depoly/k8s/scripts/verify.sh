#!/usr/bin/env bash
# Checks after a deploy or the cutover: pods, in-cluster calls, then the public names.
#   bash depoly/k8s/scripts/verify.sh [--public]
set -uo pipefail

NS=opennext
TERMINAL=${TERMINAL_HOST:-terminal.opennextlab.ai}
BOT_HOST=${BOT_HOST:-spotbot.test.vishwalab.com}
SSH_HOST=${SSH_HOST:-gpu-ssh.test.vishwalab.com}
SSH_PORT=${SSH_PORT:-22100}
failed=0
check() {
  local name=$1; shift
  if out=$("$@" 2>&1); then echo "ok    $name ${out:0:160}"; else echo "FAIL  $name ${out:0:300}"; failed=1; fi
}

kubectl -n "$NS" get pods -o wide
in_web() { kubectl -n "$NS" exec deploy/web -c web -- wget -qO- -T 15 "$1"; }
check "web status" in_web http://127.0.0.1:4188/api/pricing/status
check "web -> bot" in_web http://spotbot.opennext.svc:8000/health
check "web -> gateway (bot reachable)" sh -c "kubectl -n $NS exec deploy/web -c web -- wget -qO- -T 15 http://spotbot-gateway.opennext.svc:18084/health | grep '\"bot_reachable\":true'"

if [ "${1:-}" = --public ]; then
  check "public market" sh -c "curl -fsS -m 30 https://$TERMINAL/api/marketplace/public | python3 -c 'import json,sys; n=len(json.load(sys.stdin)[\"supplies\"]); print(n, \"offers\"); sys.exit(n == 0)'"
  check "public bot (GPU server callbacks)" curl -fsS -m 15 "https://$BOT_HOST/health"
  check "SSH entry point $SSH_HOST:$SSH_PORT" timeout 10 bash -c "exec 3<>/dev/tcp/$SSH_HOST/$SSH_PORT"
fi
exit $failed
