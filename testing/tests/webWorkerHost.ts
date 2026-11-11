import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { nodePackage } from '../engine/nodeLoader.js';

const { root } = await nodePackage();
const port = parentPort!;
const selfTarget = {
  onmessage: undefined as ((event: MessageEvent) => void) | undefined,
  postMessage: (value: unknown) => port.postMessage(value),
};
Object.assign(globalThis, { self: selfTarget });

globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
  const value = String(input);
  const path = value.startsWith('file:')
    ? fileURLToPath(value)
    : value === '/wasm/ledip_tester.wasm' || value === '/wasm/build.json' || value === '/wasm/ledip_tester.js'
      ? `${root}/wasm/build/debug${value.slice('/wasm'.length)}`
      : `${root}/wasm/build${value.slice('/wasm'.length)}`;
  const contents = await readFile(path);
  return {
    ok: true,
    arrayBuffer: async () => contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength),
    json: async () => JSON.parse(contents.toString('utf8')),
  } as Response;
};

await import('../engine/webWorker.js');
port.on('message', (data) => {
  selfTarget.onmessage?.({ data } as MessageEvent);
});
