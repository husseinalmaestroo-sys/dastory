import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// Next.js 16's eslint-config-next ships flat config natively — spread it
// directly rather than through FlatCompat's .eslintrc-shaped compat layer
// (the previous setup here). Combining the two caused a genuine crash on
// upgrade: "Converting circular structure to JSON" from @eslint/eslintrc
// trying to re-normalize a config that was already flat.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react/no-unescaped-entities': 'off',
      // react-hooks/set-state-in-effect, static-components and purity were
      // briefly downgraded to 'warn' right after the Next 16 upgrade (the
      // newer eslint-plugin-react-hooks surfaced ~18 pre-existing files) and
      // have since been fixed — they stay at eslint-config-next's default
      // 'error' now, no override needed.
    },
  },
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // ailegal_hussein is its own separate git repository living inside this
    // folder (see .gitignore) — never part of this app's own lint pass.
    'ailegal_hussein/**',
  ]),
])

export default eslintConfig
