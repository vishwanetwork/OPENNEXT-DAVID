import { describe, expect, it, vi } from 'vitest';
import { requestQueue } from './request-queue';

describe('instance history request queue', () => {
  it('reserves foreground capacity and cancels obsolete queued work on navigation', async () => {
    const run = requestQueue(1);
    const first = Promise.withResolvers<void>();
    const active = run(() => first.promise);
    const controller = new AbortController();
    const work = vi.fn().mockResolvedValue('old page');
    const queued = run(work, controller.signal);
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    first.resolve();
    await active;
    expect(await run(async () => 'new page')).toBe('new page');
    expect(work).not.toHaveBeenCalled();
  });

  it('releases its slot after an error', async () => {
    const run = requestQueue(1);
    await expect(
      run(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(await run(async () => 42)).toBe(42);
  });
});
