interface Props {
  report: Record<string, any> | undefined;
  baseline: Record<string, any> | undefined;
  onImport: (file: File, baseline: boolean) => void;
}

export function ReportPanel({ report, baseline, onImport }: Props) {
  const metrics = report?.wasmBatchMs ? [
    ['WASM 批量中位数 (ms)', report.wasmBatchMs.median, baseline?.wasmBatchMs?.median],
    ['WASM P95 (ms)', report.wasmBatchMs.p95, baseline?.wasmBatchMs?.p95],
    ['JS→WASM 每次 update (ms)', report.jsToWasmMs?.perUpdate, baseline?.jsToWasmMs?.perUpdate],
  ] : report?.component ? [
    ['WASM 总字节', report.component.wasmBytes, baseline?.component?.wasmBytes],
    ['Code section', report.component.codeSectionBytes, baseline?.component?.codeSectionBytes],
    ['Data section', report.component.dataSectionBytes, baseline?.component?.dataSectionBytes],
    ['相对空基线增量', report.increment?.wasmBytes, baseline?.increment?.wasmBytes],
  ] : [];
  return (
    <section className="panel">
      <h2>性能与体积报告</h2>
      <div className="button-row">
        <label className="button">导入报告<input type="file" accept=".json" onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0], false)} /></label>
        <label className="button">导入基线<input type="file" accept=".json" onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0], true)} /></label>
      </div>
      {metrics.length > 0 ? (
        <table>
          <thead><tr><th>指标</th><th>当前</th><th>基线</th><th>差值</th></tr></thead>
          <tbody>{metrics.map(([name, value, old]) => (
            <tr key={String(name)}><td>{name}</td><td>{value}</td><td>{old ?? '—'}</td><td>{typeof value === 'number' && typeof old === 'number' ? value - old : '—'}</td></tr>
          ))}</tbody>
        </table>
      ) : <p>导入 CLI 的 bench/size JSON 报告后可比较同配置基线。</p>}
      <p className="hint">性能不表示 MCU 速度；体积不表示 MCU Flash。不同 profile、Node 与浏览器基线不可混用。</p>
    </section>
  );
}
