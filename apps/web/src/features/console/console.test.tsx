import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderConsole, mockFetch, json } from './test-utils';
import { ConsoleShell } from './components/shell';
import { OverviewPage } from './pages/overview';
import { SchedulesPage } from './pages/schedules';
import { useConsoleStore } from './store';

describe('console shell', () => {
  it('renders the sidebar, topbar and page content with record counts', () => {
    mockFetch(() => json(200, {}));
    renderConsole(
      <ConsoleShell>
        <OverviewPage />
      </ConsoleShell>,
    );
    expect(screen.getByLabelText('OpenNEXT Operations Console')).toBeInTheDocument();
    expect(screen.getByText('Price sources')).toBeInTheDocument();
    expect(screen.getByText('LOCAL WORKSPACE')).toBeInTheDocument();
    expect(screen.getByText('Welcome back, Administrator.')).toBeInTheDocument();
    expect(screen.getByText('Needs your attention')).toBeInTheDocument();
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
    fireEvent.click(screen.getAllByText('Pause')[0]);
    const { db } = useConsoleStore.getState();
    expect(db.schedules.find((s) => s.id === 'SCH-101')?.status).toBe('Paused');
    expect(db.audit.length).toBe(before + 1);
    expect(db.audit[0]).toMatchObject({ action: 'Schedule paused', target: 'SCH-101' });
  });
});
