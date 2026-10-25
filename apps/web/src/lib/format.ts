/** Shared display formatting. Mirrors the helpers that every legacy module re-implemented. */

export const money = (value: unknown): string =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

export const number = (value: unknown): string =>
  Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '—';

/** `18 Oct, 08:00 UTC` */
export const stampUtc = (value: string | number | Date): string =>
  new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';

/** `Oct 18, 2026` in UTC */
export const dateUtc = (value: string | number | Date): string =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));

export const percent = (value: number, digits = 2): string =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
