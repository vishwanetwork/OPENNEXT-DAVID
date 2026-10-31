import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/app-shell/app-shell';

const landingFont = localFont({
  src: '../../../public/terminal-design/manrope-latin.woff2',
  display: 'swap',
  variable: '--font-landing',
});

export const metadata: Metadata = {
  title: 'OpenNEXT — AI Capacity Market',
  description: 'Find GPU capacity. Reach the right buyers. Set the terms. Keep control.',
  icons: { icon: '/landing-design/favicon.svg' },
};

/** Regenerate the public site at most every 5 minutes; no per-request data is read. */
export const revalidate = 300;

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <SiteShell>
      <div className={landingFont.variable}>{children}</div>
    </SiteShell>
  );
}
