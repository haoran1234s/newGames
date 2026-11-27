/** 命中率探针：打印第 1 关物品分布，并在不同 x 位置定点放钩统计命中 */
'use strict';
const fs = require('fs');
const path = require('path');

const gradStub = { addColorStop() {} };
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradStub;
    return () => undefined;
  },
  set() { return true; },
});
const canvasStub = {
  width: 0, height: 0, style: {},
  getContext: () => ctxStub, addEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 375, height: 667 }),
};
globalThis.document = {
  getElementById: () => canvasStub,
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }),  // 离屏背景画布
};
globalThis.window = globalThis;
globalThis.innerWidth = 375; globalThis.innerHeight = 667; globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); } };
class FakeGainParam { setValueAtTime() {} exponentialRampToValueAtTime() {} }
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.destination = {}; }
  createOscillator() { return { type: '', frequency: { value: 0 }, connect: x => x, start() {}, stop() {} }; }
  createGain() { return { gain: new FakeGainParam(), connect: x => x }; }
  resume() {}
};
let rafCb = null;
globalThis.requestAnimationFrame = cb => { rafCb = cb; };
globalThis.__rafGet = () => rafCb;

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const driver = `
;(function probe() {
  let now = 0;
  const pump = sec => {
    const steps = Math.ceil(sec * 60);
    for (let i = 0; i < steps; i++) { now += 16.7; const cb = __rafGet(); if (cb) cb(now); }
  };
  pump(0.3);
  startLevel(0);
  pump(0.5);

  console.log('=== 物品分布 ===');
  game.items.forEach(it => {
    console.log('  ' + it.typeId.padEnd(10) + ' x=' + it.ax.toFixed(0) + ' y=' + it.ay.toFixed(0) + ' r=' + it.r.toFixed(0) + ' 漂移±' + it.driftAmp.toFixed(0));
  });

  // 定点放钩实验：强制 claw.x 为指定值下落，统计命中
  console.log('=== 定点放钩命中实验（20 个 x 位置） ===');
  let totalHits = 0;
  for (let xi = 0; xi < 20; xi++) {
    const targetX = 70 + xi * 12;   // 70..298 覆盖摆动范围
    startLevel(0);                  // 重置关卡（物品重新随机）
    pump(0.3);
    // 等 SWING 后强制位置直接下落
    claw.state = 'DROP';
    claw.x = targetX;
    let hit = null;
    let g = 0;
    while (claw.state === 'DROP' && g++ < 500) {
      pump(0.016);
      if (claw.state === 'CLOSE') hit = claw.grabbed;
    }
    if (hit) { totalHits++; console.log('  x=' + targetX + ' → 命中 ' + hit.typeId); }
    else console.log('  x=' + targetX + ' → 空');
    pump(1.5);   // 让爪子升回去
  }
  console.log('定点命中率：' + totalHits + '/20');
})();
`;
eval(js + driver);
