import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn } from '@/test/render';
import type { AccountService } from '@/terminal-kit';
import { useAccountApiService } from './hooks';

const record = {
  id: 'key-1',
  label: 'Laptop',
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA laptop',
  createdAt: '2026-10-28T00:00:00Z',
};

describe('account key library service', () => {
  it('lists, adds and removes keys through the backend', async () => {
    const calls: string[] = [];
    mockFetch((path, init) => {
      calls.push((init?.method || 'GET') + ' ' + path);
      if (init?.method === 'POST') return json(200, { confirmed: true, key: record });
      if (init?.method === 'DELETE') return json(200, { confirmed: true, id: 'key-1' });
      return json(200, { keys: [record] });
    });
    signIn();
    const seen: { service?: AccountService } = {};
    function Probe() {
      const service = useAccountApiService();
      useEffect(() => {
        seen.service = service;
      });
      return null;
    }
    renderTerminal(<Probe />);
    await act(async () => {
      expect((await seen.service!.listSshKeys!()).keys).toHaveLength(1);
      expect(
        (await seen.service!.addSshKey!({ label: 'Laptop', publicKey: record.publicKey })).key,
      ).toEqual(record);
      expect(await seen.service!.removeSshKey!({ id: 'key-1' })).toEqual({
        confirmed: true,
        id: 'key-1',
      });
    });
    expect(calls).toEqual([
      'GET /api/account/ssh-keys',
      'POST /api/account/ssh-keys',
      'DELETE /api/account/ssh-keys/key-1',
    ]);
  });
});
