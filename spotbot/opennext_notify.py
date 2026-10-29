"""Order notices and usage billing for OpenNEXT Spot purchases while the customer is away.

Every 30 seconds the adapter lists the tenant's rentals and settles each customer's charges,
so usage is billed without the customer opening the Terminal. It also emails the customer
when something happens to an order:

- delivered: the server is running (with the SSH command once the gateway serves it)
- replacing / restored: a Spot interruption paused the service; the replacement is running
- ending soon: 30 minutes before the paid time ends
- billed: the order ended; the time used, the amount billed and the hold released
- refunded: no server was delivered and the hold was returned

Only charges that recorded an email at purchase get notices. A notice is recorded in the bot
database once sent, so restarts never repeat it; a failed send is retried on later passes.
"""

import asyncio
import ipaddress
import logging
import math
import smtplib
import ssl
from collections import defaultdict
from datetime import timedelta
from email.message import EmailMessage

from spotbot.models import timestamp, utcnow
from spotbot.opennext_ledger import account_id
from spotbot.rentals import at, identity
from spotbot.storage.workflows import ConflictError

KIND = "opennext_notice"
INTERVAL_SECONDS = 30
ENDING_SOON = timedelta(minutes=30)
# Wait this long after delivery for the gateway's SSH entry point before sending without it.
CONNECTION_WAIT = timedelta(minutes=2)
# Closed orders older than this have nothing left to settle or announce.
SETTLED_AFTER = timedelta(days=2)
MAX_ATTEMPTS = 5
# Refunds the customer did not already see as a purchase error.
REFUND_NOTICES = {"not_delivered", "rental_not_created"}

logger = logging.getLogger(__name__)


def money(cents):
    return f"${cents / 100:.2f}"


def when(value):
    return at(value).strftime("%Y-%m-%d %H:%M UTC")


def due(rental, charge, now, ssh=None):
    """`(key, subject, lines)` for every notice that applies to the order at `now`."""
    rfq = rental["rfq"]
    name = f"{rfq['gpu_count']} × {rfq['gpu_model']}"
    region = (rental.get("connection") or {}).get("region") or rfq["regions"][0]
    periods = rental.get("service_intervals") or []
    serving = rental["state"] == "ACTIVE" and not rental.get("end_requested")
    connect = (
        f"Connect: ssh -p {ssh['port']} {ssh.get('user') or 'ubuntu'}@{ssh['host']}"
        if ssh
        else "Find the SSH command under Terminal > Instances > Manage."
    )
    if not (rental.get("ssh_keys") or {}).get("keys"):
        connect = "Add your SSH public key under Terminal > Instances > Manage, then connect."
    result = []
    if serving and len(periods) == 1:
        result.append(
            (
                "delivered",
                f"Your {name} Spot server is running",
                [
                    f"Your {name} server in {region} is running.",
                    connect,
                    f"Paid time ends {when(rfq['expires_at'])}. You are billed per minute for "
                    "the time you use, with a 1-hour minimum. End the server when you are done.",
                ],
            )
        )
    if rental["state"] == "RECOVERING" and periods:
        result.append(
            (
                f"replacing-{len(periods)}",
                f"Your {name} Spot server is being replaced",
                [
                    "AWS reclaimed the Spot capacity behind your server. We are restoring your "
                    "disk from its latest backup onto a replacement server.",
                    "Billing is paused until the replacement is running.",
                ],
            )
        )
    if serving and len(periods) > 1:
        result.append(
            (
                f"restored-{len(periods)}",
                f"Your {name} Spot server is running again",
                [
                    f"A replacement {name} server in {region} is running with your restored "
                    "disk. Changes made after the latest backup may be missing.",
                    connect,
                ],
            )
        )
    if serving and timedelta(0) < at(rfq["expires_at"]) - now <= ENDING_SOON:
        result.append(
            (
                f"ending-{rfq['expires_at']}",
                f"Your {name} Spot server ends soon",
                [
                    f"Your {name} server's paid time ends {when(rfq['expires_at'])}.",
                    "Copy any results you need before then.",
                ],
            )
        )
    if charge["state"] == "billed":
        minutes = math.ceil(charge["service_seconds"] / 60)
        result.append(
            (
                "billed",
                f"Your {name} Spot server has ended",
                [
                    f"Time used: {minutes} minutes (billed per minute, 1-hour minimum).",
                    f"Billed {money(charge['billed_cents'])} of the {money(charge['cents'])} "
                    f"held; {money(charge['released_cents'])} returned to your Credit.",
                ],
            )
        )
    if charge["state"] == "refunded" and charge.get("reason") in REFUND_NOTICES:
        result.append(
            (
                "refunded",
                f"Your {name} Spot order was not filled",
                [
                    f"No {name} server could be delivered in {region} for this order.",
                    f"The full {money(charge['cents'])} was returned to your Credit.",
                ],
            )
        )
    return result


def loopback(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


class Mailer:
    """Plain-text email through SMTP with implicit TLS or required STARTTLS."""

    def __init__(self, host, port, sender, *, secure=False, user="", password=""):
        self.host, self.port, self.sender = host, port, sender
        self.secure = secure or port == 465
        self.user, self.password = user, password

    @classmethod
    def from_settings(cls, settings):
        if not settings.spotbot_opennext_smtp_host or not settings.spotbot_opennext_smtp_from:
            return None
        return cls(
            settings.spotbot_opennext_smtp_host,
            settings.spotbot_opennext_smtp_port,
            settings.spotbot_opennext_smtp_from,
            secure=settings.spotbot_opennext_smtp_secure,
            user=settings.spotbot_opennext_smtp_user,
            password=settings.spotbot_opennext_smtp_password.get_secret_value(),
        )

    def send(self, to, subject, text):
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = self.sender, to, subject
        message.set_content(text)
        context = ssl.create_default_context()
        if self.secure:
            client = smtplib.SMTP_SSL(self.host, self.port, context=context, timeout=20)
        else:
            client = smtplib.SMTP(self.host, self.port, timeout=20)
        with client:
            if not self.secure:
                client.ehlo()
                if client.has_extn("starttls"):
                    client.starttls(context=context)
                    client.ehlo()
                elif not loopback(self.host):
                    raise RuntimeError("smtp_starttls_unavailable")
            if self.user:
                client.login(self.user, self.password)
            client.send_message(message)


class Notifier:
    def __init__(self, db, market, ledger, mailer=None, public_url=""):
        self.db, self.market, self.ledger, self.mailer = db, market, ledger, mailer
        self.public_url = public_url.rstrip("/")
        self.sent = set()

    async def run(self):
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("opennext_notifier_failed")
            await asyncio.sleep(INTERVAL_SECONDS)

    async def tick(self, now=None):
        now = now or utcnow()
        customers = defaultdict(list)
        for rental in await self.market.rentals():
            reference = rental["rfq"].get("customer_ref") or ""
            if reference.startswith("opennext:"):
                customers[reference.removeprefix("opennext:")].append(rental)
        for user_id, rows in customers.items():
            if all(
                r["state"] == "CLOSED"
                and now - at(r.get("closed_at") or r["created_at"]) > SETTLED_AFTER
                for r in rows
            ):
                continue
            async with self.ledger.lock(user_id):
                await self.ledger.reconcile(user_id, rows)
                charges = await self.ledger.charges(user_id)
            if self.mailer:
                by_id = {r["id"]: r for r in rows}
                for charge in charges:
                    rental = by_id.get(charge.get("rental_id"))
                    if charge.get("email") and rental:
                        await self.notify(user_id, rental, charge, now)

    async def notify(self, user_id, rental, charge, now):
        pending = [n for n in due(rental, charge, now) if not await self.done(rental, n[0])]
        if any(key == "delivered" or key.startswith("restored-") for key, *_ in pending):
            ssh = await self.market.connection(rental["id"])
            started = (rental.get("service_intervals") or [{}])[-1].get("start")
            if not ssh and started and now - at(started) < CONNECTION_WAIT:
                return  # The gateway usually serves the route within seconds.
            keys = {key for key, *_ in pending}
            pending = [n for n in due(rental, charge, now, ssh) if n[0] in keys]
        for key, subject, lines in pending:
            await self.send(user_id, rental, charge["email"], key, subject, lines)

    def record_id(self, rental, key):
        return identity("opennext-notice", rental["id"], key)

    async def done(self, rental, key):
        record_id = self.record_id(rental, key)
        if record_id in self.sent:
            return True
        record = await asyncio.to_thread(self.db.get, KIND, record_id)
        if record and (record["state"] == "sent" or record["attempts"] >= MAX_ATTEMPTS):
            self.sent.add(record_id)
            return True
        return False

    async def send(self, user_id, rental, to, key, subject, lines):
        footer = [f"Open the Terminal: {self.public_url}/terminal"] if self.public_url else []
        text = "\n\n".join([*lines, *footer, f"Order {rental['id']}"]) + "\n"
        record_id = self.record_id(rental, key)
        record = await asyncio.to_thread(self.db.get, KIND, record_id) or dict(
            id=record_id,
            kind=KIND,
            tenant_id=account_id(user_id),
            rental_id=rental["id"],
            key=key,
            attempts=0,
            created_at=timestamp(),
            version=0,
        )
        try:
            await asyncio.to_thread(self.mailer.send, to, subject, text)
            state = "sent"
        except Exception as exc:
            # Never log the address or message: both are customer data.
            logger.warning(
                "opennext_notice_failed rental=%s key=%s error_type=%s",
                rental["id"],
                key,
                type(exc).__name__,
            )
            state = "failed"
        updated = dict(record, state=state, attempts=record["attempts"] + 1, updated_at=timestamp())
        try:
            await asyncio.to_thread(self.db.save, updated, record["version"])
        except ConflictError:
            return
        if state == "sent":
            self.sent.add(record_id)
