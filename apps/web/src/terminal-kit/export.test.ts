import { describe, expect, it } from 'vitest';
import { csvFrom } from './export';

describe('csvFrom', () => {
  it('quotes values, neutralises spreadsheet formulas and drops nested quote fields', () => {
    const csv = csvFrom([
      { id: 'RFQ-1', title: '=SUM(A1)', quotes: [1], note: 'say "hi"' },
      { id: 'RFQ-2', extra: { a: 1 } },
    ]);
    expect(csv.split('\n')[0]).toBe('id,title,note,extra');
    expect(csv).toContain('"\'=SUM(A1)"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"{""a"":1}"');
  });
});
