import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.indexOf('--profile');
const requested = argument >= 0 ? process.argv[argument + 1] : 'debug';
const profiles = requested === 'all' ? ['debug', 'memory-check', 'release', 'size'] : [requested];
const sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(root, '..'), encoding: 'utf8' });
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: resolve(root, '..'), encoding: 'utf8' });
const revision = sourceRevision.status === 0
  ? `${sourceRevision.stdout.trim()}${dirty.stdout.trim() ? '-dirty' : ''}`
  : 'unknown';
const emscripten = spawnSync('emcc', ['--version'], { encoding: 'utf8', env: process.env });
const version = emscripten.status === 0 ? emscripten.stdout.split('\n')[0].replace(/^emcc \(.*?\)\s*/, '') : 'unknown';

for (const profile of profiles) {
  if (!['debug', 'memory-check', 'release', 'size'].includes(profile)) throw new Error(`unknown profile: ${profile}`);
  const build = resolve(root, 'wasm/.cmake', profile);
  mkdirSync(build, { recursive: true });
  for (const [command, args] of [
    ['emcmake', ['cmake', '-S', resolve(root, 'wasm'), '-B', build, '-G', 'Ninja', `-DPROFILE=${profile}`]],
    ['cmake', ['--build', build]],
  ]) {
    const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const output = resolve(root, 'wasm/build', profile);
  const metadata = { sourceRevision: revision, emscripten: version, profile };
  writeFileSync(resolve(output, 'build.json'), JSON.stringify(metadata, null, 2));
  const publicDirectories = profile === 'debug'
    ? [resolve(root, 'dist/wasm'), resolve(root, 'web/public/wasm')]
    : profile === 'release'
      ? [resolve(root, 'web/public/wasm/release')]
      : [];
  for (const directory of publicDirectories) {
    mkdirSync(directory, { recursive: true });
    for (const file of ['ledip_tester.js', 'ledip_tester.wasm', 'build.json']) {
      copyFileSync(resolve(output, file), resolve(directory, file));
    }
  }
}

const packageFile = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
writeFileSync(resolve(root, 'wasm/build/toolchain.json'), JSON.stringify({ node: process.version, npm: packageFile.packageManager, emscripten: version }, null, 2));
