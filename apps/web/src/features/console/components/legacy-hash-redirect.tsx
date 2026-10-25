'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { legacyHashToPath } from '../pages';

/** Rewrites legacy `/#pricing`-style console links to real routes. */
export function LegacyHashRedirect() {
  const router = useRouter();
  const { href } = useApp();
  useEffect(() => {
    const apply = () => {
      const target = legacyHashToPath(window.location.hash);
      if (!target) return;
      router.replace(href(target) + window.location.search);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [router, href]);
  return null;
}
