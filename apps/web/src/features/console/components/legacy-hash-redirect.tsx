'use client';

import { useLegacyHashRedirect } from '@/components/hooks/use-legacy-hash-redirect';
import { legacyHashToPath } from '../pages';

/** Rewrites legacy `/#pricing`-style console links to real routes. */
export function LegacyHashRedirect() {
  useLegacyHashRedirect(legacyHashToPath);
  return null;
}
