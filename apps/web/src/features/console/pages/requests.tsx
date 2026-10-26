'use client';

import Link from 'next/link';
import { useApp } from '@/components/providers/app-context';
import { Head } from '../components/forms';

const REQUESTS = [
  ['payments', 'Payment Requests', 'Confirm bank receipts against customer orders.'],
  [
    'topups',
    'Top-up Requests',
    'Review deposits and approve Credit only after receipt is verified.',
  ],
  ['leads', 'Contact Requests', 'Follow up website enquiries and record the response.'],
  ['kyb', 'KYB Review Requests', 'Review company information and due diligence.'],
] as const;

export function RequestsPage() {
  const { href } = useApp();
  return (
    <>
      <Head title="Requests" copy="Customer requests, organised by the action required." />
      <div className="ops-requests">
        {REQUESTS.map(([path, title, copy]) => (
          <Link key={path} href={href('/' + path)} className="panel ops-request-card">
            <h2>{title}</h2>
            <p>{copy}</p>
            <strong>Open requests →</strong>
          </Link>
        ))}
      </div>
    </>
  );
}
