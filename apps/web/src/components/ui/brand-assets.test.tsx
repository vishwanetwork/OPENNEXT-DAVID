import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BRAND_PATH } from './brand';
import { TerminalBrand } from './terminal-brand';

const asset = (directory: string, name: string) =>
  readFileSync(resolve('public', directory, name), 'utf8');

describe('original OpenNEXT branding', () => {
  it.each(['navy', 'white'])('uses the same outlined %s logo across all sites', (color) => {
    const terminal = asset('terminal-design', `opennext-logo-${color}.svg`);
    expect(asset('landing-design', `opennext-logo-${color}.svg`)).toBe(terminal);
    expect(terminal).toContain(BRAND_PATH);
    expect(terminal).toContain('<title id="title">OpenNEXT</title>');
    expect(terminal).toContain('viewBox="0 0 260 52"');
    expect(terminal).not.toMatch(/<text|Weave|OpenNext/);
  });

  it('uses the original mark in both application favicons', () => {
    const terminal = asset('terminal-design', 'favicon.svg');
    expect(asset('landing-design', 'favicon.svg')).toBe(terminal);
    expect(terminal).toContain(BRAND_PATH);
    expect(terminal).not.toContain('Weave');
  });

  it('renders accessible light and dark lockups at their original proportions', () => {
    const { rerender } = render(<TerminalBrand />);
    const image = screen.getByRole('img', { name: 'OpenNEXT' });
    expect(image).toHaveAttribute('src', '/terminal-design/opennext-logo-navy.svg');
    expect(image).toHaveAttribute('width', '260');
    expect(image).toHaveAttribute('height', '52');
    rerender(<TerminalBrand light />);
    expect(image).toHaveAttribute('src', '/terminal-design/opennext-logo-white.svg');
  });
});
