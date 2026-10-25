'use client';

import { legacyHashToPath } from '@/terminal-kit';
import { useLegacyHashRedirect } from '@/components/hooks/use-legacy-hash-redirect';

/** `#terminal/<route>` links from the old site become real paths; the query string is kept. */
export function LegacyHashRedirect() {
  useLegacyHashRedirect(legacyHashToPath);
  return null;
}
