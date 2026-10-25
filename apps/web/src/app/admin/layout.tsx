import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';

export const metadata: Metadata = { title: 'OpenNEXT — Operations Console', robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppShell app="admin">{children}</AppShell>;
}
