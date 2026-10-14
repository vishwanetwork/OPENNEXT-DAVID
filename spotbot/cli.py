import argparse
import asyncio
import json
import logging

from spotbot.config import Settings
from spotbot.service import Service


async def collect(provider):
    service = Service(Settings())
    try:
        service.acquire()
        results = await service.collect(provider)
        print(json.dumps({"results": results}, ensure_ascii=False, indent=2))
        return 1 if any(r["status"] == "error" for r in results) else 0
    finally:
        await service.close()


def main():
    parser = argparse.ArgumentParser(description="SpotOrderBot GPU prices and capacity orders")
    commands = parser.add_subparsers(dest="command", required=True)
    server = commands.add_parser("serve")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8000)
    collector = commands.add_parser("collect")
    collector.add_argument("--provider", choices=["lambda", "tensordock", "vultr", "shadeform", "aws"])
    commands.add_parser("check-config")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.command == "serve":
        import uvicorn

        uvicorn.run(
            "spotbot.api:create_app", factory=True, host=args.host, port=args.port, workers=1
        )
    elif args.command == "collect":
        raise SystemExit(asyncio.run(collect(args.provider)))
    else:
        settings = Settings()
        print(
            json.dumps(
                {
                    "providers": {
                        name: bool(settings.key(name))
                        for name in ["lambda", "tensordock", "vultr", "shadeform"]
                    },
                    "enabled_providers": settings.spotbot_enabled_providers.split(","),
                    "live_orders_enabled": settings.spotbot_live_orders_enabled,
                    "dry_run_enabled": settings.spotbot_dry_run_enabled,
                    "aws_regions": settings.spotbot_aws_regions.split(","),
                    "aws_authentication": "standard_sdk_credential_chain",
                    "storage_backend": settings.spotbot_storage_backend,
                    "api_auth_configured": bool(settings.spotbot_api_key.get_secret_value()),
                    "gateway_callback_configured": bool(settings.spotbot_gateway_webhook_url),
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
