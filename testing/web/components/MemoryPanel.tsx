import type { MemoryBlock } from '../../engine/binary.js';
import type { TraceEntry } from '../../protocol/types.js';

export function MemoryPanel({ trace, blocks }: { trace: TraceEntry[]; blocks: MemoryBlock[] }) {
  const width = 900;
  const height = 150;
  const peak = Math.max(1, ...trace.map((entry) => entry.memory.currentPoolBytes));
  const points = trace.map((entry, index) => {
    const x = trace.length <= 1 ? 0 : (index / (trace.length - 1)) * width;
    const y = height - (entry.memory.currentPoolBytes / peak) * height;
    return `${x},${y}`;
  }).join(' ');
  const latest = trace.at(-1)?.memory;
  return (
    <section className="panel">
      <h2>TLSF 固定池</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="memory-chart" role="img" aria-label="实际池占用曲线">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} />
      </svg>
      {latest && (
        <div className="metric-grid">
          <span>Backing 预留 / TLSF 配置容量</span><strong>{latest.physicalPoolBytes} / {latest.configuredBytes} B</strong>
          <span>当前 / 峰值实际占用</span><strong>{latest.currentPoolBytes} / {latest.peakPoolBytes} B</strong>
          <span>当前 / 峰值请求</span><strong>{latest.currentRequestedBytes} / {latest.peakRequestedBytes} B</strong>
          <span>分配 / 释放 / 失败</span><strong>{latest.allocationCount} / {latest.freeCount} / {latest.failureCount}</strong>
          <span>空闲 / 最大空闲块</span><strong>{latest.freeBytes} / {latest.largestFreeBlock} B</strong>
          <span>碎片率</span><strong>{latest.fragmentationPercent.toFixed(2)}%</strong>
          <span>销毁后残留</span><strong>{latest.liveBlocks} blocks</strong>
          <span>TLSF 一致性</span><strong>{latest.tlsfConsistent ? '通过' : '失败'}</strong>
        </div>
      )}
      {blocks.length > 0 && (
        <div className="blocks" aria-label="TLSF 块分布">
          {blocks.map((block, index) => (
            <span
              key={index}
              className={block.used ? 'block used' : 'block free'}
              style={{ width: `${Math.max(2, block.size / 64)}px` }}
              title={`offset=${block.offset}, size=${block.size}, used=${block.used}`}
            />
          ))}
        </div>
      )}
      <p className="hint">这是 WASM 固定池数据，不是 MCU SRAM。诊断块遍历只在点击时执行。</p>
    </section>
  );
}
