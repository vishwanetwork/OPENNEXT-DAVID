import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Providers } from '@/components/providers/providers';
import { CinematicLandingPage } from './cinematic-landing-page';

const hosts = {
  site: 'opennextlab.ai',
  terminal: 'terminal.opennextlab.ai',
  admin: 'admin.opennextlab.ai',
};
const location = window.location;
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', Observer);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: location });
});
function renderLanding(host: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...location, host, hostname: host, pathname: '/', search: '' },
  });
  return render(
    <Providers app="site" base="" demo={false} hosts={hosts}>
      <CinematicLandingPage />
    </Providers>,
  );
}
function expectBuyerLinks(destination: string) {
  const links = [
    ...screen.getAllByRole('link', { name: 'Open Terminal' }),
    ...screen.getAllByRole('link', { name: /^Buy capacity:/ }),
  ];
  expect(links.length).toBeGreaterThanOrEqual(7);
  for (const link of links) {
    expect(link).toHaveAttribute('href', destination);
    expect(link.getAttribute('href')).not.toMatch(/demo|#terminal|listing=/);
  }
}
describe('approved cinematic landing navigation', () => {
  it('opens the real Buyer route on the configured terminal host', () => {
    renderLanding('opennextlab.ai');
    expectBuyerLinks('https://terminal.opennextlab.ai/market?role=buyer');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'An always-oncompute market.',
    );
    expect(screen.queryByText('Hover to pause')).not.toBeInTheDocument();
  });
  it('keeps staging and local navigation on the same deployed app', () => {
    renderLanding('preview.example.com');
    expectBuyerLinks('/terminal/market?role=buyer');
  });
  it('uses the same Buyer destination from mobile navigation and expanded preview', () => {
    renderLanding('opennextlab.ai');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(
      within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('link', {
        name: 'Open Terminal',
      }),
    ).toHaveAttribute('href', 'https://terminal.opennextlab.ai/market?role=buyer');
    fireEvent.click(screen.getByRole('button', { name: 'Expand GPU Market' }));
    const dialog = screen.getByRole('dialog', { name: 'GPU Market' });
    expect(within(dialog).getByRole('link', { name: 'Open Terminal' })).toHaveAttribute(
      'href',
      'https://terminal.opennextlab.ai/market?role=buyer',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
