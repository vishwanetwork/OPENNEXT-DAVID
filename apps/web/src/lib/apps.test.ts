import { describe, expect, it } from 'vitest';
import { appHref, appOrigins, resolveRequest } from './apps';

const prod = { site: 'opennextlab.ai', terminal: 'terminal.opennextlab.ai', admin: 'admin.opennextlab.ai' };

describe('resolveRequest in production (one host per app)', () => {
  it('serves the site on the apex and www', () => {
    expect(resolveRequest('opennextlab.ai', '/', prod)).toMatchObject({ app: 'site', internalPath: '/' });
    expect(resolveRequest('www.opennextlab.ai', '/privacy', prod)).toMatchObject({ app: 'site', internalPath: '/privacy' });
  });
  it('serves the terminal at the root of the terminal host', () => {
    expect(resolveRequest('terminal.opennextlab.ai:443', '/market', prod)).toMatchObject({
      app: 'terminal', base: '', internalPath: '/terminal/market', demo: false,
    });
    expect(resolveRequest('terminal.opennextlab.ai', '/', prod)).toMatchObject({ internalPath: '/terminal' });
  });
  it('keeps the legacy /demo/ workspace on the terminal host', () => {
    expect(resolveRequest('terminal.opennextlab.ai', '/demo/', prod)).toMatchObject({
      app: 'terminal', base: '/demo', internalPath: '/terminal', demo: true,
    });
    expect(resolveRequest('terminal.opennextlab.ai', '/demo/market', prod)).toMatchObject({ internalPath: '/terminal/market', demo: true });
  });
  it('serves the console at the root of the admin host and hides everything else', () => {
    expect(resolveRequest('admin.opennextlab.ai', '/pricing', prod)).toMatchObject({ app: 'admin', base: '', internalPath: '/admin/pricing' });
    expect(resolveRequest('admin.opennextlab.ai', '/admin/', prod)).toEqual({ kind: 'redirect', location: '/', permanent: true });
    expect(resolveRequest('admin.opennextlab.ai', '/terminal/market', prod)).toEqual({ kind: 'not-found' });
  });
  it('redirects legacy path entry points to their hosts', () => {
    expect(resolveRequest('opennextlab.ai', '/admin/', prod)).toEqual({ kind: 'redirect', location: 'https://admin.opennextlab.ai/', permanent: true });
    expect(resolveRequest('opennextlab.ai', '/terminal', prod)).toEqual({ kind: 'redirect', location: 'https://terminal.opennextlab.ai/', permanent: true });
    expect(resolveRequest('opennextlab.ai', '/demo/', prod)).toEqual({ kind: 'redirect', location: 'https://terminal.opennextlab.ai/demo/', permanent: true });
    expect(resolveRequest('terminal.opennextlab.ai', '/terminal/', prod)).toEqual({ kind: 'redirect', location: '/', permanent: true });
    expect(resolveRequest('terminal.opennextlab.ai', '/admin/', prod)).toEqual({ kind: 'not-found' });
  });
});

describe('resolveRequest locally (no hosts configured)', () => {
  it('serves every app by path prefix', () => {
    expect(resolveRequest('127.0.0.1:4188', '/', {})).toMatchObject({ app: 'site', base: '', internalPath: '/' });
    expect(resolveRequest('localhost', '/terminal', {})).toMatchObject({ app: 'terminal', base: '/terminal', internalPath: '/terminal' });
    expect(resolveRequest('localhost', '/terminal/market', {})).toMatchObject({ base: '/terminal', internalPath: '/terminal/market' });
    expect(resolveRequest('localhost', '/admin/', {})).toMatchObject({ app: 'admin', base: '/admin', internalPath: '/admin' });
    expect(resolveRequest('localhost', '/admin/pricing', {})).toMatchObject({ internalPath: '/admin/pricing' });
  });
  it('serves the demo workspace at /demo/ and /terminal/demo/', () => {
    expect(resolveRequest('localhost', '/demo/', {})).toMatchObject({ app: 'terminal', base: '/demo', internalPath: '/terminal', demo: true });
    expect(resolveRequest('localhost', '/terminal/demo/market', {})).toMatchObject({ base: '/terminal/demo', internalPath: '/terminal/market', demo: true });
  });
});

describe('link helpers', () => {
  it('builds in-app hrefs with and without a base', () => {
    expect(appHref('', '/market')).toBe('/market');
    expect(appHref('/terminal', '/market')).toBe('/terminal/market');
    expect(appHref('/terminal', '/')).toBe('/terminal');
    expect(appHref('', '/')).toBe('/');
  });
  it('derives cross-app origins', () => {
    expect(appOrigins({})).toEqual({ site: '', terminal: '/terminal', admin: '/admin' });
    expect(appOrigins(prod)).toEqual({ site: 'https://opennextlab.ai', terminal: 'https://terminal.opennextlab.ai', admin: 'https://admin.opennextlab.ai' });
  });
});
