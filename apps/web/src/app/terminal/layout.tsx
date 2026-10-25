import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { requestApp } from '@/lib/request-app';
import { getServerSession } from '@/features/auth/server';
import { TerminalShell } from '@/features/terminal/TerminalShell';

export const metadata: Metadata = {
  title: 'OpenNEXT — Capacity Terminal',
  robots: { index: false },
};

export default async function TerminalLayout({ children }: { children: ReactNode }) {
  const location = await requestApp('terminal');
  const initialUser = location.demo ? undefined : await getServerSession(location.host);
  return (
    <AppShell app="terminal">
      <Suspense fallback={null}>
        <TerminalShell initialUser={initialUser}>{children}</TerminalShell>
      </Suspense>
    </AppShell>
  );
}
