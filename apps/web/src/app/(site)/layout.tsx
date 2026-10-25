import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/app-shell/app-shell';

export const metadata: Metadata = {
  title: 'OpenNEXT — AI Capacity Market',
  description: 'Price intelligence, model access and GPU compute — connected in one market.',
};

/** Regenerate the public site at most every 5 minutes; no per-request data is read. */
export const revalidate = 300;

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
