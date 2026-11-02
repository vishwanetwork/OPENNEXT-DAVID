"""Route complete rental lifetimes by their immutable, operator-enrolled account."""

import asyncio
import logging
from types import SimpleNamespace

from spotbot.aws_accounts import resolved_account
from spotbot.rentals import RentalEngine, identity

logger = logging.getLogger(__name__)


class RentalAccounts:
    def __init__(self, service, default):
        self.settings = service.settings
        self.default = default
        self.db = default.db
        self.engines = {"default": default}
        for name, provider in service.providers["aws"].fulfillment_providers().items():
            scoped = SimpleNamespace(
                settings=provider.settings,
                store=service.store,
                providers={**service.providers, "aws": provider},
            )
            engine = RentalEngine(scoped)
            engine.row_locks = default.row_locks
            self.engines[name] = engine
        self.lock = asyncio.Lock()

    @property
    def event_consumer_error(self):
        return next(
            (
                e.event_consumer_error
                for e in self.engines.values()
                if getattr(e, "event_consumer_error", None)
            ),
            None,
        )

    def for_row(self, row):
        name = row["rfq"].get("account", "default")
        if name not in self.engines:
            raise ValueError("aws_account_not_enrolled")
        engine = self.engines[name]
        if (
            row.get("aws_account_id")
            and row["aws_account_id"] != engine.settings.spotbot_aws_expected_account_id
        ):
            raise ValueError("aws_account_identity_mismatch")
        return engine

    def for_id(self, rental_id, tenant_id):
        row = self.default.get(rental_id, tenant_id)
        return self.for_row(row)

    def for_rules(self, rules):
        name = resolved_account(self.settings, rules)
        if name not in self.engines:
            raise ValueError("aws_account_not_enrolled")
        return self.engines[name], rules.model_copy(update={"account": name})

    def validate_rules(self, rules):
        engine, rules = self.for_rules(rules)
        return engine.validate_rules(rules)

    def candidates(self, rules, **kwargs):
        engine, rules = self.for_rules(rules)
        return engine.candidates(rules, **kwargs)

    def backend_for(self, rules):
        engine, _ = self.for_rules(rules)
        return engine.backend

    def create(self, request, tenant_id, key):
        existing = self.db.get("rental", identity("rental", tenant_id, key))
        if existing:
            engine = self.for_row(existing)
            name = existing["rfq"].get("account", "default")
            rules = (
                request.rfq.model_copy(update={"account": name})
                if request.rfq.account == "default"
                else request.rfq
            )
        else:
            engine, rules = self.for_rules(request.rfq)
        return engine.create(request.model_copy(update={"rfq": rules}), tenant_id, key)

    def get(self, rental_id, tenant_id):
        # Historical records remain readable after an enrollment has been removed.
        return self.default.get(rental_id, tenant_id)

    def row_lock(self, rental_id):
        return self.default.row_lock(rental_id)

    def generations(self, row):
        return self.default.generations(row)

    def backups(self, row):
        return self.default.backups(row)

    def current(self, row):
        return self.default.current(row)

    def ssh_keys(self, row):
        return self.default.ssh_keys(row)

    def task(self, row):
        return self.default.task(row)

    def cost(self, row):
        return self.for_row(row).cost(row)

    def request_backup(self, row, key, **kwargs):
        return self.for_row(row).request_backup(row, key, **kwargs)

    async def revise(self, rental_id, tenant_id, request, **kwargs):
        engine = self.for_id(rental_id, tenant_id)
        if request.rfq.account == "default":
            request = request.model_copy(
                update={
                    "rfq": request.rfq.model_copy(
                        update={"account": engine.settings.spotbot_aws_account_name}
                    )
                }
            )
        return await engine.revise(rental_id, tenant_id, request, **kwargs)

    async def release(self, rental_id, tenant_id):
        return await self.for_id(rental_id, tenant_id).release(rental_id, tenant_id)

    async def set_ssh_keys(self, rental_id, tenant_id, keys):
        return await self.for_id(rental_id, tenant_id).set_ssh_keys(rental_id, tenant_id, keys)

    async def set_task(self, rental_id, tenant_id, request):
        return await self.for_id(rental_id, tenant_id).set_task(rental_id, tenant_id, request)

    async def stop_task(self, rental_id, tenant_id):
        return await self.for_id(rental_id, tenant_id).stop_task(rental_id, tenant_id)

    async def recover(self, rental_id, tenant_id, backup_id=None):
        return await self.for_id(rental_id, tenant_id).recover(rental_id, tenant_id, backup_id)

    async def gateway_ack(self, rental_id, tenant_id, ack):
        return await self.for_id(rental_id, tenant_id).gateway_ack(rental_id, tenant_id, ack)

    async def agent_report(self, report):
        row = self.db.get("rental", report.rental_id)
        if not row:
            raise PermissionError("invalid_agent_identity")
        return await self.for_row(row).agent_report(report)

    async def reconcile(self, rental_id, tenant_id, **kwargs):
        return await self.for_id(rental_id, tenant_id).reconcile(rental_id, tenant_id, **kwargs)

    async def reconcile_backup(self, rental_id, tenant_id, backup_id, **kwargs):
        return await self.for_id(rental_id, tenant_id).reconcile_backup(
            rental_id, tenant_id, backup_id, **kwargs
        )

    async def tick(self):
        if self.lock.locked():
            return
        async with self.lock:
            for name, engine in self.engines.items():
                try:
                    await engine.tick()
                except Exception as exc:
                    logger.warning(
                        "AWS account rental cycle failed: account=%s error=%s",
                        name,
                        type(exc).__name__,
                    )

    async def run(self):
        while True:
            await self.tick()
            await asyncio.sleep(self.settings.spotbot_rental_worker_seconds)
