/**
 * Links from the public site into the Capacity Terminal. The legacy site produced
 * `https://terminal…/?role=…&listing=…&intent=…#terminal/<route>`; the terminal now uses real
 * paths, so the same parameters travel on `/<route>?…`.
 */

export type PublicTarget = 'gpus' | 'models' | 'supply' | 'rfq' | string;
export type PublicRole = 'buyer' | 'seller';
export type ListingIntent = 'buy' | 'offer';

export const ROLE_INTENT_KEY = 'opennext-auth-role-intent-v1:account';

export const allowedRole = (value: unknown): PublicRole | '' =>
  typeof value === 'string' && ['buyer', 'seller'].includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as PublicRole)
    : '';

/** `openPublicWorkspace` target → terminal route. */
export function targetRoute(target: PublicTarget | undefined): string {
  return target === 'models' ? 'models' : target === 'supply' ? 'supply' : target === 'rfq' ? 'rfqs' : 'market';
}

/** Implicit onboarding hint for a target when the CTA carries no explicit role. */
export function implicitRole(target: PublicTarget | undefined): PublicRole | '' {
  return target === 'supply' ? 'seller' : target === 'rfq' ? 'buyer' : '';
}

export interface WorkspaceLinkOptions {
  route: string;
  role: PublicRole | '';
  listing?: { id: string; intent: ListingIntent };
  opportunity?: { id: string; intent: ListingIntent };
}

/** Path + query inside the terminal application (prefix with the terminal origin/base). */
export function workspacePath({ route, role, listing, opportunity }: WorkspaceLinkOptions): string {
  const params = new URLSearchParams({ role: role || 'buyer' });
  if (listing) {
    params.set('listing', listing.id);
    params.set('intent', listing.intent);
  }
  if (opportunity) {
    params.set('opportunity', opportunity.id);
    params.set('intent', opportunity.intent);
  }
  return `/${route}?${params}`;
}

/** Deep link into the isolated demo workspace for a showcase listing. */
export function demoOpportunityPath(id: string, intent: ListingIntent): string {
  const params = new URLSearchParams({ role: intent === 'buy' ? 'buyer' : 'seller', opportunity: id, intent });
  return `/demo/market?${params}`;
}

export interface RoleIntent {
  role: PublicRole;
  queryRole: PublicRole | '';
  ownerId: string | null;
  updatedAt: number;
}

/** Session-scoped onboarding preference shared with the terminal (never an account role change). */
export function readRoleIntent(storage: Pick<Storage, 'getItem'> | undefined, now = Date.now()): RoleIntent | null {
  try {
    const saved = JSON.parse(storage?.getItem(ROLE_INTENT_KEY) || 'null') as Partial<RoleIntent> | null;
    if (
      saved &&
      allowedRole(saved.role) &&
      Number.isFinite(saved.updatedAt) &&
      now - (saved.updatedAt as number) < 86_400_000 &&
      (saved.updatedAt as number) <= now + 60_000
    )
      return {
        role: allowedRole(saved.role) as PublicRole,
        queryRole: allowedRole(saved.queryRole),
        ownerId: typeof saved.ownerId === 'string' ? saved.ownerId : null,
        updatedAt: saved.updatedAt as number,
      };
  } catch {
    /* unreadable storage */
  }
  return null;
}

export function writeRoleIntent(storage: Pick<Storage, 'setItem'> | undefined, role: PublicRole, queryRole: PublicRole | '' = '') {
  try {
    storage?.setItem(ROLE_INTENT_KEY, JSON.stringify({ role, queryRole, ownerId: null, updatedAt: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}
