# Optional model inference on rented GPU servers

Status: proposed implementation design. The existing repository provides managed
tasks and an authenticated streaming HTTP gateway; it does not yet provide the
checkout presets, provisioning controller, or complete inference delivery below.

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
`deepseek-ai/DeepSeek-R1-Distill-Llama-70B`, and the full
`deepseek-ai/DeepSeek-R1` 671B model. The 70B distilled model is not the full model.
Any later R1 revision, V3 variant, quantized checkpoint, or custom model is a
separate, explicitly named preset/version.

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

References:
- [DeepSeek-R1 model card](https://huggingface.co/deepseek-ai/DeepSeek-R1)
- [DeepSeek-R1-Distill-Llama-70B model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-70B)
- [vLLM online serving](https://docs.vllm.ai/en/latest/serving/online_serving/)
