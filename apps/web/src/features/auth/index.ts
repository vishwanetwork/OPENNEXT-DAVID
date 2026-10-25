export { authApi } from './api';
export { useSessionBoot, useRefreshSession, useLogout, useSwitchRole, useRoleIntent } from './hooks';
export { allowedRole, roleIntentKey, RoleIntentStore, type Role, type RoleIntent } from './role-intent';
export { AuthView, fieldError, type AuthMode } from './components/AuthView';
export { OnboardingView } from './components/OnboardingView';
export { AuthShell } from './components/AuthShell';
