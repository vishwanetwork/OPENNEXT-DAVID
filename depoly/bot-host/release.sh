#!/usr/bin/env bash
# Runs on the bot host as root, from a release that deploy.sh unpacked into
# $SPOTBOT_HOME/releases/<tag> (the first 12 characters of the commit):
#
#   release.sh <tag> spotbot|gateway|test-web    build, check, switch, wait until healthy
#   release.sh --rollback spotbot|gateway|test-web    go back to the image that ran before
#   release.sh --restart spotbot|gateway|test-web     same image, re-read the settings
#
# A release that is not healthy in time is rolled back to the previous image at once.
# $SPOTBOT_HOME/state/<service>.env records the running and previous images.
set -euo pipefail

HOME_DIR=${SPOTBOT_HOME:-/opt/spot-order-bot}
TEST_DIR=${OPENNEXT_TEST_DIR:-/opt/opennext-test}
TEST_SITE_HOST=${TEST_SITE_HOST:-opennext.test.vishwalab.com}
TEST_TERMINAL_HOST=${TEST_TERMINAL_HOST:-opennext-terminal.test.vishwalab.com}
TEST_ADMIN_HOST=${TEST_ADMIN_HOST:-opennext-admin.test.vishwalab.com}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-300}
STATE_DIR=$HOME_DIR/state

die() { echo "error: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root (sudo)"

mode=release
case "${1:-}" in
  --rollback) mode=rollback; shift ;;
  --restart) mode=restart; shift ;;
esac
if [ "$mode" != release ]; then
  [ $# = 1 ] || die "usage: $0 --$mode spotbot|gateway|test-web"
  svc=$1
else
  [ $# = 2 ] || die "usage: $0 <tag> spotbot|gateway|test-web"
  tag=$1 svc=$2
  [[ $tag =~ ^[0-9a-f]{12}$ ]] || die "tag must be 12 hex characters of a commit"
fi

case $svc in
  spotbot) container=spot-order-bot compose_service=spotbot repo=opennext-spotbot ;;
  gateway) container=spot-order-gateway compose_service=gateway repo=opennext-spotbot ;;
  test-web) container=opennext-test-web-1 compose_service=web repo=opennext-test-web ;;
  *) die "unknown service: $svc" ;;
esac

mkdir -p "$STATE_DIR"
exec 9> "$HOME_DIR/.release.lock"
flock -n 9 || die "another release is running"

# compose <image> <release dir> <args...>: docker compose for this service.
compose() {
  local image=$1 dir=$2; shift 2
  case $svc in
    spotbot)
      SPOTBOT_HOME=$HOME_DIR SPOTBOT_IMAGE=$image \
        docker compose -f "$dir/depoly/bot-host/compose.bot.yaml" "$@" ;;
    gateway)
      SPOTBOT_HOME=$HOME_DIR SPOTBOT_IMAGE=$image \
        docker compose -f "$dir/depoly/bot-host/compose.gateway.yaml" "$@" ;;
    test-web)
      WEB_RELEASE=${image#opennext-test-web:} \
        docker compose --project-directory "$TEST_DIR" -f "$TEST_DIR/compose.yaml" "$@" ;;
  esac
}

switch_to() {
  local image=$1 dir=$2
  if [ "$svc" = test-web ]; then
    compose "$image" "$dir" up -d --remove-orphans
  else
    compose "$image" "$dir" up -d --no-deps --force-recreate "$compose_service"
  fi
}

wait_healthy() {
  local image=$1 waited=0 status running
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    running=$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)
    if [ "$running" = "$image" ] && [ "$status" = healthy ]; then
      echo "$container is healthy on $image"
      return 0
    fi
    [ "$status" = unhealthy ] && break
    sleep 5; waited=$((waited + 5))
  done
  echo "$container is not healthy on $image (status: $status)" >&2
  docker logs --tail 40 "$container" 2>&1 | sed 's/^/  | /' >&2 || true
  return 1
}

state_get() { [ -f "$STATE_DIR/$svc.env" ] && sed -n "s/^$1=//p" "$STATE_DIR/$svc.env" | tail -1 || true; }
# state_put <image> <release dir> <previous image> <previous release dir>
state_put() {
  printf 'IMAGE=%s\nRELEASE_DIR=%s\nPREVIOUS_IMAGE=%s\nPREVIOUS_RELEASE_DIR=%s\nUPDATED_AT=%s\n' \
    "$1" "$2" "$3" "$4" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE_DIR/$svc.env.tmp"
  mv "$STATE_DIR/$svc.env.tmp" "$STATE_DIR/$svc.env"
}

current_image=$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)
# The release whose compose file started the running container, if this script started it.
current_dir=""
[ "$(state_get IMAGE)" = "$current_image" ] && current_dir=$(state_get RELEASE_DIR)

if [ "$mode" = rollback ]; then
  target=$(state_get PREVIOUS_IMAGE)
  dir=$(state_get PREVIOUS_RELEASE_DIR)
  [ -n "$dir" ] && [ -d "$dir/depoly/bot-host" ] || dir=$(state_get RELEASE_DIR)
  [ -n "$target" ] && [ -n "$dir" ] || die "no previous image recorded for $svc"
  docker image inspect "$target" > /dev/null || die "previous image $target is gone"
  echo "== rolling $svc back: $current_image -> $target"
  switch_to "$target" "$dir"
  wait_healthy "$target" || die "rollback is not healthy; check the logs above"
  state_put "$target" "$dir" "$current_image" "$current_dir"
  exit 0
fi

if [ "$mode" = restart ]; then
  image=$(state_get IMAGE)
  dir=$(state_get RELEASE_DIR)
  [ -n "$image" ] && [ "$image" = "$current_image" ] ||
    die "$svc does not run the recorded release ($image); deploy a commit instead"
  tag=${image##*:}
else
  dir=$HOME_DIR/releases/$tag
  image=$repo:$tag
fi
[ -d "$dir/depoly/bot-host" ] || die "release $dir is not unpacked; run deploy.sh"

echo "== $svc: preflight"
if [ "$svc" != test-web ] && [ ! -f "$STATE_DIR/adopted" ]; then
  die "$HOME_DIR still uses the old compose overlays; run adopt.py once (see README)"
fi
case $svc in
  spotbot)
    [ -f "$HOME_DIR/.env" ] || die "$HOME_DIR/.env is missing"
    [ -f "$HOME_DIR/aws/config" ] || die "$HOME_DIR/aws/config is missing" ;;
  gateway)
    [ -f "$HOME_DIR/.env.gateway" ] || die "$HOME_DIR/.env.gateway is missing" ;;
  test-web)
    for f in compose.yaml web.env adapter.env mailpit.env; do
      [ -f "$TEST_DIR/$f" ] || die "$TEST_DIR/$f is missing"
    done ;;
esac

echo "== $svc: image $image"
if docker image inspect "$image" > /dev/null 2>&1; then
  echo "already built"
elif [ "$repo" = opennext-spotbot ]; then
  docker build -t "$image" --label "org.opencontainers.image.revision=$tag" "$dir/services/spotbot"
else
  docker build -t "$image" --label "org.opencontainers.image.revision=$tag" \
    --build-arg SPOTBOT_SOURCE=local \
    --build-arg SITE_HOST="$TEST_SITE_HOST" \
    --build-arg TERMINAL_HOST="$TEST_TERMINAL_HOST" \
    --build-arg ADMIN_HOST="$TEST_ADMIN_HOST" \
    "$dir"
fi

echo "== $svc: check configuration with the new image"
case $svc in
  spotbot)
    compose "$image" "$dir" config --quiet
    compose "$image" "$dir" run --rm --no-deps -T "$compose_service" spotbot check-config > /dev/null
    echo "bot settings load" ;;
  gateway)
    compose "$image" "$dir" config --quiet
    compose "$image" "$dir" run --rm --no-deps -T "$compose_service" python -c \
      'from spotbot.gateway_config import GatewaySettings; GatewaySettings(); print("gateway settings load")' ;;
  test-web)
    # The test site's compose file and start script come from the release.
    src=$dir/services/spotbot/deploy/opennext-test
    for f in compose.yaml start-test.cjs; do
      if ! cmp -s "$src/$f" "$TEST_DIR/$f"; then
        cp -p "$TEST_DIR/$f" "$TEST_DIR/$f.before-$tag"
        install -m 0644 "$src/$f" "$TEST_DIR/$f"
        echo "updated $TEST_DIR/$f (old copy: $f.before-$tag)"
      fi
    done
    compose "$image" "$dir" config --quiet ;;
esac

if [ "$mode" = restart ]; then
  echo "== $svc: restart on $image"
  switch_to "$image" "$dir"
  wait_healthy "$image" || die "$svc is not healthy after the restart; check the settings and the logs above"
  exit 0
fi
# What to go back to if this release fails: the running image, unless the container already
# runs this image (an earlier attempt); then the image recorded before it.
back_image=$current_image back_dir=$current_dir
if [ "$current_image" = "$image" ]; then
  if [ "$(state_get IMAGE)" = "$image" ]; then
    if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")" = healthy ]; then
      echo "== $svc already runs $image (use --restart to re-read its settings)"
      exit 0
    fi
    back_image=$(state_get PREVIOUS_IMAGE) back_dir=$(state_get PREVIOUS_RELEASE_DIR)
  else
    back_image=$(state_get IMAGE) back_dir=$(state_get RELEASE_DIR)
  fi
  echo "== $svc runs $image but not healthily; recreating it"
fi

echo "== $svc: switch ${current_image:-nothing} -> $image"
switch_to "$image" "$dir"
if ! wait_healthy "$image"; then
  if [ -n "$back_image" ]; then
    echo "== $svc: rolling back to $back_image" >&2
    switch_to "$back_image" "${back_dir:-$dir}"
    wait_healthy "$back_image" || echo "rollback is not healthy either; act now" >&2
  fi
  die "release $tag of $svc failed"
fi
state_put "$image" "$dir" "$back_image" "$back_dir"
[ "$svc" = spotbot ] && ln -sfn "$dir" "$HOME_DIR/current"
echo "== $svc runs $image"
