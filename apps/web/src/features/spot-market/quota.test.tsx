import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotaAvailability } from './components/quota-availability';
import { ActionButton } from './components/listings';
import { normalizeRow } from './inventory';

it('keeps GPUs per server separate from quota capacity and prevents a known exhausted purchase', () => {
  const row = normalizeRow(
    {
      id: 'h100',
      model: 'H100',
      gpuCount: 8,
      perGpuHourly: 2,
      term: 'Spot',
      quota: {
        maxInstances: 0,
        maxGpus: 0,
        usageKnown: true,
        capacityGuaranteed: false,
        capacityStatus: 'unknown',
        basis: 'quota_estimate',
      },
    },
    0,
    'agent',
  );
  if (!row) throw new Error('Missing row');
  render(
    <>
      <QuotaAvailability row={row} />
      <ActionButton row={row} actions={{ onBuy: () => undefined, onQuote: () => undefined }} />
    </>,
  );
  expect(screen.getByText(/up to 0 instances/)).toBeInTheDocument();
  expect(screen.getByText(/Spot capacity checked at launch/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Buy Now/ })).toBeDisabled();
  expect(row.gpuCount).toBe(8);
});
