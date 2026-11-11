import type { BuildInfo, EnvironmentInfo, Profile } from './types.js';

export const TLSF_REVISION = 'deff9ab509341f264addbd3c8ada533678591905';
export const MAGIC_ENUM_VERSION = '0.9.7';
export const GENERATOR_VERSION = 'ledip-fuzz-v1';

export function buildInfo(profile: Profile): BuildInfo {
  const optimized = profile === 'release' || profile === 'size';
  return {
    profile,
    sourceRevision: globalThis.__LEDIP_SOURCE_REVISION__ ?? 'unknown',
    emscripten: globalThis.__LEDIP_EMSCRIPTEN__ ?? 'unknown',
    tlsf: TLSF_REVISION,
    magicEnum: MAGIC_ENUM_VERSION,
    optimization: profile === 'size' ? '-Oz -flto' : optimized ? '-O3 -flto' : '-O1',
    exceptions: true,
    exceptionStrategy: 'native-wasm',
    lto: optimized,
    tracing: profile === 'debug' || profile === 'memory-check',
  };
}

export function environmentInfo(): EnvironmentInfo {
  const runtime = globalThis as typeof globalThis & {
    process?: { version: string; platform: string; arch: string; versions?: { node?: string } };
  };
  if (runtime.process?.versions?.node) {
    return {
      host: 'node',
      runtime: `Node.js ${runtime.process.version}`,
      platform: runtime.process.platform,
      arch: runtime.process.arch,
    };
  }
  return {
    host: 'browser',
    runtime: globalThis.navigator?.userAgent ?? 'browser',
    platform: globalThis.navigator?.platform ?? 'unknown',
    arch: 'unavailable',
  };
}

declare global {
  var __LEDIP_SOURCE_REVISION__: string | undefined;
  var __LEDIP_EMSCRIPTEN__: string | undefined;
  var __LEDIP_WASM_PATH__: string | undefined;
}
