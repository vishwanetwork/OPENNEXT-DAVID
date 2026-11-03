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

Before payment, validate provider-reported per-device VRAM, physical card count,
system RAM, vCPUs, CPU architecture and the model disk allocation. Restrict enabled
GPU/runtime combinations to operator-validated pins; public instance metadata does
not prove the installed driver's version or interconnect performance. Check actual
CUDA availability, per-device memory, GPU count and compute capability on the
allocated server before loading, then require a real generated token before readiness.
Weight memory alone is insufficient:
runtime workspaces, activations and KV cache need headroom. MoE activated parameter
count does not represent the full weight residency requirement. Estimates must be
confirmed with the exact preset/hardware combination before marking it supported.

### Hardware admission policy (researched 2026-11-03)

The following are conservative **platform operating floors**, not vendor guarantees
or universal model minimums. They assume one host, 8,192 context tokens, one sequence,
85% GPU memory utilization, no CPU offloading, and the stated precision. Longer
contexts, more concurrent requests and quantized checkpoints require separate profiles.

| Preset | Precision | Total nominal VRAM | System RAM | vCPUs | Supported GPU counts | Model disk |
| --- | --- | --- | --- | --- | --- | --- |
| R1 Distill Qwen 7B | FP16 | 24 GB | 16 GiB | 4 | 1, 2, 4 | 100 GiB |
| R1 Distill Llama 70B | BF16 | 192 GB | 64 GiB | 8 | 1, 2, 4, 8 | 250 GiB |
| Full R1 671B | Native FP8 | 1,120 GB | 512 GiB | 32 | 8 | 1,024 GiB |

All profiles require the managed x86_64 Linux runtime and at least a 100 GiB root
volume. Minimum device compute capabilities are 7.5 (7B FP16), 8.0 (70B BF16), and
9.0 (the managed 671B FP8 recipe). These checks do not replace the validated GPU
allowlist, correct driver/container pairing, fast interconnect evaluation, or a
paid hardware acceptance run. API-reported L4 22,888 MiB is treated as marketed
24 GB, consistent with rental admission; the guest checks reported bytes with 2%
driver-reservation tolerance. The guest allows 10% system-RAM reservation for firmware
and the OS; the provider-reported instance size must still meet the full RAM floor.

The official artifact manifests inspected on that date contain approximately
15.23 GB, 141.11 GB and 688.59 GB of safetensor weights respectively. Loading the
70B BF16 weights alone already exceeds 85% of 2 x 80 GB, so that layout is rejected.
Examples meeting the memory floor include 1 x L4 for 7B, 2 x H200 or 4 x H100 for
70B, and 8 x H200 or 8 x B300 for 671B. They remain unavailable until the specific
GPU/runtime combination is enabled after validation. A 16 GB T4 is not eligible
for the single-GPU 7B FP16 profile; a separate 4-bit preset could have different rules.

Source basis: the [DeepSeek model card](https://huggingface.co/deepseek-ai/DeepSeek-R1)
distinguishes the full 671B MoE weights from the distilled checkpoints; activated
parameters do not reduce the need to load the full checkpoint. The
[vLLM R1 recipe](https://recipes.vllm.ai/deepseek-ai/DeepSeek-R1) lists 8 x H200 for
native FP8. The [vLLM scaling guide](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)
explains KV-cache capacity and parallel layouts, and its
[GPU installation guide](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/)
documents compute capability and CUDA/runtime compatibility. RAM/vCPU floors and
the 192 GB safety margin are our conservative operating policy derived from these
constraints, rather than an official claim that every larger server will work.

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

## Preparing reusable runtime and model images

Cold downloads remain supported, but a prepared private AMI can cache both the
pinned vLLM runtime on the root disk and public model artifacts on `/dev/sdf`.
It contains no customer data, SSH identity, inference credentials, or AWS keys.
The model disk is cloned for each rental; customers never share a writable volume.

The CPU-only builder accepts a clean, encrypted account-owned base, the existing
restricted subnet/security group, immutable preset pins, and a durable state file:

```sh
PYTHONPATH=. python scripts/prepare_inference_image.py \
  --profile default --region us-west-2 --account-alias default \
  --base-image ami-<clean-base> --subnet-id subnet-<approved-subnet> \
  --security-group sg-<existing-restricted-group> \
  --pins-env .env.inference.example \
  --state-file data/inference-build/7b-us-west-2.json
```

The tool launches exactly one `t3.medium` with Standard CPU credits, no IAM instance
profile and no GPU. Its root/model disks are encrypted and delete on termination.
A guest shutdown timer and controller deadline bound CPU runtime to 90 minutes.
For short builds, `--cpu-credits unlimited` avoids credit throttling while preserving
the same runtime limit; it can add AWS CPU-credit charges. Standard mode is the
default and may make container decompression much slower after credits run out.
Use `--instance-type t3.large --cpu-credits unlimited` for an 8 GiB-memory builder
when runtime decompression exceeds the medium instance's memory headroom. The
same single-instance and 90-minute limits apply. Pull/download heartbeats include
bounded command output, free root space and model byte progress; transient status
delivery and controller connection errors are retried within the existing deadlines.
`--instance-type c7i.xlarge` is an explicitly allowed four-vCPU non-burst alternative;
it does not send T-series credit settings and retains the same runtime bound.
The pinned official container exposes `python3`, so both CPU downloads and guest
CUDA probes use that interpreter rather than assuming a `python` alias exists.
Progress uses a dedicated private, encrypted S3 bucket with public access blocked.
The guest receives only a two-hour PUT capability for its own build-status object;
it receives no cloud-management role or access keys. Temporary status objects expire
after one day and are deleted on normal cleanup. The capability file is removed
before publishing the image. EC2 console output is a fallback, not the only proof of
completion. The new model volume is matched by its ID, and disk enumeration always
keeps the root filesystem's partition hierarchy; an unknown/root disk is not formatted.
The guest downloads artifacts, checks the complete manifest, removes machine/SSH
identity, then shuts down. Only a build-specific completion marker permits image
registration. The controller verifies the private encrypted image, terminates the
builder and deletes its temporary disks. The retained AMI snapshots incur storage
charges. Interrupted controllers can resume with the same state file; failed
partial images are cleaned only when their build ownership tags match.

Add the completed AMI to that preset's `initial_image_ids`, scoped by account alias
and Region. For example:

```json
{"default":{"us-west-2":"ami-0123456789abcdef0"}}
```

The internal selection API returns only the chosen account/Region's mapping.
Credit holds and Direct Pay intents freeze it as `initialImageIds` in their private
pricing snapshot; the RFQ receives the existing `initial_image_ids` field. A model
cache image must match the preset, model revision and runtime digest tags before
launch. Changing cache configuration does not redirect previously accepted orders.
Replacement continues to use that rental's own backups. GPU-only orders keep the
original base image and disk layout.

A completed image means **artifacts prepared**, not model inference validated.
Actual model loading and token generation still require the intended GPU. EBS
snapshot blocks may also need initialization on first access, so a warm image does
not promise instantaneous readiness. The 7B candidate stays disabled until the
operator explicitly enables an approved GPU acceptance run.

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
