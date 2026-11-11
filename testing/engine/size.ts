export interface WasmSection {
  id: number;
  name: string;
  payloadBytes: number;
  totalBytes: number;
}

export function parseWasmSections(bytes: Uint8Array): WasmSection[] {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 97 || bytes[2] !== 115 || bytes[3] !== 109) {
    throw new Error('not a WASM binary');
  }
  let offset = 8;
  const readVarUint = (): number => {
    let value = 0;
    let shift = 0;
    while (true) {
      const byte = bytes[offset++];
      if (byte === undefined || shift > 28) throw new Error('invalid WASM section length');
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
  };
  const sections: WasmSection[] = [];
  while (offset < bytes.length) {
    const start = offset;
    const id = bytes[offset++]!;
    const payloadBytes = readVarUint();
    const payloadStart = offset;
    let name = `section-${id}`;
    if (id === 0) {
      const nameLength = readVarUint();
      name = new TextDecoder().decode(bytes.slice(offset, offset + nameLength));
    }
    sections.push({ id, name, payloadBytes, totalBytes: payloadBytes + payloadStart - start });
    offset = payloadStart + payloadBytes;
  }
  return sections;
}

export function sectionSize(sections: WasmSection[], id: number, name: string): number {
  return sections.filter((section) => section.id === id || section.name === name).reduce((total, section) => total + section.totalBytes, 0);
}
