#!/usr/bin/env bash
# AWS changes in the GPU supplier accounts that the cluster needs. Prints the plan by default;
# changes nothing unless --apply is given (IAM and security groups are reviewed changes).
#   1. Trust: the Bot's role in the default account may be assumed by the pod's role in the new
#      cluster account. Every other account keeps trusting that Bot role, so nothing else changes.
#   2. Security groups: GPU servers accept SSH (22) and HTTP (8000) from the gateway node's
#      Elastic IP, next to the old host's address (remove that one after the cutover).
#
#   bash depoly/k8s/scripts/aws-access.sh --pod-role arn:aws:iam::<new account>:role/<name> \
#     --gateway-ip <Elastic IP> [--apply]
#
# SG_TARGETS lists profile:region:group-name; the defaults are today's GPU security groups.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BOT_ROLE=${BOT_ROLE:-SpotOrderBotEC2Role}
BOT_PROFILE=${BOT_PROFILE:-default}
SG_TARGETS=${SG_TARGETS:-"default:us-west-2:spotbot-gpu default:us-east-1:spotbot-gpu default:us-east-2:spotbot-gpu b300-admin:us-west-2:spotbot-b300-gpu"}

role="" ip="" apply=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pod-role) role=$2; shift 2 ;;
    --gateway-ip) ip=$2; shift 2 ;;
    --apply) apply=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$role" ] && [ -n "$ip" ] || { echo "usage: $0 --pod-role ARN --gateway-ip IP [--apply]" >&2; exit 2; }
[[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "--gateway-ip must be an IPv4 address" >&2; exit 2; }

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
run() { if [ "$apply" = 1 ]; then "$@"; else printf 'would run:'; printf ' %q' "$@"; echo; fi; }

echo "== Trust policy of $BOT_ROLE ($BOT_PROFILE)"
aws iam get-role --profile "$BOT_PROFILE" --role-name "$BOT_ROLE" \
  --query Role.AssumeRolePolicyDocument --output json > "$work/current.json"
python3 "$HERE/../opennext_k8s.py" trust-policy --current "$work/current.json" --principal "$role" > "$work/new.json"
if python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])) != json.load(open(sys.argv[2])))' "$work/current.json" "$work/new.json"; then
  echo "already trusts $role"
else
  diff <(python3 -m json.tool "$work/current.json") <(python3 -m json.tool "$work/new.json") || true
  run aws iam update-assume-role-policy --profile "$BOT_PROFILE" --role-name "$BOT_ROLE" \
    --policy-document "file://$work/new.json"
fi

for target in $SG_TARGETS; do
  IFS=: read -r profile region name <<< "$target"
  group=$(aws ec2 describe-security-groups --profile "$profile" --region "$region" \
    --filters "Name=group-name,Values=$name" --query 'SecurityGroups[0].GroupId' --output text)
  [ "$group" != None ] || { echo "no security group $name in $profile/$region" >&2; exit 1; }
  for port in 22 8000; do
    if aws ec2 describe-security-groups --profile "$profile" --region "$region" --group-ids "$group" \
      --query "SecurityGroups[0].IpPermissions[?FromPort==\`$port\`].IpRanges[].CidrIp" --output text \
      | tr '\t' '\n' | grep -qx "$ip/32"; then
      echo "$profile/$region $name ($group) already allows $ip on $port"
      continue
    fi
    run aws ec2 authorize-security-group-ingress --profile "$profile" --region "$region" \
      --group-id "$group" --ip-permissions \
      "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$ip/32,Description=opennext-k8s-gateway}]"
  done
done
[ "$apply" = 1 ] || echo "Plan only. Re-run with --apply to make these changes."
