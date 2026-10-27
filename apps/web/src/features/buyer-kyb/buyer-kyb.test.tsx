import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderTerminal, signIn, mockFetch, jsonResponse } from '@/test/render';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { useSessionStore } from '@/lib/session-store';
import { ProfilePage } from '@/features/account';
import { BuyerKybContent, BuyerKybGate, useBuyerKyb } from './index';
import { serviceFixture, snapshotFixture } from './test-fixtures';

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
  mockFetch(() =>
    jsonResponse({ rfqs: [], listings: [], review: { status: 'Approved' }, instances: [] }),
  );
});

describe('Buyer KYB frontend', () => {
  it('shows the country-led form without an adapter and never enables document uploads', () => {
    renderTerminal(<BuyerKybContent />);
    expect(screen.getByText(/Secure Buyer KYB submission is not connected/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Country / region of incorporation'), {
      target: { value: 'SG' },
    });
    expect(screen.getByText('Auto · Corporate registry check')).toBeInTheDocument();
    expect(screen.queryByLabelText('Incorporation date')).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(5);
    document
      .querySelectorAll('input[type="file"]')
      .forEach((input) => expect(input).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Submit KYB' })).toBeDisabled();
    expect(screen.getByRole('form')).not.toHaveTextContent(/allscale/i);
    expect(screen.getByRole('form')).toHaveTextContent('OpenNEXT requires');
    fireEvent.change(screen.getByLabelText('Country / region of incorporation'), {
      target: { value: 'US' },
    });
    for (const label of [
      'Incorporation date',
      'Legal form / entity type',
      'Business phone number',
      'Registered legal address',
    ])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByText('Full · Document review')).toBeInTheDocument();
    expect(screen.getByRole('form')).not.toHaveTextContent(/allscale/i);
  });
  it('never lets a supplier workspace review substitute for Buyer KYB', () => {
    renderTerminal(
      <BuyerKybGate returnTo="spot">
        <div>Payment controls</div>
      </BuyerKybGate>,
      {
        workspace: { review: { status: 'Approved', step: 3 } },
      },
    );
    expect(screen.queryByText('Payment controls')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete KYB' }));
    expect(useWorkspaceStore.getState().modal).toEqual({ type: 'buyer-kyb', returnTo: 'spot' });
  });
  it('keeps Demo isolated without the removed exploration warning', () => {
    const service = serviceFixture('Approved');
    service.load = vi.fn(service.load);
    renderTerminal(<BuyerKybContent />, { demo: true, slots: { services: { buyerKyb: service } } });
    expect(service.load).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Demo is for exploring|Do not enter real business information/),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Country / region of incorporation'), {
      target: { value: 'SG' },
    });
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(5);
    document
      .querySelectorAll('input[type="file"]')
      .forEach((input) => expect(input).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Submit KYB' })).toBeDisabled();
    expect(screen.getByRole('form')).not.toHaveTextContent(/allscale/i);
  });
  it('renders Reviewing without exposing payment controls', async () => {
    renderTerminal(<BuyerKybContent />, {
      slots: { services: { buyerKyb: serviceFixture('Reviewing') } },
    });
    expect(await screen.findByText('Your KYB is under review.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Buyer KYB status' })).not.toHaveTextContent(
      /allscale/i,
    );
    expect(screen.queryByRole('button', { name: /Continue to/ })).not.toBeInTheDocument();
  });
  it('allows approved-owner controls but immediately blocks an expired session', async () => {
    renderTerminal(
      <BuyerKybGate>
        <span>Payment controls</span>
      </BuyerKybGate>,
      { slots: { services: { buyerKyb: serviceFixture('Approved') } } },
    );
    expect(await screen.findByText('Payment controls')).toBeInTheDocument();
    act(() => useSessionStore.getState().markExpired());
    expect(screen.queryByText('Payment controls')).not.toBeInTheDocument();
  });
  it('fails closed on a wrong-owner approval response', async () => {
    const service = serviceFixture();
    service.load = async () => ({ ...snapshotFixture('Approved'), accountId: 'another-user' });
    renderTerminal(
      <BuyerKybGate>
        <span>Payment controls</span>
      </BuyerKybGate>,
      { slots: { services: { buyerKyb: service } } },
    );
    expect(await screen.findByText(/Your KYB status could not be verified/)).toBeInTheDocument();
    expect(screen.queryByText('Payment controls')).not.toBeInTheDocument();
  });
  it('keeps rejection reasons in private notifications and offers resubmission', async () => {
    const service = serviceFixture('Rejected');
    service.load = async () => ({
      ...snapshotFixture('Rejected'),
      reason: 'Private ALLScale decision',
    });
    renderTerminal(<BuyerKybContent />, { slots: { services: { buyerKyb: service } } });
    expect(await screen.findByText('Your KYB needs attention.')).toBeInTheDocument();
    expect(screen.queryByText('Private ALLScale decision')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Buyer KYB status' })).not.toHaveTextContent(
      /allscale/i,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit KYB' }));
    expect(screen.getByRole('form', { name: 'Buyer KYB form' })).toBeInTheDocument();
  });
  it('shows a Buyer KYB Profile button without changing the Seller review button', () => {
    const buyer = renderTerminal(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: /KYB/ }));
    expect(useWorkspaceStore.getState().modal?.type).toBe('buyer-kyb');
    buyer.unmount();
    signIn({ role: 'seller' });
    useWorkspaceStore.getState().patch({ role: 'seller' });
    renderTerminal(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: /KYB/ }));
    expect(useWorkspaceStore.getState().modal?.type).toBe('review');
  });
  it('revalidates approval before a payment continuation and fails closed on refresh error', async () => {
    const service = serviceFixture('Approved');
    let fail = false;
    service.load = async () => {
      if (fail) throw new Error('Unavailable');
      return snapshotFixture('Approved');
    };
    function Probe() {
      const kyb = useBuyerKyb();
      return (
        <>
          <span>{kyb.approved ? 'Approved access' : 'Blocked access'}</span>
          <button type="button" onClick={() => void kyb.refreshApproved()}>
            Recheck
          </button>
        </>
      );
    }
    renderTerminal(<Probe />, { slots: { services: { buyerKyb: service } } });
    expect(await screen.findByText('Approved access')).toBeInTheDocument();
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    await waitFor(() => expect(screen.getByText('Blocked access')).toBeInTheDocument());
  });
});
