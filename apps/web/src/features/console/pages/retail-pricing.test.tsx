import { expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { mockFetch, jsonResponse, renderConsole } from '@/test/render';
import { RetailPricingPage } from './retail-pricing';
import { retailPreview } from './retail-pricing-model';

it('previews whole-cent retail markup and the unchanged fee exactly', () => {
  expect(retailPreview('1.00', '20', 500)).toEqual({
    rateCents: 120,
    feeCents: 6,
    totalCents: 126,
  });
  expect(retailPreview('0.4012', '20', 500)).toEqual({
    rateCents: 49,
    feeCents: 2,
    totalCents: 51,
  });
  expect(retailPreview('0.000001', '0', 500)).toEqual({ rateCents: 1, feeCents: 0, totalCents: 1 });
  expect(retailPreview('1.00', '101', 500)).toBeNull();
});

it('saves versioned server policy and never edits accepted orders', async () => {
  let policy = {
    version: 3,
    defaultMarkupBps: 2000,
    rules: [],
    changedBy: null,
    changedAt: null,
    history: [],
    serviceFeeBps: 500,
    procurementToleranceBps: 2000,
    scope: 'executable_spot_offers',
  };
  const request = mockFetch((path, init) => {
    if (path.endsWith('/operations/session'))
      return jsonResponse({ confirmed: true, sessionScope: 'operator' });
    if (init?.method === 'PUT') {
      expect(JSON.parse(String(init.body))).toEqual({
        expectedVersion: 3,
        defaultMarkupBps: 2500,
        rules: [],
      });
      policy = { ...policy, version: 4, defaultMarkupBps: 2500 };
    }
    return jsonResponse(policy);
  });
  renderConsole(<RetailPricingPage />);
  const input = await screen.findByLabelText('Default Spot markup (%)');
  expect(screen.getByText('Total for one hour: $1.26')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: '25' } });
  expect(screen.getByText('Total for one hour: $1.31')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save Spot pricing' }));
  expect(await screen.findByText(/Pricing version 4 saved/)).toBeInTheDocument();
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1),
  );
  expect(
    request.mock.calls.some(
      ([path]) => String(path).includes('spot-purchases') || String(path).includes('/rentals'),
    ),
  ).toBe(false);
});
