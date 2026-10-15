import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, readdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
const app = resolve('src-tauri/target/release/bundle/macos/ledad.app');
// 同じ証明書を使い、再ビルド後も録音権限の照合条件を保ちます。
const identity = process.env.APPLE_SIGNING_IDENTITY || 'Apple Development';
async function signRuntime(directory) {
  // Sign nested Python extensions before the executable and enclosing app.
  // Symlinks are preserved and skipped; their real files are visited once.
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await signRuntime(path);
    else if (entry.isFile()) {
      const file = await open(path, 'r');
      const magic = Buffer.alloc(4);
      try {
        await file.read(magic, 0, 4, 0);
      } finally {
        await file.close();
      }
      if (
        [
          'cffaedfe',
          'cefaedfe',
          'feedfacf',
          'feedface',
          'cafebabe',
          'bebafeca',
          'cafebabf',
        ].includes(magic.toString('hex'))
      )
        execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, path], {
          stdio: 'inherit',
        });
    }
  }
  if (directory.endsWith('.framework'))
    execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, directory], {
      stdio: 'inherit',
    });
}
await signRuntime(`${app}/Contents/Resources/resources/service`);
const audio = `${app}/Contents/Resources/resources/ledad-audio`;
execFileSync(
  '/usr/bin/codesign',
  ['--force', '--sign', identity, '--identifier', 'jp.ledad.desktop.audio', audio],
  { stdio: 'inherit' },
);
execFileSync(
  '/usr/bin/codesign',
  ['--force', '--sign', identity, '--entitlements', 'src-tauri/Entitlements.plist', app],
  { stdio: 'inherit' },
);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
  stdio: 'inherit',
});
for (const path of [app, audio]) {
  const requirement = execFileSync('/usr/bin/codesign', ['-d', '-r-', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert(!/\bcdhash\b/.test(requirement), `ビルドごとに変わる署名は使用できません: ${path}`);
}
// コピーと署名検証が成功してから、起動用のアプリを差し替えます。
const outputDir = resolve('build');
const outputApp = resolve(outputDir, 'ledad.app');
await mkdir(outputDir, { recursive: true });
const stagingDir = await mkdtemp(`${outputDir}/.ledad-`);
try {
  const stagedApp = resolve(stagingDir, 'ledad.app');
  execFileSync('/usr/bin/ditto', [app, stagedApp], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp], {
    stdio: 'inherit',
  });
  await rm(outputApp, { recursive: true, force: true });
  await rename(stagedApp, outputApp);
} finally {
  await rm(stagingDir, { recursive: true, force: true });
}
console.log(`Macアプリ: ${outputApp}`);
