#!/usr/bin/env bash
# Apply the production overlay with both images pinned to one commit and wait for the rollout.
# The images must exist: .github/workflows/images.yml publishes them for every main commit.
#
#   bash depoly/k8s/scripts/deploy.sh <full commit SHA>
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
tag=${1:?usage: deploy.sh <full commit SHA>}
python3 "$HERE/../opennext_k8s.py" render --tag "$tag" | kubectl apply -f -
for deployment in spotbot spotbot-gateway web; do
  kubectl -n opennext rollout status "deployment/$deployment" --timeout=900s
done
