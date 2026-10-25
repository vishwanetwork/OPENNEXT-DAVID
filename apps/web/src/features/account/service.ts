import type { SshKeyRecord } from './ssh-keys';

/**
 * Backend adapter for the account key library (legacy `OpenNEXTAccountService`). The backend
 * uses its verified session, never a client-supplied owner id. Until a backend connects it,
 * real accounts see "SSH key management is not connected yet".
 *
 *   listSshKeys()               -> { keys: [{ id, label, publicKey, createdAt }] }
 *   addSshKey({ label, publicKey }) -> { confirmed: true, key: {...} }
 *   removeSshKey({ id })        -> { confirmed: true, id }
 */
export interface AccountService {
  listSshKeys?: () => Promise<{ keys: unknown[] }>;
  addSshKey?: (input: {
    label: string;
    publicKey: string;
  }) => Promise<{ confirmed?: boolean; key?: unknown }>;
  removeSshKey?: (input: { id: string }) => Promise<{ confirmed?: boolean; id?: string }>;
}

let service: AccountService | null = null;

export function registerAccountService(next: AccountService | null) {
  service = next;
}
export const accountService = () => service;
export const serviceConnected = (method: keyof AccountService) =>
  typeof service?.[method] === 'function';

export type { SshKeyRecord };
