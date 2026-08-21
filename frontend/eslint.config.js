import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      react,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Found live 2026-08-20: core no-undef doesn't check JSX identifiers, so
      // a JSX component used without an import silently compiles and only
      // crashes at runtime (ReferenceError, whole page blank) -- broke Plan
      // Feed's Edit FO tab in prod. This is the narrow rule that actually
      // catches it (not the full react/recommended set, to avoid pulling in
      // unrelated new lint noise across the whole app in one pass).
      'react/jsx-no-undef': 'error',
    },
  },
])
