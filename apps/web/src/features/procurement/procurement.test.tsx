import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { jsonResponse, renderTerminal, signIn } from '@/test/render';
import { useWorkspaceStore, initialWorkspace } from '@/terminal-kit';
import { useSessionStore } from '@/lib/session-store';
import { RfqPage } from './components/RfqPage';
import { SupplyPage } from './components/SupplyPage';
import { RfqForm } from './components/forms';
import { rfqStatus, receiptFor } from './components/shared';

const rfq = (over: Record<string, unknown>) => ({
  id: 'RFQ-1',
  kind: 'gpu_rental',
  title: 'Cluster',
  model: 'H100',
  region: 'Germany',
  term: 'Spot',
  count: 8,
  hours: 72,
  budget: 2.5,
  status: 'Open',
  quotes: [],
  audit: [],
  ...over,
});

beforeEach(() => {
  useWorkspaceStore.setState({
    ...initialWorkspace(),
    identity: { name: 'Ada', email: 'ada@example.com', id: 'u1' },
  });
  useSessionStore.setState({ status: 'booting', user: null });
  signIn();
  useWorkspaceStore.getState().applySession(useSessionStore.getState().user);
});

describe('RFQ status presentation', () => {
  it('shows Reviewing, Live RFQ and private approvals correctly and never relabels closed states', () => {
    expect(rfqStatus(rfq({ status: 'Reviewing' }) as never)).toBe('Reviewing');
    expect(rfqStatus(rfq({ status: 'Open', reviewStatus: 'Approved' }) as never)).toBe('Live RFQ');
    expect(
      rfqStatus(
        rfq({ status: 'Quoted', reviewStatus: 'Approved', visibility: 'Private RFQ' }) as never,
      ),
    ).toBe('Approved · Private RFQ');
    expect(rfqStatus(rfq({ status: 'Completed', reviewStatus: 'Approved' }) as never)).toBe(
      'Completed',
    );
  });
  it('treats only a complete Received receipt as a Console acknowledgment', () => {
    expect(
      receiptFor({
        submission: {
          status: 'Received',
          receiptId: 'RCPT-1',
          receivedAt: '2026-10-18T08:00:00.000Z',
          revision: 1,
        },
      }),
    ).not.toBeNull();
    expect(
      receiptFor({
        submission: {
          status: 'Saved',
          receiptId: 'RCPT-1',
          receivedAt: '2026-10-18T08:00:00.000Z',
        },
      }),
    ).toBeNull();
    expect(
      receiptFor({ submission: { status: 'Received', receiptId: '', receivedAt: 'x' } }),
    ).toBeNull();
    expect(receiptFor(null)).toBeNull();
  });
});

describe('RFQ page', () => {
  it('lists owner records in a four-column table with status tags, details controls and status filters', () => {
    renderTerminal(<RfqPage />, {
      workspace: {
        rfqs: [
          rfq({ status: 'Reviewing' }),
          rfq({
            id: 'RFQ-2',
            status: 'Open',
            reviewStatus: 'Approved',
            quotes: [{ id: 'Q1', status: 'Pending', price: 2 }],
          }),
          rfq({ id: 'RFQ-3', status: 'Rejected', reviewReason: '<b>fix</b>' }),
        ] as never,
      },
    });
    expect(screen.getByRole('heading', { name: 'RFQs & Quote' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Model',
      'vCPU & Memory',
      'Estimated Price',
      'Details',
    ]);
    expect(screen.getByText('Reviewing', { selector: '.tag' })).toBeInTheDocument();
    expect(screen.getByText('Live RFQ', { selector: '.tag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review quotes (1)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('RFQ status'), { target: { value: 'Rejected' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(document.body.innerHTML).not.toContain('<b>fix</b>');
  });
  it('Post RFQ opens the native RFQ form modal', () => {
    renderTerminal(<RfqPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Post RFQ' }));
    expect(useWorkspaceStore.getState().modal?.type).toBe('rfq-form');
  });
});

describe('RFQ form', () => {
  it('shows the Maximum Quote Price as the quantity-duration budget total and updates with inputs', () => {
    renderTerminal(<RfqForm r={{ budget: 2, count: 8, hours: 10 }} />);
    const maximum = document.querySelector('[data-proc-maximum-quote]')!;
    expect(maximum.textContent).toBe('$160.00');
    fireEvent.change(screen.getByLabelText('Maximum USD / GPU-hour'), { target: { value: '2.5' } });
    expect(maximum.textContent).toBe('$200.00');
    expect(screen.getByLabelText('Region / data location')).toBeInTheDocument();
    expect(screen.queryByLabelText('Requirement name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Post RFQ' })).toBeInTheDocument();
  });
  it('submits to the marketplace API with one stable client submission id and keeps the server receipt', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        if (url === '/api/marketplace/rfqs' && init?.method === 'POST') {
          calls.push({ url, body });
          if (calls.length === 1)
            return jsonResponse({ error: 'Sign in with a verified account.' }, 401);
          return jsonResponse({
            rfq: {
              id: 'RFQ-9',
              status: 'Reviewing',
              model: 'H100',
              submission: {
                status: 'Received',
                receiptId: 'RCPT-9',
                receivedAt: '2026-10-18T08:00:00.000Z',
                revision: 1,
              },
            },
          });
        }
        return jsonResponse({
          rfqs: [],
          supplies: [],
          featured: { rfqs: [], supplies: [] },
          rows: [],
          listings: [],
          review: { status: 'Not started', step: 0 },
          responses: [],
          orders: [],
          notifications: [],
          instances: [],
          reason: '',
          confirmed: true,
          accountId: 'u1',
          currency: 'USD',
          availableCredit: 0,
          paidCredit: 0,
          promotionalCredit: 0,
          requests: [],
        });
      }),
    );
    renderTerminal(<RfqForm r={{ budget: 2, count: 8, hours: 10, region: 'Germany' }} />);
    fireEvent.change(screen.getByLabelText('vCPU'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Memory (GB / GPU)'), { target: { value: '80' } });
    const submit = screen.getByRole('button', { name: 'Post RFQ' });
    fireEvent.click(submit);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(useWorkspaceStore.getState().modal).toBeNull();
    expect(String(calls[0].body.clientSubmissionId)).toMatch(/.{8,}/);
    expect(calls[0].body.start).toMatch(/Z$/);
    fireEvent.click(submit);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body.clientSubmissionId).toBe(calls[0].body.clientSubmissionId);
    await waitFor(() => expect(useWorkspaceStore.getState().modal?.type).toBe('proc-submission'));
    expect(useWorkspaceStore.getState().modal).toMatchObject({
      id: 'RFQ-9',
      recordKind: 'rfq',
      receipt: { receiptId: 'RCPT-9' },
    });
    vi.unstubAllGlobals();
  });
});

describe('Supply page', () => {
  it('shows the review gate, capacity table and responses with base prices and the settlement fee label', () => {
    useWorkspaceStore.getState().patch({ role: 'seller' });
    renderTerminal(<SupplyPage />, {
      workspace: {
        review: { status: 'Reviewing', step: 1 },
        listings: [
          {
            id: 'SUP-1',
            model: 'H100',
            region: 'Germany',
            count: 8,
            hours: 100,
            netPrice: 2.2,
            status: 'Awaiting agent',
            agentStatus: 'Pending',
          },
        ] as never,
        responses: [
          {
            id: 'QUOTE-1',
            rfqId: 'RFQ-1',
            model: 'H100',
            rate: 2.4,
            status: 'Pending',
            validUntil: '2026-11-01T00:00:00Z',
          },
        ] as never,
      },
    });
    expect(screen.getByRole('heading', { name: 'My Supply' })).toBeInTheDocument();
    expect(document.querySelector('.proc-review-steps')?.textContent).toContain('KYB · Reviewing');
    expect(screen.getByRole('button', { name: 'View submission' })).toBeInTheDocument();
    expect(screen.getByText('$2.20')).toBeInTheDocument();
    expect(screen.getByText('OpenNEXT Fee 5%')).toBeInTheDocument();
    expect(screen.getByText('Agent: Pending')).toBeInTheDocument();
    expect(screen.getByText('H100 · RFQ-1')).toBeInTheDocument();
  });
});
