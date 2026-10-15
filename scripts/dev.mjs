import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ブラウザ確認は画面とローカルAPIを一緒に起動・終了します。
const commands = [
  [
    'next/dist/bin/next',
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    process.env.LEDAD_UI_PORT || '3000',
  ],
  [
    './scripts/python.mjs',
    '-m',
    'watchfiles',
    '--target-type',
    'command',
    'python -m ledad --http',
    'backend/ledad',
  ],
];
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const [module, ...args] of commands) {
  const child = spawn(
    process.execPath,
    [module.startsWith('./') ? module : fileURLToPath(import.meta.resolve(module)), ...args],
    {
      stdio: 'inherit',
      env: { ...process.env, LEDAD_SERVICE_PORT: '4319' },
    },
  );
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
