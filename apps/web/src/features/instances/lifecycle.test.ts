import { describe, expect, it } from 'vitest';
import { eligibility, lifecycle, sshCommand, telemetry } from './lifecycle';

const now = Date.parse('2026-10-20T00:00:00Z');
const future = new Date(now + 3600000).toISOString();
const fresh = { utilizationPercent: 40, observedAt: new Date(now - 1000).toISOString() };

describe('lifecycle', () => {
  it('normalizes known states without inventing non-Spot reconnection', () => {
    expect(lifecycle({ status: 'Running', serviceEnd: future }, now).label).toBe('Running');
    expect(lifecycle({ status: 'interrupted', term: 'Spot', serviceEnd: future }, now).label).toBe(
      'Connecting',
    );
    expect(
      lifecycle({ status: 'interrupted', term: 'On-demand', serviceEnd: future }, now).label,
    ).toBe('Awaiting status');
    expect(
      lifecycle({ status: 'Running', serviceEnd: new Date(now - 1).toISOString() }, now).label,
    ).toBe('End');
    expect(lifecycle({ status: 'released' }, now).ended).toBe(true);
    expect(lifecycle({ status: 'Mystery', serviceEnd: future }, now).label).toBe('Awaiting status');
  });
  it('telemetry is fresh only within two minutes and the 0–100 range', () => {
    expect(telemetry({ telemetry: fresh }, now)).toMatchObject({ fresh: true, value: 40 });
    expect(
      telemetry(
        { telemetry: { utilizationPercent: 40, observedAt: new Date(now - 200000).toISOString() } },
        now,
      ).fresh,
    ).toBe(false);
    expect(
      telemetry({ telemetry: { utilizationPercent: 140, observedAt: fresh.observedAt } }, now)
        .fresh,
    ).toBe(false);
    expect(telemetry({}, now).fresh).toBe(false);
  });
  it('resale keeps the telemetry, payment, whole-GPU, threshold and Spot interruption guards', () => {
    const base = {
      status: 'Running',
      serviceEnd: future,
      resaleAllowed: true,
      paymentStatus: 'Paid',
      telemetry: fresh,
      availableResellCount: 2,
      term: 'Spot',
    };
    expect(eligibility(base, 'Buyer', now).allowed).toBe(true);
    expect(eligibility(base, 'Seller', now).reason).toMatch(/buyer capacity/);
    expect(eligibility({ ...base, resaleAllowed: false }, 'Buyer', now).reason).toMatch(
      /permission/,
    );
    expect(eligibility({ ...base, paymentStatus: 'Unpaid' }, 'Buyer', now).reason).toMatch(
      /active, paid/,
    );
    expect(
      eligibility({ ...base, telemetry: { ...fresh, utilizationPercent: 96 } }, 'Buyer', now)
        .reason,
    ).toMatch(/95%/);
    expect(eligibility({ ...base, availableResellCount: 0 }, 'Buyer', now).reason).toMatch(
      /idle GPUs/,
    );
    expect(eligibility({ ...base, status: 'interrupted' }, 'Buyer', now).reason).toMatch(
      /active, paid/,
    );
    expect(
      eligibility(
        {
          ...base,
          telemetry: { utilizationPercent: 40, observedAt: new Date(now - 500000).toISOString() },
        },
        'Buyer',
        now,
      ).reason,
    ).toMatch(/telemetry/);
  });
  it('only builds an ssh command from safe host, user and port values', () => {
    expect(sshCommand({ sshHost: 'gpu.example.com', sshUser: 'ubuntu', sshPort: 2222 })).toBe(
      'ssh -p 2222 ubuntu@gpu.example.com',
    );
    expect(sshCommand({ sshHost: 'gpu.example.com; rm -rf /', sshUser: 'ubuntu' })).toBe('');
    expect(sshCommand({})).toBe('');
  });
});
