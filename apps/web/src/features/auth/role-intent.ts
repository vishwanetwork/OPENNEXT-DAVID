/**
 * Onboarding role preference (Buyer/Seller) carried from a public CTA (`?role=`) into
 * onboarding. It is a preference only, never authorization or an account role change.
 * Ported from legacy OpenNEXT-auth.js.
 */

export type Role = 'buyer' | 'seller';

export interface RoleIntent {
  role: Role;
  queryRole: Role | '';
  ownerId: string | null;
  updatedAt: number;
}

export const allowedRole = (value: unknown): Role | '' =>
  typeof value === 'string' && ['buyer', 'seller'].includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as Role)
    : '';

export const roleIntentKey = (pathname: string): string =>
  'opennext-auth-role-intent-v1:' +
  (/^\/(?:terminal\/)?demo(?:\/|$)/.test(pathname || '') ? 'demo' : 'account');

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class RoleIntentStore {
  private intent: RoleIntent | null = null;
  constructor(
    private readonly key: string,
    private readonly queryRole: Role | '',
    private readonly storage: StorageLike | null,
    private readonly now: () => number = Date.now,
  ) {
    this.initialize();
  }
  private save() {
    try {
      if (this.intent) this.storage?.setItem(this.key, JSON.stringify(this.intent));
      else this.storage?.removeItem(this.key);
    } catch {
      /* storage unavailable */
    }
  }
  private initialize() {
    try {
      const saved = JSON.parse(
        this.storage?.getItem(this.key) || 'null',
      ) as Partial<RoleIntent> | null;
      if (
        saved &&
        allowedRole(saved.role) &&
        Number.isFinite(saved.updatedAt) &&
        this.now() - (saved.updatedAt as number) < 86400000 &&
        (saved.updatedAt as number) <= this.now() + 60000
      )
        this.intent = {
          role: allowedRole(saved.role) as Role,
          queryRole: allowedRole(saved.queryRole),
          ownerId: typeof saved.ownerId === 'string' ? saved.ownerId : null,
          updatedAt: saved.updatedAt as number,
        };
    } catch {
      /* ignore */
    }
    // A changed URL hint is a new CTA. The same URL must not undo a user's later selection on reload.
    if (this.queryRole && (!this.intent || this.intent.queryRole !== this.queryRole))
      this.intent = {
        role: this.queryRole,
        queryRole: this.queryRole,
        ownerId: null,
        updatedAt: this.now(),
      };
    this.save();
  }
  get(): RoleIntent | null {
    return this.intent;
  }
  clear() {
    this.intent = null;
    this.save();
  }
  /** Returns false when the role is invalid or the account already completed onboarding. */
  set(value: unknown, user: { id: string; onboardingCompleted: boolean } | null): boolean {
    const role = allowedRole(value);
    if (!role) return false;
    if (user?.onboardingCompleted) {
      this.clear();
      return false;
    }
    this.intent = {
      role,
      queryRole: this.queryRole,
      ownerId: user?.id || null,
      updatedAt: this.now(),
    };
    this.save();
    return true;
  }
  /** Called whenever the verified user changes: completed accounts drop the hint, other owners' hints are discarded. */
  bind(user: { id: string; onboardingCompleted: boolean } | null) {
    if (user?.onboardingCompleted) this.clear();
    else if (user && this.intent) {
      if (this.intent.ownerId && this.intent.ownerId !== user.id) this.clear();
      else {
        this.intent.ownerId = user.id;
        this.save();
      }
    }
  }
  preferred(user: { onboardingCompleted: boolean } | null): Role | '' {
    return user?.onboardingCompleted ? '' : allowedRole(this.intent?.role);
  }
}
