/**
 * Central TanStack Query key factory. One entry per backend resource so that every
 * `/api/*` read has exactly one key, and invalidation is expressed by prefix.
 */
export const queryKeys = {
  auth: {
    session: ['auth', 'session'] as const,
    config: ['auth', 'config'] as const,
  },
  pricing: {
    all: ['pricing'] as const,
    prices: ['pricing', 'prices'] as const,
    catalog: ['pricing', 'history-catalog'] as const,
    regionalHistory: (query: string) => ['pricing', 'regional-history', query] as const,
    ticker: ['pricing', 'ticker'] as const,
  },
  news: ['news'] as const,
  marketplace: {
    all: ['marketplace'] as const,
    public: ['marketplace', 'public'] as const,
    reference: ['marketplace', 'reference-catalog'] as const,
    settlements: (days: number | 'all') => ['marketplace', 'settlements', days] as const,
  },
  /** Records owned by the signed-in account; `identity` = id + role + demo scope. */
  account: {
    all: ['account'] as const,
    workspace: (identity: string) => ['account', 'workspace', identity] as const,
    matches: (identity: string, model: string, region: string) =>
      ['account', 'matches', identity, model, region] as const,
    billing: (identity: string) => ['account', 'billing', identity] as const,
    topup: (identity: string, id: string) => ['account', 'topup', identity, id] as const,
  },
  site: {
    curatedRfqs: ['site', 'homepage-rfqs'] as const,
    showcase: ['site', 'demo-showcase'] as const,
  },
  admin: {
    all: ['admin'] as const,
    session: ['admin', 'pricing-session'] as const,
    providers: ['admin', 'pricing-providers'] as const,
    runs: (provider?: string) => ['admin', 'pricing-runs', provider ?? ''] as const,
    run: (id: string) => ['admin', 'pricing-run', id] as const,
    prices: (provider: string) => ['admin', 'pricing-prices', provider] as const,
    marketplace: (scope: 'live' | 'demo') => ['admin', 'marketplace', scope] as const,
    contacts: ['admin', 'contacts'] as const,
    topups: (scope: 'live' | 'demo') => ['admin', 'topups', scope] as const,
  },
} as const;
