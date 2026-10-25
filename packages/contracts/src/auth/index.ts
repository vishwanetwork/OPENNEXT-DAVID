import { z } from 'zod';

/** Verified account as returned by `GET /api/auth/session` (`{ user }`). */
export const SessionUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullish(),
  company: z.string().nullish(),
  role: z.enum(['buyer', 'seller']).or(z.string()),
  onboardingCompleted: z.boolean(),
  promotionalCredit: z.number().default(0),
  promotionalCreditGranted: z.number().default(0),
  promotionalCreditWithdrawable: z.boolean().default(false),
  fundedCredit: z.number().optional(),
  welcomeCreditGrantedAt: z.string().nullish(),
  /** Session-scoped token echoed back in `X-CSRF-Token` on every write. */
  csrfToken: z.string().optional(),
  /** True for isolated demo workspace users. */
  demo: z.boolean().optional(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const SessionResponse = z.object({ user: SessionUser.nullable() });
export type SessionResponse = z.infer<typeof SessionResponse>;

export const AuthConfig = z.object({
  providers: z.record(z.boolean()).default({}),
  emailEnabled: z.boolean().optional(),
});
export type AuthConfig = z.infer<typeof AuthConfig>;

export const EmailRequestResponse = z.object({ challengeId: z.string() });
export const EmailVerifyRequest = z.object({ challengeId: z.string(), code: z.string() });
export const OnboardingRequest = z.object({ role: z.enum(['buyer', 'seller']) });
export const RoleRequest = z.object({ role: z.enum(['buyer', 'seller']) });
