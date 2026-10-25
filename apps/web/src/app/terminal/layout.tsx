import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';

export const metadata: Metadata = { title: 'OpenNEXT — Capacity Terminal' };

export default function TerminalLayout({ children }: { children: ReactNode }) {
  return <AppShell app="terminal">{children}</AppShell>;
}
