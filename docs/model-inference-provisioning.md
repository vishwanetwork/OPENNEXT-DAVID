# Optional model inference on rented GPU servers

Status: implemented in the model-inference development branches. Automated tests
cover control-plane behavior and TLS forwarding. A paid GPU model acceptance run
has not been performed; presets remain disabled until an operator validates an
immutable runtime image on the intended GPU hardware.

## Accepted product rules

- Procurement accounts are selected by environment configuration and service
  restart. No Console account-switching feature is required. Account filtering
  applies before offer aggregation and to new purchase validation; accepted orders,
  existing servers, recovery, and backup cleanup retain their recorded account.
- Customers may rent a base GPU server or choose an optional inference preset.
- The purchased service window starts at GPU delivery, using the existing billing
  rule. Model download, initialization, and later model restarts use that window.
  Checkout must explain this and show a preparation estimate; the Instances page
  must show actual preparation progress. Estimates are not readiness guarantees.
- This remains GPU-hour rental. Generated text tokens and inference API credentials
  are separate concepts; usage reporting does not introduce token-based billing.
- Preserve the existing markup-only policy; do not reintroduce a fixed service fee.

## Presets and admission

Initial catalog entries should clearly distinguish `No preinstallation`,
`deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` (small test preset),
`deepseek-ai/DeepSeek-R1-Distill-Llama-70B`, and the full
`deepseek-ai/DeepSeek-R1` 671B model. The 70B distilled model is not the full model.
Any later R1 revision, V3 variant, quantized checkpoint, or custom model is a
separate, explicitly named preset/version.

The initial 7B test preset uses float16, one validated GPU with at least 24 GB
advertised VRAM, an 8,192-token context cap, one concurrent sequence, and a 100 GiB
protected model volume. This conservatively excludes a 16 GB T4 at this precision.
The 30-minute cold preparation estimate is not a benchmark. Do not enable a GPU
model solely because it passes the memory calculation.

Each validated preset pins a repository revision, inference image digest, engine,
precision/quantization, compatible GPU architectures, parallelism, context limit,
concurrency limit, health route, and expected artifact/storage requirements. Do not
use an unpinned `latest` image or silently substitute a smaller/quantized model.

Before payment, validate actual per-device VRAM, card count, interconnect, driver
and engine compatibility, and disk space. Weight memory alone is insufficient:
runtime workspaces, activations and KV cache need headroom. MoE activated parameter
count does not represent the full weight residency requirement. Estimates must be
confirmed with the exact preset/hardware combination before marking it supported.

Size a dedicated encrypted model volume from the pinned artifact manifest plus
download/cache headroom. The existing 100 GiB checkout root disk is not an adequate
general model store. Include additional storage and retention in the accepted
quote and RFQ budget before allocating it. Format only a verified new empty data
volume; mount restored filesystems without formatting them.

Freeze preset/version, account, hardware, price, disk specification and preparation
terms with the accepted purchase. Direct Pay, Credit purchases, retries and
idempotent replay must preserve the same selection. Changing to a larger preset
after purchase requires a separately validated resource/price change.

## Delivery lifecycle

Maintain independent machine and inference readiness:

1. Acquire the account-bound GPU server and complete the existing protected-server
   verification, initial backup and SSH gateway delivery.
2. Start the customer's service window at that existing GPU handoff.
3. Provision the selected managed inference service. Report `queued`,
   `preparing_runtime`, `downloading`, `loading`, `ready`, `failed` or `stopped`, with
   byte progress where available, bounded preparation time and sanitized errors.
4. Load the pinned model and run an authenticated smoke generation. A listening
   socket or successful container start alone is insufficient to declare readiness.
5. Enable the inference route only when its current generation is ready. Return
   a clear preparing/unavailable response before that point; SSH remains usable.
6. Show failure/retry information without ending the purchased server merely
   because an optional model preparation step failed. Expiry and explicit End
   retain their existing authority and stop preparation/inference workers too.

Do not implement this as the customer's ordinary Autopilot task. That task starts
only for `ACTIVE` rentals, while the existing gateway requires configured HTTP
health before delivery acknowledgement. Combining these unchanged would deadlock
delivery. Add independent optional-service readiness and preserve the existing
required-HTTP delivery behavior for older RFQs. Managed inference must not overwrite
the customer's task, inherit its default end-on-success behavior, or block SSH
delivery while weights download.

The preparation controller must be resumable and versioned. Persist desired state
before dispatch; duplicate heartbeats/retries must not create duplicate downloads,
containers, or services. Apply limits to retries, download storage and startup time.

## Customer access and gateway

Run the inference engine on an internal service port such as 8000. Expose a stable
per-rental HTTPS endpoint through the gateway on port 443, independently of the
customer's existing SSH connection. There is no need to allocate a distinct public
inference port for every customer. GPU ingress stays restricted to the gateway.

Deliver an OpenAI-compatible Base URL ending in `/v1`, the served model name, and a
separate per-rental inference API credential. Standard clients should use one Bearer
credential; they should not need the Bot administrator key or a second custom
gateway header. Never expose AWS credentials. Validate access at the gateway,
support revocation/rotation, and keep public and backend credentials distinct if
the engine also uses authentication. Do not put credentials in URLs or logs.

Preserve streaming SSE without response buffering. Set bounded, configurable
first-token/idle timeouts suitable for the preset; the existing gateway and example
proxy use 60-second read timeouts. Cancellation, rental expiry and route revocation
must close the upstream inference request, not just its client connection. Protect
gateway-to-GPU transport with validated TLS or a private encrypted tunnel before
advertising protected prompt transport. Add narrowly scoped CORS handling if the
Terminal calls the endpoint from a browser.

The current gateway already supports authenticated HTTP forwarding and streaming.
The OpenNext adapter currently exposes only the SSH portion of its connection
response. Extend the owner-scoped API/contracts and Instances connection dialog
to expose inference status, Base URL, served model name, credential controls, and
a copyable streaming request example. Secrets must not enter public supply rows.

## Spot replacement and persistence

Store model artifacts on protected persistent storage or an approved immutable
shared cache; keep customer files and credentials tenant-isolated. Downloads must
resume and verify their pinned artifacts. Never publish a customer's full-server
backup as a shared preset/base image.

After replacement, reconcile the saved preset and current credential version,
restore/mount disks, restart the engine and re-run inference readiness before
switching the route. The customer's external Base URL stays stable. Disk snapshots
do not preserve GPU memory, KV cache or an in-flight generation: interrupted
requests fail and clients must retry; do not promise continuation of the same stream.

## Validation and rollout

Test hardware admission, storage quoting, frozen checkout terms, account filtering,
idempotent dispatch, machine/inference readiness independence, authenticated and
unauthenticated requests, SSE, cancellation, credential rotation, restoration,
expiry and tenant isolation. Use fake engines for deterministic integration tests.

Real GPU acceptance needs a separate explicit spending allowance. Mark a particular
preset/hardware combination production-supported only after loading its actual
weights and generating tokens through the customer gateway; do not infer success
from unit tests or GPU detection alone.

## Deployment and the small-model acceptance path

Keep all inference presets disabled while deploying. Update the Gateway first, then
the Bot, OpenNEXT adapter and web, and enable a test preset last. An older gateway
cannot acknowledge managed inference correctly. Existing GPU-only requests remain
compatible. No database migration is needed for the optional JSON fields. Old
rentals keep their account and do not acquire a model preset implicitly.

Set `SPOTBOT_INFERENCE_PRESETS` on the Bot (default `{}`). Each entry has `enabled`,
an immutable Hugging Face `revision`, an immutable `vllm/vllm-openai@sha256:...` image,
and `validated_gpu_models`. The OpenNEXT adapter obtains admission from this Bot
catalog, so it does not need the Bot's encryption key or duplicate model pins.

For the 7B test configuration, run:

`.env.inference.example` contains a resolved, disabled L4 candidate using vLLM
v0.32.0 and immutable image/model digests. It is a configuration starting point,
not a statement that this runtime has passed a paid GPU test. To resolve pins again:

```sh
python scripts/prepare_inference_preset.py \
  --image vllm/vllm-openai@sha256:<validated-image-digest> \
  --validated-gpu-model L4
```

The command resolves the exact public model revision and prints an environment
assignment without starting a GPU. It leaves the preset disabled. For an explicitly
approved isolated GPU acceptance run, enable the entry with `--enable`; do not mark
the combination production-supported until the end-to-end checks below succeed.
The base AMI must already contain working NVIDIA drivers, Docker, and the NVIDIA
container toolkit. Missing runtime components cause an explicit preparation failure;
the system does not run arbitrary package installers as a fallback.

Keep GPU port 8000 restricted to the gateway. Configure its HTTPS wildcard domain,
set `SPOTBOT_GATEWAY_INFERENCE_READ_TIMEOUT_SECONDS=600`, and configure the public
reverse proxy with `proxy_buffering off` and a read timeout greater than 600 seconds.
Public customers continue to use HTTPS 443 and the existing SSH gateway ports.

In GPU Market, select a compatible offer and the 7B test preset, review the storage
add-on, and acknowledge that preparation uses paid GPU time. Both Credit and Direct
Pay preserve the selected preset and price. After delivery, open Instances → Manage
→ Model inference. Wait for `Ready for inference`, then set the displayed customer
key in `INFERENCE_API_KEY` and run:

```sh
python scripts/test_inference_endpoint.py \
  --base-url https://r-<rental-id>.<gateway-domain>/v1
```

The test verifies `/models`, a non-streaming response with generated token usage,
and a complete SSE stream. It does not print the credential or model response text.
Then rotate the key, verify the old key is rejected, retry with the new key, test a
protected replacement, and end the instance. Confirm the stable URL reconnects only
after the restored model passes readiness, and is unavailable after ending.

## Quota display and concurrent admission

GPU count describes each physical instance. GPU Market separately shows a quota
estimate of the maximum instances and GPUs that can still be requested. The estimate
uses the exact procurement account, Region, Spot quota family, running/pending AWS
instances and open/active Spot requests. It subtracts local queued and ambiguous
orders not yet visible in AWS, without counting known instance IDs twice. H100 and
B300 offers share an allowance only when their actual quota scope matches; displayed
counts across a shared pool must never be added together.

Snapshots refresh at most every 10 seconds in the Bot and through the existing
30-second visible-tab marketplace refresh. Unknown usage displays as unavailable,
never as one unit of stock. Each accepted OpenNEXT rental requests quota admission
again under the Bot's worker lock; the committed rental becomes a local reservation
before another checkout enters. Duplicate HTTP requests keep their original rental.
AWS and other tools can still consume quota outside this service, and Spot inventory
is known only from a real launch. Rejections follow the existing refund/Credit flow.

References:
- [Small 7B model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B)
- [AWS Spot quotas](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html)
- [DeepSeek-R1 model card](https://huggingface.co/deepseek-ai/DeepSeek-R1)
- [DeepSeek-R1-Distill-Llama-70B model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-70B)
- [vLLM online serving](https://docs.vllm.ai/en/latest/serving/online_serving/)
