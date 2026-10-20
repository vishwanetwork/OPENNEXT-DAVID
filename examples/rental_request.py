"""Print a current sample RFQ. This helper does not call APIs or purchase resources."""

import argparse
import json
from datetime import UTC, datetime, timedelta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="us-west-2")
    parser.add_argument("--ssh-key", required=True)
    parser.add_argument("--hours", type=int, default=2)
    parser.add_argument("--acceptance", action="store_true", help="Use short backup retention for an opt-in staging test")
    args = parser.parse_args()
    if args.hours < 1:
        parser.error("--hours must be positive")
    now = datetime.now(UTC)
    value = {
        "rfq": {
            "rfq_id": "example-rfq",
            "rfq_version": 1,
            "upstream_order_id": "example-order",
            "regions": [args.region],
            "gpu_model": "H100",
            "gpu_count": 1,
            "min_gpu_memory_gib": 80,
            "price_unit": "instance_hour",
            "max_price_hourly": "3",
            "budget_usd": "100",
            "acquisition_deadline": (now + timedelta(minutes=30)).isoformat(),
            "expires_at": (now + timedelta(hours=args.hours)).isoformat(),
            "ssh_key_name": args.ssh_key,
            "root_volume_gib": 100,
            "data_disks": [{"device": "/dev/sdf", "size_gib": 100}],
            "require_gateway_ack": True,
        }
    }
    if args.acceptance:
        value["rfq"]["backup"] = {"interval_seconds": 900, "final_retention_seconds": 60}
    print(json.dumps(value, indent=2))


if __name__ == "__main__":
    main()
