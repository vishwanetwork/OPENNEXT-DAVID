import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Components read the App Router through `next/navigation`; outside Next there is no router
// context, so every suite gets the same inert implementation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/terminal/market',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
