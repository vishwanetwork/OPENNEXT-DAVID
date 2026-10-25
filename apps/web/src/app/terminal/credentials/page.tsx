import { redirect } from 'next/navigation';
import { requestApp } from '@/lib/request-app';

/** Legacy `#terminal/credentials` → instances. */
export default async function Page() {
  const { base } = await requestApp('terminal');
  redirect(base + '/instances');
}
