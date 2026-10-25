import type { Metadata } from 'next';
import { DM_Sans, Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { ConsoleShell } from '@/features/console';

export const metadata: Metadata = {
  title: 'OpenNEXT — Operations Console',
  robots: { index: false, follow: false },
};

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell app="admin">
      <div className={`${dmSans.variable} ${manrope.variable}`}>
        <ConsoleShell>{children}</ConsoleShell>
      </div>
    </AppShell>
  );
}
