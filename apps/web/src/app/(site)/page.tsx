import type { Metadata } from 'next';
import { LandingPage } from '@/features/site';

export const metadata: Metadata = { title: 'OpenNEXT — Capacity Terminal' };

export default function SitePage() {
  return <LandingPage />;
}
