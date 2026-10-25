import { z } from 'zod';
import { lenientArray } from '../_shared';
import { SessionUser } from '../auth';
import { MarketplaceListing } from '../marketplace';

/** `POST /api/demo/start`, `POST /api/demo/auth/role` — isolated guest workspace session. */
export const DemoSessionResponse = z.object({ user: SessionUser }).passthrough();
export type DemoSessionResponse = z.infer<typeof DemoSessionResponse>;
export const DemoStartRequest = z.object({ role: z.enum(['buyer', 'seller']) });

/* ---------- GET /api/demo/showcase (public, isolated demo feed) ---------- */

export const ShowcaseResponse = z.object({
  demo: z.boolean().optional(),
  featured: z
    .object({ rfqs: lenientArray(MarketplaceListing), supplies: lenientArray(MarketplaceListing) })
    .optional(),
  updatedAt: z.string().optional(),
});
export type ShowcaseResponse = z.infer<typeof ShowcaseResponse>;

