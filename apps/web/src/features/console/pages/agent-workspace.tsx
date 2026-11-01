'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { LiveAgentPage, LiveBillingPage } from './live-agent';
import { RetailPricingPage } from './retail-pricing';

export function AgentWorkspace() {
  const tab = useSearchParams().get('tab');
  const billing = tab === 'billing';
  const pricing = tab === 'pricing';
  const { href } = useApp();
  return (
    <>
      <nav className="ops-tabs" aria-label="Platform agent sections">
        <Link href={href('/agent')} aria-current={!billing && !pricing ? 'page' : undefined}>
          Platform agent
        </Link>
        <Link href={href('/agent?tab=billing')} aria-current={billing ? 'page' : undefined}>
          Agent billing
        </Link>
        <Link href={href('/agent?tab=pricing')} aria-current={pricing ? 'page' : undefined}>
          Spot pricing
        </Link>
      </nav>
      {pricing ? <RetailPricingPage /> : billing ? <LiveBillingPage /> : <LiveAgentPage />}
    </>
  );
}
