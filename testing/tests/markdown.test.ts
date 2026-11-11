import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runIsolated } from '../engine/isolated.js';
import { markdownReport } from '../engine/markdownReport.js';
import { parseScenario } from '../protocol/validate.js';

async function basicResult() {
  const scenario = parseScenario(await readFile(new URL('../scenarios/regression/basic-gpio.json', import.meta.url), 'utf8'));
  return runIsolated(scenario);
}

describe('中文 Markdown 报告', () => {
  it('renders conclusion, environment, assertions, memory and trace', async () => {
    const markdown = markdownReport(await basicResult());
    expect(markdown).toContain('# LEDIndicatorPP 中文测试报告');
    expect(markdown).toContain('用例：basic-gpio');
    expect(markdown).toContain('通过');
    expect(markdown).toContain('构建与运行环境');
    expect(markdown).toContain('断言结果');
    expect(markdown).toContain('内存指标');
    expect(markdown).toContain('查看 8 条操作轨迹');
    expect(markdown).toContain('复现信息');
  });

  it('combines suite, benchmark and size JSON into one document', async () => {
    const scenario = await basicResult();
    const suite = {
      id: 'suite-all',
      status: 'pass',
      results: [scenario],
      metrics: { cases: 1, passed: 1 },
    };
    const benchmark = {
      id: 'wasm-update-benchmark',
      status: 'pass',
      build: scenario.build,
      environment: scenario.environment,
      configuration: { patterns: 32, samples: 1, warmups: 1, batchSize: 500 },
      wasmBatchMs: { median: 0.14, p95: 0.2, samples: [0.14] },
      jsToWasmMs: { perUpdate: 0.0004 },
      perUpdateMs: 0.00028,
      checksum: 1,
    };
    const size = {
      id: 'size',
      status: 'pass',
      build: scenario.build,
      component: { wasmBytes: 1000, codeSectionBytes: 700, dataSectionBytes: 100, jsGlueBytes: 200, sections: [] },
      emptyBaseline: { wasmBytes: 100, codeSectionBytes: 50, dataSectionBytes: 10, jsGlueBytes: 100 },
      increment: { wasmBytes: 900, codeSectionBytes: 650, dataSectionBytes: 90 },
    };
    const markdown = markdownReport([suite, benchmark, size]);
    expect(markdown.match(/# LEDIndicatorPP 中文测试报告/g)).toHaveLength(1);
    expect(markdown).toContain('场景套件：suite-all');
    expect(markdown).toContain('WASM 性能基准');
    expect(markdown).toContain('WASM 体积分析');
    expect(markdown).toContain('批量中位数');
    expect(markdown).toContain('增量');
  });
});
