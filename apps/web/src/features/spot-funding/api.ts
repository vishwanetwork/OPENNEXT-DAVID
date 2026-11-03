import type { SpotFundingLookup, SpotFundingService } from '@/lib/spot-funding';
import { confirmedSpotFundingAccount, confirmedSpotFundingOrder } from './validation';

/** Calls only the explicitly supplied adapter; this proposal defines no live endpoint. */
export const spotFundingApi = {
  async account(
    service: SpotFundingService,
    accountId: string,
    demo: boolean,
    signal?: AbortSignal,
  ) {
    const result = confirmedSpotFundingAccount(
      await service.loadAccount({ signal }),
      accountId,
      demo,
    );
    if (!result) throw new Error('A confirmed Spot funding record for this account is required.');
    return result;
  },
  async order(
    service: SpotFundingService,
    accountId: string,
    demo: boolean,
    lookup: SpotFundingLookup,
    cursor = '',
    signal?: AbortSignal,
  ) {
    const result = confirmedSpotFundingOrder(
      await service.loadOrder({ ...lookup, cursor, signal }),
      accountId,
      demo,
      lookup,
    );
    if (!result) throw new Error('A confirmed Spot funding record for this order is required.');
    return result;
  },
};
