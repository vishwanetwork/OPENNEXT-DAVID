import { describe, expect, it } from 'vitest';
import { at } from '@/test/at';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { sshTestRuntime as runtime } from '@/test/ssh-runtime';
import {
  accountRef,
  fingerprint,
  keyLabel,
  profileIdentity,
  validatePublicKey,
  verificationFor,
} from './ssh-keys';
import type { AccountService } from '@/terminal-kit';
import { changeKey, libraryFor, loadKeys, useKeyLibraries, type KeyLibraryDeps } from './store';

let accountService: AccountService | null = null;
const registerAccountService = (next: AccountService | null) => {
  accountService = next;
};

const field = (bytes: Buffer | string) => {
  const data = Buffer.from(bytes);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, data]);
};
const wire = (type: string, ...parts: (Buffer | string)[]) =>
  type + ' ' + Buffer.concat([field(type), ...parts.map(field)]).toString('base64');
const edBytes = generateKeyPairSync('ed25519')
  .publicKey.export({ type: 'spki', format: 'der' })
  .subarray(-32);
const publicKey = wire('ssh-ed25519', edBytes);

describe('SSH public key validation', () => {
  it('valid ED25519 key and fingerprint match the OpenSSH SHA-256 convention', async () => {
    const parsed = validatePublicKey(publicKey + ' workstation', runtime);
    expect(parsed.material).toBe(publicKey);
    expect(parsed.publicKey).toBe(publicKey + ' workstation');
    const digest = createHash('sha256')
      .update(Buffer.from(publicKey.split(' ')[1] ?? '', 'base64'))
      .digest('base64')
      .replace(/=+$/, '');
    expect(await fingerprint(parsed, runtime)).toBe('SHA256:' + digest);
  });
  it('rejects private, multiline, malformed and mismatched encoded algorithms', () => {
    for (const invalid of [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'ssh-ed25519 aaaa\nssh-ed25519 aaaa',
      'ssh-ed25519 !!!',
      'ssh-rsa ' + publicKey.split(' ')[1],
      wire('ssh-ed25519', Buffer.alloc(31)),
      publicKey.slice(0, -5),
      'ssh-ed25519 ' +
        Buffer.concat([field('ssh-ed25519'), field(edBytes), Buffer.from([1])]).toString('base64'),
    ])
      expect(() => validatePublicKey(invalid, runtime), invalid.slice(0, 30)).toThrow();
  });
  it('accepts RSA 2048 structure and rejects weak or malformed modulus', () => {
    const modulus = Buffer.alloc(257, 7);
    modulus[0] = 0;
    modulus[1] = 128;
    expect(
      validatePublicKey(wire('ssh-rsa', Buffer.from([1, 0, 1]), modulus), runtime).algorithm,
    ).toBe('ssh-rsa');
    expect(() =>
      validatePublicKey(wire('ssh-rsa', Buffer.from([1, 0, 1]), Buffer.alloc(129, 7)), runtime),
    ).toThrow();
    expect(() => validatePublicKey(wire('ssh-rsa', Buffer.from([2]), modulus), runtime)).toThrow();
  });
  it('ECDSA curve and point must both validate', async () => {
    const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      format: 'jwk',
    });
    const point = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x!, 'base64url'),
      Buffer.from(jwk.y!, 'base64url'),
    ]);
    const valid = validatePublicKey(wire('ecdsa-sha2-nistp256', 'nistp256', point), runtime);
    expect(await fingerprint(valid, runtime)).toMatch(/^SHA256:/);
    expect(() =>
      validatePublicKey(wire('ecdsa-sha2-nistp256', 'nistp384', point), runtime),
    ).toThrow();
    const bad = Buffer.alloc(65);
    bad[0] = 4;
    await expect(
      fingerprint(
        validatePublicKey(wire('ecdsa-sha2-nistp256', 'nistp256', bad), runtime),
        runtime,
      ),
    ).rejects.toThrow();
  });
  it('labels are bounded and profile identity hides demo fixtures', () => {
    expect(keyLabel(' Laptop ')).toBe('Laptop');
    expect(() => keyLabel('')).toThrow();
    const user = {
      id: 'one',
      name: 'Verified User',
      email: 'verified@example.invalid',
      provider: 'google',
    };
    expect(profileIdentity(user, accountRef(user, false))).toEqual({
      name: 'Verified User',
      email: 'verified@example.invalid',
      provider: 'Google',
    });
    expect(profileIdentity(user, accountRef(user, true))).toEqual({
      name: '',
      email: '',
      provider: '',
    });
    expect(verificationFor('Seller', 'Reviewing')).toMatchObject({
      status: 'Reviewing',
      kind: 'reviewing',
    });
    expect(verificationFor('Buyer', 'Approved')).toMatchObject({ status: '', kind: '' });
  });
});

function deps(
  demo: boolean,
  id = 'one',
  storage = new Map<string, string>(),
): KeyLibraryDeps & { storageMap: Map<string, string> } {
  const user = { id, demo };
  return {
    account: () => accountRef(user, demo),
    service: () => accountService ?? undefined,
    storage: () => ({
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
    }),
    runtime,
    uuid: () => 'key-' + storage.size,
    now: () => Date.now(),
    storageMap: storage,
  };
}

describe('SSH key library', () => {
  it('Demo starts empty; add persists only the public key in identity-specific storage', async () => {
    useKeyLibraries.setState({ libraries: {} });
    registerAccountService(null);
    const d = deps(true);
    await loadKeys(d);
    expect(libraryFor('demo:one').keys.length).toBe(0);
    const result = await changeKey(d, { removing: false, label: 'Laptop', publicKey });
    expect(result?.ok).toBe(true);
    expect(libraryFor('demo:one').keys.length).toBe(1);
    const [storageKey, value] = [...d.storageMap.entries()][0] ?? [];
    expect(storageKey).toBe('opennext:demo:account-ssh:v1:one');
    expect(value).toMatch(/Laptop/);
    expect(value).not.toMatch(/PRIVATE/);
    await loadKeys(deps(true, 'two'));
    expect(libraryFor('demo:two').keys.length).toBe(0);
    const real = deps(false, 'one');
    await loadKeys(real);
    expect(libraryFor('account:one').keys.length).toBe(0);
    expect(libraryFor('account:one').error).toMatch(/not connected/);
  });
  it('duplicate key detection ignores a changed comment; removal needs the record', async () => {
    useKeyLibraries.setState({ libraries: {} });
    const d = deps(true);
    await changeKey(d, { removing: false, label: 'Laptop', publicKey });
    const second = await changeKey(d, {
      removing: false,
      label: 'Another name',
      publicKey: publicKey + ' another-comment',
    });
    expect(second?.ok).toBe(false);
    expect(second?.message).toMatch(/already been added/);
    expect(libraryFor('demo:one').keys.length).toBe(1);
    const id = at(libraryFor('demo:one').keys, 0).id;
    const removed = await changeKey(d, { removing: true, id });
    expect(removed?.ok).toBe(true);
    expect(libraryFor('demo:one').keys.length).toBe(0);
  });
  it('unconfigured real account cannot be locally saved; confirmed adapter saves without demo storage', async () => {
    useKeyLibraries.setState({ libraries: {} });
    registerAccountService(null);
    const real = deps(false);
    const blocked = await changeKey(real, { removing: false, label: 'Laptop', publicKey });
    expect(blocked?.ok).toBe(false);
    expect(blocked?.message).toMatch(/No account changes/);
    expect(real.storageMap.size).toBe(0);
    let keys: { id: string; label: string; publicKey: string; createdAt: string }[] = [];
    let received: unknown;
    registerAccountService({
      listSshKeys: async () => ({ keys }),
      addSshKey: async (input: { label: string; publicKey: string }) => {
        received = input;
        const key = { ...input, id: 'backend-key', createdAt: new Date().toISOString() };
        keys.push(key);
        return { confirmed: true, key };
      },
      removeSshKey: async ({ id }: { id: string }) => {
        keys = keys.filter((key) => key.id !== id);
        return { confirmed: true, id };
      },
    });
    useKeyLibraries.setState({ libraries: {} });
    const added = await changeKey(real, { removing: false, label: 'Laptop', publicKey });
    expect(added?.ok).toBe(true);
    expect(Object.keys(received as object).sort()).toEqual(['label', 'publicKey']);
    expect(libraryFor('account:one').keys.length).toBe(1);
    expect(real.storageMap.size).toBe(0);
    const removed = await changeKey(real, { removing: true, id: 'backend-key' });
    expect(removed?.ok).toBe(true);
    expect(libraryFor('account:one').keys.length).toBe(0);
    registerAccountService({
      listSshKeys: async () => ({ keys: [] }),
      addSshKey: async () => ({ confirmed: false }),
    });
    useKeyLibraries.setState({ libraries: {} });
    const unconfirmed = await changeKey(real, { removing: false, label: 'Laptop', publicKey });
    expect(unconfirmed?.ok).toBe(false);
    expect(unconfirmed?.message).toMatch(/not confirmed/);
    expect(libraryFor('account:one').keys.length).toBe(0);
    registerAccountService(null);
  });
});
