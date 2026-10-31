import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { jsonResponse, mockFetch, renderConsole } from '@/test/render';
import { PricingAdminPage } from './pricing-admin-page';

describe('Persistent provider credentials', () => {
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
    expect(window.localStorage.getItem('provider-test-secret')).toBeNull();
    expect(request.mock.calls.some(([path]) => String(path).endsWith('/lambda/credential'))).toBe(
      true,
    );
  });
});
