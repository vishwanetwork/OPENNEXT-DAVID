#!/usr/bin/env bash
# Create a reviewable production recovery change set. Never execute it or create GPU VMs.
set -euo pipefail
test "$#" -eq 3 || { echo 'Usage: prepare-recovery.sh AWS_PROFILE REGION EXISTING_PRODUCTION_ROLE' >&2; exit 1; }
PROFILE="$1"
REGION="$2"
ROLE="$3"
[[ "$REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || exit 1
[[ "$ROLE" =~ ^[A-Za-z0-9+=,.@_-]+$ ]] || exit 1
[[ "$ROLE" != *[Tt]est* ]] || { echo 'Select a dedicated production role.' >&2; exit 1; }
TEMPLATE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
aws --profile "$PROFILE" cloudformation validate-template --template-body "file://$TEMPLATE_DIR/recovery-template.json" --region "$REGION" >/dev/null
aws --profile "$PROFILE" cloudformation deploy \
  --template-file "$TEMPLATE_DIR/recovery-template.json" \
  --stack-name "opennext-production-recovery-$REGION" \
  --region "$REGION" --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "ExistingBotRoleName=$ROLE" AllowCrossRegionCopies=false \
  --no-execute-changeset
echo 'Review the change set, IAM scope and production AWS account before executing it separately.'
