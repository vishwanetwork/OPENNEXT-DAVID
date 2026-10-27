import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BuyerKybSnapshot } from '@/lib/buyer-kyb';
import { useSessionStore } from '@/lib/session-store';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { renderTerminal, signIn } from '@/test/render';
import { BuyerKybContent } from './index';
import { serviceFixture, snapshotFixture } from './test-fixtures';

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
});

async function fillForm() {
  fireEvent.change(screen.getByLabelText('Country / region of incorporation'), {
    target: { value: 'SG' },
  });
  for (const [label, value] of [
    ['Legal company name', 'Example Pte Ltd'],
    ['Company registration number', '202601234A'],
    ['Business email', 'billing@example.com'],
    ['Tax identification number', '202601234A'],
    ['Estimated monthly volume (USD)', '5000'],
    ['Estimated monthly transactions', '4'],
    ['Business description', 'AI compute research'],
  ])
    if (label) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await waitFor(() => expect(screen.getByLabelText('Proof of legal presence')).not.toBeDisabled());
  for (const label of [
    'Proof of legal presence',
    'Ownership structure',
    'Proof of business address',
    'Company details',
    'Representative authorization',
  ])
    fireEvent.change(screen.getByLabelText(label), {
      target: {
        files: [new File(['safe test fixture'], 'example.pdf', { type: 'application/pdf' })],
      },
    });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('Buyer KYB submission', () => {
  it('submits transient documents and only shows success after a confirmed Reviewing receipt', async () => {
    const service = serviceFixture();
    service.submit = vi.fn(service.submit);
    renderTerminal(<BuyerKybContent />, { slots: { services: { buyerKyb: service } } });
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit KYB' }));
    expect(await screen.findByText('Your KYB is under review.')).toBeInTheDocument();
    expect(service.submit).toHaveBeenCalledTimes(1);
    expect(service.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'Auto',
        consent: true,
        documents: expect.arrayContaining([
          expect.objectContaining({ kind: 'legal-presence', file: expect.any(File) }),
          expect.objectContaining({ kind: 'representative-authorization', file: expect.any(File) }),
        ]),
      }),
    );
  });
  it('does not show success if the backend returns another account', async () => {
    const service = serviceFixture();
    service.submit = async () => ({
      ...snapshotFixture('Reviewing'),
      accountId: 'different-owner',
    });
    renderTerminal(<BuyerKybContent />, { slots: { services: { buyerKyb: service } } });
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit KYB' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Submission was not confirmed');
    expect(screen.queryByText('Your KYB is under review.')).not.toBeInTheDocument();
  });
  it('ignores a late submission response after the session expires', async () => {
    let finish: (result: BuyerKybSnapshot) => void = () => undefined;
    const service = serviceFixture();
    service.submit = vi.fn(
      () =>
        new Promise<BuyerKybSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    renderTerminal(<BuyerKybContent />, { slots: { services: { buyerKyb: service } } });
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit KYB' }));
    await waitFor(() => expect(service.submit).toHaveBeenCalledOnce());
    act(() => useSessionStore.getState().markExpired());
    await act(async () => finish(snapshotFixture('Reviewing')));
    expect(screen.queryByText('Your KYB is under review.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit KYB' })).toBeDisabled();
  });
});
