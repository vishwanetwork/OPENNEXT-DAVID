/**
 * Backend adapters that features consume through `useTerminalSlots().services`. They are
 * `undefined` until the corresponding backend capability exists; features must fail closed
 * (show the legacy "not connected yet" copy) rather than fabricate a result.
 */
import type { Instance } from '@opennext/contracts';
import type { BankTransferService, BuyerKybService } from '@/lib/buyer-kyb';

export interface AccountService {
  listSshKeys?: () => Promise<{ keys: unknown[] }>;
  addSshKey?: (input: {
    label: string;
    publicKey: string;
  }) => Promise<{ confirmed?: boolean; key?: unknown }>;
  removeSshKey?: (input: { id: string }) => Promise<{ confirmed?: boolean; id?: string }>;
}

export interface InstanceLifecycleAdapter {
  end: (input: {
    instanceId: string;
    confirmation: 'END';
  }) => Promise<{ confirmed?: boolean; instance?: Partial<Instance> & { id?: string } }>;
}

export interface CreditBalanceResult {
  confirmed?: boolean;
  accountId?: string;
  currency?: string;
  availableCredit?: number | null;
}

export interface PurchaseResult {
  confirmed?: boolean;
  offerId?: string;
  orderId?: string;
  currency?: string;
  durationHours?: number;
  totalCents?: number;
}

/**
 * Backend contract for Credit purchases (legacy `window.OpenNEXTSpotCheckout`). The backend must
 * authorize the session, lock the offer, independently calculate the duration subtotal and
 * 5% fee, check funds and apply idempotency. No client ledger changes.
 */
export interface SpotCheckoutService {
  getCreditBalance?(): Promise<CreditBalanceResult | null | undefined>;
  beginPurchase?(input: {
    pricingVersion: 'duration-v1';
    offerId: string;
    durationHours: number;
    expectedPricing: unknown;
    sshPublicKey: string | null;
    idempotencyKey: string;
  }): Promise<PurchaseResult | null | undefined>;
  /** Fallback balance refresh through the verified billing account (legacy exchange). */
  refreshBillingAccount?(): Promise<CreditBalanceResult | null | undefined>;
}

/** A purchase waiting for credit (Spot checkout) that a top-up can return to. */
export interface PurchaseContext {
  hasPending: () => boolean;
  reference: () => string;
  resume: () => void;
}

export interface TerminalServices {
  buyerKyb?: BuyerKybService;
  bankTransfer?: BankTransferService;
  account?: AccountService;
  instanceLifecycle?: InstanceLifecycleAdapter;
  spotCheckout?: SpotCheckoutService;
  purchaseContext?: PurchaseContext;
}
