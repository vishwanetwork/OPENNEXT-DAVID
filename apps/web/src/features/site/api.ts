import {
  ContactResponse,
  CuratedRfq,
  CuratedRfqsResponse,
  MarketplaceListing,
  PublicMarketResponse,
  ShowcaseResponse,
  TickerRecord,
  TickerResponse,
  type ContactRequest,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Curated customer requirements; malformed rows are dropped, never patched. */
export async function fetchCuratedRfqs(api: ApiClient): Promise<CuratedRfq[]> {
  const data = CuratedRfqsResponse.parse(await api.get('/api/homepage/rfqs', { credentials: 'omit' }));
  return data.rfqs.flatMap((row) => {
    const parsed = CuratedRfq.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface ShowcaseLanes {
  rfqs: MarketplaceListing[];
  supplies: MarketplaceListing[];
}

/** Isolated demo showcase. Returns null unless the backend explicitly marks the feed as demo. */
export async function fetchShowcase(api: ApiClient): Promise<ShowcaseLanes | null> {
  const data = ShowcaseResponse.parse(await api.get('/api/demo/showcase', { credentials: 'omit' }));
  if (data.demo !== true || !data.featured) return null;
  const lane = (rows: unknown[] | undefined) =>
    (rows || []).flatMap((row) => {
      const parsed = MarketplaceListing.safeParse(row);
      return parsed.success && ['rental', 'gpu_rental'].includes(parsed.data.kind)
        ? [{ ...parsed.data, kind: 'rental' }]
        : [];
    });
  return { rfqs: lane(data.featured.rfqs), supplies: lane(data.featured.supplies) };
}

export async function fetchPublicMarket(api: ApiClient): Promise<PublicMarketResponse> {
  return PublicMarketResponse.parse(await api.get('/api/marketplace/public'));
}

/** Seven-day Spot histories for the ticker; only complete recorded series are kept. */
export async function fetchTickerHistory(api: ApiClient): Promise<TickerRecord[]> {
  const data = TickerResponse.parse(
    await api.get('/api/pricing/ticker?period=1W', { timeoutMs: 10_000 }),
  );
  return data.records.flatMap((row) => {
    const parsed = TickerRecord.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function submitContact(api: ApiClient, body: ContactRequest): Promise<ContactResponse> {
  return ContactResponse.parse(await api.post('/api/contact', body, { timeoutMs: 12_000 }));
}
