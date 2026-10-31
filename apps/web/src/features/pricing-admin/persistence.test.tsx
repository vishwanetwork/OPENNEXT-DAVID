import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { jsonResponse, mockFetch, renderConsole } from '@/test/render';
import { PricingAdminPage } from './pricing-admin-page';

describe('Persistent provider credentials', () => {
  it('hides cached source history when the administrator session expires', async () => {
    let denied = false;
    mockFetch((path) => {
      if (denied) return jsonResponse({ error: 'Administrator sign-in required' }, 401);
      if (path.endsWith('/runs'))
        return jsonResponse({
          runs: [{ id: 'private-run', provider: 'lambda', status: 'completed', records: 1 }],
        });
      return jsonResponse({
        access: { mutable: true },
        providers: [
          {
            id: 'lambda',
            name: 'Lambda',
            enabled: true,
            intervalMinutes: 60,
            adapterStatus: 'implemented',
          },
        ],
      });
    });
    const { queryClient } = renderConsole(<PricingAdminPage />);
    expect(await screen.findByRole('button', { name: 'View log ↗' })).toBeInTheDocument();
    denied = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'pricing'] });
    });
    expect(
      await screen.findByRole('button', { name: 'Connect administrator session' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View log ↗' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'Lambda price source' })).toBeNull();
  });

  it('saves through the protected API and confirms the actual storage mode', async () => {
    const request = mockFetch((path, init) => {
      if (path.endsWith('/credential')) {
        expect(JSON.parse(String(init?.body))).toEqual({ credential: 'provider-test-secret' });
        return jsonResponse({ ok: true, configured: true, storage: 'encrypted_database' });
      }
      if (path.endsWith('/runs')) return jsonResponse({ runs: [] });
      return jsonResponse({
        access: { mutable: true },
        providers: [
          {
            id: 'lambda',
            name: 'Lambda',
            enabled: true,
            intervalMinutes: 60,
            adapterStatus: 'implemented',
            credentialEnv: 'LAMBDA_API_KEY',
            credentialRequired: true,
            credentialConfigured: false,
            supportedTerms: ['On-demand'],
          },
        ],
      });
    });
    renderConsole(<PricingAdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure & API' }));
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'provider-test-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }));
    expect(
      await screen.findByText('Credential encrypted and saved to the server database.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('provider-test-secret');
    expect(
      JSON.stringify(
        Object.keys(window.localStorage).map((key) => window.localStorage.getItem(key)),
      ),
    ).not.toContain('provider-test-secret');
    expect(request.mock.calls.some(([path]) => String(path).endsWith('/lambda/credential'))).toBe(
      true,
    );
  });
});
