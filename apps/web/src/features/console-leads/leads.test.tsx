import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderConsole, mockFetch, json } from '@/features/console/test-utils';
import { filterLeads, leadTime } from './leads';
import { ConsoleLeadsPage } from './leads-page';

const leads = [
  {
    id: 'LEAD-1',
    name: 'Ada',
    title: 'CTO',
    email: 'ada@example.com',
    company: 'Acme',
    message: 'Need 8 H100',
    status: 'New',
    createdAt: '2026-10-18T08:00:00.000Z',
    updatedAt: 'v1',
    history: [],
  },
  {
    id: 'LEAD-2',
    name: 'Bo',
    title: 'Buyer',
    email: 'bo@example.com',
    company: 'Beta',
    message: '<b>x</b>',
    status: 'Closed',
    createdAt: '2026-10-19T08:00:00.000Z',
    updatedAt: 'v1',
    history: [],
  },
];

describe('contact inbox helpers', () => {
  it('filters by status and free text', () => {
    expect(filterLeads(leads, '', 'All requests')).toHaveLength(2);
    expect(filterLeads(leads, 'acme', 'All requests').map((l) => l.id)).toEqual(['LEAD-1']);
    expect(filterLeads(leads, '', 'Closed').map((l) => l.id)).toEqual(['LEAD-2']);
    expect(leadTime('2026-10-18T08:00:00.000Z')).toBe('18 Oct 2026, 08:00:00');
    expect(leadTime('nope')).toBe('—');
  });
});

describe('ConsoleLeadsPage', () => {
  it('emphasises email, company, UTC time and Detail, escaping content', async () => {
    mockFetch(() => json(200, { leads }));
    renderConsole(<ConsoleLeadsPage />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());
    expect(screen.getByText('18 Oct 2026, 08:00:00')).toBeInTheDocument();
    expect(screen.getByLabelText('View details for ada@example.com')).toHaveTextContent('Detail');
    expect(document.querySelector('b')).toBeNull();
  });
  it('shows the access-required state on 401', async () => {
    mockFetch(() => json(401, { error: 'Administrator sign-in required' }));
    renderConsole(<ConsoleLeadsPage />);
    await waitFor(() =>
      expect(screen.getByText('Administrator access required')).toBeInTheDocument(),
    );
  });
});
