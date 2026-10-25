import { redirect } from 'next/navigation';
import { requestApp } from '@/lib/request-app';

/** Broker mandates were never launched; the legacy route shows the RFQ page. */
export default async function Page() {
  const { base } = await requestApp('terminal');
  redirect(base + '/rfqs');
}
