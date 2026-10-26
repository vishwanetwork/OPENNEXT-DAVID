import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch, json, renderConsole } from '@/test/render';
import { OverviewPage } from './overview';
import { InstancesPage } from './instances';
import { RequestsPage } from './requests';

const fixtureApi = (path: string) => {
  if (path.includes('/admin/marketplace'))
    return json(200, {
      rfqs: [{ id: 'r1', status: 'Reviewing' }],
      supplies: [],
      kyb: [],
      featured: [],
      audit: [],
    });
  if (path.includes('/admin/pricing/providers')) return json(200, { providers: [] });
  if (path.includes('/pricing/prices'))
    return json(200, {
      records: [
        {
          recordId: 'p1',
          provider: 'aws',
          gpuModel: 'H100',
          region: 'ap-southeast-1',
          term: 'Spot',
          gpuCount: 8,
          perGpuHourly: 2,
          vCpu: 192,
          gpuMemoryGb: 80,
        },
      ],
      meta: {},
    });
  if (path.includes('/admin/topups'))
    return json(200, { requests: [{ id: 't1', status: 'Pending' }] });
  if (path.includes('/admin/contacts')) return json(200, { leads: [] });
  return json(200, { supplies: [], rfqs: [] });
};
describe('operations pages', () => {
  it('renders eight server-backed KPI cards, leaves unavailable services unknown', async () => {
    mockFetch(fixtureApi);
    renderConsole(<OverviewPage />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Pending Top-up Requests/ })).toHaveTextContent('1'),
    );
    expect(screen.getByRole('link', { name: /Live Instances/ })).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /Pending Payment Confirmed/ })).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /Available Spot Instance/ })).toHaveTextContent('0');
    expect(document.querySelectorAll('.ops-metric')).toHaveLength(8);
  });
  it('does not show fake zeroes when snapshots fail or are malformed', async () => {
    mockFetch(() => json(200, {}));
    renderConsole(<OverviewPage />);
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: /Pending RFQs/ })).toHaveTextContent('—');
  });
  it('does not claim an exact source total from a truncated price response', async () => {
    mockFetch((path) =>
      path.includes('/pricing/prices')
        ? json(200, { records: [], meta: { truncated: true, total: 9000 } })
        : fixtureApi(path),
    );
    renderConsole(<OverviewPage />);
    await screen.findByText('Complete source summary awaiting backend');
    expect(screen.getByRole('link', { name: /Available Price Sources/ })).toHaveTextContent('—');
  });
  it('shows the Terminal column order and functional catalog filters', async () => {
    mockFetch(fixtureApi);
    renderConsole(<InstancesPage />);
    await screen.findByText('16.00 USD / hour');
    expect(
      within(screen.getByRole('navigation', { name: 'Instance terms' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Spot', 'On-demand', 'Reserved']);
    expect(
      screen
        .getAllByRole('columnheader')
        .slice(0, 6)
        .map((cell) => cell.textContent),
    ).toEqual(['Model', 'Capacity', 'Price', 'Country', 'vCPU', 'Memory']);
    fireEvent.change(screen.getByPlaceholderText('Model, source or region'), {
      target: { value: 'B300' },
    });
    expect(screen.getByText('No records match this term and these filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('16.00 USD / hour')).toBeInTheDocument();
  });
  it('groups the four request queues in the requested order', () => {
    renderConsole(<RequestsPage />);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin/payments',
      '/admin/topups',
      '/admin/leads',
      '/admin/kyb',
    ]);
  });
});
