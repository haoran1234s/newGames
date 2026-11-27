/**
 * 团子捞捞乐 v2 逻辑冒烟测试（Node 环境桩掉浏览器 API）
 * 用法：node test/smoke.js
 * 覆盖：菜单→选关→游玩循环→三消（含万能牌）→河豚爆炸→石头/时钟星→复活→过关→进度持久化
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ------------------------------ 浏览器环境桩 ------------------------------ */
const gradStub = { addColorStop() {} };
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradStub;
    return (...a) => undefined;
  },
  set() { return true; },
});
const canvasStub = {
  width: 0, height: 0, style: {},
  getContext: () => ctxStub,
  addEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 375, height: 667 }),
};
globalThis.document = {
  getElementById: () => canvasStub,
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }),  // 离屏背景画布
};
globalThis.window = globalThis;
globalThis.innerWidth = 375;
globalThis.innerHeight = 667;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.localStorage = {
  _m: {},
  getItem(k) { return this._m[k] ?? null; },
  setItem(k, v) { this._m[k] = String(v); },
};
class FakeGainParam { setValueAtTime() {} exponentialRampToValueAtTime() {} }
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.destination = {}; }
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: x => x, start() {}, stop() {} };
  }
  createGain() { return { gain: new FakeGainParam(), connect: x => x }; }
  resume() {}
};
let rafCb = null;
globalThis.requestAnimationFrame = cb => { rafCb = cb; };
globalThis.__rafGet = () => rafCb;   // 供 eval 内的测试驱动读取

/* ------------------------------ 加载游戏脚本 ------------------------------ */
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* ------------------------------ 测试驱动 --------------------------------- */
const driver = `
;(function test() {
  let fails = 0;
  const assert = (cond, msg) => {
    if (!cond) { console.error('  ✗ FAIL:', msg); fails++; }
    else console.log('  ✓', msg);
  };
  let now = 0;
  const pump = sec => {
    const steps = Math.ceil(sec * 60);
    for (let i = 0; i < steps; i++) {
      now += 16.7;
      const cb = __rafGet(); 
      if (cb) cb(now);
    }
  };
  pump(0.5);

  assert(game.scene === 'menu', '初始为菜单场景');
  onTap(187, 457);                       // 点击「开始游戏」
  pump(0.3);
  assert(game.scene === 'levels', '进入选关界面');
  onTap(62, 180);                        // 点击第 1 关
  pump(0.3);
  assert(game.scene === 'play', '进入第 1 关');
  assert(game.items.length >= 13, '关卡生成物品 ' + game.items.length + ' 个（12团子+1星星）');
  assert(game.timeLeft > 70, '倒计时初始化 ' + game.timeLeft.toFixed(1));

  // 真实游玩循环：放钩直到过关或超时失败
  let hits = 0, deliveries = 0, arrivals = 0, drops = 0, staleSlip = 0;
  const _oh = onHookHit; onHookHit = it => { hits++; _oh(it); };
  const _di = deliverItem; deliverItem = it => { deliveries++; _di(it); };
  const _ta = trayArrive; trayArrive = it => { arrivals++; _ta(it); };
  let guard = 0;
  while (game.scene === 'play' && guard++ < 80) {
    let g2 = 0;
    while (game.scene === 'play' && claw.state !== 'SWING' && g2++ < 800) pump(0.05);
    if (claw.state === 'SWING' && claw.slipAtY !== null) staleSlip++;   // 回到原位仍残留滑落标记 = bug
    if (game.scene !== 'play') break;
    pump(rand(0.15, 1.4));               // 模拟真人在摆动中择机点击
    if (game.scene !== 'play') break;
    onTap(100, 300);                     // 放钩
    drops++;
    pump(0.3);
  }
  pump(0.5);
  console.log('    链路统计：放钩 ' + drops + ' 次 → 命中 ' + hits + ' → 到顶投递 ' + deliveries + ' → 入槽 ' + arrivals);
  assert(game.scene === 'win' || game.scene === 'fail',
    '游玩循环正常结束于 ' + game.scene + '（80 钩内无崩溃）');
  console.log('    游玩统计：消除 ' + game.groupsDone + ' 组，得分 ' + game.score);
  assert(hits >= 5, '命中数 >= 5（池塘会枯竭，命中率随进程衰减属正常），实际 ' + hits);
  assert(arrivals >= 3, '入槽数 >= 3，实际 ' + arrivals);
  assert(game.groupsDone >= 1, '随机游玩至少自然消除 1 组（3类×3只抽7必出三），实际 ' + game.groupsDone);

  // 复活流程（若失败）
  if (game.scene === 'fail') {
    assert(!game.reviveUsed, '复活未使用');
    onTap(187, 411);                     // 点击复活按钮
    pump(0.3);
    assert(game.scene === 'play', '复活后回到游戏');
    assert(game.tray.every(s => s === null), '复活清空槽位');
    pump(2);                             // 让游戏继续跑一会
  }

  // --- 滑落标记残留（确定性复现）---
  // 构造：团子贴近水面 → 闭合时钩子很高；随机数固定为 0 → 必判滑落且滑落高度 = 闭合高度 - 60，
  // 该高度高于待机位置，上升途中永远到不了，旧代码会把标记残留到下一钩
  {
    startLevel(0);
    game.tutorT = 0;
    game.items = [new PondItem('cat', 187, 200, 18)];
    game.items[0].driftAmp = 0;
    const realRandom = Math.random;
    Math.random = () => 0;
    claw.swingT = 0; claw.x = 187; claw.state = 'DROP';
    let g = 0;
    while (claw.state !== 'SWING' && g++ < 400) pump(0.02);
    Math.random = realRandom;
    assert(claw.state === 'SWING', '构造场景：钩子已回到原位');
    assert(claw.slipAtY === null, '回到原位后滑落标记已清除，实际 ' + claw.slipAtY);
    // 下一钩空钩上升，末段不应出现颤抖减速
    game.items = [];
    claw.state = 'DROP';
    let trembled = false; g = 0;
    while (claw.state !== 'SWING' && g++ < 400) { pump(0.02); trembled = trembled || claw.tremble; }
    assert(!trembled, '后续空钩上升不出现莫名颤抖');
  }

  // --- 直接测试三消结算 ---
  checkGoal = () => {};   // 单元测试期间禁用关卡目标判定（避免误触过关结算）
  game.scene = 'play';
  game.tray = Array(7).fill(null);
  game.groupsDone = 0; game.combo = 0; game.score = 0;
  const mk = id => new PondItem(id, 0, 0, 20);
  game.tray[0] = mk('cat'); game.tray[1] = mk('cat');
  const c3 = mk('cat'); c3.slotIdx = 2; c3.state = 'deliver';
  trayArrive(c3);
  assert(game.groupsDone === 1, '三只奶猫消除 1 组');
  assert(game.tray.every(s => s === null), '消除后槽位清空');
  assert(game.score === 100, '普通组得分 100，实际 ' + game.score);

  // 万能牌补对
  game.tray[0] = mk('rabbit'); game.tray[1] = mk('rabbit'); game.tray[2] = mk('wild');
  const groups = resolveTray();
  assert(groups === 1, '兔子×2 + 万能团子消除 1 组');
  assert(game.score === 100 + 100, '万能组得分累计 200，实际 ' + game.score);

  // 连击倍率：combo=2 时消除得分 ×2
  game.combo = 2;
  game.tray = Array(7).fill(null);
  game.tray[0] = mk('bear'); game.tray[1] = mk('bear');
  const b3 = mk('bear'); b3.slotIdx = 2; b3.state = 'deliver';
  trayArrive(b3);
  assert(game.score === 200 + 300, '连击 x3 得分 300（combo先自增），实际 ' + game.score);

  // 河豚爆炸
  game.items = [];
  const pf = new PondItem('puffer', 150, 300, 20);
  const near = new PondItem('cat', 160, 310, 20);
  game.items.push(pf, near);
  const oldAx = near.ax;
  explodeAt(pf);
  assert(!game.items.includes(pf), '河豚爆炸后移除');
  assert(near.ax !== oldAx || near.ay !== 310, '冲击波推开邻近物品');

  // 石头/时钟星投递
  game.items = [];
  const rock = new PondItem('rock', 0, 0, 22);
  const star = new PondItem('star', 0, 0, 14);
  game.items.push(rock, star);
  const scoreBefore = game.score, timeBefore = game.timeLeft;
  deliverItem(rock);
  deliverItem(star);
  assert(game.score === scoreBefore + 10, '石头安慰分 +10');
  assert(game.timeLeft === timeBefore + 5, '时钟星 +5 秒');
  assert(game.items.length === 0, '石头和星星不残留');

  // 过关流程 + 进度持久化
  startLevel(0);
  game.timeLeft = 40;
  endWin();
  pump(0.5);
  assert(game.scene === 'win', '过关面板');
  assert(game.winStars === 3, '剩余时间充足获 3 星');
  assert(store.unlock === 2, '解锁第 2 关');
  assert((store.stars[0] || 0) === 3, '星级持久化');

  // 第 8 关高密度场景压测（独角兽/河豚×2/万能×2）
  startLevel(7);
  pump(1);
  assert(game.items.length > 30, '第 8 关生成 ' + game.items.length + ' 个物品');
  guard = 0;
  while (game.scene === 'play' && guard++ < 100) {
    let g2 = 0;
    while (game.scene === 'play' && claw.state !== 'SWING' && g2++ < 800) pump(0.05);
    if (claw.state === 'SWING' && claw.slipAtY !== null) staleSlip++;   // 回到原位仍残留滑落标记 = bug
    if (game.scene !== 'play') break;
    pump(rand(0.15, 1.4));
    if (game.scene !== 'play') break;
    onTap(100, 300);
    pump(0.3);
  }
  pump(0.5);
  assert(true, '第 8 关压测无崩溃，结束于 ' + game.scene);
  assert(staleSlip === 0, '钩子回到原位时不残留滑落标记（残留会导致后续每次上升末段莫名减速颤抖），残留次数 ' + staleSlip);

  console.log(fails === 0 ? '\\n✅ 全部通过' : '\\n❌ 失败 ' + fails + ' 项');
  if (fails > 0) throw new Error('smoke test failed');
})();
`;
eval(js + driver);
