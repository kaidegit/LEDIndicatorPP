import type { Scenario, StateSnapshot } from '../../protocol/types.js';

const STATE_NAMES = ['NONE', 'OFF', 'ON', 'BREATHING'];

export function LedPreview({ state, scenario }: { state: StateSnapshot | undefined; scenario: Scenario }) {
  const activeLevel = scenario.activeLevel ?? 1;
  const gpioOn = state?.pinR === activeLevel;
  const rgb = state ? [state.pinR, state.pinG, state.pinB].map((level) => level === activeLevel ? 255 : 0) : [0, 0, 0];
  const cache = state?.requestedColor ?? [0, 0, 0, 0];
  return (
    <section className="panel">
      <h2>LED 状态</h2>
      <div className="led-grid">
        <div>
          <h3>驱动请求</h3>
          <div className={`led-request ${state?.requestedState === 2 ? 'on' : ''}`}>
            {STATE_NAMES[state?.requestedState ?? 0]}
          </div>
          <p>亮度：{state?.brightness ?? -1}</p>
        </div>
        <div>
          <h3>RGB 缓存（setColor）</h3>
          <div className="rgb-swatch" style={{ background: `rgb(${cache.slice(0, 3).join(',')})` }} />
          <code>[{cache.join(', ')}]</code>
        </div>
        <div>
          <h3>实际引脚</h3>
          {scenario.driver === 'rgb-gpio' ? (
            <div className="rgb-swatch actual" style={{ background: `rgb(${rgb.join(',')})` }} />
          ) : (
            <div className={`led-request ${gpioOn ? 'on' : ''}`}>{state?.pinR === -1 || !state ? '未知' : gpioOn ? '亮' : '灭'}</div>
          )}
          <p>R/G/B：{state ? `${state.pinR}/${state.pinG}/${state.pinB}` : 'unavailable'}</p>
          <p>最后掩码：{state?.pinMask === 0xffffffff ? 'unavailable' : state?.pinMask}</p>
        </div>
      </div>
      <p className="hint">颜色请求不会直接改变 RGB GPIO；只有 HOLD/ON 等状态写引脚。</p>
    </section>
  );
}
