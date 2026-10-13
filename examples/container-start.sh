#!/usr/bin/env bash
# Example VM startup script. The VM image must already include Docker and GPU runtime.
# Scheduler replaces these values before submitting as launch.cloud_init.
# This script is NOT run by the bot on its own host.
set -euo pipefail
CONTAINER_IMAGE='replace-with-reviewed-image:fixed-version'
MODEL_ID='replace-with-your-model'
INFERENCE_API_KEY='replace-with-a-per-instance-key'

command -v docker >/dev/null
command -v nvidia-smi >/dev/null
nvidia-smi
docker run -d --restart unless-stopped --name inference \
  --gpus all --ipc=host -p 8000:8000 \
  "$CONTAINER_IMAGE" --model "$MODEL_ID" --host 0.0.0.0 --port 8000 \
  --api-key "$INFERENCE_API_KEY"
# Gateway must verify the HTTP service is healthy before routing requests.
# Restrict ingress to the gateway using the cloud firewall / private networking.
