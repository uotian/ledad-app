import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, resolve } from 'node:path';

assert.equal(process.platform, 'darwin', 'DMGの作成にはmacOSが必要です。');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const app = resolve('build/ledad.app');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const appVersion = (path) =>
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', `${path}/Contents/Info.plist`],
    { encoding: 'utf8' },
  ).trim();
assert.equal(appVersion(app), version, '最新バージョンのアプリを先にビルドしてください。');
assert.equal(
  execFileSync('/usr/bin/lipo', ['-archs', `${app}/Contents/MacOS/ledad`], {
    encoding: 'utf8',
  }).trim(),
  'arm64',
  '配布対象はApple Siliconです。',
);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);

const output = resolve(`build/ledad_${version}_aarch64.dmg`);
const work = await mkdtemp(resolve('build/.dmg-'));
const staging = resolve(work, 'contents');
const image = resolve(work, 'ledad.dmg');
const mount = resolve(work, 'mounted');
let mounted = false;
try {
  await mkdir(staging);
  await mkdir(mount);
  run('/usr/bin/ditto', [app, resolve(staging, 'ledad.app')]);
  await symlink('/Applications', resolve(staging, 'Applications'));
  run('/usr/bin/hdiutil', [
    'create',
    '-volname',
    'ledad',
    '-srcfolder',
    staging,
    '-format',
    'UDZO',
    image,
  ]);
  run('/usr/bin/hdiutil', ['verify', image]);
  run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image]);
  mounted = true;
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', resolve(mount, 'ledad.app')]);
  assert.equal(appVersion(resolve(mount, 'ledad.app')), version);
  assert.equal(await readlink(resolve(mount, 'Applications')), '/Applications');
  run('/usr/sbin/diskutil', ['eject', mount]);
  mounted = false;
  await rename(image, output);
  const checksum = execFileSync('/usr/bin/shasum', ['-a', '256', basename(output)], {
    cwd: resolve('build'),
    encoding: 'utf8',
  });
  await writeFile(`${output}.sha256`, checksum);
  console.log(`DMG: ${output}\nSHA-256: ${output}.sha256`);
} finally {
  if (mounted) run('/usr/sbin/diskutil', ['eject', mount]);
  await rm(work, { recursive: true, force: true });
}
