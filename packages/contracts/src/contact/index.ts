import { z } from 'zod';

/* ---------- POST /api/contact ---------- */

export const ContactRequest = z.object({
  name: z.string().max(100),
  company: z.string().max(160),
  title: z.string().max(100),
  email: z.string().max(254),
  message: z.string().max(4000),
  /** Honeypot; must be empty. */
  website: z.string().optional(),
  /** Client-generated idempotency key so a timed-out retry never creates a duplicate. */
  submissionId: z.string(),
});
export type ContactRequest = z.infer<typeof ContactRequest>;

export const ContactResponse = z.object({ id: z.string() }).passthrough();
export type ContactResponse = z.infer<typeof ContactResponse>;
