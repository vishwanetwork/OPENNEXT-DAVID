'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';

/**
 * Turns legacy hash links (`#terminal/<route>`, `#pricing`) into real routes of the current
 * application. `mapHash` returns the in-app path for a hash, or null to ignore it. The query
 * string is preserved; the hash is consumed on load and on every `hashchange`.
 */
export function useLegacyHashRedirect(mapHash: (hash: string) => string | null) {
  const router = useRouter();
  const { href } = useApp();
  useEffect(() => {
    const apply = () => {
      const path = mapHash(window.location.hash);
      if (!path) return;
      router.replace(href(path) + window.location.search);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [router, href, mapHash]);
}
