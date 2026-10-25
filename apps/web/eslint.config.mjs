import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import boundaries from 'eslint-plugin-boundaries';

/**
 * Module boundaries (see docs/ARCHITECTURE.md):
 *   lib → data → market → terminal-kit → features → app
 *
 * - a feature may import other features only through their barrel (`@/features/<x>`),
 *   never the terminal shell (`@/features/terminal`), and never `@/app` or `@/proxy`;
 * - terminal-kit imports lib, data, components and the market domain only;
 * - the composition root under src/app may import anything.
 */
const FEATURE_RULES = {
  'boundaries/element-types': [
    'error',
    {
      default: 'disallow',
      rules: [
        { from: ['app'], allow: ['app', 'features', 'terminal-kit', 'components', 'lib', 'data', 'styles', 'proxy'] },
        { from: ['proxy'], allow: ['lib'] },
        { from: ['terminal-kit'], allow: ['terminal-kit', 'lib', 'data', 'components', 'market'] },
        { from: ['market'], allow: ['market', 'lib', 'data', 'components'] },
        { from: ['features'], allow: ['features', 'market', 'terminal-kit', 'lib', 'data', 'components'] },
        { from: ['components'], allow: ['components', 'lib'] },
        { from: ['lib'], allow: ['lib'] },
        { from: ['data'], allow: ['data'] },
        { from: ['test'], allow: ['test', 'app', 'features', 'market', 'terminal-kit', 'components', 'lib', 'data'] },
      ],
    },
  ],
  'boundaries/entry-point': [
    'error',
    {
      default: 'disallow',
      rules: [
        // Features and the market domain are consumed through their barrel only.
        // `server.ts` is the server-only entry (never re-exported by the client barrel).
        { target: ['features', 'market'], allow: ['index.ts', 'server.ts'] },
        // The modal map is augmented by path; everything else goes through the barrel.
        { target: ['terminal-kit'], allow: ['index.ts', 'modal.tsx'] },
        { target: ['app', 'components', 'lib', 'data', 'styles', 'proxy', 'test'], allow: '**' },
      ],
    },
  ],
  'boundaries/no-unknown-files': 'off',
  'boundaries/no-unknown': 'off',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts', 'coverage/**']),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      // Folder elements: imports inside one folder are internal; imports across folders must
      // use the folder's entry point (its barrel).
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app', mode: 'folder' },
        { type: 'proxy', pattern: 'src/proxy.ts', mode: 'file' },
        { type: 'terminal-kit', pattern: 'src/terminal-kit', mode: 'folder' },
        { type: 'market', pattern: 'src/features/market', mode: 'folder' },
        { type: 'features', pattern: 'src/features/*', mode: 'folder', capture: ['feature'] },
        { type: 'components', pattern: 'src/components', mode: 'folder' },
        { type: 'lib', pattern: 'src/lib', mode: 'folder' },
        { type: 'data', pattern: 'src/data', mode: 'folder' },
        { type: 'styles', pattern: 'src/styles', mode: 'folder' },
        { type: 'test', pattern: 'src/test', mode: 'folder' },
      ],
    },
    rules: {
      ...FEATURE_RULES,
      // The terminal shell is composed by src/app, never imported by a feature.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/terminal', '@/features/terminal/*'],
              message: 'Only the composition root (src/app/terminal) may import the terminal shell; features use @/terminal-kit.',
            },
            { group: ['@/proxy'], message: 'Import APP_HEADERS from @/lib/apps instead.' },
          ],
        },
      ],
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*'],
    rules: { 'boundaries/entry-point': 'off', 'boundaries/element-types': 'off', 'max-lines': 'off' },
  },
]);
