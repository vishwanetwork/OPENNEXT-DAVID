export const money = (value: unknown): string =>
  Number(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const number = (value: unknown): string => Number(value).toLocaleString('en-US');
/** `Oct 12, 09:42` in the operator's local time (legacy `stamp()`). */
export const stamp = (): string =>
  new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const STATUS_TONES: Record<string, string> = {
  Active: 'green',
  Completed: 'green',
  Approved: 'green',
  Verified: 'green',
  Delivered: 'green',
  Published: 'green',
  Draft: '',
  Paused: 'orange',
  Pending: 'orange',
  'In review': 'orange',
  'Awaiting approval': 'orange',
  'Awaiting funds': 'orange',
  Quoted: 'blue',
  Reserved: 'blue',
  Running: 'blue',
  New: 'blue',
  Rejected: 'red',
  Failed: 'red',
  Open: 'blue',
  Accepted: 'green',
  Dismissed: '',
};
export const statusTone = (label: string): string => STATUS_TONES[label] || '';

export const initials = (name: string): string =>
  name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');

/** Generic record search used by every legacy list: any field value contains the query. */
export const matchesQuery = (record: object, query: string): boolean =>
  !query || Object.values(record).join(' ').toLowerCase().includes(query.toLowerCase());

export function toCsv(rows: Record<string, unknown>[]): string {
  const keys = Object.keys(rows[0] ?? {});
  return [
    keys.join(','),
    ...rows.map((x) => keys.map((k) => `"${String(x[k] ?? '').replaceAll('"', '""')}"`).join(',')),
  ].join('\n');
}

export function download(filename: string, content: string, type = 'text/csv'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parses an operator CSV into header/value rows exactly like the legacy importer. */
export function parseCsv(text: string): { headers: string[]; lines: string[] } | null {
  const lines = text.split(/\r?\n/).filter((v) => v.trim());
  if (!lines.length) return null;
  const headers = lines
    .shift()!
    .split(',')
    .map((x) => x.trim().toLowerCase());
  return { headers, lines };
}

/** Returns a copy of the record without the given key (CSV exports drop nested arrays). */
export function omit<T extends object, K extends keyof T>(record: T, key: K): Omit<T, K> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}
