# Additional read-only price sources

The Console adapter owns these sources in `spotbot/price_sources`. They use the existing
SQLite, MySQL or DynamoDB workflow database. New sources default to disabled. An operator
can run a source once, or enable its 10–1440 minute schedule. The worker runs independently
of an open browser. Only GET pricing operations are invoked; adding a price source does
not add a fulfillment provider or grant permission to buy instances.

## Source matrix

| Sources | Implemented transport | Credential | Validation |
| --- | --- | --- | --- |
| Verda | Public instance-types API | None | Public read-only smoke test |
| DigitalOcean | Droplet sizes API, bounded same-origin pagination | `DIGITALOCEAN_API_KEY` read-only token | Fixture contracts; account test pending |
| TensorDock | Existing v2 locations collector | `TENSORDOCK_API_KEY` | Fixture contracts; account test pending |
| GCP, Azure, Hyperstack, Vast.ai, RunPod, Nebius, OCI, Paperspace | SkyPilot official v8 catalog | None | Public read-only smoke tests |
| Packet.ai, Lightning, Crusoe, Aliyun, Modal, Tencent, Volcengine, CoreWeave | Documentation found; adapter pending | Provider-specific | Not implemented |
| CUDO | Public platform closed March 31, 2026 | Not applicable | Disabled; see official status page |

Direct API references:
- [Verda](https://api.verda.com/v1/docs)
- [DigitalOcean](https://docs.digitalocean.com/reference/api/reference/sizes/)
- [TensorDock](https://dashboard.tensordock.com/api/docs)

The [official SkyPilot catalog](https://github.com/skypilot-org/skypilot-catalog) is a
reference feed, not a direct authenticated provider API. Its refresh cadence differs by
cloud. `sourceType=catalog_reference` and the immutable Git blob `sourceRevision` preserve
this distinction. `observedAt` means when this adapter fetched it; `effectiveAt` and
`upstreamUpdatedAt` remain null when the source does not publish them. Fetching an old
catalog does not make its rates current. No historical data is fabricated.

The remaining providers' verified documentation and concrete blockers are maintained in
`registry.py` and displayed in Console. A provider stays unimplemented until its price
schema, units and authentication are implemented. A text field accepting a token is not
an integration.

## Price semantics

- `instanceHourly` is USD per instance-hour; `perGpuHourly` divides it by the explicit GPU count.
- GCP accelerator-only rows have `priceBasis=gpu_component_hour` and null `instanceHourly`.
  They must not enter full-machine comparisons. Complete machine rows use `instance_hour`.
- TensorDock estimates include 1 GPU, 4 vCPU, 8 GB RAM and 100 GB disk.
- Only explicitly published nonzero finite prices are accepted. No Reserved rate or Spot
  discount is inferred. Supported terms reflect the selected feed, not every product
  available from that cloud.
- `availability=null`, `orderable=false`: these feeds do not verify account quotas, stock,
  capacity reservations or actual launch permission.
- Existing AWS capacity-history charts and orderable inventory keep their current sources.
  Added sources appear in `/api/pricing/prices` and the research price catalog; they do not
  replace AWS historical observations.

## Persistence and execution

Credentials saved in Console use the existing `SPOTBOT_OPENNEXT_CONSOLE_KEY` AES-GCM
sealer with source-specific associated data. They are never returned to the browser or
written to logs. Server environment tokens are an alternative; encrypted database values
have priority. No browser cookie is retained for background collection.

One compare-and-swap lease per provider prevents overlapping collection across adapter
workers. Two sources can collect concurrently. Time, response size, record count and
pagination are bounded; authenticated pagination cannot leave its fixed API origin.
A stale lease becomes a failed run rather than remaining running after a process crash.
Failures preserve the previous successful catalog. Snapshot chunks are written before the
published manifest switches, so public readers cannot see a half-written collection.
Workflow chunks remain under DynamoDB's document limit. Schedules and successful snapshots
survive adapter restarts; run summaries retain the latest 20 runs per new source.

The existing provider, credential, settings, run and public-price routes are extended.
New-source test operations enqueue the same real read-only request with `mode=test`;
operators inspect the returned run until it completes. `validationStatus=live_verified`
means at least one real collection published rows, not that account availability was tested.
The production image must contain this adapter revision before the UI can expose the new sources.
