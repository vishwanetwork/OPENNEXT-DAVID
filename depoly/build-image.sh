#!/usr/bin/env bash
# Build only. Unlike the existing GitHub deployment workflow, this never upgrades 1Panel.
set -euo pipefail
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DEPLOY_DIR/production.py" build-image "$@"
