'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { LiveAgentPage, LiveBillingPage } from './live-agent';

export function AgentWorkspace() {
  const billing = useSearchParams().get('tab') === 'billing';
  const { href } = useApp();
  return (
    <>
      <nav className="ops-tabs" aria-label="Platform agent sections">
        <Link href={href('/agent')} aria-current={!billing ? 'page' : undefined}>
          Platform agent
        </Link>
        <Link href={href('/agent?tab=billing')} aria-current={billing ? 'page' : undefined}>
          Agent billing
        </Link>
      </nav>
      {billing ? <LiveBillingPage /> : <LiveAgentPage />}
    </>
  );
}
