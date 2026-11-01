"""HTTPS and account-isolation checks; no cloud purchase or message delivery."""

import http.cookiejar
import json
import urllib.error
import urllib.request

from config import Invalid, validate


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def smoke(config, *, expect_empty=False):
    """Read-only checks apart from obtaining an operator session; never buy or send email."""
    validate(config, ready=True)
    cookies = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies), NoRedirect())

    def request(host, path, *, body=None, token=None, tenant=None, status=200):
        headers = {"Origin": "https://" + host}
        if token:
            headers["Authorization"] = "Bearer " + token
        if tenant:
            headers["X-SpotBot-Tenant"] = tenant
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            "https://" + host + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        try:
            response = client.open(req, timeout=45)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            if response.status != status:
                raise Invalid(
                    "Unexpected HTTP status for " + path + "; inspect production service logs."
                )
            raw = response.read(4 * 1024 * 1024)
            return json.loads(raw) if raw else {}

    d, s = config["domains"], config["secrets"]
    request(d["bot"], "/health")
    request(d["gateway"], "/health")
    request(d["bot"], "/v1/prices/latest", status=401)
    request(d["admin"], "/api/admin/users", status=401)
    request(d["terminal"], "/api/billing/paid-purchases", status=401)
    session = request(d["terminal"], "/api/auth/session")
    if session.get("user") is not None:
        raise Invalid("An anonymous production request unexpectedly contains an account.")
    request(d["admin"], "/api/admin/pricing/session", body={"token": s["admin_token"]})
    operations = request(d["admin"], "/api/admin/operations/session")
    if operations.get("confirmed") is not True or not {
        "accounts-v1",
        "kyb-bundle-v1",
        "direct-pay-continuation-v1",
    } <= set(operations.get("capabilities", [])):
        raise Invalid(
            "The deployed web image is missing the reviewed Console adapter capabilities."
        )
    if expect_empty:
        if request(d["admin"], "/api/admin/users")["totalUsers"] != 0:
            raise Invalid(
                "Production already has customer accounts; the empty-install assertion failed."
            )
        for path, key in (
            ("/api/admin/buyer-kyb", "cases"),
            ("/api/admin/payment-requests?kind=topup", "records"),
            ("/api/admin/payment-requests?kind=direct_pay", "records"),
            ("/api/admin/payments/credit", "payments"),
        ):
            if request(d["admin"], path)[key] != []:
                raise Invalid("Production contains customer workflow data; no data was changed.")
        rentals = request(
            d["bot"], "/v1/rentals", token=s["tenant_api"], tenant=config["project_name"]
        )
        if rentals["total"] != 0:
            raise Invalid("The production Bot tenant is not empty.")
    print("HTTPS, access controls and production Console capabilities verified.")
    if expect_empty:
        print("Verified zero production accounts, payments, KYB cases, Credit charges and rentals.")
