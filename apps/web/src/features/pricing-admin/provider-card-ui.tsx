'use client';

import { PROVIDER_LOGOS } from './provider-logos';
import { STATUS_LABELS } from './api';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`pc-status pc-${status}`}>
      {STATUS_LABELS[status] || status || 'Not synced'}
    </span>
  );
}

export function ProviderLogo({ id }: { id: string }) {
  const logo = PROVIDER_LOGOS[id];
  if (!logo) return null;
  return (
    <span className="pc-provider-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.src} alt="" aria-hidden="true" width={28} height={28} decoding="async" />
    </span>
  );
}
