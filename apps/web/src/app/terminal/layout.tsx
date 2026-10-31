import type { Metadata } from 'next';
import localFont from 'next/font/local';

import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { requestApp } from '@/lib/request-app';
import { getServerSession } from '@/features/auth/server';
import { TerminalApp } from './terminal-app';

const terminalFont = localFont({
  src: '../../../public/terminal-design/manrope-latin.woff2',
  display: 'swap',
});
export const metadata: Metadata = {
  title: 'OpenNEXT — Capacity Terminal',
  icons: { icon: '/terminal-design/favicon.svg' },
  robots: { index: false },
};

export default async function TerminalLayout({ children }: { children: ReactNode }) {
  const location = await requestApp('terminal');
  const initialUser = location.demo ? undefined : await getServerSession(location.host);
  return (
    <AppShell app="terminal">
      <Suspense fallback={null}>
        <div className={`buyer-terminal-root ${terminalFont.className}`}>
          <TerminalApp initialUser={initialUser}>{children}</TerminalApp>
        </div>
      </Suspense>
    </AppShell>
  );
}
