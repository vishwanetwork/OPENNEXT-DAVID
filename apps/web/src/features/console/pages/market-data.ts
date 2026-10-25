'use client';

import { matchesQuery, stamp, parseCsv } from '../helpers';
import { MODEL_SPECS } from '../reference-data';
import type { ConsoleDb, DatasetId, MarketFilters, Offer } from '../types';

export function filteredOffers(db: ConsoleDb, f: MarketFilters, search: string): Offer[] {
  const q = search.toLowerCase();
  return db.offers.filter(
    (x) =>
      (f.provider === 'All providers' || x.provider === f.provider) &&
      (f.model === 'All models' || x.model === f.model) &&
      (f.count === 'All counts' || String(x.count) === f.count) &&
      (f.region === 'All regions' || x.region === f.region) &&
      (f.terms === 'All terms' || x.terms === f.terms) &&
      (f.availability === 'All availability' || x.availability === f.availability) &&
      (f.min === '' || x.rate >= Number(f.min)) &&
      (f.max === '' || x.rate <= Number(f.max)) &&
      (f.score === 'All scores' || x.score >= Number(f.score)) &&
      matchesQuery(x, q),
  );
}

/** CSV import exactly as the legacy console validated it. Returns the accepted/skipped counts. */
export function importOffers(
  db: ConsoleDb,
  key: DatasetId,
  text: string,
): { added: number; skipped: number } | { error: string } {
  const parsed = parseCsv(text);
  if (!parsed) return { error: 'Upload or paste CSV records first.' };
  const { headers, lines } = parsed;
  if (lines.length === 0) return { error: 'The CSV needs at least one data row.' };
  let added = 0;
  let skipped = 0;
  if (key === 'current') {
    if (
      !['provider', 'model', 'count', 'region', 'terms', 'rate'].every((k) => headers.includes(k))
    )
      return { error: 'CSV headers must include provider, model, count, region, terms and rate.' };
    for (const line of lines) {
      const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
      const x = Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
      if (
        !x.provider ||
        !x.model ||
        !x.region ||
        !(x.rate && +x.rate > 0) ||
        !(x.count && +x.count > 0)
      ) {
        skipped++;
        continue;
      }
      db.offers.unshift({
        id: `OFR-${Date.now().toString().slice(-6)}-${added}`,
        provider: x.provider,
        model: x.model,
        memory: MODEL_SPECS.find((s) => s[0] === x.model)?.[1] || 80,
        count: +x.count,
        region: x.region,
        terms: x.terms ?? '',
        rate: +x.rate,
        score: 8,
        availability: 'Available',
        source: 'Operator CSV import',
        updated: stamp(),
        record: 'Current offer',
      });
      added++;
    }
  } else {
    added = lines.filter((l) => l.split(',').length === headers.length).length;
    skipped = lines.length - added;
  }
  db.datasets.find((x) => x.id === key)!.count += added;
  return { added, skipped };
}
