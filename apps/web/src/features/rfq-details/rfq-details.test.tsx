import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { RfqDetails } from './rfq-details';
import { maximumQuote, rfqKind } from './maximum';

const request = {
  kind: 'rental',
  model: 'H200',
  region: 'US East',
  vcpu: 128,
  count: 8,
  memory: 141,
  hours: 48,
  term: 'On-demand',
  budget: 3.225,
  start: '2026-10-20T08:00:00.000Z',
  quoteDeadline: '2026-10-18T08:00:00.000Z',
  urgency: 'Standard',
  visibility: 'Public RFQ',
  shareClosingPrice: true,
};

describe('maximumQuote', () => {
  it('rounds once at the subtotal with integer arithmetic', () => {
    expect(maximumQuote(request)).toBe(1238.4);
    expect(maximumQuote({ ...request, budget: 0.005, count: 1, hours: 1 })).toBe(0.01);
    expect(maximumQuote({ kind: 'model', budget: 1234.567 })).toBe(1234.57);
    expect(maximumQuote({ kind: 'hardware', budget: 10, count: 3 })).toBe(30);
    expect(maximumQuote({ ...request, budget: null })).toBeNull();
    expect(maximumQuote({ ...request, count: 0 })).toBeNull();
  });
  it('normalises legacy kinds', () => {
    expect(rfqKind({ kind: 'rental' })).toBe('gpu_rental');
    expect(rfqKind({ kind: 'hardware' })).toBe('physical_gpu');
    expect(rfqKind({ kind: 'model_capacity' })).toBe('model_capacity');
    expect(rfqKind({})).toBe('gpu_rental');
  });
});

describe('RfqDetails', () => {
  it('retains the form order, labels and optional empty values with no actions', () => {
    const { container } = render(<RfqDetails record={request} />);
    const fields = [...container.querySelectorAll('[data-rfq-field]')].map((el) =>
      el.getAttribute('data-rfq-field'),
    );
    expect(fields).toEqual([
      'model',
      'region',
      'vcpu',
      'count',
      'memory',
      'hours',
      'term',
      'budget',
      'start',
      'quoteDeadline',
      'network',
      'storage',
      'image',
      'sla',
      'deliveryMethod',
      'urgency',
      'visibility',
      'notes',
      'shareClosingPrice',
    ]);
    const html = container.innerHTML;
    for (const label of [
      'Required start (UTC)',
      'Quotes due (UTC)',
      'SLA / support needs (optional)',
      'Maximum Quote Price:',
      '$1,238.40',
      'Not provided',
    ])
      expect(html).toContain(label);
    expect(container.querySelector('a,button,form,input,textarea,select')).toBeNull();
    expect(html).not.toMatch(/Requirement name|Project/);
  });
  it('shows the selected resource for quote requests and escapes untrusted content', () => {
    const { container } = render(
      <RfqDetails
        record={{
          ...request,
          requestKind: 'quote_request',
          model: '<script>model</script>',
          notes: '<img onerror="alert(1)">',
          selectedOffer: {
            id: '<svg onload="alert(1)">',
            model: 'H200',
            country: 'US',
            term: 'On-demand',
            gpuCount: 8,
            instanceHourly: 25.8,
            perGpuHourly: 3.225,
          },
        }}
      />,
    );
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Submitted quote request details',
    );
    expect(container.textContent).toContain('Selected resource');
    expect(container.textContent).toContain('<script>model</script>');
    expect(container.querySelector('script,img,svg')).toBeNull();
  });
  it('uses hardware and model labels for the other markets', () => {
    const hardware = render(<RfqDetails record={{ kind: 'hardware', budget: 10, count: 2 }} />);
    expect(hardware.container.textContent).toContain('Maximum unit price (USD / GPU)');
    expect(hardware.container.textContent).toContain('Required arrival (UTC)');
    const model = render(<RfqDetails record={{ kind: 'model_capacity', budget: 100 }} />);
    expect(model.container.textContent).toContain('Maximum total budget (USD)');
    expect(model.container.textContent).toContain('Access and data policy requirements');
  });
});
