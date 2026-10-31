'use client';

import Link from 'next/link';
import { useApp } from '@/components/providers/app-context';
import { Head } from '../components/forms';

export function LiveSchedulesPage() {
  const { href } = useApp();
  return (
    <>
      <Head
        title="Schedules"
        copy="Price collection intervals are managed by the server-side source scheduler."
      />
      <section className="panel">
        <div className="panel-body">
          <p>
            Configure enabled sources, collection frequency and API credentials in Price Source.
            Customer rental acquisition and recovery follow each paid order&apos;s RFQ
            automatically.
          </p>
          <Link className="btn primary" href={href('/pricing')}>
            Manage collection schedules
          </Link>
          <p>Free-form browser evaluation plans do not control the production worker.</p>
        </div>
      </section>
    </>
  );
}
