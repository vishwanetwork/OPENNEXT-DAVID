#!/usr/bin/env bash
# Deploy a commit of this repository to the bot host, the Docker Compose way it runs today.
# Run it from a checkout on the operator machine:
#
#   bash depoly/bot-host/deploy.sh <commit> <service>...   build and switch to the commit
#   bash depoly/bot-host/deploy.sh <commit>                 only upload it (for adopt.py)
#   bash depoly/bot-host/deploy.sh --rollback <service>     back to the previous image
#   bash depoly/bot-host/deploy.sh --restart <service>      re-read settings, same image
#
# Services: spotbot (core Bot), gateway (rental gateway), test-web (OpenNEXT test site).
# The commit must be on origin/main unless --allow-unmerged is given. The host builds the
# images from the commit's source (`git archive`), so it needs no registry login.
#
# Options:
#   --ssh "<command>"   how to reach the host with sudo rights
#                       (default: $BOT_HOST_SSH, or "ssh admin@44.248.155.24")
#   --allow-unmerged    deploy a commit that is not on origin/main (test only)
set -euo pipefail

SSH=${BOT_HOST_SSH:-ssh admin@44.248.155.24}
HOME_DIR=/opt/spot-order-bot
mode="" allow_unmerged=0
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ssh) SSH=$2; shift 2 ;;
    --rollback | --restart) mode=${1#--}; shift ;;
    --allow-unmerged) allow_unmerged=1; shift ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) args+=("$1"); shift ;;
  esac
done

valid_service() { case $1 in spotbot | gateway | test-web) return 0 ;; *) return 1 ;; esac; }
remote() { $SSH "$@"; }

if [ -n "$mode" ]; then
  [ ${#args[@]} = 1 ] && valid_service "${args[0]}" ||
    { echo "usage: $0 --$mode spotbot|gateway|test-web" >&2; exit 2; }
  svc=${args[0]}
  remote "sudo bash -c 'set -e; f=$HOME_DIR/state/$svc.env; test -f \$f || { echo no release recorded for $svc >&2; exit 1; }; dir=\$(sed -n s/^RELEASE_DIR=//p \$f); exec bash \$dir/depoly/bot-host/release.sh --$mode $svc'"
  exit 0
fi

[ ${#args[@]} -ge 1 ] || { echo "usage: $0 <commit> [spotbot|gateway|test-web...]" >&2; exit 2; }
ref=${args[0]}
services=("${args[@]:1}")
for svc in ${services[@]+"${services[@]}"}; do
  valid_service "$svc" || { echo "unknown service: $svc" >&2; exit 2; }
done

cd "$(git rev-parse --show-toplevel)"
sha=$(git rev-parse --verify "$ref^{commit}")
tag=${sha:0:12}
git fetch -q origin main
if ! git merge-base --is-ancestor "$sha" origin/main; then
  [ "$allow_unmerged" = 1 ] || { echo "$sha is not on origin/main; pass --allow-unmerged for a test deploy" >&2; exit 1; }
  echo "warning: $sha is not on origin/main" >&2
fi

echo "== upload $tag ($(git log -1 --format=%s "$sha"))"
git archive --format=tar.gz "$sha" | remote "sudo bash -c 'set -e; d=$HOME_DIR/releases/$tag; if [ -d \$d ]; then cat > /dev/null; echo already on the host; else rm -rf \$d.part; mkdir -p \$d.part; tar -xzf - -C \$d.part; mv \$d.part \$d; echo unpacked into \$d; fi'"

[ ${#services[@]} -gt 0 ] || { echo "uploaded only: $HOME_DIR/releases/$tag"; exit 0; }
for svc in ${services[@]+"${services[@]}"}; do
  echo "== release $svc"
  remote "sudo bash $HOME_DIR/releases/$tag/depoly/bot-host/release.sh $tag $svc"
done
