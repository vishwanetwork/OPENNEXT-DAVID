import { describe, expect, it } from 'vitest';
import { at } from '@/test/at';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderConsole, mockFetch, json } from '@/test/render';
import { ConsoleShell } from './components/shell';
import { Sidebar } from './components/sidebar';
import { OverviewPage } from './pages/overview';
import { SchedulesPage } from './pages/schedules';
import { useConsoleStore } from './store';

describe('console shell', () => {
  it('places Price Source between Instances and Buyer RFQs as an independently active page', () => {
    renderConsole(<Sidebar page="pricing" />);
    const nav = within(screen.getByRole('navigation', { name: 'Console navigation' }));
    expect(nav.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Overview',
      'Requests',
      'Orders',
      'Instances',
      'Price Source',
      'Buyer RFQs',
      'Supplier capacity',
      'Platform agent',
      'User',
    ]);
    expect(nav.getByRole('button', { name: 'Price Source' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(nav.getByRole('button', { name: 'Instances' })).not.toHaveAttribute('aria-current');
    expect(nav.queryByRole('link', { name: 'Spot' })).not.toBeInTheDocument();
  });
  it('keeps only rental terms nested under Instances', () => {
    renderConsole(<Sidebar page="instances" />);
    const nav = within(screen.getByRole('navigation', { name: 'Console navigation' }));
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Spot',
      'On-demand',
      'Reserved',
    ]);
    expect(nav.getByRole('button', { name: 'Instances' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('button', { name: 'Price Source' })).not.toHaveAttribute('aria-current');
  });
  it('renders the compact operations sidebar and server-backed overview', () => {
    mockFetch(() => json(200, {}));
    renderConsole(
      <ConsoleShell>
        <OverviewPage />
      </ConsoleShell>,
    );
    expect(screen.getByLabelText('OpenNEXT Operations Console')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getAllByText('OPERATIONS').length).toBeGreaterThan(0);
    expect(screen.getByText('Available Price Sources')).toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.queryByText('Welcome back, Administrator.')).not.toBeInTheDocument();
  });
  it('opens the user menu and the schedule wizard drawer', () => {
    mockFetch(() => json(200, {}));
    renderConsole(
      <ConsoleShell>
        <SchedulesPage />
      </ConsoleShell>,
    );
    fireEvent.click(screen.getByText('Administrator', { selector: '.admin-user strong' }));
    expect(screen.getByText('My account & preferences')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Create schedule', { selector: '.head-actions button' }));
    expect(screen.getByRole('dialog', { name: 'Create ad-hoc schedule' })).toBeInTheDocument();
    expect(screen.getByText('Analyze instruction')).toBeInTheDocument();
  });
  it('records an audit entry when a schedule is paused', () => {
    mockFetch(() => json(200, {}));
    renderConsole(
      <ConsoleShell>
        <SchedulesPage />
      </ConsoleShell>,
    );
    const before = useConsoleStore.getState().db.audit.length;
    fireEvent.click(at(screen.getAllByText('Pause'), 0));
    const { db } = useConsoleStore.getState();
    expect(db.schedules.find((s) => s.id === 'SCH-101')?.status).toBe('Paused');
    expect(db.audit.length).toBe(before + 1);
    expect(db.audit[0]).toMatchObject({ action: 'Schedule paused', target: 'SCH-101' });
  });
});
