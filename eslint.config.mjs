import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    'src-tauri/**',
    '**/.venv/**',
    'out/**',
    'build/**',
    '.next/**',
    'artifacts/**',
    'output/**',
    'public/pdf.worker.min.mjs',
  ]),
]);
