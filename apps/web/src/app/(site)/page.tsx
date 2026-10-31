import type { Metadata } from 'next';
import { CinematicLandingPage } from '@/features/site';

export const metadata: Metadata = { title: 'OpenNEXT — An always-on compute market' };

export default function SitePage() {
  return <CinematicLandingPage />;
}
