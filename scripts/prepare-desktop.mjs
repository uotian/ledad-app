import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const resources = resolve('src-tauri/resources');
await mkdir(resources, { recursive: true });
execFileSync(
  process.execPath,
  [
    'scripts/python.mjs',
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--distpath',
    'backend/dist',
    '--workpath',
    'backend/build',
    'backend/ledad-service.spec',
  ],
  { stdio: 'inherit' },
);
// Only replace the previous bundle after Python packaging succeeds.
await rm(`${resources}/service`, { recursive: true, force: true });
await cp('backend/dist/ledad-service', `${resources}/service`, {
  recursive: true,
  verbatimSymlinks: true,
});
await rm(`${resources}/node`, { force: true });
const tauriConfig = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
execFileSync(
  '/usr/bin/swiftc',
  [
    'native/AudioCapture.swift',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos${tauriConfig.bundle.macOS.minimumSystemVersion}`,
    '-o',
    `${resources}/ledad-audio`,
    '-O',
    '-framework',
    'AVFoundation',
    '-framework',
    'ScreenCaptureKit',
    '-framework',
    'CoreMedia',
    '-Xlinker',
    '-sectcreate',
    '-Xlinker',
    '__TEXT',
    '-Xlinker',
    '__info_plist',
    '-Xlinker',
    'src-tauri/Info.plist',
  ],
  { stdio: 'inherit' },
);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  `${resources}/versions.json`,
  JSON.stringify({ runtime: 'python', version: packageJson.version }, null, 2),
);
console.log('Macアプリ用サービスと音声モジュールを準備しました。');
