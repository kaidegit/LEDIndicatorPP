#!/usr/bin/env node
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { createServer } from 'vite';
import { InputError, parseScenario } from '../protocol/validate.js';
import type { Profile, Scenario } from '../protocol/types.js';
import { runIsolated, runWorker } from '../engine/isolated.js';
import { nodePackage } from '../engine/nodeLoader.js';
import { generateScenario, GENERATOR_VERSION, shrinkScenario } from '../engine/fuzz.js';
import { parseWasmSections, sectionSize } from '../engine/size.js';
import { markdownReport } from '../engine/markdownReport.js';
import { exitCode, printResult, saveReproduction } from './report.js';

function profile(value: string): Profile {
  if (!['debug', 'memory-check', 'release', 'size'].includes(value)) throw new InvalidArgumentError('expected debug, memory-check, release or size');
  return value as Profile;
}

function outputFormat(value: string): 'json' | 'text' | 'md' {
  if (value === 'markdown') return 'md';
  if (!['json', 'text', 'md'].includes(value)) throw new InvalidArgumentError('expected json, text or md');
  return value as 'json' | 'text' | 'md';
}

function bytes(value: string): number {
  const match = /^(\d+)(KiB|MiB|B)?$/.exec(value);
  if (!match) throw new InvalidArgumentError('expected bytes, KiB or MiB, for example 32KiB');
  const multiplier = match[2] === 'MiB' ? 1024 * 1024 : match[2] === 'KiB' ? 1024 : 1;
  return Number(match[1]) * multiplier;
}

async function readStandardInput(): Promise<string> {
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function scenarioFile(path: string): Promise<Scenario> {
  return parseScenario(path === '-' ? await readStandardInput() : await readFile(path, 'utf8'));
}

const program = new Command();
program
  .name('ledip_tester')
  .description('Run real LEDIndicatorPP C++ in WASM with deterministic virtual time')
  .version('1.0.0')
  .exitOverride();

program.command('run')
  .requiredOption('--scenario <path>', 'scenario JSON file, or - for stdin')
  .option('--format <format>', 'json, text or md', outputFormat, 'json')
  .option('--profile <profile>', 'WASM build profile', profile, 'debug')
  .option('--repro-dir <directory>', 'save a reproduction package on failure')
  .action(async (options) => {
    const scenario = await scenarioFile(options.scenario);
    const result = await runIsolated(scenario, options.profile);
    if (options.reproDir && result.status !== 'pass') {
      result.artifacts.reproduction = await saveReproduction(result, scenario, options.reproDir);
    }
    printResult(result, options.format);
    process.exitCode = exitCode(result);
  });

program.command('suite')
  .option('--name <name>', 'regression, boundary, memory, stress or all', 'regression')
  .option('--profile <profile>', 'WASM build profile', profile, 'debug')
  .option('--format <format>', 'json, text or md', outputFormat, 'json')
  .option('--repro-dir <directory>', 'save failure reproduction packages')
  .action(async (options) => {
    const { root } = await nodePackage();
    const names = options.name === 'all' ? ['regression', 'boundary', 'memory', 'stress'] : [options.name];
    const results = [];
    for (const name of names) {
      const directory = resolve(root, 'scenarios', name);
      const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
      for (const file of files) {
        const scenario = parseScenario(await readFile(resolve(directory, file), 'utf8'));
        const result = await runIsolated(scenario, options.profile);
        if (options.reproDir && result.status !== 'pass') {
          result.artifacts.reproduction = await saveReproduction(result, scenario, options.reproDir);
        }
        results.push(result);
        if (options.format === 'text') printResult(result, 'text');
      }
    }
    const output = {
      protocolVersion: 1,
      id: `suite-${options.name}`,
      status: results.every((result) => result.status === 'pass' || result.status === 'unsupported') ? 'pass' : 'fail',
      results,
      metrics: { cases: results.length, passed: results.filter((result) => result.status === 'pass').length },
    };
    if (options.format !== 'text') printResult(output, options.format);
    process.exitCode = output.status === 'pass' ? 0 : 1;
  });

program.command('fuzz')
  .requiredOption('--seed <number>', 'unsigned 32-bit seed', Number)
  .option('--iterations <number>', 'number of scenarios', Number, 100)
  .option('--heap-size <bytes>', 'fixed pool capacity', bytes, 32 * 1024)
  .option('--output <path>', 'failure and shrink report', 'artifacts/fuzz-report.json')
  .option('--format <format>', 'json, text or md', outputFormat, 'json')
  .action(async (options) => {
    let failure;
    let original: Scenario | undefined;
    for (let serial = 0; serial < options.iterations; serial += 1) {
      const scenario = generateScenario(options.seed, options.heapSize, serial);
      const result = await runIsolated(scenario);
      if (result.status !== 'pass') {
        failure = result;
        original = scenario;
        break;
      }
    }
    if (!failure || !original) {
      printResult({ protocolVersion: 1, status: 'pass', seed: options.seed, iterations: options.iterations, generatorVersion: GENERATOR_VERSION }, options.format);
      return;
    }
    const isFailure = async (candidate: Scenario) => (await runIsolated(candidate)).status !== 'pass';
    const shrunk = await shrinkScenario(original, isFailure);
    const confirmed = await runIsolated(shrunk);
    const { root } = await nodePackage();
    const outputPath = resolve(root, options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify({ original, failure, shrunk, confirmed, generatorVersion: GENERATOR_VERSION }, null, 2));
    printResult({ protocolVersion: 1, status: confirmed.status === 'pass' ? 'execution_error' : 'fail', seed: options.seed, original, shrunk, shrinkConfirmed: confirmed.status !== 'pass', report: outputPath }, options.format);
    process.exitCode = confirmed.status === 'pass' ? 3 : 1;
  });

program.command('scan')
  .requiredOption('--scenario <path>', 'scenario JSON file, or - for stdin')
  .option('--from <bytes>', 'initial pool capacity', bytes, 4096)
  .option('--to <bytes>', 'maximum pool capacity', bytes, 65536)
  .option('--step <bytes>', 'linear scan granularity', bytes, 256)
  .option('--format <format>', 'json, text or md', outputFormat, 'json')
  .action(async (options) => {
    const scenario = await scenarioFile(options.scenario);
    if (options.from < 1024 || options.to < options.from || options.step < 1) throw new Error('invalid scan range');
    const attempts = [];
    for (let capacity = options.from; capacity <= options.to; capacity += options.step) {
      const candidate = structuredClone(scenario);
      candidate.memory.heapSize = capacity;
      const result = await runIsolated(candidate, 'memory-check');
      attempts.push({ heapSize: capacity, status: result.status, reason: result.reason, failure: result.metrics.failureMemory });
      if (result.status === 'pass') {
        printResult({
          protocolVersion: 1,
          id: `${scenario.id}-capacity-scan`,
          status: 'pass',
          minimumVerifiedBytes: capacity,
          method: 'linear',
          granularityBytes: options.step,
          profile: 'memory-check',
          attempts,
          note: 'Minimum only for this scenario, build and scan granularity; not MCU SRAM.',
        }, options.format);
        return;
      }
    }
    printResult({ protocolVersion: 1, id: `${scenario.id}-capacity-scan`, status: 'fail', attempts }, options.format);
    process.exitCode = 1;
  });

program.command('bench')
  .option('--profile <profile>', 'must be release', profile, 'release')
  .option('--samples <number>', 'measured samples', Number, 20)
  .option('--batch-size <number>', 'WASM updates per sample', Number, 1000)
  .option('--warmups <number>', 'warmup batches', Number, 3)
  .option('--output <path>', 'optional JSON report path')
  .option('--format <format>', 'json, text or md', outputFormat, 'json')
  .action(async (options) => {
    if (options.profile !== 'release') throw new Error('bench requires --profile release');
    const result = await runWorker<Record<string, unknown>>({ kind: 'bench', timeoutMs: 120000, samples: options.samples, batchSize: options.batchSize, warmups: options.warmups });
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, JSON.stringify(result, null, 2));
    }
    printResult(result, options.format);
    process.exitCode = result.status === 'pass' ? 0 : 3;
  });

program.command('size')
  .option('--profile <profile>', 'must be size', profile, 'size')
  .option('--output <path>', 'optional JSON report path')
  .option('--format <format>', 'json, text or md', outputFormat, 'json')
  .action(async (options) => {
    if (options.profile !== 'size') throw new Error('size requires --profile size');
    const { root } = await nodePackage();
    const directory = resolve(root, 'wasm/build/size');
    const [component, baseline, componentJs, baselineJs, metadata] = await Promise.all([
      readFile(resolve(directory, 'ledip_tester.wasm')),
      readFile(resolve(directory, 'ledip_empty.wasm')),
      readFile(resolve(directory, 'ledip_tester.js')),
      readFile(resolve(directory, 'ledip_empty.js')),
      readFile(resolve(directory, 'build.json'), 'utf8'),
    ]);
    const componentSections = parseWasmSections(component);
    const baselineSections = parseWasmSections(baseline);
    const report = {
      protocolVersion: 1,
      status: 'pass',
      profile: 'size',
      build: {
        ...JSON.parse(metadata),
        optimization: '-Oz -flto',
        lto: true,
        exceptionStrategy: 'native-wasm',
        debugInfo: false,
        exportPolicy: 'fixed C ABI plus HEAPU8/HEAPU32',
      },
      artifacts: {
        wasm: resolve(directory, 'ledip_tester.wasm'),
        emptyBaselineWasm: resolve(directory, 'ledip_empty.wasm'),
      },
      component: {
        wasmBytes: component.length,
        codeSectionBytes: sectionSize(componentSections, 10, 'code'),
        dataSectionBytes: sectionSize(componentSections, 11, 'data'),
        jsGlueBytes: componentJs.length,
        sections: componentSections,
      },
      emptyBaseline: {
        wasmBytes: baseline.length,
        codeSectionBytes: sectionSize(baselineSections, 10, 'code'),
        dataSectionBytes: sectionSize(baselineSections, 11, 'data'),
        jsGlueBytes: baselineJs.length,
      },
      increment: {
        wasmBytes: component.length - baseline.length,
        codeSectionBytes: sectionSize(componentSections, 10, 'code') - sectionSize(baselineSections, 10, 'code'),
        dataSectionBytes: sectionSize(componentSections, 11, 'data') - sectionSize(baselineSections, 11, 'data'),
      },
      note: 'WASM code/storage size only; not MCU Flash or SRAM. The increment includes TLSF, bridge and the replacement of the default allocator.',
    };
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, JSON.stringify(report, null, 2));
    }
    printResult(report, options.format);
  });

program.command('report')
  .requiredOption('--input <paths...>', 'JSON intermediate reports to combine')
  .option('--output <path>', 'Markdown path, or - for stdout', 'artifacts/ledip-report.md')
  .action(async (options) => {
    const documents: unknown[] = [];
    for (const path of options.input as string[]) {
      try {
        documents.push(JSON.parse(await readFile(path, 'utf8')));
      } catch (error) {
        throw new InputError([`${path}: ${error instanceof Error ? error.message : String(error)}`]);
      }
    }
    const markdown = markdownReport(documents);
    if (options.output === '-') {
      process.stdout.write(markdown);
      return;
    }
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, markdown, 'utf8');
    process.stderr.write(`中文 Markdown 报告已写入 ${options.output}\n`);
  });

program.command('serve')
  .option('--host <host>', 'listen host', '127.0.0.1')
  .option('--port <number>', 'listen port', Number, 5173)
  .action(async (options) => {
    const { root } = await nodePackage();
    const server = await createServer({ configFile: resolve(root, 'vite.config.ts'), root: resolve(root, 'web'), server: { host: options.host, port: options.port } });
    await server.listen();
    server.printUrls();
  });

program.parseAsync(process.argv).catch((error) => {
  if (typeof error?.code === 'string' && error.code.startsWith('commander.')) {
    process.exitCode = error.exitCode === 0 ? 0 : 2;
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error?.issues ? 2 : 3;
});
