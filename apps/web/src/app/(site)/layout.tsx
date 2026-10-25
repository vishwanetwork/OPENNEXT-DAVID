import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';

export const metadata: Metadata = {
  title: 'OpenNEXT — AI Capacity Market',
  description: 'Price intelligence, model access and GPU compute — connected in one market.',
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <AppShell app="site">{children}</AppShell>;
}
