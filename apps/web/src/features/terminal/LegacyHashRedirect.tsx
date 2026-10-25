'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { legacyHashToPath } from '@/terminal-kit';

/** `#terminal/<route>` links from the old site become real paths; the query string is kept. */
export function LegacyHashRedirect() {
  const router = useRouter();
  const { href } = useApp();
  useEffect(() => {
    const apply = () => {
      const path = legacyHashToPath(window.location.hash);
      if (!path) return;
      router.replace(href(path) + window.location.search);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [router, href]);
  return null;
}
