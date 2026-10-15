import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// uv.lock pins the development and packaged Python environments alike.
const uv = process.env.LEDAD_UV || (existsSync('.tools/bin/uv') ? resolve('.tools/bin/uv') : 'uv');
const child = spawn(
  uv,
  [
    'run',
    '--project',
    'backend',
    '--frozen',
    '--python',
    '3.13',
    'python',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: process.env,
  },
);
child.on('error', (error) => {
  console.error(`Python環境を起動できません。uvをインストールしてください: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
