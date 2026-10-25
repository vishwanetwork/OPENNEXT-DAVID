import { z } from 'zod';

/* ---------- Account SSH key library (backend adapter expected by the profile page) ---------- */

export const SshKeyRecord = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(80),
  publicKey: z.string().min(1).max(16384),
  createdAt: z.string().nullish(),
});
export type SshKeyRecord = z.infer<typeof SshKeyRecord>;

export const SshKeyListResponse = z.object({ keys: z.array(SshKeyRecord).max(50) });
export const SshKeyAddRequest = z.object({ label: z.string().min(1).max(80), publicKey: z.string().min(1).max(16384) });
export const SshKeyAddResponse = z.object({ confirmed: z.literal(true), key: SshKeyRecord });
export const SshKeyRemoveRequest = z.object({ id: z.string() });
export const SshKeyRemoveResponse = z.object({ confirmed: z.literal(true), id: z.string() });
