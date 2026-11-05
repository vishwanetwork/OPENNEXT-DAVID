#!/usr/bin/env bash
# Load the exported bundles into the cluster before the first start of the new services:
# namespace and web volume, Secrets, the Bot's AWS config, MySQL users and dumps, web data.
# Run from a checkout with kubectl pointed at the new cluster. Nothing is printed that holds
# a secret; private intermediate files live in a temporary 0700 directory removed on exit.
#
#   MYSQL_HOST=... MYSQL_ADMIN_USER=admin MYSQL_ADMIN_PASSWORD=... \
#     bash depoly/k8s/scripts/import.sh --bot-bundle DIR --web-bundle DIR
#
# Optional: MYSQL_PORT (3306), BOT_ROLE_ARN (the Bot's role in the default AWS account),
# AWS_IDENTITY (pod-identity or irsa), IRSA_ROLE_ARN (with irsa), WEB_DATA_DROP (keys to leave
# out of web-env, comma-separated).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
TOOL=(python3 "$HERE/../opennext_k8s.py")
NS=opennext
MYSQL_PORT=${MYSQL_PORT:-3306}
AWS_IDENTITY=${AWS_IDENTITY:-pod-identity}

bot="" web="" force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --bot-bundle) bot=$2; shift 2 ;;
    --web-bundle) web=$2; shift 2 ;;
    --force) force=1; shift ;; # Re-run over existing data (rehearsals only).
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$bot" ] && [ -n "$web" ] || { echo "usage: $0 --bot-bundle DIR --web-bundle DIR" >&2; exit 2; }
: "${MYSQL_HOST:?set MYSQL_HOST}" "${MYSQL_ADMIN_USER:?set MYSQL_ADMIN_USER}"
: "${MYSQL_ADMIN_PASSWORD:?set MYSQL_ADMIN_PASSWORD in the environment}"

echo "== Checking bundles"
checksums() { if command -v sha256sum >/dev/null; then sha256sum -c --quiet SHA256SUMS; else shasum -a 256 -c --quiet SHA256SUMS; fi; }
(cd "$bot" && checksums)
(cd "$web" && checksums)
if [ "$force" != 1 ] && kubectl -n "$NS" get deployment -o name 2>/dev/null | grep -q .; then
  echo "The workloads already exist. Import runs before their first start (or pass --force)." >&2
  exit 1
fi

private=$(mktemp -d)
cleanup() {
  rm -rf "$private"
  kubectl -n "$NS" delete pod migration-mysql migration-web --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl -n "$NS" delete secret migration-mysql-admin --ignore-not-found >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== Namespace and web volume"
"${TOOL[@]}" render --kinds Namespace,PersistentVolumeClaim | kubectl apply -f -

echo "== Secrets and the Bot's AWS config"
"${TOOL[@]}" mysql-setup --out "$private/mysql" --host "$MYSQL_HOST" --port "$MYSQL_PORT"
"${TOOL[@]}" env-secret --name spotbot-env "$bot/bot.env" "$private/mysql/bot-override.env" | kubectl apply -f -
"${TOOL[@]}" env-secret --name spotbot-gateway-env "$bot/gateway.env" "$private/mysql/gateway-override.env" | kubectl apply -f -
"${TOOL[@]}" env-secret --name web-env --drop "${WEB_DATA_DROP:-}" "$web/web.env" | kubectl apply -f -
"${TOOL[@]}" aws-config --source "$bot/aws-config" --identity "$AWS_IDENTITY" \
  ${BOT_ROLE_ARN:+--role-arn "$BOT_ROLE_ARN"} ${IRSA_ROLE_ARN:+--irsa-role-arn "$IRSA_ROLE_ARN"} > "$private/aws-config"
kubectl -n "$NS" create configmap spotbot-aws-config --from-file=config="$private/aws-config" \
  --dry-run=client -o yaml | kubectl apply -f -
printf 'MYSQL_HOST=%s\nMYSQL_TCP_PORT=%s\nMYSQL_ADMIN_USER=%s\nMYSQL_PWD=%s\n' \
  "$MYSQL_HOST" "$MYSQL_PORT" "$MYSQL_ADMIN_USER" "$MYSQL_ADMIN_PASSWORD" > "$private/admin.env"
"${TOOL[@]}" env-secret --name migration-mysql-admin "$private/admin.env" | kubectl apply -f -

echo "== Migration pods"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata: {name: migration-mysql, namespace: $NS}
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  containers:
    - name: mysql
      image: mysql:8.4
      command: [sleep, '7200']
      envFrom: [{secretRef: {name: migration-mysql-admin}}]
---
apiVersion: v1
kind: Pod
metadata: {name: migration-web, namespace: $NS}
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext: {runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, runAsNonRoot: true}
  containers:
    - name: restore
      image: debian:bookworm-slim
      command: [sleep, '7200']
      volumeMounts: [{name: data, mountPath: /data}]
  volumes:
    - name: data
      persistentVolumeClaim: {claimName: web-data}
EOF
kubectl -n "$NS" wait --for=condition=Ready pod/migration-mysql pod/migration-web --timeout=600s
# The password reaches mysql as MYSQL_PWD from the pod's Secret, never on a command line.
mysql_exec() {
  kubectl -n "$NS" exec -i migration-mysql -- sh -c \
    'exec mysql -h"$MYSQL_HOST" -P"$MYSQL_TCP_PORT" -u"$MYSQL_ADMIN_USER" --default-character-set=utf8mb4'
}

echo "== MySQL users and data"
mysql_exec < "$private/mysql/create-users.sql"
gunzip -c "$bot/bot.sql.gz" | mysql_exec
gunzip -c "$bot/gateway.sql.gz" | mysql_exec
echo "SELECT table_schema, COUNT(*) AS tables FROM information_schema.tables
  WHERE table_schema IN ('spot_order_bot', 'spot_order_gateway') GROUP BY table_schema;" | mysql_exec

echo "== Web data"
existing=$(kubectl -n "$NS" exec migration-web -- sh -c 'ls -A /data | grep -vx lost+found | head -1' || true)
if [ -n "$existing" ] && [ "$force" != 1 ]; then
  echo "The web volume already holds data; refusing to overwrite it (or pass --force)." >&2
  exit 1
fi
kubectl -n "$NS" exec -i migration-web -- tar -xzf - -C /data --strip-components=1 < "$web/web-data.tar.gz"
kubectl -n "$NS" exec migration-web -- sh -c 'du -sh /data; ls -A /data'

echo "Import complete. Next: bash depoly/k8s/scripts/deploy.sh <full commit SHA>"
