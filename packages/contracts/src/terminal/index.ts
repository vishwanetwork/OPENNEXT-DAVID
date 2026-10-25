import { z } from 'zod';
import { SessionUser } from '../auth';

/** `POST /api/demo/start`, `POST /api/demo/auth/role` — isolated guest workspace session. */
export const DemoSessionResponse = z.object({ user: SessionUser }).passthrough();
export type DemoSessionResponse = z.infer<typeof DemoSessionResponse>;
export const DemoStartRequest = z.object({ role: z.enum(['buyer', 'seller']) });
