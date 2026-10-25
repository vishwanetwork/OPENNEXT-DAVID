export { authApi } from './api';
export {
  useSessionBoot,
  useRefreshSession,
  useLogout,
  useSwitchRole,
  useRoleIntent,
} from './hooks';
export {
  allowedRole,
  roleIntentKey,
  RoleIntentStore,
  type Role,
  type RoleIntent,
} from './role-intent';
export { AuthView, fieldError, type AuthMode } from './components/auth-view';
export { OnboardingView } from './components/onboarding-view';
export { AuthShell } from './components/auth-shell';
