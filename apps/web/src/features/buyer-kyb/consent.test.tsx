import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import { BuyerKybContent } from './index';
import { serviceFixture } from './test-fixtures';

const labels = [
  'Proof of legal presence',
  'Ownership structure',
  'Proof of business address',
  'Company details',
  'Representative authorization',
];
const attach = (
  label: string,
  file = new File(['fixture'], 'sample.pdf', { type: 'application/pdf' }),
) => fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });

beforeEach(() => signIn());

describe('verification consent and assistance', () => {
  it('enables consent only after all five valid document categories are present', async () => {
    renderTerminal(<BuyerKybContent />, { slots: { services: { buyerKyb: serviceFixture() } } });
    fireEvent.change(screen.getByLabelText('Country / region of incorporation'), {
      target: { value: 'SG' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Proof of legal presence')).not.toBeDisabled(),
    );
    expect(screen.getByRole('checkbox')).toBeDisabled();
    for (const label of labels.slice(0, 4)) attach(label);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    attach('Representative authorization');
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).toBeChecked();
    attach('Proof of legal presence', new File(['invalid'], 'sample.txt', { type: 'text/plain' }));
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Submit KYB' })).toBeDisabled();
    attach('Proof of legal presence');
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Company details'), { target: { files: [] } });
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    attach('Company details');
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Country / region of incorporation'), {
      target: { value: 'US' },
    });
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
  it('opens the existing contact integration without submitting the KYB form', () => {
    const openContact = vi.fn();
    renderTerminal(<BuyerKybContent />, { slots: { openContact } });
    expect(
      screen.getByText(/If you need help completing business verification/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'contact us' }));
    expect(openContact).toHaveBeenCalledWith({
      message: 'I need help completing business verification.',
    });
  });
});
