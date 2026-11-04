/**
 * Spot purchase checkout engine — a faithful port of the checkout half of
 * OpenNEXT-spot-market-preview.js as a dependency-injected state machine so the safety
 * rules (fresh verified balance, offer signature checks, idempotency, uncertain-payment
 * freeze, demo/preview rows never purchasable) can be unit-tested without a DOM.
 */
import type { CreditBalanceResult, PurchaseResult } from '@/terminal-kit';
import { FloatingSpotAcceptance, InferenceQuote } from '@opennext/contracts';
import type { z } from 'zod';
import type { BankTransferRequest } from '@/lib/buyer-kyb';
import type {
  AgreementPaymentMethod,
  SignedSpotAgreement,
  SpotAgreementContext,
} from '@/lib/spot-agreement';
import { validateAgreementReceipt } from '@/features/agreements';
import { PaymentNotStartedError } from './agreement-payment';
import { round, usd, type SpotRow } from './inventory';

export const CHECKOUT_STORAGE = 'opennext:pending-spot-purchase:v1:';
export const CHECKOUT_TTL = 2 * 60 * 60 * 1000;

export interface CheckoutTotals {
  currency: 'USD';
  durationHours: number;
  hourlyCents: number;
  baseCents: number;
  feeCents: number;
  totalCents: number;
}

export function durationHours(value: unknown): number {
  const text = String(value ?? '').trim();
  const hours = Number(text);
  // Usage is billed per minute with a 1-hour minimum, so shorter orders are not offered.
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(hours) || hours < 1)
    throw new Error('Enter a usage duration of at least 1 hour, with up to two decimal places.');
  return hours;
}

export function checkoutTotals(
  row: { instanceHourly: number },
  hours: unknown = 1,
): CheckoutTotals {
  const parsedHours = durationHours(hours);
  const hourlyCents = Math.round(row.instanceHourly * 100);
  const hundredthHours = Math.round(parsedHours * 100);
  const durationProduct = hourlyCents * hundredthHours;
  // The listed retail rate already includes the configured markup. Round the duration once.
  const baseCents = Math.round(durationProduct / 100);
  const feeCents = 0;
  const totalCents = baseCents + feeCents;
  if (
    ![hourlyCents, hundredthHours, durationProduct, baseCents, feeCents, totalCents].every(
      Number.isSafeInteger,
    ) ||
    hourlyCents <= 0 ||
    baseCents <= 0
  )
    throw new Error('Enter a valid duration with a payable total.');
  return {
    currency: 'USD',
    durationHours: parsedHours,
    hourlyCents,
    baseCents,
    feeCents,
    totalCents,
  };
}

export const signature = (row: SpotRow) =>
  JSON.stringify([
    row.id,
    row.term,
    row.model,
    row.country,
    row.gpuCount,
    row.vcpu,
    row.memory,
    row.instanceHourly,
    row.perGpuHourly,
    row.sourceKind,
    row.previewOnly,
  ]);

export type CheckoutStage = 'review' | 'payment' | 'confirm' | 'topup' | 'completed';

export interface CheckoutDraft {
  floatingAcceptance?: z.infer<typeof FloatingSpotAcceptance>;
  inferenceQuote?: InferenceQuote;
  inferenceBillingAcknowledged?: boolean;
  /** Model being quoted for this server; shown as selected until the quote settles. */
  quotingPresetId?: string;
  owner: string;
  key: string;
  row: SpotRow;
  stage: CheckoutStage;
  hoursRaw: string;
  durationHours: number;
  sshRaw: string;
  sshPublicKey: string;
  idempotencyKey: string;
  createdAt: number;
  balanceNeedsRefresh: boolean;
  reviewRequired: boolean;
  message: string;
  busy: boolean;
  paymentSubmitted?: boolean;
  /** Server-signed receipt is memory-only; never persisted with the resumable draft. */
  agreement?: SignedSpotAgreement;
  orderId?: string;
  /** Last validation/service error shown inside the dialog (legacy `[data-spot-checkout-error]`). */
  error: string;
}

export type { CreditBalanceResult, PurchaseResult };

export interface PurchaseInput {
  agreement?: SignedSpotAgreement;
  inferencePresetId?: string | null;
  inferenceBillingAcknowledged?: boolean;
  pricingVersion: 'duration-v1';
  offerId: string;
  durationHours: number;
  expectedPricing: CheckoutTotals;
  sshPublicKey: string | null;
  idempotencyKey: string;
}

/**
 * Backend contract for Credit purchases (legacy `OpenNEXTSpotCheckout`). The backend must
 * authorize the session, lock the offer, independently calculate the duration subtotal and
 * with no added service fee, check funds and apply idempotency. No client ledger changes.
 */
export interface SpotCheckoutService {
  inferenceQuote?: (offerId: string, presetId: string, hours: number) => Promise<InferenceQuote>;
  getCreditBalance?: () => Promise<CreditBalanceResult | null | undefined>;
  beginPurchase?: (input: PurchaseInput) => Promise<PurchaseResult | null | undefined>;
  /** Fallback balance refresh through the verified billing account (legacy exchange). */
  refreshBillingAccount?: () => Promise<CreditBalanceResult | null | undefined>;
}

export interface CheckoutDeps {
  /** `demo:<id>:<role>` / `account:<id>:<role>`, or null when signed out. */
  owner: () => string | null;
  role: () => string;
  userId: () => string | undefined;
  /** Demo workspace or demo user: purchases are never dispatched. */
  isDemo: () => boolean;
  balance: () => number | null;
  setBalance: (value: number) => void;
  inventory: () => SpotRow[];
  service: () => SpotCheckoutService;
  verifyKyb?: () => Promise<boolean>;
  /** Explicit rollout policy; missing means the existing purchase flow remains active. */
  agreementRequired?: () => boolean;
  beginBankTransfer?: (
    input: BankTransferRequest,
    agreement?: SignedSpotAgreement,
  ) => Promise<boolean>;
  validateSsh: (value: unknown) => Promise<string>;
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now: () => number;
  uuid: () => string;
  open: (type: string, extra?: Record<string, unknown>) => void;
  closeModal: () => void;
  toast: (message: string) => void;
  go: (route: string) => void;
}

export const CHECKOUT_MODALS = [
  'spot-review',
  'spot-payment-choice',
  'spot-agreement',
  'spot-credit-confirm',
  'spot-purchase-complete',
] as const;

export class SpotCheckout {
  private draft: CheckoutDraft | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(private deps: CheckoutDeps) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private storageKey(): string | null {
    const id = this.deps.owner();
    return id ? CHECKOUT_STORAGE + encodeURIComponent(id) : null;
  }
  private clearStored() {
    try {
      const key = this.storageKey();
      if (key) this.deps.storage()?.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
  private savePending() {
    const draft = this.draft;
    const key = this.storageKey();
    if (!draft || !key || draft.owner !== this.deps.owner() || draft.stage === 'completed') return;
    try {
      this.deps.storage()?.setItem(
        key,
        JSON.stringify({
          version: 2,
          owner: draft.owner,
          offerId: draft.row.id,
          signature: signature(draft.row),
          durationHours: durationHours(draft.hoursRaw),
          sshPublicKey: draft.sshPublicKey || '',
          idempotencyKey: draft.idempotencyKey,
          paymentSubmitted: !!draft.paymentSubmitted,
          createdAt: draft.createdAt,
          inferenceQuote: draft.inferenceQuote,
          inferenceBillingAcknowledged: draft.inferenceBillingAcknowledged,
          floatingAcceptance: draft.floatingAcceptance,
        }),
      );
    } catch {
      this.deps.toast('The purchase is retained in this tab. Browser storage is unavailable.');
    }
  }

  /** The current account's draft, restored from session storage when needed. */
  pending(): CheckoutDraft | null {
    const id = this.deps.owner();
    if (!id) return null;
    if (this.draft?.owner === id) return this.draft;
    this.draft = null;
    try {
      const stored = JSON.parse(
        this.deps.storage()?.getItem(this.storageKey()!) || 'null',
      ) as Record<string, unknown> | null;
      const now = this.deps.now();
      if (
        !stored ||
        stored.version !== 2 ||
        stored.owner !== id ||
        !Number.isFinite(stored.createdAt) ||
        now - Number(stored.createdAt) > CHECKOUT_TTL ||
        Number(stored.createdAt) > now + 60000 ||
        typeof stored.idempotencyKey !== 'string' ||
        stored.idempotencyKey.length > 100
      )
        return null;
      const row = this.deps
        .inventory()
        .find((item) => item.id === stored.offerId && item.term === 'Spot');
      if (!row) return null;
      const ssh = stored.sshPublicKey ? this.restoreSsh(String(stored.sshPublicKey)) : '';
      const hours = durationHours(stored.durationHours);
      checkoutTotals(row, hours);
      this.draft = {
        owner: id,
        key: row._key,
        row: { ...row },
        stage: 'payment',
        hoursRaw: String(hours),
        durationHours: hours,
        sshPublicKey: ssh,
        sshRaw: ssh,
        idempotencyKey: stored.idempotencyKey,
        paymentSubmitted: stored.paymentSubmitted === true,
        createdAt: Number(stored.createdAt),
        balanceNeedsRefresh: true,
        reviewRequired: stored.signature !== signature(row),
        message: '',
        busy: false,
        error: '',
        inferenceQuote: InferenceQuote.safeParse(stored.inferenceQuote).success
          ? InferenceQuote.parse(stored.inferenceQuote)
          : undefined,
        inferenceBillingAcknowledged: stored.inferenceBillingAcknowledged === true,
        floatingAcceptance: FloatingSpotAcceptance.safeParse(stored.floatingAcceptance).success
          ? FloatingSpotAcceptance.parse(stored.floatingAcceptance)
          : undefined,
      };
    } catch {
      this.clearStored();
    }
    return this.draft;
  }
  /** Stored keys were validated when saved; `restoreSsh` only re-parses the material synchronously. */
  restoreSsh: (value: string) => string = (value) => value;

  hasPending(): boolean {
    const draft = this.pending();
    return Boolean(draft && draft.stage !== 'completed');
  }

  recordFloating(acceptance: z.infer<typeof FloatingSpotAcceptance>) {
    const draft = this.pending();
    if (!draft) throw new Error('This purchase is no longer available.');
    draft.floatingAcceptance = acceptance;
    draft.paymentSubmitted = true;
    this.savePending();
    this.notify();
  }

  completeFloating(orderId: string, showConfirmation = true) {
    const draft = this.pending();
    if (!draft) return;
    draft.orderId = orderId;
    draft.stage = 'completed';
    draft.paymentSubmitted = false;
    draft.floatingAcceptance = undefined;
    this.clearStored();
    this.notify();
    if (showConfirmation) this.deps.open('spot-purchase-complete');
  }

  rejectFloating() {
    const draft = this.pending();
    if (!draft) return;
    draft.floatingAcceptance = undefined;
    draft.paymentSubmitted = false;
    this.savePending();
    this.notify();
  }
  purchaseReference(): string | null {
    return this.pending()?.idempotencyKey || null;
  }

  beginCheckout(row: SpotRow) {
    if (row.quota?.maxInstances === 0)
      return this.deps.toast(
        'No quota is currently available for this server. Choose another offer.',
      );
    if (!this.deps.owner() || this.deps.role() !== 'buyer')
      return this.deps.toast('Sign in to a Buyer account before purchasing capacity.');
    if (this.pending()?.paymentSubmitted)
      return this.deps.toast(
        'A payment is awaiting confirmation. Check its order status before starting another purchase.',
      );
    this.clearStored();
    this.draft = {
      owner: this.deps.owner()!,
      key: row._key,
      row: { ...row },
      stage: 'review',
      hoursRaw: '1',
      durationHours: 1,
      sshRaw: '',
      sshPublicKey: '',
      idempotencyKey: this.deps.uuid(),
      createdAt: this.deps.now(),
      balanceNeedsRefresh: false,
      reviewRequired: false,
      message: '',
      busy: false,
      error: '',
    };
    this.notify();
    this.deps.open('spot-review');
  }

  /** Current inventory row for the draft; throws (and re-opens review) when the offer changed. */
  liveRow(): SpotRow {
    const draft = this.pending();
    if (!draft) throw new Error('This purchase is no longer available. Choose the offer again.');
    const row = this.deps
      .inventory()
      .find((item) => item.id === draft.row.id && item.term === 'Spot');
    if (!row) throw new Error('This Spot offer is no longer available. Choose another offer.');
    if (draft.paymentSubmitted && (draft.reviewRequired || signature(row) !== signature(draft.row)))
      throw new Error(
        'The offer changed while payment confirmation is pending. Check your order status before trying again.',
      );
    if (signature(row) !== signature(draft.row)) {
      draft.inferenceQuote = undefined;
      draft.inferenceBillingAcknowledged = false;
      draft.row = { ...row };
      draft.key = row._key;
      draft.reviewRequired = true;
      draft.stage = 'review';
      draft.message =
        'This offer has changed. Review its current specifications and hourly price before continuing.';
      this.notify();
      this.deps.open('spot-review');
      throw new Error(draft.message);
    }
    return pricedRow(draft, row);
  }

  availableCredit(): number | null {
    const value = Number(this.deps.balance());
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  agreementContext(method: AgreementPaymentMethod): SpotAgreementContext {
    const draft = this.pending();
    const accountId = this.deps.userId();
    if (!draft || !accountId) throw new Error('Choose a Spot offer in your Buyer account first.');
    const row = this.liveRow();
    return {
      accountId,
      purchaseReference: this.purchaseReference() ?? draft.idempotencyKey,
      offerId: row.id,
      offerFingerprint: signature(row),
      model: row.model,
      gpuCount: row.gpuCount,
      vcpu: row.vcpu ?? null,
      memoryGbPerGpu: row.memory ?? null,
      country: row.country,
      paymentMethod: method,
      pricing: checkoutTotals(row, draft.hoursRaw),
    };
  }

  recordAgreement(receipt: SignedSpotAgreement): void {
    const draft = this.pending();
    if (!draft || draft.busy || draft.paymentSubmitted || draft.stage !== 'payment')
      throw new Error('The purchase changed. Return to payment selection.');
    draft.agreement = validateAgreementReceipt(
      receipt,
      this.agreementContext(receipt.context.paymentMethod),
      this.deps.now(),
    );
    draft.error = '';
    this.notify();
  }

  requiresAgreement(): boolean {
    return this.deps.agreementRequired?.() === true;
  }

  private signedAgreement(method: AgreementPaymentMethod): SignedSpotAgreement | undefined {
    if (!this.requiresAgreement()) return undefined;
    return validateAgreementReceipt(
      this.pending()?.agreement,
      this.agreementContext(method),
      this.deps.now(),
    );
  }

  private requireAgreement(method: AgreementPaymentMethod): boolean {
    if (!this.requiresAgreement()) return true;
    if (this.pending()?.inferenceQuote || this.pending()?.floatingAcceptance)
      throw new Error(
        'Agreement-linked model and floating purchases are not connected yet. No payment was submitted.',
      );
    // Inventory errors must retain their review step rather than opening an obsolete agreement.
    const context = this.agreementContext(method);
    try {
      validateAgreementReceipt(this.pending()?.agreement, context, this.deps.now());
      return true;
    } catch {
      if (this.pending()?.paymentSubmitted)
        throw new Error(
          'Payment confirmation is pending. Check your order status before signing or paying again.',
        );
      this.deps.open('spot-agreement', { method });
      return false;
    }
  }
  insufficientCredit(draft: CheckoutDraft): boolean {
    const balance = this.availableCredit();
    return (
      balance !== null &&
      Math.round(balance * 100) < checkoutTotals(pricedRow(draft), draft.hoursRaw).totalCents
    );
  }

  private showError(message: string) {
    if (this.draft) this.draft.error = message;
    this.notify();
    this.deps.toast(message);
  }

  setHoursRaw(value: string) {
    const draft = this.pending();
    if (!draft || draft.busy) return;
    draft.hoursRaw = value;
    draft.error = '';
    this.notify();
  }
  setSshRaw(value: string) {
    const draft = this.pending();
    if (!draft) return;
    draft.sshRaw = value;
    this.notify();
  }

  acknowledgeInference(value: boolean) {
    const draft = this.pending();
    if (!draft || draft.busy) return;
    draft.inferenceBillingAcknowledged = value;
    this.notify();
  }

  async selectInference(presetId: string) {
    const draft = this.pending();
    if (!draft || draft.busy || draft.paymentSubmitted || draft.stage !== 'review') return;
    draft.busy = true;
    draft.quotingPresetId = presetId || undefined;
    draft.error = '';
    this.notify();
    try {
      const service = this.deps.service();
      const quote = presetId
        ? await service.inferenceQuote?.(draft.row.id, presetId, durationHours(draft.hoursRaw))
        : undefined;
      if (this.pending() !== draft) return;
      if (presetId && (!quote || quote.inferencePresetId !== presetId))
        throw new Error('The model quote could not be confirmed.');
      draft.inferenceQuote = quote;
      draft.inferenceBillingAcknowledged = false;
      draft.idempotencyKey = this.deps.uuid();
    } catch (error) {
      if (this.pending() === draft) this.showError((error as Error).message);
    } finally {
      draft.busy = false;
      draft.quotingPresetId = undefined;
      this.notify();
    }
  }

  private async refreshCredit(): Promise<number> {
    const draft = this.pending();
    const id = this.deps.owner();
    const service = this.deps.service();
    if (!draft) throw new Error('The purchase draft is no longer available.');
    let result: CreditBalanceResult | null | undefined;
    if (typeof service.getCreditBalance === 'function') result = await service.getCreditBalance();
    else if (typeof service.refreshBillingAccount === 'function')
      result = await service.refreshBillingAccount();
    else
      throw Object.assign(
        new Error('Your available Credit could not be refreshed. Please try again.'),
        { code: 'CREDIT_SERVICE_UNAVAILABLE' },
      );
    if (this.deps.owner() !== id || this.pending() !== draft)
      throw new Error('Your account changed. Review the purchase again.');
    const value = Number(result?.availableCredit);
    if (
      result?.confirmed !== true ||
      result.accountId !== this.deps.userId() ||
      result.currency !== 'USD' ||
      result.availableCredit === null ||
      result.availableCredit === undefined ||
      !Number.isFinite(value) ||
      value < 0
    )
      throw new Error('The account service did not confirm your available Credit.');
    this.deps.setBalance(round(value));
    draft.balanceNeedsRefresh = false;
    this.notify();
    return round(value);
  }

  openTopup() {
    const draft = this.pending();
    if (!draft) return;
    draft.stage = 'topup';
    draft.balanceNeedsRefresh = true;
    draft.message = '';
    this.savePending();
    this.notify();
    this.deps.open('pay-start', { spotCheckout: true });
  }

  resumeCheckout(): boolean {
    const draft = this.pending();
    if (!draft) {
      this.deps.toast('There is no saved Spot purchase in this account.');
      return false;
    }
    try {
      this.liveRow();
    } catch (error) {
      this.showError((error as Error).message);
      return true;
    }
    if (draft.reviewRequired) {
      draft.stage = 'review';
      this.notify();
      this.deps.open('spot-review');
      return true;
    }
    draft.stage = 'payment';
    draft.message = '';
    this.notify();
    this.deps.open('spot-payment-choice');
    return true;
  }

  async chooseCredit(): Promise<void> {
    const draft = this.pending();
    if (!draft || draft.busy) return;
    draft.busy = true;
    this.notify();
    try {
      if (draft.stage !== 'payment')
        throw new Error('Review the purchase and choose a payment method first.');
      this.liveRow();
      if (draft.reviewRequired) return this.deps.open('spot-review');
      let balance = this.availableCredit();
      if (draft.balanceNeedsRefresh) {
        try {
          balance = await this.refreshCredit();
        } catch (error) {
          // A known shortfall can still offer Deposit Credit; authorizing a purchase always requires a fresh, verified balance.
          if (
            (error as { code?: string }).code !== 'CREDIT_SERVICE_UNAVAILABLE' ||
            this.pending() !== draft ||
            balance === null ||
            !this.insufficientCredit(draft)
          )
            throw error;
        }
      }
      if (this.pending() !== draft) return;
      const fresh = this.liveRow();
      if (draft.reviewRequired) return this.deps.open('spot-review');
      if (balance === null) throw new Error('Your available Credit has not been confirmed.');
      checkoutTotals(fresh, draft.hoursRaw);
      if (
        !this.deps.isDemo() &&
        !fresh.previewOnly &&
        fresh.sourceKind === 'agent' &&
        !this.insufficientCredit(draft) &&
        !this.requireAgreement('credit')
      )
        return;
      draft.stage = 'confirm';
      draft.message = '';
      draft.error = '';
      this.deps.open('spot-credit-confirm');
    } catch (error) {
      this.showError((error as Error).message);
    } finally {
      draft.busy = false;
      this.notify();
    }
  }

  async authorizeCredit(): Promise<void> {
    const draft = this.pending();
    if (!draft || draft.busy) return;
    const previouslySubmitted = Boolean(draft.paymentSubmitted);
    draft.busy = true;
    this.notify();
    try {
      if (draft.stage !== 'confirm')
        throw new Error('Confirm the purchase duration and total before authorizing payment.');
      const row = this.liveRow();
      if (this.deps.role() !== 'buyer')
        throw new Error('A Buyer account is required to purchase capacity.');
      if (draft.reviewRequired)
        throw new Error('Review the updated offer before authorizing payment.');
      const confirmedHours = durationHours(draft.hoursRaw);
      const confirmedSsh = draft.sshPublicKey;
      const expectedSignature = signature(row);
      const expectedPricing = checkoutTotals(row, confirmedHours);
      const confirmDetails = () => {
        if (durationHours(draft.hoursRaw) !== confirmedHours || draft.sshPublicKey !== confirmedSsh)
          throw new Error(
            'The purchase duration or SSH key changed. Review the updated purchase before paying.',
          );
      };
      if (
        this.deps.isDemo() ||
        row.previewOnly ||
        row.sourceKind !== 'agent' ||
        draft.row.previewOnly ||
        draft.row.sourceKind !== 'agent'
      )
        throw new Error(
          'This purchase flow is for testing only. No Credit was charged and no order or instance was created.',
        );
      if (!(await this.deps.verifyKyb?.()))
        throw new Error('Complete Buyer KYB approval before purchasing capacity.');
      if (this.pending() !== draft || this.deps.owner() !== draft.owner) return;
      const balance = await this.refreshCredit();
      confirmDetails();
      if (Math.round(balance * 100) < expectedPricing.totalCents) {
        draft.busy = false;
        this.notify();
        return this.deps.open('spot-credit-confirm');
      }
      const service = this.deps.service();
      if (!this.requireAgreement('credit')) {
        draft.stage = 'payment';
        return;
      }
      if (typeof service.beginPurchase !== 'function')
        throw new Error(
          'Credit payment is not connected yet. No Credit was charged and no order was created.',
        );
      const ssh = await this.deps.validateSsh(confirmedSsh);
      if (this.pending() !== draft || this.deps.owner() !== draft.owner) return;
      confirmDetails();
      const fresh = this.liveRow();
      if (draft.reviewRequired || signature(fresh) !== expectedSignature)
        throw new Error(
          'The offer changed during validation. Review its current price before paying.',
        );
      const agreement = this.signedAgreement('credit');
      draft.paymentSubmitted = true;
      this.savePending();
      const result = await service.beginPurchase({
        pricingVersion: 'duration-v1',
        offerId: fresh.id,
        durationHours: expectedPricing.durationHours,
        expectedPricing,
        sshPublicKey: ssh || null,
        idempotencyKey: draft.idempotencyKey,
        ...(agreement ? { agreement } : {}),
        ...(draft.inferenceQuote
          ? {
              inferencePresetId: draft.inferenceQuote.inferencePresetId,
              inferenceBillingAcknowledged: draft.inferenceBillingAcknowledged === true,
            }
          : {}),
      });
      if (this.deps.owner() !== draft.owner || this.pending() !== draft) return;
      if (
        result?.confirmed !== true ||
        result.offerId !== fresh.id ||
        typeof result.orderId !== 'string' ||
        !result.orderId ||
        result.orderId.length > 200 ||
        result.currency !== 'USD' ||
        result.durationHours !== expectedPricing.durationHours ||
        result.totalCents !== expectedPricing.totalCents
      )
        throw new Error(
          'The purchase total and duration have not been confirmed. Check your order status before trying again.',
        );
      draft.orderId = result.orderId;
      draft.stage = 'completed';
      this.clearStored();
      this.deps.open('spot-purchase-complete');
    } catch (error) {
      // A first-attempt refusal may unlock review. No retry failure can erase an earlier
      // uncertain submission, including a preflight or payment HTTP 4xx response.
      const status = (error as { status?: unknown }).status;
      if (
        draft.paymentSubmitted &&
        !previouslySubmitted &&
        (error instanceof PaymentNotStartedError ||
          (typeof status === 'number' && status >= 400 && status < 500))
      ) {
        draft.paymentSubmitted = false;
        this.savePending();
      }
      this.showError((error as Error).message);
    } finally {
      draft.busy = false;
      this.notify();
    }
  }

  async chooseDirect(): Promise<void> {
    const draft = this.pending();
    if (!draft || draft.busy) return;
    draft.busy = true;
    this.notify();
    try {
      const row = this.liveRow();
      const hours = durationHours(draft.hoursRaw);
      const expected = signature(row);
      if (draft.stage !== 'payment' || draft.paymentSubmitted || draft.reviewRequired)
        throw new Error('Review the purchase before choosing bank transfer.');
      if (this.deps.isDemo() || row.previewOnly || row.sourceKind !== 'agent')
        throw new Error('Bank transfers are unavailable for this inventory.');
      if (!(await this.deps.verifyKyb?.()))
        throw new Error('Complete Buyer KYB approval before purchasing capacity.');
      if (this.pending() !== draft || this.deps.owner() !== draft.owner) return;
      if (
        this.deps.role() !== 'buyer' ||
        signature(this.liveRow()) !== expected ||
        durationHours(draft.hoursRaw) !== hours
      )
        throw new Error('Your account or purchase changed. Review it before continuing.');
      if (!this.deps.beginBankTransfer)
        throw new Error('Bank transfer is not connected yet. No payment request was created.');
      if (!this.requireAgreement('bank_transfer')) return;
      const agreement = this.signedAgreement('bank_transfer');
      const started = await this.deps.beginBankTransfer(
        {
          purpose: 'order',
          currency: 'USD',
          offerId: row.id,
          amountCents: checkoutTotals(row, hours).totalCents,
          durationHours: hours,
          sshPublicKey: draft.sshPublicKey || null,
          purchaseReference: this.purchaseReference() || undefined,
          idempotencyKey: draft.idempotencyKey,
          ...(draft.inferenceQuote
            ? {
                inferencePresetId: draft.inferenceQuote.inferencePresetId,
                inferenceBillingAcknowledged: draft.inferenceBillingAcknowledged === true,
              }
            : {}),
        },
        agreement,
      );
      if (!started && this.pending() === draft)
        throw new Error(
          'Bank transfer instructions could not be confirmed. Please retry or contact support. No payment was taken.',
        );
    } catch (error) {
      if (this.pending() === draft) this.showError((error as Error).message);
    } finally {
      draft.busy = false;
      this.notify();
    }
  }

  /** Legacy `data-act="spot-checkout-*"` dispatcher. */
  action(act: string): boolean {
    if (!act.startsWith('spot-checkout-')) return false;
    const draft = this.pending();
    if (act === 'spot-checkout-resume') {
      this.resumeCheckout();
      return true;
    }
    if (!draft) {
      this.deps.toast('Choose a Spot offer to start a purchase.');
      return true;
    }
    if (draft.busy) {
      this.deps.toast('Please wait for the current payment step to finish.');
      return true;
    }
    if (draft.paymentSubmitted && ['spot-checkout-cancel', 'spot-checkout-review'].includes(act)) {
      this.deps.toast(
        'Payment confirmation is pending. Check your order status before changing or cancelling this purchase.',
      );
      return true;
    }
    switch (act) {
      case 'spot-checkout-cancel':
        this.clearStored();
        this.draft = null;
        this.notify();
        this.deps.closeModal();
        return true;
      case 'spot-checkout-review':
        draft.stage = 'review';
        draft.message = '';
        this.notify();
        this.deps.open('spot-review');
        return true;
      case 'spot-checkout-payment':
        draft.stage = 'payment';
        draft.message = '';
        this.notify();
        this.deps.open('spot-payment-choice');
        return true;
      case 'spot-checkout-credit':
        void this.chooseCredit();
        return true;
      case 'spot-checkout-deposit':
        if (draft.stage === 'confirm' && !draft.busy) this.openTopup();
        return true;
      case 'spot-checkout-direct':
        void this.chooseDirect();
        return true;
      case 'spot-checkout-authorize':
        void this.authorizeCredit();
        return true;
      case 'spot-checkout-instances':
        this.draft = null;
        this.deps.closeModal();
        this.notify();
        this.deps.go('instances');
        return true;
      default:
        return false;
    }
  }

  /** Review form submission: validates duration and SSH key, then moves to payment choice. */
  async reviewPurchase(data: {
    durationHours: unknown;
    sshPublicKey: unknown;
  }): Promise<{ error: string } | null> {
    const draft = this.pending();
    if (!draft || draft.busy) return null;
    draft.busy = true;
    this.notify();
    try {
      if (draft.paymentSubmitted)
        throw new Error(
          'Payment confirmation is pending. Check your order status before changing this purchase.',
        );
      const hours = durationHours(data.durationHours);
      if (draft.inferenceQuote && !draft.inferenceBillingAcknowledged)
        throw new Error('Confirm that model preparation uses paid GPU time.');
      const reviewedSignature = signature(this.liveRow());
      checkoutTotals(pricedRow(draft), hours);
      draft.hoursRaw = String(data.durationHours);
      const ssh = await this.deps.validateSsh(data.sshPublicKey);
      if (this.pending() !== draft) return null;
      const currentRow = this.liveRow();
      if (signature(currentRow) !== reviewedSignature)
        throw new Error(
          'The offer changed during validation. Review the updated price before continuing.',
        );
      if (durationHours(draft.hoursRaw) !== hours)
        throw new Error('The usage duration changed. Review the total before continuing.');
      if (draft.durationHours !== hours || draft.sshPublicKey !== ssh)
        draft.idempotencyKey = this.deps.uuid();
      draft.durationHours = hours;
      draft.hoursRaw = String(hours);
      draft.sshPublicKey = ssh;
      draft.sshRaw = ssh;
      draft.reviewRequired = false;
      draft.message = '';
      draft.error = '';
      draft.stage = 'payment';
      draft.busy = false;
      this.notify();
      this.deps.open('spot-payment-choice');
      return null;
    } catch (error) {
      const message = (error as Error).message;
      if (this.draft === draft) draft.error = message;
      this.deps.toast(message);
      this.notify();
      return { error: message };
    } finally {
      draft.busy = false;
      this.notify();
    }
  }
}

export function pricedRow(draft: CheckoutDraft, row = draft.row): SpotRow {
  const cents = draft.inferenceQuote?.pricing.hourlyCents;
  return cents
    ? { ...row, instanceHourly: cents / 100, perGpuHourly: cents / 100 / row.gpuCount }
    : row;
}

/** Markup helper data for the totals block (legacy `totalsMarkup`). */
export function totalsView(
  row: SpotRow,
  hours: unknown,
): { total: CheckoutTotals | null; hourly: string } {
  let total: CheckoutTotals | null = null;
  try {
    total = checkoutTotals(row, hours);
  } catch {
    total = null;
  }
  return { total, hourly: usd(row.instanceHourly) };
}
