import { webcrypto } from 'node:crypto';
import type { KeyRuntime } from '@/features/account/ssh-keys';

/** jsdom typed arrays are foreign to Node's WebCrypto; copy them into Node buffers first. */
export const sshTestRuntime: KeyRuntime = {
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  subtle: {
    digest: (algorithm: AlgorithmIdentifier, data: BufferSource) =>
      webcrypto.subtle.digest(algorithm as string, Buffer.from(data as ArrayBuffer)),
    importKey: (
      format: string,
      data: BufferSource,
      algorithm: unknown,
      extractable: boolean,
      usages: KeyUsage[],
    ) =>
      webcrypto.subtle.importKey(
        format as 'raw',
        Buffer.from(data as ArrayBuffer),
        algorithm as Parameters<typeof webcrypto.subtle.importKey>[2],
        extractable,
        usages,
      ),
  } as unknown as SubtleCrypto,
};
