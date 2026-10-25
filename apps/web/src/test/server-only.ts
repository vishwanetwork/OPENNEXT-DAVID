// Test stand-in for Next's `server-only` marker: the real module throws when bundled for the
// client. Vitest resolves `server-only` here (see vitest.config.ts) so server modules can be
// unit-tested in isolation.
export {};
