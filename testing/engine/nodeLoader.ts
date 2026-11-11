import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import type { Profile, WasmExports } from '../protocol/types.js';

export interface NodePackage {
  root: string;
  wasmDirectory: string;
}

export async function nodePackage(): Promise<NodePackage> {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifest = resolve(directory, 'package.json');
    if (existsSync(manifest)) {
      const content = JSON.parse(await readFile(manifest, 'utf8')) as { name?: string };
      if (content.name === 'ledip_tester') {
        return { root: directory, wasmDirectory: resolve(directory, 'wasm/build') };
      }
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('cannot locate ledip_tester package root');
    directory = parent;
  }
}

export async function createNodeWasm(profile: Profile = 'debug'): Promise<WasmExports> {
  const { wasmDirectory } = await nodePackage();
  const directory = resolve(wasmDirectory, profile);
  globalThis.__LEDIP_WASM_PATH__ = resolve(directory, 'ledip_tester.wasm');
  const [binary, metadataText] = await Promise.all([
    readFile(resolve(directory, 'ledip_tester.wasm')),
    readFile(resolve(directory, 'build.json'), 'utf8'),
  ]);
  const metadata = JSON.parse(metadataText) as { sourceRevision: string; emscripten: string };
  globalThis.__LEDIP_SOURCE_REVISION__ = metadata.sourceRevision;
  globalThis.__LEDIP_EMSCRIPTEN__ = metadata.emscripten;
  const moduleUrl = pathToFileURL(resolve(directory, 'ledip_tester.js')).href;
  const { default: createModule } = await import(moduleUrl) as {
    default: (options: { wasmBinary: Uint8Array }) => Promise<WasmExports>;
  };
  return createModule({ wasmBinary: binary });
}
