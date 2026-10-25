/** Console pages in sidebar order (legacy `pages`). `settings` is reachable from the user menu only. */
export const CONSOLE_PAGES = {
  overview: 'Overview',
  market: 'Market',
  pricing: 'Price sources',
  leads: 'Contact requests',
  topups: 'Top-up Requests',
  rfqs: 'Buyer RFQs',
  supplies: 'Supplier capacity',
  kyb: 'KYB reviews',
  featured: 'Homepage review',
  advisory: 'Advisory',
  orders: 'Orders',
  instances: 'Instances',
  schedules: 'Schedules',
  agent: 'Platform agent',
  billing: 'Agent billing',
  users: 'User',
  audit: 'Audit log',
  settings: 'My account',
} as const;
export type ConsolePage = keyof typeof CONSOLE_PAGES;

/** Pages that exist as routes but are not listed in the sidebar. */
export const HIDDEN_PAGES: Record<string, string> = { 'demo-submissions': 'Demo submissions' };

export const pagePath = (page: ConsolePage | string): string =>
  page === 'overview' ? '/' : `/${page}`;

export const pageFromPath = (path: string): string => {
  const segment = path.replace(/^\/+|\/+$/g, '').split('/')[0];
  return segment || 'overview';
};

/** Maps a legacy `#<page>` hash to the console route, or null when it is not a console page. */
export function legacyHashToPath(hash: string): string | null {
  const page = hash.replace(/^#/, '');
  if (!page) return null;
  if (page === 'demoSubmissions') return '/demo-submissions';
  if (page in CONSOLE_PAGES) return pagePath(page);
  return null;
}
