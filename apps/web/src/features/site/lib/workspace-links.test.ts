import { describe, expect, it } from 'vitest';
import { demoOpportunityPath, implicitRole, readRoleIntent, targetRoute, workspacePath, writeRoleIntent } from './workspace-links';

describe('workspace links', () => {
  it('maps public targets to terminal routes', () => {
    expect(targetRoute('gpus')).toBe('market');
    expect(targetRoute('rfq')).toBe('rfqs');
    expect(targetRoute('supply')).toBe('supply');
    expect(targetRoute('models')).toBe('models');
    expect(targetRoute(undefined)).toBe('market');
  });
  it('derives onboarding hints only for supply and RFQ targets', () => {
    expect(implicitRole('supply')).toBe('seller');
    expect(implicitRole('rfq')).toBe('buyer');
    expect(implicitRole('gpus')).toBe('');
  });
  it('carries role, listing and opportunity parameters like the legacy hash URL', () => {
    const url = new URL(workspacePath({ route: 'models', role: 'buyer', listing: { id: 'model-quote-gpt-5.6-sol-long', intent: 'buy' } }), 'https://terminal.example');
    expect(url.pathname).toBe('/models');
    expect(url.searchParams.get('listing')).toBe('model-quote-gpt-5.6-sol-long');
    expect(url.searchParams.get('intent')).toBe('buy');
    expect(url.searchParams.get('role')).toBe('buyer');
    expect(workspacePath({ route: 'supply', role: '', opportunity: { id: 'RFQ-1', intent: 'offer' } })).toBe('/supply?role=buyer&opportunity=RFQ-1&intent=offer');
  });
  it('deep links showcase listings into the demo workspace', () => {
    expect(demoOpportunityPath('SUP-1', 'buy')).toBe('/demo/market?role=buyer&opportunity=SUP-1&intent=buy');
    expect(demoOpportunityPath('RFQ-1', 'offer')).toBe('/demo/market?role=seller&opportunity=RFQ-1&intent=offer');
  });
  it('round-trips the session role intent and ignores stale or invalid entries', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeRoleIntent(storage, 'seller');
    expect(readRoleIntent(storage)?.role).toBe('seller');
    store.set('opennext-auth-role-intent-v1:account', JSON.stringify({ role: 'seller', updatedAt: Date.now() - 2 * 86_400_000 }));
    expect(readRoleIntent(storage)).toBeNull();
    store.set('opennext-auth-role-intent-v1:account', JSON.stringify({ role: 'broker', updatedAt: Date.now() }));
    expect(readRoleIntent(storage)).toBeNull();
  });
});
