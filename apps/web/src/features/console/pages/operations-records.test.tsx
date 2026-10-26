import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderConsole } from '@/test/render';
import { OrdersPage } from './orders';
import { PaymentsPage } from './payments';
import { UsersPage } from './users';
import {
  filterOrders,
  filterPayments,
  filterUsers,
  growthValue,
  paymentAmount,
  type OperationsOrder,
  type OperationsPayment,
  type UsersSnapshot,
} from './operations-records';

const users: UsersSnapshot = {
  users: [
    {
      id: 'u1',
      name: 'Alice',
      email: 'alice@example.test',
      company: 'Acme',
      role: 'Buyer',
      status: 'Active',
      joinedAt: '2026-10-21T12:00:00Z',
    },
    {
      id: 'u2',
      name: 'Bob',
      email: 'bob@example.test',
      company: null,
      role: 'Seller',
      status: 'Active',
      joinedAt: '2026-10-22T12:00:00Z',
    },
  ],
  totalUsers: 350,
  growth: { '7D': 3, '1M': 12 },
};
const baseOrder: OperationsOrder = {
  id: 'order-1',
  kind: 'Instance',
  email: 'alice@example.test',
  model: 'H100',
  gpuCount: 8,
  country: 'Singapore',
  term: 'Spot',
  total: 100,
  currency: 'USD',
  status: 'Provisioning',
  state: 'processing',
  submittedAt: '2026-10-21T12:00:00Z',
};
const orders: readonly OperationsOrder[] = [
  baseOrder,
  { ...baseOrder, id: 'order-2', kind: 'RFQ', model: 'B200', status: 'Awaiting payment' },
  { ...baseOrder, id: 'order-closed', state: 'completed', status: 'Completed' },
];
const basePayment: OperationsPayment = {
  id: 'pay-1',
  email: 'alice@example.test',
  orderId: 'order-1',
  amount: 100,
  currency: 'USD',
  reference: 'BANK-REF',
  submittedAt: '2026-10-21T12:00:00Z',
  status: 'Awaiting confirmation',
  detail: 'Account holder supplied a transfer reference.',
};

describe('operations record selectors', () => {
  it('filters verified user rows without inventing a total or missing growth', () => {
    expect(filterUsers(users.users, ' ACME ', 'All')).toHaveLength(1);
    expect(filterUsers(users.users, '', 'Seller').map((row) => row.id)).toEqual(['u2']);
    expect(filterUsers(users.users, 'Alice', 'Seller')).toHaveLength(0);
    expect(growthValue(undefined, '7D')).toBeUndefined();
    expect(growthValue(users, '3M')).toBeUndefined();
    expect(growthValue(users, '1M')).toBe(12);
  });

  it('only includes in-progress orders and filters by type and search', () => {
    expect(filterOrders(orders, '', 'All').map((row) => row.id)).toEqual(['order-1', 'order-2']);
    expect(filterOrders(orders, 'singapore', 'RFQ').map((row) => row.id)).toEqual(['order-2']);
    expect(filterOrders(orders, 'B200', 'Instance')).toHaveLength(0);
    expect(orders).toHaveLength(3);
  });

  it('keeps bank-payment filtering separate and preserves currency', () => {
    const payments = [basePayment, { ...basePayment, id: 'pay-2', status: 'Rejected' as const }];
    expect(filterPayments(payments, ' bank-ref ', 'Awaiting confirmation')).toEqual([basePayment]);
    expect(filterPayments(payments, 'missing', 'All')).toHaveLength(0);
    expect(paymentAmount(1000, 'SGD')).toBe('1,000.00 SGD');
    expect(paymentAmount(Number.NaN, 'USD')).toBe('—');
  });
});

describe('Users page', () => {
  it('does not show preview account counts before a service is connected', () => {
    const { container } = renderConsole(<UsersPage />);
    expect(screen.getByText('User directory awaiting backend')).toBeInTheDocument();
    expect([...container.querySelectorAll('.stat-value')].map((node) => node.textContent)).toEqual([
      '—',
      '—',
    ]);
    expect(screen.queryByRole('button', { name: 'Invite account' })).not.toBeInTheDocument();
  });

  it('renders server aggregates, changes the growth period and filters rows', () => {
    const { container } = renderConsole(<UsersPage snapshot={users} />);
    expect(screen.getByText('350')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/New users/), { target: { value: '1M' } });
    expect(screen.getByText('+12')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/New users/), { target: { value: '3M' } });
    expect(container.querySelectorAll('.stat-value')[1]?.textContent).toBe('—');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Seller' } });
    expect(screen.getByText('bob@example.test')).toBeInTheDocument();
    expect(screen.queryByText('alice@example.test')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search name, company or email…'), {
      target: { value: 'Alice' },
    });
    expect(screen.getByText('No matching users')).toBeInTheDocument();
  });

  it('can represent a genuinely confirmed empty directory', () => {
    const { container } = renderConsole(
      <UsersPage snapshot={{ users: [], totalUsers: 0, growth: { '7D': 0 } }} />,
    );
    expect([...container.querySelectorAll('.stat-value')].map((node) => node.textContent)).toEqual([
      '0',
      '+0',
    ]);
  });
});

describe('Orders page', () => {
  it('shows the missing-service state without fabricated manage actions', () => {
    renderConsole(<OrdersPage />);
    expect(screen.getByText('Order service awaiting backend')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
  });

  it('filters supplied in-progress records by type and search', () => {
    renderConsole(<OrdersPage orders={orders} />);
    expect(screen.queryByText('order-closed')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Order type'), { target: { value: 'RFQ' } });
    expect(screen.getByText('order-2')).toBeInTheDocument();
    expect(screen.queryByText('order-1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search order, email, model or country…'), {
      target: { value: 'H100' },
    });
    expect(screen.getByText('No matching in-progress orders')).toBeInTheDocument();
  });
});

describe('Payment Requests page', () => {
  it('does not infer bank payments from credit requests', () => {
    renderConsole(<PaymentsPage />);
    expect(screen.getByText('Payment service awaiting backend')).toBeInTheDocument();
    expect(screen.getByText(/No payment can be approved here yet/)).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('opens read-only details and keeps financial mutations disabled', () => {
    renderConsole(<PaymentsPage payments={[basePayment]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = screen.getByRole('dialog', { name: 'Payment request details' });
    expect(within(dialog).getByText(basePayment.detail)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Confirmed' } });
    expect(screen.getByText('No matching payment requests')).toBeInTheDocument();
  });
});
