import type { TraceEntry } from '../../protocol/types.js';

interface Props {
  trace: TraceEntry[];
  cursor: number;
  onCursor: (index: number) => void;
}

export function Timeline({ trace, cursor, onCursor }: Props) {
  const width = 1000;
  const left = 120;
  const maxTime = Math.max(1, ...trace.map((entry) => entry.time));
  const types = [...new Set(trace.flatMap((entry) => entry.state.active.map((pattern) => pattern.type)))].sort((a, b) => a - b);
  const rowHeight = 48;
  const eventTop = 30 + types.length * rowHeight;
  const height = eventTop + 90;
  const x = (time: number) => left + (time / maxTime) * (width - left - 20);
  const cursorTime = trace[cursor]?.time ?? 0;
  return (
    <section className="panel">
      <h2>虚拟时间线</h2>
      <input
        aria-label="时间线位置"
        type="range"
        min={0}
        max={Math.max(0, trace.length - 1)}
        value={Math.min(cursor, Math.max(0, trace.length - 1))}
        onChange={(event) => onCursor(Number(event.target.value))}
      />
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="pattern 与输出事件时间线">
        <line x1={left} x2={width - 20} y1={20} y2={20} className="axis" />
        <text x={left} y={14}>0 ms</text>
        <text x={width - 20} y={14} textAnchor="end">{maxTime} ms</text>
        {types.map((type, row) => (
          <g key={type}>
            <text x={4} y={43 + row * rowHeight}>type {type}</text>
            {trace.map((entry, index) => {
              const pattern = entry.state.active.find((candidate) => candidate.type === type);
              if (!pattern) return null;
              const selected = entry.state.selectedType === type;
              return (
                <g key={index} onClick={() => onCursor(index)} className="timeline-point">
                  <circle
                    cx={x(entry.time)}
                    cy={35 + row * rowHeight}
                    r={selected ? 7 : 4}
                    className={selected ? 'selected-pattern' : 'background-pattern'}
                  />
                  <text x={x(entry.time) + 8} y={39 + row * rowHeight}>s{pattern.stepIndex}</text>
                </g>
              );
            })}
          </g>
        ))}
        <text x={4} y={eventTop + 10}>输出事件</text>
        {trace.flatMap((entry, traceIndex) => entry.events.map((event, eventIndex) => (
          <g key={`${traceIndex}-${eventIndex}`} onClick={() => onCursor(traceIndex)} className="timeline-point">
            <rect
              x={x(event.time) - 2}
              y={eventTop + 20 + (eventIndex % 4) * 12}
              width={5}
              height={9}
              className={`event-${event.kind}`}
            />
            <title>{`t=${event.time} op=${event.operationIndex} ${event.kind}(${event.args.join(',')})`}</title>
          </g>
        )))}
        <line x1={x(cursorTime)} x2={x(cursorTime)} y1={18} y2={height - 8} className="cursor" />
      </svg>
      <p className="hint">实心大圆控制实际输出；小圆为后台推进。向后拖动仅查看轨迹，不恢复内存快照。</p>
    </section>
  );
}
