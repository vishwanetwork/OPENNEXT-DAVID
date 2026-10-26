import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVIDER_LOGOS } from './provider-logos';
import { PROVIDER_REFERENCES } from './provider-references';

describe('registered source reference assets', () => {
  it('ships a real local brand asset and official API reference for all 24 registered suppliers', () => {
    expect(Object.keys(PROVIDER_LOGOS)).toHaveLength(24);
    expect(Object.keys(PROVIDER_REFERENCES).sort()).toEqual(Object.keys(PROVIDER_LOGOS).sort());
    for (const logo of Object.values(PROVIDER_LOGOS)) {
      const asset = resolve(process.cwd(), 'public', logo.src.slice(1));
      expect(existsSync(asset), logo.src).toBe(true);
      expect(readFileSync(asset).byteLength).toBeGreaterThan(100);
    }
  });

  it('does not invent endpoints for unverified or restricted pricing APIs', () => {
    for (const id of ['modal', 'lightning', 'oci', 'coreweave', 'cudo', 'tensordock']) {
      expect(PROVIDER_REFERENCES[id]?.endpoints).toEqual([]);
    }
    for (const entry of Object.values(PROVIDER_REFERENCES)) {
      expect(entry.docs).toMatch(/^https:\/\//);
      expect(entry.auth.length).toBeGreaterThan(0);
      expect(entry.limitation.length).toBeGreaterThan(0);
    }
  });
});
