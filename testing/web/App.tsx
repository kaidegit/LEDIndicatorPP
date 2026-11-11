import { useEffect, useMemo, useRef, useState } from 'react';
import basicScenario from '../scenarios/regression/basic-gpio.json?raw';
import priorityScenario from '../scenarios/regression/priority-background.json?raw';
import rgbScenario from '../scenarios/regression/rgb-cache-pins.json?raw';
import stressScenario from '../scenarios/stress/many-patterns.json?raw';
import timeoutScenario from '../scenarios/robustness/zero-duration-loop.json?raw';
import { BrowserRunner } from './host.js';
import { validateScenario } from '../protocol/validate.js';
import type { Scenario, ScenarioResult, TraceEntry } from '../protocol/types.js';
import { deepEqual } from '../engine/equality.js';
import { markdownReport } from '../engine/markdownReport.js';
import type { MemoryBlock } from '../engine/binary.js';
import { LedPreview } from './components/LedPreview.js';
import { Timeline } from './components/Timeline.js';
import { MemoryPanel } from './components/MemoryPanel.js';
import { ReportPanel } from './components/ReportPanel.js';

const EXAMPLES: Record<string, string> = {
  '基础 GPIO': basicScenario,
  '优先级与后台推进': priorityScenario,
  'RGB 缓存与引脚': rgbScenario,
  '1000 次更新压力': stressScenario,
  '零时长死循环超时': timeoutScenario,
};

function download(name: string, value: unknown, type = 'application/json'): void {
  const contents = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [text, setText] = useState(basicScenario);
  const parsed = useMemo(() => {
    try {
      return { scenario: validateScenario(JSON.parse(text)) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [text]);
  const scenario = parsed.scenario;
  const runner = useRef(new BrowserRunner()).current;
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [result, setResult] = useState<ScenarioResult>();
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [advanceMs, setAdvanceMs] = useState(50);
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Record<string, any>>();
  const [baseline, setBaseline] = useState<Record<string, any>>();
  const [expectedFailure, setExpectedFailure] = useState<unknown>();
  const visibleTrace = result?.trace.length ? result.trace : trace;
  const current = visibleTrace[Math.min(cursor, Math.max(0, visibleTrace.length - 1))];
  const finished = result !== undefined || (trace.length > 0 && trace.at(-1)!.operationIndex >= (scenario?.operations.length ?? 0) - 1);

  useEffect(() => () => runner.stop(), [runner]);

  useEffect(() => {
    if (!playing || finished || busy) return;
    const timer = setInterval(() => void step(), Math.max(20, 250 / speed));
    return () => clearInterval(timer);
  }, [playing, finished, busy, speed, trace.length]);

  async function perform(action: () => Promise<void>): Promise<void> {
    if (!scenario || busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function initialize(): Promise<void> {
    if (!scenario) return;
    setResult(undefined);
    setBlocks([]);
    const initialTrace = await runner.initialize(scenario);
    setTrace(initialTrace);
    setCursor(initialTrace.length - 1);
  }

  async function run(): Promise<void> {
    await perform(async () => {
      if (!scenario) return;
      setPlaying(false);
      setBlocks([]);
      const nextResult = await runner.run(scenario);
      setTrace(nextResult.trace);
      setResult(nextResult);
      setCursor(Math.max(0, nextResult.trace.length - 1));
    });
  }

  async function step(count = 1): Promise<void> {
    await perform(async () => {
      if (trace.length === 0) await initialize();
      const response = await runner.step(count);
      setTrace(response.trace);
      setCursor(response.trace.length - 1);
      if (response.finished) setPlaying(false);
    });
  }

  async function advance(): Promise<void> {
    await perform(async () => {
      if (trace.length === 0) await initialize();
      const response = await runner.advance(advanceMs);
      setTrace(response.trace);
      setText(JSON.stringify(scenario!, null, 2));
      setCursor(response.trace.length - 1);
    });
  }

  async function finish(): Promise<void> {
    await perform(async () => {
      const nextResult = await runner.finish();
      setResult(nextResult);
      setTrace(nextResult.trace);
      setCursor(Math.max(0, nextResult.trace.length - 1));
    });
  }

  async function replayFromCursor(): Promise<void> {
    await perform(async () => {
      if (!scenario) return;
      setPlaying(false);
      setResult(undefined);
      let replayed = await runner.initialize(scenario);
      if (cursor > 0) {
        const response = await runner.step(cursor);
        replayed = response.trace;
      }
      setTrace(replayed);
      setCursor(Math.min(cursor, replayed.length - 1));
    });
  }

  async function importScenario(file: File): Promise<void> {
    const value = JSON.parse(await file.text());
    const imported = validateScenario(value.kind === 'ledip-reproduction' ? value.scenario : value);
    setText(JSON.stringify(imported, null, 2));
    setExpectedFailure(value.firstFailure);
    setResult(undefined);
    setTrace([]);
    setCursor(0);
    runner.stop();
  }

  async function importReport(file: File, isBaseline: boolean): Promise<void> {
    const value = JSON.parse(await file.text());
    if (isBaseline) setBaseline(value);
    else setReport(value);
  }

  const actualFailure = result?.assertions.find((assertion) => assertion.status === 'fail');
  const failureMatches = expectedFailure && actualFailure
    ? deepEqual(
        { time: (expectedFailure as any).time, operationIndex: (expectedFailure as any).operationIndex, expected: (expectedFailure as any).expected, actual: (expectedFailure as any).actual },
        { time: actualFailure.time, operationIndex: actualFailure.operationIndex, expected: actualFailure.expected, actual: actualFailure.actual },
      )
    : undefined;

  return (
    <main>
      <header>
        <div>
          <h1>ledip_tester</h1>
          <p>真实 C++ · 同一 WASM · 确定性虚拟时间</p>
        </div>
        {result && <strong className={`status ${result.status}`}>{result.status.toUpperCase()}</strong>}
      </header>

      <section className="panel">
        <h2>场景</h2>
        <div className="toolbar">
          <select aria-label="场景选择" onChange={(event) => { setText(EXAMPLES[event.target.value]!); setTrace([]); setResult(undefined); runner.stop(); }}>
            {Object.keys(EXAMPLES).map((name) => <option key={name}>{name}</option>)}
          </select>
          <label className="button">导入场景/复现包<input type="file" accept=".json" onChange={(event) => event.target.files?.[0] && void importScenario(event.target.files[0])} /></label>
          <button onClick={() => scenario && download(`${scenario.id}.json`, scenario)}>导出场景</button>
          <button onClick={() => scenario && download(`${scenario.id}.repro.json`, { protocolVersion: 1, kind: 'ledip-reproduction', scenario, effectiveConfig: scenario, trace: visibleTrace, result, firstFailure: actualFailure })}>导出复现包</button>
          <button disabled={!result} onClick={() => result && download(`${result.id}-中文报告.md`, markdownReport(result), 'text/markdown;charset=utf-8')}>导出中文 Markdown 报告</button>
        </div>
        {scenario && (
          <div className="form-grid">
            <label>驱动
              <select value={scenario.driver} onChange={(event) => setText(JSON.stringify({ ...scenario, driver: event.target.value }, null, 2))}>
                <option value="recorder">recorder</option><option value="gpio">gpio</option><option value="rgb-gpio">rgb-gpio</option><option value="none">none</option>
              </select>
            </label>
            <label>池容量 (bytes)<input type="number" value={scenario.memory.heapSize} onChange={(event) => setText(JSON.stringify({ ...scenario, memory: { ...scenario.memory, heapSize: Number(event.target.value) } }, null, 2))} /></label>
            <label>真实超时 (ms)<input type="number" value={scenario.budgets.timeoutMs} onChange={(event) => setText(JSON.stringify({ ...scenario, budgets: { ...scenario.budgets, timeoutMs: Number(event.target.value) } }, null, 2))} /></label>
            <label>有效电平
              <select value={scenario.activeLevel ?? 1} onChange={(event) => setText(JSON.stringify({ ...scenario, activeLevel: Number(event.target.value) }, null, 2))}><option value={1}>高电平</option><option value={0}>低电平</option></select>
            </label>
          </div>
        )}
        <textarea className="editor" spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} aria-label="场景 JSON" />
        {parsed.error && <pre className="error">{parsed.error}</pre>}
      </section>

      <section className="panel">
        <h2>执行</h2>
        <div className="toolbar">
          <button className="primary" disabled={!scenario || busy} onClick={() => void run()}>从头运行</button>
          <button disabled={!scenario || busy} onClick={() => void initialize()}>初始化</button>
          <button disabled={!scenario || busy || finished} onClick={() => void step()}>单步</button>
          <button disabled={!scenario || busy || finished} onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</button>
          <label>速度 <input type="number" min={1} max={100} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
          <label>推进 ms <input type="number" min={0} value={advanceMs} onChange={(event) => setAdvanceMs(Number(event.target.value))} /></label>
          <button disabled={!scenario || busy || finished} onClick={() => void advance()}>推进并 update</button>
          <button disabled={!scenario || busy || trace.length === 0} onClick={() => void finish()}>销毁并汇总</button>
          <button disabled={busy || visibleTrace.length === 0} onClick={() => void replayFromCursor()}>从光标确定性重放</button>
          <button onClick={() => { setPlaying(false); runner.stop(); setBusy(false); }}>取消</button>
        </div>
        {error && <pre className="error">{error}</pre>}
        {result?.error && <pre className="error">{result.error}</pre>}
        <p>虚拟时间：{current?.time ?? 0} ms · 操作：{current?.operationIndex ?? -1} · 活动：{current?.state.activeCount ?? 0}</p>
      </section>

      <LedPreview state={current?.state} scenario={scenario ?? validateScenario(JSON.parse(basicScenario))} />
      <Timeline trace={visibleTrace} cursor={cursor} onCursor={setCursor} />

      <section className="panel">
        <h2>断言与首次偏差</h2>
        {failureMatches !== undefined && <p>复现包首次偏差：<strong>{failureMatches ? '一致' : '不一致'}</strong></p>}
        {result?.assertions.length ? (
          <ul className="assertions">{result.assertions.map((assertion, index) => (
            <li key={index} className={assertion.status} onClick={() => {
              const indexInTrace = visibleTrace.findIndex((entry) => entry.operationIndex === assertion.operationIndex);
              if (indexInTrace >= 0) setCursor(indexInTrace);
            }}>
              <strong>{assertion.status}</strong> <code>{assertion.assertion.type}</code> {assertion.message}
              {assertion.time !== undefined && <span> · t={assertion.time} op={assertion.operationIndex}</span>}
              {assertion.status === 'fail' && <details><summary>预期 / 实际</summary><pre>{JSON.stringify({ expected: assertion.expected, actual: assertion.actual }, null, 2)}</pre></details>}
            </li>
          ))}</ul>
        ) : <p>运行后显示断言；失败项可点击定位时间线。</p>}
        {result && <p className="hint">{result.build.profile} · {result.build.emscripten} · {result.environment.runtime} · 源码 {result.build.sourceRevision}</p>}
      </section>

      <MemoryPanel trace={visibleTrace} blocks={blocks} />
      <button disabled={busy || trace.length === 0} onClick={() => void perform(async () => setBlocks(await runner.blocks()))}>读取 TLSF 块分布</button>
      <button disabled={busy} onClick={() => void perform(async () => setReport(await runner.benchmark()))}>运行浏览器 Release 基准</button>
      <ReportPanel report={report} baseline={baseline} onImport={(file, isBaseline) => void importReport(file, isBaseline)} />
      <footer>所有指标仅针对 WASM；栈高水位等未知指标不会填零。</footer>
    </main>
  );
}
