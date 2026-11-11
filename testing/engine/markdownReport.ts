import type { AssertionResult, MemoryStats, ScenarioResult, TraceEntry } from '../protocol/types.js';

type ReportRecord = Record<string, any>;

const STATUS_TEXT: Record<string, string> = {
  pass: '通过',
  fail: '失败',
  unsupported: '不支持',
  skipped: '跳过',
  execution_error: '执行异常',
  timeout: '超时',
};

function record(value: unknown): ReportRecord | undefined {
  return typeof value === 'object' && value !== null ? value as ReportRecord : undefined;
}

function text(value: unknown, fallback = '—'): string {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function cell(value: unknown): string {
  return text(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function number(value: unknown, digits = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : text(value);
}

function status(value: unknown): string {
  return STATUS_TEXT[String(value)] ?? text(value);
}

function reason(value: unknown): string {
  const reasons: Record<string, string> = {
    assertion: '断言失败',
    trace_overflow: '轨迹溢出',
    oom: '内存不足',
    trap: 'WASM 陷阱',
    invalid_input: '输入无效',
    unsupported: '不支持',
    timeout: '真实时间预算超时',
    worker_error: 'Worker 执行异常',
  };
  return reasons[String(value)] ?? text(value);
}

function table(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '暂无记录。';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function heading(level: number, title: string): string {
  return `${'#'.repeat(level)} ${title}`;
}

function documentName(value: ReportRecord): string {
  if (value.wasmBatchMs) return 'WASM 性能基准';
  if (value.component && value.emptyBaseline) return 'WASM 体积分析';
  if (value.minimumVerifiedBytes !== undefined) return '固定池容量扫描';
  if (value.generatorVersion) return '随机测试';
  return text(value.id, '测试报告');
}

function reportNote(report: ReportRecord): string {
  if (report.wasmBatchMs) return '耗时仅适用于当前 WASM 宿主，不代表 MCU 速度；Node 与浏览器基线不可混用。';
  if (report.component) return '体积仅表示 WASM 代码/存储，不代表 MCU Flash/SRAM；增量包含 TLSF、桥接层和分配器替换成本。';
  if (report.attempts) return '最小容量仅表示指定场景、构建和扫描步长下已验证的容量，不是 MCU SRAM。';
  return text(report.note);
}

function overallDescription(value: ReportRecord): string {
  if (value.metrics?.cases !== undefined) {
    return `${value.metrics.cases} 个用例，${value.metrics.passed} 个通过`;
  }
  if (value.wasmBatchMs) return `${value.configuration?.patterns ?? '—'} 个 pattern，${value.configuration?.samples ?? '—'} 组样本`;
  if (value.component) return `WASM ${value.component.wasmBytes} 字节`;
  if (value.minimumVerifiedBytes !== undefined) return `已验证容量 ${value.minimumVerifiedBytes} 字节`;
  return status(value.status);
}

function environmentTable(result: ReportRecord): string {
  const build = record(result.build) ?? {};
  const environment = record(result.environment) ?? {};
  return table(['项目', '值'], [
    ['源码版本', build.sourceRevision],
    ['构建配置', build.profile],
    ['Emscripten', build.emscripten],
    ['优化参数', build.optimization],
    ['异常策略', build.exceptionStrategy],
    ['宿主', environment.host],
    ['运行时', environment.runtime],
    ['平台', [environment.platform, environment.arch].filter(Boolean).join(' / ') || undefined],
    ['处理器', environment.cpu],
  ]);
}

function operationText(entry: TraceEntry): string {
  const operation = entry.operation;
  const details = Object.entries(operation)
    .filter(([key]) => key !== 'op')
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(', ');
  return `${operation.op}${details ? ` (${details})` : ''}`;
}

function assertionMessage(assertion: AssertionResult): string {
  const translations: Record<string, string> = {
    matched: '符合预期',
    'value differs': '值不一致',
    'first reference-model deviation': '首次参考模型偏差',
    'event does not exist': '事件不存在',
  };
  if (assertion.message.startsWith('unsupported step mask')) {
    return `不支持的步骤掩码：${assertion.message.replace('unsupported step mask', '').trim()}`;
  }
  return translations[assertion.message] ?? assertion.message;
}

function memoryRows(before?: MemoryStats, after?: MemoryStats): unknown[][] {
  const fields: Array<[string, keyof MemoryStats, string]> = [
    ['配置池容量', 'configuredBytes', 'B'],
    ['峰值请求字节', 'peakRequestedBytes', 'B'],
    ['峰值实际池占用', 'peakPoolBytes', 'B'],
    ['分配次数', 'allocationCount', ''],
    ['释放次数', 'freeCount', ''],
    ['失败次数', 'failureCount', ''],
    ['存活块数', 'liveBlocks', ''],
    ['当前请求字节', 'currentRequestedBytes', 'B'],
    ['当前实际池占用', 'currentPoolBytes', 'B'],
    ['空闲总量', 'freeBytes', 'B'],
    ['最大空闲块', 'largestFreeBlock', 'B'],
    ['碎片率', 'fragmentationPercent', '%'],
  ];
  const format = (stats: MemoryStats | undefined, field: keyof MemoryStats, unit: string) => {
    if (!stats) return '—';
    return `${number(stats[field])}${unit ? ` ${unit}` : ''}`;
  };
  return fields.map(([label, field, unit]) => [
    label,
    format(before, field, unit),
    format(after, field, unit),
  ]);
}

function failureDetails(assertions: AssertionResult[]): string {
  const failures = assertions.filter((assertion) => assertion.status === 'fail');
  if (failures.length === 0) return '';
  return failures.map((assertion) => [
    heading(4, `失败：${assertion.assertion.type}`),
    `首次位置：虚拟时间 ${text(assertion.time)} ms，操作索引 ${text(assertion.operationIndex)}。`,
    jsonBlock({ expected: assertion.expected, actual: assertion.actual }),
  ].join('\n\n')).join('\n\n');
}

function traceTable(trace: TraceEntry[]): string {
  return table(
    ['操作', '虚拟时间 (ms)', '操作内容', '活动数', '当前优先级', '请求状态', '引脚 R/G/B', '事件数', '池占用 (B)'],
    trace.map((entry) => [
      entry.operationIndex,
      entry.time,
      operationText(entry),
      entry.state.activeCount,
      entry.state.selectedType,
      entry.state.requestedState,
      `${entry.state.pinR}/${entry.state.pinG}/${entry.state.pinB}`,
      entry.events.length,
      entry.memory.currentPoolBytes,
    ]),
  );
}

function eventTable(trace: TraceEntry[]): string {
  const events = trace.flatMap((entry) => entry.events);
  return table(
    ['操作', '虚拟时间 (ms)', '原始 uint32 时间', '事件', '参数'],
    events.map((event) => [event.operationIndex, event.time, event.rawTime, event.kind, event.args.join(', ')]),
  );
}

function renderScenario(result: ScenarioResult, includeTrace = true, level = 3): string {
  const sections = [
    heading(level, `用例：${result.id}`),
    table(['结论', '原因', '操作数', '事件数', '真实耗时 (ms)'], [[
      status(result.status),
      reason(result.reason),
      result.metrics.operations,
      result.metrics.events,
      number(result.metrics.durationMs),
    ]]),
  ];
  if (result.error) sections.push(`> 错误：${result.error}`);
  sections.push(
    heading(level + 1, '构建与运行环境'),
    environmentTable(result),
    heading(level + 1, '断言结果'),
    table(['类型', '结果', '虚拟时间 (ms)', '操作索引', '说明'], result.assertions.map((assertion) => [
      assertion.assertion.type,
      status(assertion.status),
      assertion.time,
      assertion.operationIndex,
      assertionMessage(assertion),
    ])),
  );
  const failures = failureDetails(result.assertions);
  if (failures) sections.push(failures);
  sections.push(
    heading(level + 1, '内存指标'),
    table(['指标', '销毁前', '销毁后'], memoryRows(result.metrics.beforeDestroy, result.metrics.afterDestroy)),
    table(['WASM 线性内存', 'TLSF 预留池', '栈预留', '静态区总量', '栈高水位'], [[
      result.metrics.wasmMemoryBytes !== undefined ? `${result.metrics.wasmMemoryBytes} B` : '—',
      result.metrics.tlsfPoolBytes !== undefined ? `${result.metrics.tlsfPoolBytes} B` : '—',
      result.metrics.stackReservedBytes !== undefined ? `${result.metrics.stackReservedBytes} B` : '—',
      result.metrics.staticBytes === null ? '未可靠测量' : text(result.metrics.staticBytes),
      result.metrics.stackHighWaterBytes === null ? '未可靠测量' : text(result.metrics.stackHighWaterBytes),
    ]]),
  );
  if (result.metrics.failureMemory) {
    sections.push(heading(level + 1, '失败分配'), jsonBlock(result.metrics.failureMemory));
  }
  if (includeTrace) {
    sections.push(
      `<details><summary>查看 ${result.trace.length} 条操作轨迹</summary>\n`,
      traceTable(result.trace),
      `\n</details>`,
      `<details><summary>查看输出事件明细</summary>\n`,
      eventTable(result.trace),
      `\n</details>`,
    );
  }
  sections.push(
    heading(level + 1, '复现信息'),
    `\`${result.reproduce.command}\``,
    result.artifacts.reproduction ? `复现包：\`${result.artifacts.reproduction}\`` : '未单独保存复现包。',
  );
  return sections.join('\n\n');
}

function renderSuite(report: ReportRecord, level: number): string {
  const results = (report.results ?? []) as ScenarioResult[];
  const counts = results.reduce<Record<string, number>>((total, result) => {
    total[result.status] = (total[result.status] ?? 0) + 1;
    return total;
  }, {});
  return [
    heading(level, `场景套件：${report.id}`),
    table(['用例数', '通过', '失败', '不支持', '跳过', '执行异常', '超时'], [[
      results.length,
      counts.pass ?? 0,
      counts.fail ?? 0,
      counts.unsupported ?? 0,
      counts.skipped ?? 0,
      counts.execution_error ?? 0,
      counts.timeout ?? 0,
    ]]),
    heading(level + 1, '用例汇总'),
    table(['用例', '结果', '操作数', '事件数', '真实耗时 (ms)', '峰值池占用 (B)', '销毁后残留'], results.map((result) => [
      result.id,
      status(result.status),
      result.metrics.operations,
      result.metrics.events,
      number(result.metrics.durationMs),
      result.metrics.beforeDestroy?.peakPoolBytes,
      result.metrics.afterDestroy?.liveBlocks,
    ])),
    heading(level + 1, '失败、不支持与跳过项'),
    ...results.filter((result) => result.status !== 'pass').map((result) => renderScenario(result, false, level + 2)),
    results.every((result) => result.status === 'pass') ? '所有用例均通过。' : '通过用例的完整轨迹保留在 JSON 中间结果中。',
  ].join('\n\n');
}

function renderBenchmark(report: ReportRecord, level: number): string {
  const samples = (report.wasmBatchMs?.samples ?? []) as number[];
  return [
    heading(level, 'WASM 性能基准'),
    environmentTable(report),
    heading(level + 1, '测量结果'),
    table(['指标', '数值'], [
      ['pattern 数', report.configuration?.patterns],
      ['样本数', report.configuration?.samples],
      ['预热批次数', report.configuration?.warmups],
      ['每批 update 数', report.configuration?.batchSize],
      ['批量中位数', `${number(report.wasmBatchMs?.median)} ms`],
      ['批量 P95', `${number(report.wasmBatchMs?.p95)} ms`],
      ['批量平均每次 update', `${number(report.perUpdateMs, 6)} ms`],
      ['JS→WASM 逐次 update', `${number(report.jsToWasmMs?.perUpdate, 6)} ms`],
      ['实际输出 checksum', report.checksum],
    ]),
    `<details><summary>查看原始样本</summary>\n\n${table(['样本', '批量耗时 (ms)'], samples.map((sample, index) => [index + 1, number(sample, 6)]))}\n\n</details>`,
    `> ${reportNote(report)}`,
  ].join('\n\n');
}

function renderSize(report: ReportRecord, level: number): string {
  const component = report.component;
  const baseline = report.emptyBaseline;
  const increment = report.increment;
  return [
    heading(level, 'WASM 体积分析'),
    environmentTable({ build: report.build }),
    table(['指标', '组件构建', '空基线', '增量'], [
      ['WASM 总大小 (B)', component.wasmBytes, baseline.wasmBytes, increment.wasmBytes],
      ['Code section (B)', component.codeSectionBytes, baseline.codeSectionBytes, increment.codeSectionBytes],
      ['Data section (B)', component.dataSectionBytes, baseline.dataSectionBytes, increment.dataSectionBytes],
      ['JS 胶水 (B)', component.jsGlueBytes, baseline.jsGlueBytes, '—'],
    ]),
    heading(level + 1, 'WASM section 明细'),
    table(['ID', '名称', '载荷 (B)', '含头部总大小 (B)'], (component.sections ?? []).map((section: ReportRecord) => [
      section.id,
      section.name,
      section.payloadBytes,
      section.totalBytes,
    ])),
    `WASM 产物：\`${report.artifacts?.wasm ?? '—'}\``,
    `> ${reportNote(report)}`,
  ].join('\n\n');
}

function renderScan(report: ReportRecord, level: number): string {
  return [
    heading(level, `固定池容量扫描：${report.id}`),
    table(['结论', '最小已验证容量', '方法', '步长', '配置'], [[
      status(report.status),
      report.minimumVerifiedBytes !== undefined ? `${report.minimumVerifiedBytes} B` : '未找到',
      report.method,
      report.granularityBytes !== undefined ? `${report.granularityBytes} B` : '—',
      report.profile,
    ]]),
    table(['池容量 (B)', '结果', '原因'], (report.attempts ?? []).map((attempt: ReportRecord) => [
      attempt.heapSize,
      status(attempt.status),
      attempt.reason,
    ])),
    `> ${reportNote(report)}`,
  ].join('\n\n');
}

function renderFuzz(report: ReportRecord, level: number): string {
  return [
    heading(level, '固定种子随机测试'),
    table(['结论', '种子', '迭代数', '生成器版本', '缩减确认'], [[
      status(report.status),
      report.seed,
      report.iterations,
      report.generatorVersion,
      report.shrinkConfirmed === undefined ? '—' : report.shrinkConfirmed ? '通过' : '失败',
    ]]),
    report.original ? `<details><summary>原始场景</summary>\n\n${jsonBlock(report.original)}\n\n</details>` : '',
    report.shrunk ? `<details><summary>缩减场景</summary>\n\n${jsonBlock(report.shrunk)}\n\n</details>` : '',
    report.report ? `完整 JSON：\`${report.report}\`` : '',
  ].filter(Boolean).join('\n\n');
}

function renderDocument(value: unknown, level: number): string {
  const report = record(value);
  if (!report) return `${heading(level, '附加结果')}\n\n${jsonBlock(value)}`;
  if (Array.isArray(report.results)) return renderSuite(report, level);
  if (report.wasmBatchMs) return renderBenchmark(report, level);
  if (report.component && report.emptyBaseline) return renderSize(report, level);
  if (report.minimumVerifiedBytes !== undefined || report.attempts) return renderScan(report, level);
  if (report.generatorVersion) return renderFuzz(report, level);
  if (report.trace && report.effectiveConfig) return renderScenario(report as ScenarioResult, true, level);
  return `${heading(level, documentName(report))}\n\n${jsonBlock(value)}`;
}

export function markdownReport(input: unknown | unknown[]): string {
  const reports = Array.isArray(input) ? input : [input];
  const records = reports.map(record).filter((value): value is ReportRecord => value !== undefined);
  const hasFailure = records.some((report) => ['fail', 'execution_error', 'timeout'].includes(report.status));
  const unsupportedCount = records.reduce((total, report) => {
    if (!Array.isArray(report.results)) return total + (report.status === 'unsupported' ? 1 : 0);
    return total + report.results.filter((result: ReportRecord) => result.status === 'unsupported').length;
  }, 0);
  return [
    '# LEDIndicatorPP 中文测试报告',
    `**总体结论：${hasFailure ? '存在失败或执行异常' : '执行完成'}**。本报告由 JSON 中间结果汇总生成；指标仅适用于 WASM，不代表实测 MCU 资源或速度。`,
    unsupportedCount > 0 ? `> 包含 ${unsupportedCount} 个不支持项，未将其计为功能通过。` : '',
    heading(2, '报告摘要'),
    table(['内容', '状态', '摘要'], reports.map((report) => {
      const value = record(report);
      return value ? [documentName(value), status(value.status), overallDescription(value)] : ['附加结果', '—', '—'];
    })),
    ...reports.map((report) => renderDocument(report, 2)),
  ].filter(Boolean).join('\n\n') + '\n';
}
