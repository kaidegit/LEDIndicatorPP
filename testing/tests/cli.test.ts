import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodePackage } from '../engine/nodeLoader.js';

async function cli(args: string[], input?: string) {
  const { root } = await nodePackage();
  const child = spawn(process.execPath, [resolve(root, 'dist/cli/index.js'), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  if (input !== undefined) child.stdin.write(input);
  child.stdin.end();
  const code = await new Promise<number>((resolve) => child.once('close', resolve));
  return { code, stdout, stderr };
}

describe('CLI protocol', () => {
  it('keeps JSON stdout clean and supports stdin', async () => {
    const { root } = await nodePackage();
    const input = await readFile(resolve(root, 'scenarios/regression/basic-gpio.json'), 'utf8');
    const result = await cli(['run', '--scenario', '-', '--format', 'json'], input);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('pass');
  });

  it('writes a human-readable Chinese Markdown report', async () => {
    const { root } = await nodePackage();
    const result = await cli([
      'run',
      '--scenario', resolve(root, 'scenarios/regression/basic-gpio.json'),
      '--format', 'md',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('# LEDIndicatorPP 中文测试报告');
    expect(result.stdout).toContain('用例：basic-gpio');
    expect(result.stdout).toContain('销毁后');
  });

  it('uses exit code 2 and field paths for invalid input', async () => {
    const result = await cli(['run', '--scenario', '-'], '{"id":"bad"}');
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('/memory');
  });
});
