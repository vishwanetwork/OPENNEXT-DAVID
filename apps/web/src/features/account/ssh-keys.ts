/**
 * SSH public-key validation and the per-account key library logic, ported from
 * OpenNEXT-account-profile-preview.js. Pure functions: no DOM, no globals except
 * `atob`/`btoa`/`crypto.subtle` through the injected runtime.
 */

export const MAX_KEYS = 50;
export const DEMO_STORAGE_PREFIX = 'opennext:demo:account-ssh:v1:';
export const UNCONFIGURED =
  'SSH key management is not connected yet. No account changes have been made.';

export interface ParsedPublicKey {
  algorithm: string;
  material: string;
  publicKey: string;
  bytes: Uint8Array;
}

export interface SshKeyRecord {
  id: string;
  label: string;
  publicKey: string;
  material: string;
  algorithm: string;
  fingerprint: string;
  createdAt: string | null;
}

export interface KeyRuntime {
  atob: (value: string) => string;
  btoa: (value: string) => string;
  subtle: SubtleCrypto | undefined;
}

const defaultRuntime = (): KeyRuntime => ({
  atob: (value) => globalThis.atob(value),
  btoa: (value) => globalThis.btoa(value),
  subtle: globalThis.crypto?.subtle,
});

function decodeBase64(value: string, runtime: KeyRuntime): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1)
    throw new Error('The public key contains invalid Base64 data.');
  let binary: string;
  try {
    binary = runtime.atob(value);
  } catch {
    throw new Error('The public key contains invalid Base64 data.');
  }
  if (runtime.btoa(binary).replace(/=+$/, '') !== value.replace(/=+$/, ''))
    throw new Error('The public key encoding is not valid.');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function validatePublicKey(
  value: unknown,
  runtime: KeyRuntime = defaultRuntime(),
): ParsedPublicKey {
  const text = String(value ?? '').trim();
  if (!text || text.length > 16384)
    throw new Error('Enter one SSH public key, up to 16,384 characters.');
  if (/[\r\n\x00-\x1F\x7F]/.test(text) || /PRIVATE KEY|BEGIN |END /i.test(text))
    throw new Error('Use a single-line public key only. Never upload a private key.');
  const parts =
    /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) +([A-Za-z0-9+/=]+)(?: +([^\r\n]{0,254}))?$/.exec(
      text,
    );
  if (!parts) throw new Error('Use an ED25519, RSA or ECDSA OpenSSH public key.');
  const algorithm = parts[1];
  const bytes = decodeBase64(parts[2] ?? '', runtime);
  let cursor = 0;
  function field(): Uint8Array {
    if (cursor + 4 > bytes.length) throw new Error('The public key is incomplete.');
    const size =
      (bytes[cursor] ?? 0) * 0x1000000 +
      ((bytes[cursor + 1] ?? 0) << 16) +
      ((bytes[cursor + 2] ?? 0) << 8) +
      (bytes[cursor + 3] ?? 0);
    cursor += 4;
    if (size > bytes.length - cursor) throw new Error('The public key is incomplete.');
    const result = bytes.slice(cursor, cursor + size);
    cursor += size;
    return result;
  }
  const ascii = (data: Uint8Array) =>
    Array.from(data, (code) => String.fromCharCode(code)).join('');
  if (ascii(field()) !== algorithm)
    throw new Error('The encoded algorithm does not match the public key type.');
  if (algorithm === 'ssh-ed25519') {
    if (field().length !== 32) throw new Error('An ED25519 public key must contain 32 bytes.');
  } else if (algorithm === 'ssh-rsa') {
    const exponent = field();
    const modulus = field();
    const unsigned = (data: Uint8Array) =>
      data.length > 0 &&
      !((data[0] ?? 0) & 128) &&
      !(data.length > 1 && data[0] === 0 && !((data[1] ?? 0) & 128));
    let exp = 0n;
    for (const byte of exponent) exp = (exp << 8n) + BigInt(byte);
    const number = modulus[0] === 0 ? modulus.slice(1) : modulus;
    const bits = number.length
      ? 8 * (number.length - 1) + Math.floor(Math.log2(number[0] ?? 0)) + 1
      : 0;
    if (
      !unsigned(exponent) ||
      !unsigned(modulus) ||
      exponent.length > 8 ||
      exp < 3n ||
      exp % 2n === 0n ||
      bits < 2048 ||
      bits > 8192 ||
      !((number[number.length - 1] ?? 0) & 1)
    )
      throw new Error('Use a valid RSA public key between 2,048 and 8,192 bits.');
  } else {
    const curve = algorithm.replace('ecdsa-sha2-', '');
    const point = field();
    if (ascii(point) !== curve)
      throw new Error('The encoded curve does not match the public key type.');
    const publicPoint = field();
    const expected = { nistp256: 65, nistp384: 97, nistp521: 133 }[
      curve as 'nistp256' | 'nistp384' | 'nistp521'
    ];
    if (publicPoint.length !== expected || publicPoint[0] !== 4)
      throw new Error('The ECDSA public point is not valid.');
  }
  if (cursor !== bytes.length) throw new Error('The public key contains unexpected encoded data.');
  const material =
    algorithm + ' ' + runtime.btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  return {
    algorithm,
    material,
    publicKey: material + (parts[3] ? ' ' + parts[3].trim() : ''),
    bytes,
  };
}

export async function fingerprint(
  parsed: ParsedPublicKey,
  runtime: KeyRuntime = defaultRuntime(),
): Promise<string> {
  const subtle = runtime.subtle;
  if (!subtle) throw new Error('Secure key validation is unavailable in this browser.');
  if (parsed.algorithm.startsWith('ecdsa-sha2-')) {
    const curves: Record<string, [string, number]> = {
      'ecdsa-sha2-nistp256': ['P-256', 65],
      'ecdsa-sha2-nistp384': ['P-384', 97],
      'ecdsa-sha2-nistp521': ['P-521', 133],
    };
    const curve = curves[parsed.algorithm];
    if (!curve) throw new Error('The ECDSA public point is not valid.');
    const [namedCurve, length] = curve;
    try {
      await subtle.importKey(
        'raw',
        new Uint8Array(parsed.bytes.slice(-length)).buffer as ArrayBuffer,
        { name: 'ECDSA', namedCurve },
        false,
        ['verify'],
      );
    } catch {
      throw new Error('The ECDSA public point is not valid.');
    }
  }
  const hash = new Uint8Array(
    await subtle.digest('SHA-256', new Uint8Array(parsed.bytes).buffer as ArrayBuffer),
  );
  return (
    'SHA256:' +
    runtime
      .btoa(Array.from(hash, (value) => String.fromCharCode(value)).join(''))
      .replace(/=+$/, '')
  );
}

export function keyLabel(value: unknown): string {
  const label = String(value ?? '').trim();
  if (!label || label.length > 80 || /[\x00-\x1F\x7F]/.test(label))
    throw new Error('Enter a label between 1 and 80 characters.');
  return label;
}

export async function normalizeKey(
  row: unknown,
  runtime: KeyRuntime = defaultRuntime(),
): Promise<SshKeyRecord> {
  const record = row as {
    id?: unknown;
    publicKey?: unknown;
    label?: unknown;
    createdAt?: unknown;
  } | null;
  if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 200)
    throw new Error('The account service returned an invalid SSH key record.');
  const parsed = validatePublicKey(record.publicKey, runtime);
  const label = keyLabel(record.label);
  const date = Date.parse(String(record.createdAt));
  return {
    id: record.id,
    label,
    publicKey: parsed.publicKey,
    material: parsed.material,
    algorithm: parsed.algorithm,
    fingerprint: await fingerprint(parsed, runtime),
    createdAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
  };
}

/** Identity of the signed-in account as the key library sees it. */
export interface AccountRef {
  id: string;
  demo: boolean;
  /** `demo:<id>` or `account:<id>` — scopes stores and demo storage. */
  key: string;
  available: boolean;
}

export function accountRef(
  user: { id?: unknown; demo?: unknown } | null | undefined,
  demoMode: boolean,
): AccountRef {
  const id = typeof user?.id === 'string' ? user.id : '';
  const demo = Boolean(demoMode || user?.demo);
  return { id, demo, key: (demo ? 'demo:' : 'account:') + id, available: Boolean(id) };
}

export const demoStorageKey = (account: AccountRef) =>
  DEMO_STORAGE_PREFIX + encodeURIComponent(account.id);

export async function readDemoKeys(
  account: AccountRef,
  storage: Pick<Storage, 'getItem'>,
  runtime?: KeyRuntime,
): Promise<SshKeyRecord[]> {
  if (!account.demo || !account.available) throw new Error('An active Demo workspace is required.');
  const raw = storage.getItem(demoStorageKey(account));
  if (!raw) return [];
  const saved = JSON.parse(raw) as { version?: number; keys?: unknown[] };
  if (saved.version !== 1 || !Array.isArray(saved.keys) || saved.keys.length > MAX_KEYS)
    throw new Error('The Demo SSH key data could not be read.');
  return Promise.all(saved.keys.map((row) => normalizeKey(row, runtime)));
}

export function saveDemoKeys(
  account: AccountRef,
  keys: SshKeyRecord[],
  storage: Pick<Storage, 'setItem'>,
) {
  if (!account.demo || !account.available)
    throw new Error('Demo keys cannot be saved to a real account.');
  storage.setItem(
    demoStorageKey(account),
    JSON.stringify({
      version: 1,
      keys: keys.map(({ id, label, publicKey, createdAt }) => ({
        id,
        label,
        publicKey,
        createdAt,
      })),
    }),
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  email: 'Email verification',
  microsoft: 'Microsoft',
  sso: 'Company SSO',
  passkey: 'Passkey',
};

export interface ProfileIdentity {
  name: string;
  email: string;
  provider: string;
}

/** Verified identity shown on the profile; demo workspaces never show fixture identities. */
export function profileIdentity(
  user: Record<string, unknown> | null | undefined,
  account: AccountRef,
): ProfileIdentity {
  if (account.demo || !account.available || !user) return { name: '', email: '', provider: '' };
  const provider = user.provider || user.signInProvider || user.authProvider;
  const providers: unknown[] = provider
    ? [provider]
    : Array.isArray(user.identities)
      ? (user.identities as { provider?: unknown }[]).map((item) => item.provider)
      : [];
  return {
    name: String(user.name || '').slice(0, 160),
    email: String(user.email || '').slice(0, 254),
    provider: [
      ...new Set(
        providers
          .filter((value): value is string => typeof value === 'string')
          .map((value) => PROVIDER_LABELS[value.toLowerCase()] || value.slice(0, 80)),
      ),
    ].join(', '),
  };
}

export function verificationFor(
  role: string,
  reviewStatus: string | undefined,
): { label: string; status: string; kind: string } {
  if (role !== 'Seller') return { label: 'KYC / KYB', status: '', kind: '' };
  const status = ['Approved', 'Reviewing', 'Rejected'].includes(String(reviewStatus))
    ? String(reviewStatus)
    : '';
  return {
    label: 'KYC / KYB',
    status,
    kind:
      status === 'Approved'
        ? 'approved'
        : status === 'Reviewing'
          ? 'reviewing'
          : status === 'Rejected'
            ? 'rejected'
            : '',
  };
}

export function initialsOf(name: string): string {
  return name
    ? name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase()
    : '';
}
