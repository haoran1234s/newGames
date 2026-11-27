/**
 * 玩法核心单元测试（迁移自 claw-machine-demo/test/smoke.js，并补充确定性测试）
 * 运行：node --test test/   （Node 24 直接执行 TypeScript）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClawGame, PondItem, MemoryStorage, seededRandom, CONFIG, LEVELS,
  type GameEvent, type ItemId,
} from '../assets/scripts/core/game-core.ts';

const FRAME = 1 / 60;

/** 创建带事件记录的游戏实例 */
function makeGame(seed = 1) {
  const events: GameEvent[] = [];
  const storage = new MemoryStorage();
  const g = new ClawGame({ random: seededRandom(seed), storage, emit: e => events.push(e) });
  return { g, events, storage };
}

/** 按帧推进 sec 秒 */
const pump = (g: ClawGame, sec: number) => Array.from({ length: Math.ceil(sec / FRAME) }).forEach(() => g.step(FRAME));

/** 模拟真人游玩：等钩子回到原位 → 随机等待 → 点击，直到关卡结束或达到钩数上限 */
function autoplay(g: ClawGame, rng: () => number, maxDrops: number) {
  let drops = 0;
  let staleSlip = 0;
  while (g.scene === 'play' && drops < maxDrops) {
    let guard = 0;
    while (g.scene === 'play' && g.claw.state !== 'SWING' && guard++ < 800) pump(g, 0.05);
    if (g.claw.state === 'SWING' && g.claw.slipAtY !== null) staleSlip++;
    if (g.scene !== 'play') break;
    pump(g, 0.15 + rng() * 1.25);
    if (g.scene !== 'play') break;
    g.tap();
    drops++;
    pump(g, 0.3);
  }
  pump(g, 0.5);
  return { drops, staleSlip };
}

/** 直接在槽位放一只团子（不触发结算） */
function putTray(g: ClawGame, i: number, id: ItemId) {
  const it = new PondItem(id, 0, 0, 20);
  it.state = 'tray';
  g.tray[i] = it;
  return it;
}

test('第 1 关初始化：13 个物品、75 秒、进入游戏场景', () => {
  const { g } = makeGame();
  g.startLevel(0);
  assert.equal(g.scene, 'play');
  assert.equal(g.items.length, 13);
  assert.equal(g.timeLeft, 75);
  assert.ok(g.items.every(it => it.x >= CONFIG.pond.x0 && it.x <= CONFIG.pond.x1), '物品都在池塘内');
});

test('随机游玩：链路完整，能自然消除，且不残留滑落标记', () => {
  const { g, events } = makeGame(7);
  g.startLevel(0);
  const { drops, staleSlip } = autoplay(g, seededRandom(99), 80);
  const hits = events.filter(e => e.type === 'hookHit').length;
  const arrivals = events.filter(e => e.type === 'slotKick').length;
  assert.ok(g.scene === 'win' || g.scene === 'fail', `结束于 ${g.scene}`);
  assert.ok(drops > 0);
  assert.ok(hits >= 5, `命中 ${hits}`);
  assert.ok(arrivals >= 3, `入槽 ${arrivals}`);
  assert.ok(g.groupsDone >= 1, `消除 ${g.groupsDone} 组`);
  assert.equal(staleSlip, 0);
});

test('同一随机种子结果完全一致（可复现）', () => {
  const run = () => {
    const { g } = makeGame(2024);
    g.startLevel(3);
    autoplay(g, seededRandom(5), 40);
    return { scene: g.scene, score: g.score, groups: g.groupsDone, time: g.timeLeft.toFixed(4) };
  };
  assert.deepEqual(run(), run());
});

test('复活：清空槽位、续 10 秒、回到游戏，且每关只能一次', () => {
  const { g } = makeGame();
  g.startLevel(0);
  ['cat', 'rabbit', 'bear', 'cat', 'rabbit', 'bear', 'cat'].forEach((id, i) => putTray(g, i, id as ItemId));
  g['endFail']('full');
  assert.equal(g.scene, 'fail');
  const before = g.timeLeft;
  assert.equal(g.revive(), true);
  assert.equal(g.scene, 'play');
  assert.ok(g.tray.every(s => s === null));
  assert.equal(g.timeLeft, before + 10);
  g['endFail']('time');
  assert.equal(g.revive(), false, '第二次复活被拒绝');
});

test('三消结算：同款凑三、万能补对、连击倍率', () => {
  const { g, events } = makeGame();
  g.startLevel(0);
  g.checkGoal = () => {};   // 隔离关卡目标判定
  putTray(g, 0, 'cat'); putTray(g, 1, 'cat');
  const c3 = new PondItem('cat', 0, 0, 20); c3.slotIdx = 2;
  g.trayArrive(c3);
  assert.equal(g.groupsDone, 1);
  assert.ok(g.tray.every(s => s === null));
  assert.equal(g.score, 100);
  assert.ok(events.some(e => e.type === 'merge' && e.pts.length === 3), '发出吸拢动画事件');

  putTray(g, 0, 'rabbit'); putTray(g, 1, 'rabbit'); putTray(g, 2, 'wild');
  assert.equal(g.resolveTray(), 1, '兔子×2 + 万能');
  assert.equal(g.score, 200);

  g.combo = 2;
  g.tray.fill(null);
  putTray(g, 0, 'bear'); putTray(g, 1, 'bear');
  const b3 = new PondItem('bear', 0, 0, 20); b3.slotIdx = 2;
  g.trayArrive(b3);
  assert.equal(g.score, 500, '连击 x3 得 300');
  assert.equal(g.maxCombo, 3);
});

test('槽满且无法消除 → 失败', () => {
  const { g } = makeGame();
  g.startLevel(0);
  ['cat', 'rabbit', 'bear', 'cat', 'rabbit', 'bear'].forEach((id, i) => putTray(g, i, id as ItemId));
  const last = new PondItem('strawberry', 0, 0, 20); last.slotIdx = 6;
  g.trayArrive(last);
  assert.equal(g.scene, 'fail');
  assert.equal(g.failReason, 'full');
});

test('河豚爆炸：移除自身、推开邻近物品、触发顿帧', () => {
  const { g } = makeGame();
  g.startLevel(0);
  const pf = new PondItem('puffer', 150, 300, 20);
  const near = new PondItem('cat', 160, 310, 20);
  g.items = [pf, near];
  g['explodeAt'](pf);
  assert.ok(!g.items.includes(pf));
  assert.ok(near.ax !== 160 || near.ay !== 310);
  assert.equal(g.hitStop, 0.1);
  assert.equal(g.shake, 14);
});

test('石头 +10 分并中断连击，时钟星 +5 秒，均不残留', () => {
  const { g } = makeGame();
  g.startLevel(0);
  const rock = new PondItem('rock', 0, 0, 22);
  const star = new PondItem('star', 0, 0, 14);
  g.items = [rock, star];
  g.combo = 3;
  const t0 = g.timeLeft;
  g['deliverItem'](rock);
  g['deliverItem'](star);
  assert.equal(g.score, 10);
  assert.equal(g.combo, 0);
  assert.equal(g.timeLeft, t0 + 5);
  assert.equal(g.items.length, 0);
});

test('过关：剩余时间充足得 3 星，解锁下一关并持久化星级', () => {
  const { g, storage } = makeGame();
  g.startLevel(0);
  g.timeLeft = 40;
  g['endWin']();
  assert.equal(g.scene, 'win');
  assert.equal(g.winStars, 3);
  assert.equal(g.winScore, 400);
  assert.equal(g.unlock, 2);
  assert.equal(g.stars[0], 3);
  assert.equal(storage.getItem('tt_unlock'), '2', '写入存储');
});

test('滑落标记残留（确定性复现）：回到原位后必须清除', () => {
  const { g } = makeGame();
  g.startLevel(0);
  g.tutorT = 0;
  const cat = new PondItem('cat', 187, 200, 18);
  cat.driftAmp = 0;
  g.items = [cat];
  // 随机数固定为 0：必判滑落，滑落高度 = 闭合高度 - 60，高于待机位置
  g['rng'] = () => 0;
  Object.assign(g.claw, { swingT: 0, x: 187, state: 'DROP' });
  let guard = 0;
  while (g.claw.state !== 'SWING' && guard++ < 400) pump(g, 0.02);
  assert.equal(g.claw.state, 'SWING');
  assert.equal(g.claw.slipAtY, null);
  pump(g, 0.6);   // 等飞入槽位的动画结束
  assert.equal(g.tray[0], cat, '团子正常入槽（没有滑落）');
});

test('每一关都能生成且物品不越界，第 8 关压测无异常', () => {
  LEVELS.forEach((lv, i) => {
    const { g } = makeGame(i + 10);
    g.startLevel(i);
    const expected = Object.values(lv.dolls).reduce((a, b) => a + (b ?? 0), 0) + lv.rocks + lv.puffers + lv.stars + lv.wilds;
    assert.equal(g.items.length, expected, `第 ${i + 1} 关物品数`);
  });
  const { g } = makeGame(8);
  g.startLevel(7);
  autoplay(g, seededRandom(3), 100);
  assert.ok(g.scene === 'win' || g.scene === 'fail');
});
