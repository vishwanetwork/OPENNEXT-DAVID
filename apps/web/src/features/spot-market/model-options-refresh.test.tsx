import { useState } from 'react';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch, renderTerminal, signIn, testQueryClient } from '@/test/render';
import { SpotCheckoutProvider, useSpotCheckout, useSpotInventory } from './hooks';
import { ModelOptions } from './components/model-options';
import { usePublicMarket } from '@/terminal-kit';

const offer = {
  id: 'spotbot-us-west-2-p5.4xlarge',
  kind: 'rental',
  side: 'supply',
  term: 'Spot',
  model: 'H100',
  region: 'us-west-2',
  gpuCount: 1,
  vcpu: 16,
  memory: 80,
  perGpuHourly: 3,
  listedAt: '2026-10-28T01:00:00+00:00',
  status: 'Published',
  serverRecord: true,
  agentStatus: 'Succeeded',
};
const preset = {
  id: 'deepseek-r1-distill-7b',
  label: 'DeepSeek 7B',
  model: 'deepseek-ai/test',
  precision: 'float16',
  diskGiB: 100,
  estimatedMinutes: 30,
  billingStart: 'gpu_delivery',
  enabled: true,
  reason: null,
};

function Screen() {
  const [show, setShow] = useState(true);
  const inventory = useSpotInventory();
  const checkout = useSpotCheckout(inventory);
  return (
    <>
      <button
        type="button"
        disabled={!inventory.rows.length}
        onClick={() => {
          const row = inventory.rows[0];
          if (row) checkout.beginCheckout(row);
        }}
      >
        Choose H100
      </button>
      <button type="button" onClick={() => setShow(!show)}>
        Toggle models
      </button>
      {show ? <ModelOptions /> : null}
    </>
  );
}
function mount() {
  signIn();
  return renderTerminal(
    <SpotCheckoutProvider>
      <Screen />
    </SpotCheckoutProvider>,
    {
      workspace: {},
      billing: { availableCredit: 100 },
    },
  );
}
async function choose() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose H100' })).toBeEnabled());
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Choose H100' }));
}
afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe('manual model option refresh', () => {
  it('loads once and retains options across time, focus, reconnect and reopening', async () => {
    let reads = 0;
    mockFetch((path) => {
      if (path.includes('inference-presets')) {
        reads++;
        return json(200, { presets: [preset] });
      }
      if (path.includes('/marketplace/public')) return json(200, { rfqs: [], supplies: [offer] });
      return json(200, { orders: [], instances: [] });
    });
    mount();
    await choose();
    expect(await screen.findByRole('option', { name: 'DeepSeek 7B' })).toBeEnabled();
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle models' }));
    await act(async () => {});
    expect(screen.getByRole('option', { name: 'DeepSeek 7B' })).toBeEnabled();
    expect(reads).toBe(1);
  });

  it('does not retry a failed read until the user refreshes and shows refresh progress', async () => {
    let reads = 0;
    const response = Promise.withResolvers<Response>();
    mockFetch((path) => {
      if (path.includes('inference-presets')) {
        reads++;
        return reads === 1 ? json(503, { error: 'Unavailable' }) : response.promise;
      }
      if (path.includes('/marketplace/public')) return json(200, { rfqs: [], supplies: [offer] });
      return json(200, { orders: [], instances: [] });
    });
    mount();
    await choose();
    expect(await screen.findByText(/Model options could not be loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle models' }));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(reads).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh model options' }));
    expect(await screen.findByRole('button', { name: 'Refreshing models…' })).toBeDisabled();
    await act(async () => response.resolve(json(200, { presets: [preset] })));
    expect(await screen.findByRole('option', { name: 'DeepSeek 7B' })).toBeEnabled();
    expect(reads).toBe(2);
  });
});

function MarketRead() {
  const query = usePublicMarket();
  return (
    <button type="button" onClick={() => void query.refetch()}>
      {query.isFetching ? 'Loading offers' : 'Refresh offers'}
    </button>
  );
}
it('keeps the public offer catalog until an explicit refresh', async () => {
  let reads = 0;
  mockFetch(() => {
    reads++;
    return json(200, { rfqs: [], supplies: [offer] });
  });
  const client = testQueryClient();
  const view = renderTerminal(<MarketRead />, { queryClient: client });
  await screen.findByRole('button', { name: 'Refresh offers' });
  vi.useFakeTimers();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90_000);
  });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  view.unmount();
  renderTerminal(<MarketRead />, { queryClient: client });
  await act(async () => {});
  expect(reads).toBe(1);
  vi.useRealTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh offers' }));
  await waitFor(() => expect(reads).toBe(2));
});
