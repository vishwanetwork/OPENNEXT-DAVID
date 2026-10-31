"""Read-only sources. These entries never register instance provisioning capabilities."""

from dataclasses import dataclass

CATALOG_ROOT = "https://raw.githubusercontent.com/skypilot-org/skypilot-catalog/master/catalogs/v8"
CATALOG_DOCS = "https://github.com/skypilot-org/skypilot-catalog"


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    docs: str
    mode: str = "catalog_reference"
    credential_env: str | None = None
    terms: tuple[str, ...] = ("On-demand", "Spot")
    note: str = "SkyPilot reference catalog; upstream refresh cadence varies. No inventory or quota guarantee."


SOURCES = {
    key: Source(
        name,
        f"{CATALOG_ROOT}/{cloud}/vms.csv",
        CATALOG_DOCS,
        terms=(
            ("On-demand",)
            if key in {"hyperstack", "vast", "oci", "paperspace", "runpod"}
            else ("On-demand", "Spot")
        ),
    )
    for key, cloud, name in [
        ("gcp", "gcp", "Google Cloud"),
        ("azure", "azure", "Azure"),
        ("hyperstack", "hyperstack", "Hyperstack"),
        ("vast", "vast", "Vast.ai"),
        ("runpod", "runpod", "RunPod"),
        ("nebius", "nebius", "Nebius"),
        ("oci", "oci", "Oracle Cloud"),
        ("paperspace", "paperspace", "Paperspace"),
    ]
}
SOURCES.update(
    verda=Source(
        "Verda",
        "https://api.verda.com/v1/instance-types?currency=usd",
        "https://api.verda.com/v1/docs",
        "provider_api",
        note="Public instance-type prices. Location and account availability are not checked.",
    ),
    digitalocean=Source(
        "DigitalOcean",
        "https://api.digitalocean.com/v2/sizes?per_page=200",
        "https://docs.digitalocean.com/reference/api/reference/sizes/",
        "provider_api",
        "DIGITALOCEAN_API_KEY",
        ("On-demand",),
        "Droplet size prices; availability is a catalog flag, not an account quota check.",
    ),
    tensordock=Source(
        "TensorDock",
        "https://dashboard.tensordock.com/api/v2/locations",
        "https://dashboard.tensordock.com/api/docs",
        "provider_api",
        "TENSORDOCK_API_KEY",
        ("On-demand",),
        "Estimated 1 GPU + 4 vCPU + 8 GB RAM + 100 GB disk. No Spot price inference.",
    ),
)

# Having documentation is not evidence that a working price adapter exists.
PENDING = {
    "packet": (
        "https://support.packet.ai/cli",
        "The official CLI lists prices; a stable price API contract still needs verification.",
    ),
    "lightning": (
        "https://lightning.ai/pricing",
        "Public prices include plan-specific and interruptible ranges; normalization is pending.",
    ),
    "crusoe": (
        "https://docs.crusoecloud.com/reference/api/",
        "Signed requests require an access key, secret and project ID; signing and price schema integration are pending.",
    ),
    "aliyun": (
        "https://www.alibabacloud.com/help/en/ecs/developer-reference/api-ecs-2014-05-26-describeprice",
        "DescribePrice requires signed access-key requests and region-specific currency handling; integration is pending.",
    ),
    "modal": (
        "https://modal.com/pricing",
        "GPU component rates exclude separately charged CPU and RAM; a comparable machine quote is not implemented.",
    ),
    "tencent": (
        "https://www.tencentcloud.com/document/api/213",
        "CVM pricing requires signed credentials, a region and verified GPU specifications; integration is pending.",
    ),
    "volcengine": (
        "https://docs.volcengine.com/docs/ecs/",
        "Regional signed pricing requests and native-currency normalization are pending.",
    ),
    "coreweave": (
        "https://www.coreweave.com/pricing",
        "Regional full-node and inference product prices need separate normalization; integration is pending.",
    ),
    "cudo": (
        "https://status.cudocompute.com/",
        "The public on-demand platform closed on March 31, 2026. New access must be confirmed with CUDO.",
    ),
}
