import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { at } from '@/test/at';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Providers } from '@/components/providers/providers';
import { LandingPage } from './landing-page';
import { TickerView } from './ticker';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, { IntersectionObserver: Observer, ResizeObserver: Observer });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes('/api/homepage/rfqs')
      ? { rfqs: [] }
      : url.includes('/api/demo/showcase')
        ? { demo: false }
        : url.includes('/api/marketplace/public')
          ? { rfqs: [], supplies: [], featured: { rfqs: [], supplies: [] } }
          : { records: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
afterEach(() => cleanup());

const prodOrigins = {
  site: 'https://opennextlab.ai',
  terminal: 'https://terminal.opennextlab.ai',
  admin: 'https://admin.opennextlab.ai',
};
const renderLanding = () =>
  render(
    <Providers app="site" base="" demo={false} origins={prodOrigins}>
      <LandingPage />
    </Providers>,
  );

describe('landing page', () => {
  it('keeps the hero eyebrow, headings and the requested line breaks', () => {
    const { container } = renderLanding();
    expect(
      screen.getByText('THE AI CAPACITY MARKET - FROM SUPPLY TO WORKLOAD'),
    ).toBeInTheDocument();
    const descriptions = [
      ...container.querySelectorAll('p.public-section-description.public-description-lines'),
    ].map((p) => p.innerHTML);
    expect(descriptions).toEqual([
      'Two sides of the same market.<br>Explore supply to buy, or respond to buyers looking for capacity you can deliver.',
      'Market intelligence and procurement in the same workspace.<br>Keep every specification, quote and decision connected.',
    ]);
    expect(container.querySelector('.public-hero h1')?.innerHTML).toBe(
      'The market behind<br>your next move.',
    );
  });
  it('Model capacity CTA is Coming Soon, disabled and has no navigation action', () => {
    const { container } = renderLanding();
    const row = [...container.querySelectorAll('.public-market-row')].find(
      (el) => el.querySelector('h3')?.textContent === 'Model capacity',
    )!;
    const button = within(row as HTMLElement).getByRole('button', { hidden: true });
    expect(button).toHaveTextContent('Coming Soon');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('data-public-action');
    expect(container.querySelector('[data-target="gpus"].on-button-text')).toHaveTextContent(
      'Explore GPUs',
    );
  });
  it('Find capacity and List capacity carry Buyer/Seller intent without adding a role to generic Open Terminal', () => {
    renderLanding();
    const find = screen.getByRole('button', { name: 'Find capacity' });
    const list = screen.getByRole('button', { name: 'List capacity' });
    expect(find).toHaveAttribute('data-target', 'gpus');
    expect(find).toHaveAttribute('data-preferred-role', 'buyer');
    expect(list).toHaveAttribute('data-target', 'supply');
    expect(list).toHaveAttribute('data-preferred-role', 'seller');
    const generic = screen.getAllByRole('button', { name: 'Open Terminal' });
    expect(generic.length).toBeGreaterThanOrEqual(1);
    generic.forEach((button) => expect(button).not.toHaveAttribute('data-preferred-role'));
  });
  it('routes a CTA into the terminal host with the role hint as query parameters', () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign, search: '', pathname: '/' },
    });
    window.scrollTo = vi.fn();
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: 'List capacity' }));
    expect(assign).toHaveBeenCalledWith('https://terminal.opennextlab.ai/supply?role=seller');
    expect(
      JSON.parse(window.sessionStorage.getItem('opennext-auth-role-intent-v1:account') || '{}')
        .role,
    ).toBe('seller');
    fireEvent.click(at(screen.getAllByRole('button', { name: 'Open Terminal' }), 0));
    expect(assign).toHaveBeenLastCalledWith('https://terminal.opennextlab.ai/market?role=seller');
  });
  it('supply and demand selectors remain a centered two-button group without side copy', () => {
    const { container } = renderLanding();
    const group = container.querySelector('.on-listing-sides [role="group"]')!;
    expect(group).toHaveAttribute('aria-label', 'Choose your side of the market');
    expect(group.querySelectorAll('[data-listing-side-filter]')).toHaveLength(2);
    expect(group.querySelector('p')).toBeNull();
    expect(container.querySelector('#public-listings-0')).toBeChecked();
  });
  it('opens the Contact Us form and the Privacy modal', () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    renderLanding();
    fireEvent.click(at(screen.getAllByRole('button', { name: 'Contact Us' }), 0));
    expect(screen.getByText("Let's talk capacity.")).toBeInTheDocument();
    expect(document.querySelector('input[name="website"]')).toHaveAttribute('tabindex', '-1');
  });
});

describe('ticker', () => {
  it('shows exactly six requested fields in order with a dated seven-day history', () => {
    const row = {
      gpuModel: 'H100',
      country: 'Singapore',
      term: 'Spot',
      vcpu: 192,
      gpuMemoryGb: 80,
      perGpuHourly: 2.4,
      historical: true,
      points: [
        { date: '2026-10-18', value: 2.0 },
        { date: '2026-10-24', value: 2.4 },
      ],
    };
    const { container } = render(<TickerView row={row} paused={false} onToggle={() => {}} />);
    const fields = [...container.querySelectorAll('[data-ticker-field]')];
    expect(fields.map((f) => f.getAttribute('data-ticker-field'))).toEqual([
      'country',
      'model',
      'vcpu',
      'memory',
      'price',
      'term',
    ]);
    expect(fields.map((f) => f.textContent)).toEqual([
      'Singapore',
      'H100',
      '192 vCPU',
      '80 GB',
      '$2.40 / GPU-hour',
      'Spot',
    ]);
    expect(container.querySelector('.tag')).toHaveTextContent('7D history');
    expect(container.textContent).toContain('Oct 18, 2026');
    expect(container.textContent).toContain('Oct 24, 2026');
    expect(container.textContent).toContain('+20.00%');
    expect(container.querySelector('.ticker-foot')).toBeNull();
  });
});
