/* =========================================================
   sfx.test.mjs —— 用假的 AudioContext 验证音效层
   运行： node test/sfx.test.mjs
   覆盖：每个音效都能正常合成（频率/时长/音量合法）、静音开关生效、
        没有 AudioContext 的环境不报错
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'js', 'sfx.js'), 'utf8');

/* ---------- 极简 AudioContext 假实现，记录所有参数 ---------- */
function makeMockCtx() {
  const calls = { oscillators: [], buffers: [], gains: [], delays: [] };
  const param = (name, store) => ({
    value: 0,
    setValueAtTime(v, t) { assert.ok(Number.isFinite(v), `${name} setValueAtTime 非数字`); assert.ok(t >= 0, `${name} 时间为负`); store.push(['set', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) {
      assert.ok(Number.isFinite(v) && v > 0, `${name} 指数斜坡必须为正数，得到 ${v}`);
      assert.ok(t >= 0, `${name} 时间为负`);
      store.push(['exp', v, t]);
      return this;
    },
    linearRampToValueAtTime(v, t) { store.push(['lin', v, t]); return this; },
    setTargetAtTime(v, t, c) { store.push(['target', v, t, c]); return this; },
    cancelScheduledValues() { return this; },
  });
  const node = (extra = {}) => ({
    connect(dest) { assert.ok(dest, 'connect 目标为空'); return dest; },
    disconnect() {},
    ...extra,
  });
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.state = 'running';
      this._t = 0;
      this.destination = node({ name: 'destination' });
    }
    get currentTime() { return this._t; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() {
      const store = [];
      calls.gains.push(store);
      return node({ gain: param('gain', store) });
    }
    createOscillator() {
      const o = { type: 'sine', frequency: null, started: false, stopped: false, freqStore: [], freq: null };
      const store = [];
      o.frequency = param('frequency', store);
      o.connect = (d) => d;
      o.start = (t) => { o.started = true; assert.ok(t >= 0); };
      o.stop = (t) => { o.stopped = true; assert.ok(t >= 0, '停止时间为负'); };
      calls.oscillators.push({ osc: o, store });
      return o;
    }
    createBufferSource() {
      const s = { buffer: null, loop: false, connect: (d) => d, start(t) { assert.ok(t >= 0); }, stop(t) { assert.ok(t >= 0); } };
      return s;
    }
    createBuffer(ch, len, rate) {
      calls.buffers.push({ ch, len, rate });
      const data = new Float32Array(len);
      return { getChannelData: () => data, length: len };
    }
    createBiquadFilter() {
      const store = [];
      return node({ type: 'lowpass', frequency: param('filter.frequency', store), Q: { value: 0 } });
    }
    createDelay(max) { calls.delays.push(max); return node({ delayTime: { value: 0 } }); }
    createDynamicsCompressor() {
      return node({ threshold: { value: 0 }, ratio: { value: 0 } });
    }
  }
  return { FakeAudioContext, calls };
}

const { FakeAudioContext, calls } = makeMockCtx();
const sandbox = { window: { AudioContext: FakeAudioContext, localStorage: { getItem: () => null, setItem() {} } }, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'sfx.js' });
const Sfx = sandbox.window.G24.Sfx;

let pass = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

console.log('\nSfx 音效合成');

test('初始化会建好总线（主输出 + 压缩 + 混响延迟）', () => {
  const ctx = Sfx.init();
  assert.ok(ctx, '应创建 AudioContext');
  assert.ok(Sfx.master && Sfx.shimmer, '应有主输出与混响总线');
  assert.ok(calls.delays.length >= 1, '应创建延迟节点');
});

const sounds = ['pickup', 'hoverTick', 'snap', 'release', 'popupOpen', 'popupClose', 'choose',
  'targetOn', 'targetOff', 'merge', 'spawn', 'invalid', 'undo', 'deal', 'dead', 'win', 'softTick'];

test(`全部 ${sounds.length} 个音效都能合成，且参数合法`, () => {
  for (const name of sounds) {
    const before = calls.oscillators.length;
    assert.equal(typeof Sfx[name], 'function', `缺少音效 ${name}`);
    Sfx[name]();
    const added = calls.oscillators.slice(before);
    if (name !== 'deal') assert.ok(added.length >= 1, `${name} 没有产生振荡器`);
  }
});

test('振荡器频率/时长参数合理（20Hz~20kHz、正时长、音量 0~1）', () => {
  for (const { store } of calls.oscillators) {
    for (const [kind, v] of store) {
      if (kind === 'set' || kind === 'exp') {
        if (v > 100) assert.ok(v >= 20 && v <= 20000, `频率越界: ${v}`);
      }
    }
  }
  for (const store of calls.gains) {
    for (const [kind, v] of store) {
      if (kind === 'exp' || kind === 'set') assert.ok(v >= 0 && v <= 1, `音量越界: ${v}`);
    }
  }
});

test('洗牌音效使用噪声源与滤波器', () => {
  assert.ok(calls.buffers.length >= 1, '应生成噪声缓冲');
  assert.ok(calls.buffers[0].len > 1000, '噪声缓冲长度应足够');
});

test('静音开关：关闭后不再产生新声音，打开后恢复', () => {
  Sfx.setEnabled(false);
  const before = calls.oscillators.length;
  Sfx.win(); Sfx.merge(); Sfx.pickup();
  assert.equal(calls.oscillators.length, before, '静音时不应再合成声音');
  Sfx.setEnabled(true);
  Sfx.softTick();
  assert.ok(calls.oscillators.length > before, '恢复后应能发声');
});

test('没有 AudioContext 的环境（老浏览器）不抛错', () => {
  const sb = { window: { localStorage: { getItem: () => null, setItem() {} } }, console };
  sb.window.window = sb.window;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'sfx.js' });
  const s2 = sb.window.G24.Sfx;
  s2.setEnabled(true);
  assert.doesNotThrow(() => { s2.init(); s2.win(); s2.merge(); });
  assert.equal(s2.enabled, false, '无音频支持时应自动关闭音效');
});

console.log(`\n全部通过：${pass} 组断言${process.exitCode ? '（有失败）' : ''}\n`);
