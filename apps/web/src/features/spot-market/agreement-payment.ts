import type { BankTransferRequest } from '@/lib/buyer-kyb';
import type { SignedSpotAgreement, SpotAgreementService } from '@/lib/spot-agreement';
import { validateAgreementReceipt } from '@/features/agreements';
import type { PurchaseInput } from './checkout';

/** Only local checks before dispatch may produce this error; transport outcomes stay uncertain. */
export class PaymentNotStartedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentNotStartedError';
  }
}

function validateBeforeDispatch(validate: () => void) {
  try {
    validate();
  } catch (cause) {
    throw new PaymentNotStartedError(
      cause instanceof Error ? cause.message : 'Review the agreement before continuing to payment.',
    );
  }
}

/** No legacy fallback: signing and money movement must be bound by the same backend. */
export async function purchaseWithAgreement(
  service: SpotAgreementService | undefined,
  input: PurchaseInput,
) {
  if (!service || typeof service.purchaseByCredit !== 'function' || !input.agreement)
    throw new PaymentNotStartedError(
      'Agreement-linked payment is not connected yet. No payment was submitted.',
    );
  const { agreement, ...purchase } = input;
  validateBeforeDispatch(() => {
    if (purchase.durationHours !== purchase.expectedPricing.durationHours)
      throw new Error('The purchase duration does not match the signed order total.');
    validateAgreementReceipt(agreement, {
      ...agreement.context,
      purchaseReference: purchase.idempotencyKey,
      offerId: purchase.offerId,
      paymentMethod: 'credit',
      pricing: purchase.expectedPricing,
    });
  });
  const receipt = await service.purchaseByCredit({ agreement, purchase });
  if (receipt.agreementId !== agreement.agreementId)
    throw new Error(
      'Payment confirmation did not match the signed agreement. Check your order status before retrying.',
    );
  return receipt;
}

export async function transferWithAgreement(
  service: SpotAgreementService | undefined,
  agreement: SignedSpotAgreement,
  request: BankTransferRequest,
) {
  if (!service || typeof service.createBankTransfer !== 'function')
    throw new PaymentNotStartedError(
      'Agreement-linked bank transfer is not connected yet. No payment request was created.',
    );
  validateBeforeDispatch(() => {
    validateAgreementReceipt(agreement, agreement.context);
    if (
      agreement.context.paymentMethod !== 'bank_transfer' ||
      request.purpose !== 'order' ||
      request.offerId !== agreement.context.offerId ||
      request.amountCents !== agreement.context.pricing.totalCents ||
      request.durationHours !== agreement.context.pricing.durationHours ||
      request.purchaseReference !== agreement.context.purchaseReference ||
      request.idempotencyKey !== agreement.context.purchaseReference
    )
      throw new Error(
        'The bank transfer does not match the signed purchase. Review the agreement again.',
      );
  });
  const intent = await service.createBankTransfer({ agreement, request });
  if (intent.agreementId !== agreement.agreementId)
    throw new Error(
      'The payment request did not match the signed agreement. Contact support before paying.',
    );
  return intent;
}
