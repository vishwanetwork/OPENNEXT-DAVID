import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderConsole } from '@/test/render';
import { ProviderCard } from './provider-card';

it('separates catalog provenance and pending real collection from credential readiness', () => {
  renderConsole(
    <ProviderCard
      provider={{
        id: 'gcp',
        name: 'Google Cloud',
        enabled: false,
        intervalMinutes: 60,
        adapterStatus: 'implemented',
        credentialRequired: false,
        sourceType: 'catalog_reference',
        validationStatus: 'not_live_verified',
      }}
      mutable
      busy={false}
      onOpen={vi.fn()}
      onRun={vi.fn()}
    />,
  );
  expect(screen.getByText(/SkyPilot catalog reference/)).toHaveTextContent(
    'Live verification pending',
  );
  expect(screen.getByRole('button', { name: /Run now/i })).toBeEnabled();
});
