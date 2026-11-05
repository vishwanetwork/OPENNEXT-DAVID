"""Loopback-only OpenNEXT adapter for local Autopilot testing."""

import argparse
import logging
from urllib.parse import urlsplit

from spotbot.config import Settings
from spotbot.opennext import create_opennext_app


def local_origin(value):
    url = urlsplit(value)
    return (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"}
            and not url.username and not url.password and url.path in {"", "/"}
            and not url.query and not url.fragment)


def create_local_app(settings, *, skip_kyb=False, **kwargs):
    if not local_origin(settings.spotbot_opennext_legacy_origin) or not local_origin(
        settings.spotbot_opennext_public_url
    ):
        raise ValueError("local_adapter_requires_loopback_legacy_and_public_origins")
    app = create_opennext_app(settings, origin=settings.spotbot_opennext_legacy_origin, **kwargs)
    if skip_kyb:
        original = app.state.ops.kyb_case

        async def approved_for_local_testing(user_id):
            case = await original(user_id)
            if case:
                return dict(case, status="Approved")
            return dict(id="LOCAL-KYB-" + user_id, account=user_id,
                        email=user_id + "@local.invalid", mode="Auto", status="Approved",
                        revision=1, company={}, documents=[], submitted_at=None)

        app.state.ops.kyb_case = approved_for_local_testing
        logging.getLogger(__name__).warning("Local KYB bypass enabled; no verification records are changed")
    return app


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=None)
    parser.add_argument("--port", type=int, default=4191)
    parser.add_argument("--skip-kyb", action="store_true")
    args = parser.parse_args()
    app = create_local_app(Settings(_env_file=args.env_file), skip_kyb=args.skip_kyb)
    uvicorn.run(app, host="127.0.0.1", port=args.port)
