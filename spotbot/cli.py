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
    gateway = commands.add_parser("gateway", help="Serve stable rental SSH and HTTP entry points")
    gateway.add_argument("--host", default="127.0.0.1")
    gateway.add_argument("--port", type=int, default=18084)
    readiness = commands.add_parser("rental-check", help="Read-only rental deployment preflight")
    readiness.add_argument("--rfq", required=True, help="Path to a structured rental request JSON")
    readiness.add_argument("--aws", action="store_true", help="Inspect AWS using read-only SDK calls")
    readiness.add_argument("--gateway", action="store_true", help="Also validate .env.gateway against bot settings")
    acceptance = commands.add_parser("rental-acceptance", help="Plan or explicitly execute a bounded staging recovery test")
    acceptance.add_argument("--rfq", required=True)
    acceptance.add_argument("--run-id", required=True, help="Unique UUID for this acceptance run")
    acceptance.add_argument("--report", help="New journal path; defaults to logs/acceptance/<run-id>.json")
    acceptance.add_argument("--execute", action="store_true", help="Create, recover and release a real rental using .env.acceptance")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.command == "serve":
        import uvicorn

        uvicorn.run(
            "spotbot.api:create_app", factory=True, host=args.host, port=args.port, workers=1
        )
    elif args.command == "gateway":
        import uvicorn

        logging.getLogger("httpx").setLevel(logging.WARNING)
        uvicorn.run(
            "spotbot.gateway:create_gateway_app", factory=True,
            host=args.host, port=args.port, workers=1, access_log=False,
        )
    elif args.command == "collect":
        raise SystemExit(asyncio.run(collect(args.provider)))
    elif args.command == "rental-check":
        from pathlib import Path

        from spotbot.gateway_config import GatewaySettings
        from spotbot.rental_models import RentalRequest
        from spotbot.rental_readiness import Readiness

        try:
            request = RentalRequest.model_validate_json(Path(args.rfq).read_text())
            result = asyncio.run(Readiness(Settings()).run(
                request.rfq, aws=args.aws, gateway=GatewaySettings() if args.gateway else None
            ))
        except Exception:
            print(json.dumps({"error": "invalid_readiness_configuration_or_rfq"}))
            raise SystemExit(1) from None
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["configuration_ready"] and result["cloud_preflight_passed"] is not False else 1)
    elif args.command == "rental-acceptance":
        from pathlib import Path

        from spotbot.rental_acceptance import Acceptance, AcceptanceError, AcceptanceSettings, plan
        from spotbot.rental_models import RentalRequest

        async def execute():
            runner = Acceptance(AcceptanceSettings(), request, args.run_id,
                args.report or Path("logs/acceptance") / (planned["run_id"] + ".json"))
            try:
                return await runner.execute()
            finally:
                await runner.close()

        try:
            request = RentalRequest.model_validate_json(Path(args.rfq).read_text())
            planned = plan(request, args.run_id)
            result = asyncio.run(execute()) if args.execute else planned
        except AcceptanceError as exc:
            print(json.dumps({"error": str(exc)}))
            raise SystemExit(1) from None
        except Exception:
            print(json.dumps({"error": "acceptance_failed_check_configuration_and_run_journal"}))
            raise SystemExit(1) from None
        print(json.dumps(result, indent=2))
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
