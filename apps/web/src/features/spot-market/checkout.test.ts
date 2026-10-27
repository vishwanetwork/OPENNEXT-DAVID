import { describe, expect, it } from 'vitest';
import { at } from '@/test/at';
import { webcrypto, generateKeyPairSync } from 'node:crypto';
import { sshTestRuntime as runtime } from '@/test/ssh-runtime';
import {
  SpotCheckout,
  checkoutTotals,
  type CheckoutDeps,
  type CreditBalanceResult,
  type PurchaseInput,
  type SpotCheckoutService,
} from './checkout';
import { normalizeInjected, type SpotRow } from './inventory';
import { fingerprint, validatePublicKey } from '@/features/account/ssh-keys';

const fixture = {
  id: 'offer-one',
  model: 'H100 SXM',
  country: 'Singapore',
  gpuCount: 8,
  vcpu: 192,
  memory: 80,
  perGpuHourly: 1.8,
  term: 'Spot',
};
const agent = {
  ...fixture,
  agentStatus: 'Succeeded',
  serverRecord: true,
  status: 'Published',
  executable: true,
};
const wireField = (value: Buffer | string) => {
  const buf = Buffer.from(value);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(buf.length);
  return Buffer.concat([header, buf]);
};
const publicKey =
  'ssh-ed25519 ' +
  Buffer.concat([
    wireField('ssh-ed25519'),
    wireField(
      generateKeyPairSync('ed25519')
        .publicKey.export({ type: 'spki', format: 'der' })
        .subarray(-32),
    ),
  ]).toString('base64');

interface Env {
  engine: SpotCheckout;
  ctx: {
    balance: number;
    role: string;
    userId: string;
    demo: boolean;
    modal: { type: string; [k: string]: unknown } | null;
    opened: { type: string }[];
    messages: string[];
    route: string;
    orders: unknown[];
  };
  storage: Map<string, string>;
  setRows: (rows: unknown[]) => void;
  row: SpotRow;
  fingerprintGate: {
    fn: ((parsed: ReturnType<typeof validatePublicKey>) => Promise<string>) | null;
  };
}

function setup({
  rows = [fixture],
  demo = true,
  storage = new Map<string, string>(),
  service,
  begin = true,
}: {
  rows?: unknown[];
  demo?: boolean;
  storage?: Map<string, string>;
  service?: SpotCheckoutService;
  begin?: boolean;
} = {}): Env {
  let inventory = normalizeInjected(rows);
  const ctx: Env['ctx'] = {
    balance: 100,
    role: 'buyer',
    userId: 'buyer-one',
    demo,
    modal: null,
    opened: [],
    messages: [],
    route: '',
    orders: [],
  };
  const fingerprintGate: Env['fingerprintGate'] = { fn: null };
  const deps: CheckoutDeps = {
    owner: () =>
      ctx.userId ? (ctx.demo ? 'demo:' : 'account:') + ctx.userId + ':' + ctx.role : null,
    role: () => ctx.role,
    userId: () => ctx.userId,
    isDemo: () => ctx.demo,
    balance: () => ctx.balance,
    setBalance: (value) => {
      ctx.balance = value;
    },
    inventory: () => inventory,
    service: () => service || {},
    validateSsh: async (value) => {
      const text = String(value || '').trim();
      if (!text) return '';
      const parsed = validatePublicKey(text, runtime);
      await (fingerprintGate.fn ? fingerprintGate.fn(parsed) : fingerprint(parsed, runtime));
      return parsed.publicKey;
    },
    storage: () => ({
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    }),
    now: () => Date.now(),
    uuid: () => webcrypto.randomUUID(),
    open: (type, extra = {}) => {
      ctx.modal = { type, ...extra };
      ctx.opened.push(ctx.modal);
    },
    closeModal: () => {
      ctx.modal = null;
    },
    toast: (message) => {
      ctx.messages.push(message);
    },
    go: (route) => {
      ctx.route = route;
    },
  };
  const engine = new SpotCheckout(deps);
  engine.restoreSsh = (value) => validatePublicKey(value, runtime).publicKey;
  const row = at(inventory, 0);
  if (begin) engine.beginCheckout(row);
  return {
    engine,
    ctx,
    storage,
    row,
    fingerprintGate,
    setRows: (next) => {
      inventory = normalizeInjected(next);
    },
  };
}
const wallet = (): CreditBalanceResult => ({
  confirmed: true,
  accountId: 'buyer-one',
  currency: 'USD',
  availableCredit: 100,
});
const confirmation = (input: PurchaseInput) => ({
  confirmed: true,
  offerId: input.offerId,
  orderId: 'ORDER-BACKEND-1',
  currency: 'USD',
  durationHours: input.durationHours,
  totalCents: input.expectedPricing.totalCents,
});
async function toPayment(env: Env, key = '', hours = '1') {
  await env.engine.reviewPurchase({ durationHours: hours, sshPublicKey: key });
  expect(env.ctx.modal?.type).toBe('spot-payment-choice');
}
function deposit(env: Env) {
  expect(env.ctx.modal?.type).toBe('spot-credit-confirm');
  env.engine.action('spot-checkout-deposit');
  expect(env.ctx.modal?.type).toBe('pay-start');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Spot checkout totals', () => {
  it('review uses editable duration, aggregate computation and a flat 5% fee', () => {
    const { row } = setup();
    const total = checkoutTotals(row);
    expect([total.baseCents, total.feeCents, total.totalCents]).toEqual([1440, 72, 1512]);
  });
  it('duration multiplication rounds the aggregate fee rather than each hourly fee', () => {
    expect(checkoutTotals({ instanceHourly: 0.1 }, 3)).toEqual({
      currency: 'USD',
      durationHours: 3,
      hourlyCents: 10,
      baseCents: 30,
      feeCents: 2,
      totalCents: 32,
    });
    const fractional = checkoutTotals({ instanceHourly: 1.11 }, 2.5);
    expect([fractional.baseCents, fractional.feeCents, fractional.totalCents]).toEqual([
      278, 14, 292,
    ]);
    const halfCent = checkoutTotals({ instanceHourly: 0.25 }, 0.58);
    expect([halfCent.baseCents, halfCent.feeCents, halfCent.totalCents]).toEqual([15, 1, 16]);
    expect(() => checkoutTotals({ instanceHourly: 0.01 }, 0.01)).toThrow(/payable total/);
  });
  it('invalid, zero, overprecise and unsafe durations cannot advance checkout', async () => {
    for (const hours of [
      '',
      null,
      undefined,
      '0',
      '-1',
      'abc',
      'NaN',
      'Infinity',
      '1e3',
      '1.001',
      '90071992547409910',
    ]) {
      const env = setup();
      const result = await env.engine.reviewPurchase({ durationHours: hours, sshPublicKey: '' });
      expect(env.ctx.modal?.type, String(hours)).toBe('spot-review');
      expect(result?.error, String(hours)).toMatch(/duration|total/);
      expect(env.ctx.balance).toBe(100);
    }
  });
});

describe('Spot checkout safety', () => {
  it('optional SSH accepts blank; Direct Pay never calls a gateway', async () => {
    const env = setup();
    await toPayment(env);
    expect(env.engine.pending()?.sshPublicKey).toBe('');
    env.engine.action('spot-checkout-direct');
    expect(env.ctx.messages.at(-1)).toMatch(/not connected/);
    expect(env.ctx.balance).toBe(100);
  });
  it('invalid/private SSH stays on review; valid public key persists across modal navigation', async () => {
    const env = setup();
    const result = await env.engine.reviewPurchase({
      durationHours: '1',
      sshPublicKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
    });
    expect(env.ctx.modal?.type).toBe('spot-review');
    expect(result?.error).toMatch(/public key|private key/i);
    await toPayment(env, publicKey);
    env.engine.action('spot-checkout-review');
    expect(env.engine.pending()?.sshRaw).toBe(publicKey);
  });
  it('insufficient credit shows Deposit Credit and opens top-up only after selection', async () => {
    const env = setup();
    env.ctx.balance = 0;
    await toPayment(env, publicKey, '12.5');
    await env.engine.chooseCredit();
    expect(env.engine.insufficientCredit(env.engine.pending()!)).toBe(true);
    expect(env.storage.size).toBe(0);
    deposit(env);
    expect(env.ctx.balance).toBe(0);
    expect(env.storage.size).toBe(1);
    env.engine.resumeCheckout();
    expect(env.ctx.modal?.type).toBe('spot-payment-choice');
    expect(env.engine.pending()?.sshPublicKey).toBe(publicKey);
    expect(env.engine.pending()?.durationHours).toBe(12.5);
    await env.engine.chooseCredit();
    expect(env.ctx.modal?.type).toBe('spot-credit-confirm');
    expect(env.ctx.balance).toBe(0);
  });
  it('top-up return updates balance only from the authoritative account response', async () => {
    let purchaseCalls = 0;
    const env = setup({
      service: {
        getCreditBalance: async () => wallet(),
        beginPurchase: async () => {
          purchaseCalls++;
          return null;
        },
      },
    });
    env.ctx.balance = 0;
    await toPayment(env);
    await env.engine.chooseCredit();
    deposit(env);
    env.engine.resumeCheckout();
    expect(env.ctx.balance).toBe(0);
    await env.engine.chooseCredit();
    expect(env.ctx.balance).toBe(100);
    expect(env.ctx.modal?.type).toBe('spot-credit-confirm');
    expect(purchaseCalls).toBe(0);
  });
  it('wrong-account and unconfirmed balances fail closed', async () => {
    for (const response of [
      { ...wallet(), confirmed: false },
      { ...wallet(), accountId: 'someone-else' },
      { ...wallet(), availableCredit: null },
    ]) {
      const env = setup({ service: { getCreditBalance: async () => response } });
      env.ctx.balance = 0;
      await toPayment(env);
      await env.engine.chooseCredit();
      deposit(env);
      env.engine.resumeCheckout();
      await env.engine.chooseCredit();
      expect(env.ctx.balance).toBe(0);
      expect(env.ctx.modal?.type).toBe('spot-payment-choice');
      expect(env.ctx.messages.at(-1)).toMatch(/did not confirm/);
    }
  });
  it('Demo and fixture rows never invoke the purchase adapter even with sufficient Credit', async () => {
    for (const variant of [
      { rows: [agent], demo: true },
      { rows: [fixture], demo: false },
    ]) {
      let calls = 0;
      const env = setup({
        ...variant,
        service: {
          getCreditBalance: async () => wallet(),
          beginPurchase: async () => {
            calls++;
            return null;
          },
        },
      });
      await toPayment(env);
      await env.engine.chooseCredit();
      await env.engine.authorizeCredit();
      expect(calls).toBe(0);
      expect(env.ctx.balance).toBe(100);
      expect(env.ctx.messages.at(-1)).toMatch(/testing only/);
    }
  });
  it('real confirmed flow submits explicit duration and aggregate fee without mutating the client ledger', async () => {
    let calls = 0;
    let payload: PurchaseInput | undefined;
    const env = setup({
      rows: [agent],
      demo: false,
      service: {
        getCreditBalance: async () => wallet(),
        beginPurchase: async (input) => {
          calls++;
          payload = input;
          return confirmation(input);
        },
      },
    });
    await toPayment(env, '', '2.5');
    await env.engine.authorizeCredit();
    expect(calls).toBe(0);
    await env.engine.chooseCredit();
    expect(calls).toBe(0);
    await env.engine.authorizeCredit();
    expect(calls).toBe(1);
    expect(payload?.pricingVersion).toBe('duration-v1');
    expect(payload?.durationHours).toBe(2.5);
    expect(payload?.sshPublicKey).toBeNull();
    expect(payload?.expectedPricing).toEqual({
      currency: 'USD',
      durationHours: 2.5,
      hourlyCents: 1440,
      baseCents: 3600,
      feeCents: 180,
      totalCents: 3780,
    });
    expect(env.ctx.balance).toBe(100);
    expect(env.ctx.modal?.type).toBe('spot-purchase-complete');
    expect(env.engine.hasPending()).toBe(false);
    await env.engine.authorizeCredit();
    expect(calls).toBe(1);
  });
  it('exact available credit is sufficient but an authoritative shortfall prevents a purchase', async () => {
    let calls = 0;
    const env = setup({
      rows: [agent],
      demo: false,
      service: {
        getCreditBalance: async () => ({ ...wallet(), availableCredit: 30.24 }),
        beginPurchase: async (input) => {
          calls++;
          return confirmation(input);
        },
      },
    });
    env.ctx.balance = 30.24;
    await toPayment(env, '', '2');
    await env.engine.chooseCredit();
    expect(env.engine.insufficientCredit(env.engine.pending()!)).toBe(false);
    await env.engine.authorizeCredit();
    expect(calls).toBe(1);
    const short = setup({
      rows: [agent],
      demo: false,
      service: {
        getCreditBalance: async () => ({ ...wallet(), availableCredit: 30.23 }),
        beginPurchase: async () => {
          calls++;
          return null;
        },
      },
    });
    await toPayment(short, '', '2');
    await short.engine.chooseCredit();
    await short.engine.authorizeCredit();
    expect(calls).toBe(1);
    expect(short.ctx.modal?.type).toBe('spot-credit-confirm');
    expect(short.engine.insufficientCredit(short.engine.pending()!)).toBe(true);
  });
  it('a legacy metered adapter never receives a duration-based purchase', async () => {
    let calls = 0;
    const env = setup({
      rows: [agent],
      demo: false,
      service: {
        getCreditBalance: async () => wallet(),
        ...({
          beginMeteredPurchase: async () => {
            calls++;
          },
        } as object),
      },
    });
    await toPayment(env, '', '2');
    await env.engine.chooseCredit();
    await env.engine.authorizeCredit();
    expect(calls).toBe(0);
    expect(env.ctx.messages.at(-1)).toMatch(/not connected/);
    expect(env.ctx.modal?.type).toBe('spot-credit-confirm');
  });
  it('confirmation must match the offer, currency, full total and duration', async () => {
    for (const mismatch of [
      { confirmed: false },
      { offerId: 'another-offer' },
      { currency: 'EUR' },
      { durationHours: 1 },
      { totalCents: 1 },
      { orderId: '' },
    ]) {
      const env = setup({
        rows: [agent],
        demo: false,
        service: {
          getCreditBalance: async () => wallet(),
          beginPurchase: async (input) => ({ ...confirmation(input), ...mismatch }),
        },
      });
      await toPayment(env, '', '2');
      await env.engine.chooseCredit();
      await env.engine.authorizeCredit();
      expect(env.ctx.modal?.type).not.toBe('spot-purchase-complete');
      expect(env.ctx.messages.at(-1)).toMatch(/not been confirmed/);
      expect(env.ctx.balance).toBe(100);
    }
  });
  it('unconfigured and unconfirmed real purchases never claim success', async () => {
    for (const result of [null, { confirmed: false }]) {
      const service: SpotCheckoutService = { getCreditBalance: async () => wallet() };
      if (result) service.beginPurchase = async () => result;
      const env = setup({ rows: [agent], demo: false, service });
      await toPayment(env);
      await env.engine.chooseCredit();
      await env.engine.authorizeCredit();
      expect(env.ctx.modal?.type).toBe('spot-credit-confirm');
      expect(env.ctx.balance).toBe(100);
      expect(env.ctx.messages.at(-1)).toMatch(/not connected|not been confirmed/);
    }
  });
  it('quote changes during SSH validation require review again', async () => {
    const env = setup();
    const gate = deferred<string>();
    env.fingerprintGate.fn = () => gate.promise;
    const promise = env.engine.reviewPurchase({ durationHours: '1', sshPublicKey: publicKey });
    env.setRows([{ ...fixture, perGpuHourly: 3 }]);
    gate.resolve('SHA256:test');
    await promise;
    expect(env.ctx.modal?.type).toBe('spot-review');
    expect(env.engine.pending()?.reviewRequired).toBe(true);
    expect(env.ctx.messages.at(-1)).toMatch(/offer has changed/);
  });
  it('duration changes during review SSH validation cannot advance to payment', async () => {
    const env = setup();
    const gate = deferred<string>();
    env.fingerprintGate.fn = () => gate.promise;
    const promise = env.engine.reviewPurchase({ durationHours: '2', sshPublicKey: publicKey });
    env.engine.pending()!.hoursRaw = '3';
    gate.resolve('SHA256:test');
    const result = await promise;
    expect(env.ctx.modal?.type).toBe('spot-review');
    expect(result?.error).toMatch(/duration changed/);
  });
  it('quote changes during balance refresh or final SSH validation prevent any purchase call', async () => {
    const gate = deferred<CreditBalanceResult>();
    let calls = 0;
    const env = setup({
      rows: [agent],
      demo: false,
      service: {
        getCreditBalance: () => gate.promise,
        beginPurchase: async () => {
          calls++;
          return null;
        },
      },
    });
    await toPayment(env);
    await env.engine.chooseCredit();
    const promise = env.engine.authorizeCredit();
    env.setRows([{ ...agent, perGpuHourly: 3 }]);
    gate.resolve(wallet());
    await promise;
    expect(calls).toBe(0);
    expect(env.ctx.modal?.type).toBe('spot-review');
    expect(env.engine.pending()?.reviewRequired).toBe(true);

    const ssh = setup({
      rows: [agent],
      demo: false,
      service: {
        getCreditBalance: async () => wallet(),
        beginPurchase: async () => {
          calls++;
          return null;
        },
      },
    });
    await toPayment(ssh, publicKey);
    await ssh.engine.chooseCredit();
    const sshGate = deferred<string>();
    const started = deferred<void>();
    ssh.fingerprintGate.fn = () => {
      started.resolve();
      return sshGate.promise;
    };
    const authorize = ssh.engine.authorizeCredit();
    await started.promise;
    ssh.setRows([{ ...agent, perGpuHourly: 3 }]);
    sshGate.resolve('SHA256:test');
    await authorize;
    expect(calls).toBe(0);
    expect(ssh.ctx.modal?.type).toBe('spot-review');
  });
  it('stored top-up draft restores only for its account; legacy or invalid durations are never authorized', async () => {
    const first = setup();
    first.ctx.balance = 0;
    await toPayment(first, publicKey, '3.25');
    await first.engine.chooseCredit();
    deposit(first);
    const second = setup({ storage: first.storage, begin: false });
    expect(second.engine.hasPending()).toBe(true);
    expect(second.engine.pending()?.balanceNeedsRefresh).toBe(true);
    expect(second.engine.pending()?.sshPublicKey).toBe(publicKey);
    expect(second.engine.pending()?.durationHours).toBe(3.25);
    second.ctx.userId = 'different-account';
    expect(second.engine.hasPending()).toBe(false);
    const [key, value] = at([...first.storage], 0);
    const saved = JSON.parse(value) as Record<string, unknown>;
    for (const override of [
      { version: 1 },
      { durationHours: 0 },
      { durationHours: -1 },
      { durationHours: 'NaN' },
      { durationHours: '90071992547409910' },
    ]) {
      const env = setup({
        storage: new Map([[key, JSON.stringify({ ...saved, ...override })]]),
        begin: false,
      });
      expect(env.engine.hasPending()).toBe(false);
    }
  });
  it('top-up return can refresh from the verified billing account service', async () => {
    let refreshes = 0;
    const service: SpotCheckoutService = {};
    const env = setup({ service });
    env.ctx.balance = 0;
    await toPayment(env, publicKey, '2');
    await env.engine.chooseCredit();
    deposit(env);
    env.engine.resumeCheckout();
    service.refreshBillingAccount = async () => {
      refreshes++;
      return wallet();
    };
    await env.engine.chooseCredit();
    expect(refreshes).toBe(1);
    expect(env.ctx.balance).toBe(100);
    expect(env.ctx.modal?.type).toBe('spot-credit-confirm');
  });
  it('uncertain payment freezes cancellation, edits and replacement purchases; retries reuse the identical payload', async () => {
    const payloads: PurchaseInput[] = [];
    const service: SpotCheckoutService = {
      getCreditBalance: async () => wallet(),
      beginPurchase: async (input) => {
        payloads.push(JSON.parse(JSON.stringify(input)));
        return { confirmed: false };
      },
    };
    const env = setup({ rows: [agent], demo: false, service });
    await toPayment(env, publicKey, '2');
    await env.engine.chooseCredit();
    await env.engine.authorizeCredit();
    const draft = env.engine.pending()!;
    const key = draft.idempotencyKey;
    expect(draft.paymentSubmitted).toBe(true);
    for (const action of ['spot-checkout-review', 'spot-checkout-cancel']) {
      env.engine.action(action);
      expect(env.engine.pending()).toBe(draft);
      expect(env.ctx.modal?.type).toBe('spot-credit-confirm');
      expect(env.ctx.messages.at(-1)).toMatch(/confirmation is pending/);
    }
    env.engine.beginCheckout(env.row);
    expect(env.engine.pending()).toBe(draft);
    expect(env.ctx.messages.at(-1)).toMatch(/awaiting confirmation/);
    const result = await env.engine.reviewPurchase({ durationHours: '4', sshPublicKey: '' });
    expect(result?.error).toMatch(/confirmation is pending/);
    expect(draft.durationHours).toBe(2);
    expect(draft.idempotencyKey).toBe(key);
    await env.engine.authorizeCredit();
    expect(payloads.length).toBe(2);
    expect(payloads[1]).toEqual(payloads[0]);
    const restored = setup({
      rows: [agent],
      demo: false,
      storage: env.storage,
      service,
      begin: false,
    });
    expect(restored.engine.pending()?.paymentSubmitted).toBe(true);
    await restored.engine.chooseCredit();
    await restored.engine.authorizeCredit();
    expect(payloads.length).toBe(3);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(restored.ctx.balance).toBe(100);
  });
  it('a definite refusal unlocks review; network failures stay pending', async () => {
    const failures = [
      Object.assign(new Error('Add a valid SSH public key. No order was created.'), {
        status: 400,
      }),
      Object.assign(new Error('Unable to reach OpenNEXT.'), { status: 0 }),
    ];
    const service: SpotCheckoutService = {
      getCreditBalance: async () => wallet(),
      beginPurchase: async () => {
        throw failures.shift();
      },
    };
    const env = setup({ rows: [agent], demo: false, service });
    await toPayment(env, '', '2');
    await env.engine.chooseCredit();
    await env.engine.authorizeCredit();
    const draft = env.engine.pending()!;
    expect(draft.paymentSubmitted).toBe(false);
    expect(draft.error).toMatch(/No order was created/);
    env.engine.action('spot-checkout-review');
    expect(env.ctx.modal?.type).toBe('spot-review');
    await env.engine.reviewPurchase({ durationHours: '2', sshPublicKey: publicKey });
    await env.engine.chooseCredit();
    await env.engine.authorizeCredit();
    expect(env.engine.pending()?.paymentSubmitted).toBe(true);
  });
  it('changed inventory cannot reuse an uncertain purchase against a new price', async () => {
    let calls = 0;
    const service: SpotCheckoutService = {
      getCreditBalance: async () => wallet(),
      beginPurchase: async () => {
        calls++;
        return { confirmed: false };
      },
    };
    const first = setup({ rows: [agent], demo: false, service });
    await toPayment(first, '', '2');
    await first.engine.chooseCredit();
    await first.engine.authorizeCredit();
    first.setRows([{ ...agent, perGpuHourly: 2.5 }]);
    await first.engine.authorizeCredit();
    expect(calls).toBe(1);
    expect(first.ctx.messages.at(-1)).toMatch(
      /offer changed while payment confirmation is pending/,
    );
    const restored = setup({
      rows: [{ ...agent, perGpuHourly: 2.5 }],
      demo: false,
      storage: first.storage,
      service,
      begin: false,
    });
    await restored.engine.chooseCredit();
    expect(calls).toBe(1);
    expect(restored.ctx.messages.at(-1)).toMatch(
      /offer changed while payment confirmation is pending/,
    );
    expect(restored.engine.pending()?.paymentSubmitted).toBe(true);
  });
  it('editing a purchase before submission creates a fresh idempotency key', async () => {
    const env = setup();
    const firstKey = env.engine.pending()!.idempotencyKey;
    await toPayment(env, '', '2');
    const secondKey = env.engine.pending()!.idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    env.engine.action('spot-checkout-review');
    await toPayment(env, '', '3');
    expect(env.engine.pending()!.idempotencyKey).not.toBe(secondKey);
    expect(env.engine.pending()!.durationHours).toBe(3);
    expect(env.engine.pending()!.paymentSubmitted).toBeUndefined();
  });
});
