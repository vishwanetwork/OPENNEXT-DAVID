# 0005 — Contracts organised by backend resource and parsed with zod

Status: accepted (2026-10)

## Context

`packages/contracts` grew per front-end feature, so the same wire object (settlement rows,
credit top-ups, market records) was declared two or three times with drifting fields, and the
backend team had no single place to read what the UI expects.

## Decision

`packages/contracts/src/<resource>/index.ts` mirrors the backend resources: `auth`,
`marketplace`, `billing`, `pricing`, `news`, `contact`, `demo`, `admin`, `account`. One schema per
wire object; shared lenient parsers (`num`, `str`, `numberOrString`, `lenientArray`) live in
`_shared.ts`. Every feature `api.ts` parses responses with these schemas, and
`contracts.test.ts` pins representative fixtures. `docs/API_CONTRACT.md` lists the endpoints and
the hand-off notes for the Python backend.

## Consequences

- A backend change touches one schema and its fixture; the compiler finds every consumer.
- `.passthrough()` and string-or-number fields remain where the legacy server is inconsistent;
  they are the tightening list for the Python API.
- Contracts are versioned with the app (workspace package), not published separately.
