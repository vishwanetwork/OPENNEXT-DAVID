import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { APP_HEADERS } from '@/proxy';

/** Legacy `#terminal/credentials` → instances. */
export default async function Page() {
  const base = (await headers()).get(APP_HEADERS.base) ?? '/terminal';
  redirect((base || '') + '/instances');
}
