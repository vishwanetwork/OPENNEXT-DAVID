/**
 * Account feature: profile page and the SSH public-key library (legacy
 * OpenNEXT-account-profile-preview.js). `validatePublicKey` / `fingerprint` are shared with
 * the Spot checkout and the instances feature.
 */
export { ProfilePage } from './components/ProfilePage';
export { SshKeyLibrary, SshKeyList, type SshLibraryScope } from './components/SshKeyLibrary';
export { accountModals } from './components/modals';
export { useAccountRef, useKeyLibrary, useAccountService } from './hooks';
export {
  validatePublicKey,
  fingerprint,
  keyLabel,
  normalizeKey,
  accountRef,
  profileIdentity,
  verificationFor,
  initialsOf,
  readDemoKeys,
  saveDemoKeys,
  MAX_KEYS,
  UNCONFIGURED,
  type ParsedPublicKey,
  type SshKeyRecord,
  type AccountRef,
} from './ssh-keys';
export {
  loadKeys,
  changeKey,
  useKeyLibraries,
  libraryFor,
  type KeyLibraryDeps,
  type KeyLibraryState,
} from './store';
