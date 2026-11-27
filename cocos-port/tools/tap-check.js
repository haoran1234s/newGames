/**
 * 真实点击冒烟测试：用 CDP 模拟手指点击，走一遍 菜单 → 选关 → 放钩 → 入槽
 * 用法：python -m http.server 8323 --directory build/web-mobile，然后 node tools/tap-check.js
 */
'use strict';
const { openPage, sleep } = require('../../claw-machine-demo/test/cdp');

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:8323/';
const VW = 390, VH = 844;

(async () => {
  const p = await openPage(URL, { width: VW, height: VH, dpr: 2 });
  let fails = 0;
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails++; };
  try {
    for (let i = 0; i < 60 && !(await p.evaluate('!!globalThis.__game')); i++) await sleep(250);
    await p.evaluate('localStorage.clear(); __game.goMenu()');
    // SHOW_ALL：375×667 等比缩放到视口宽度，垂直居中
    const k = VW / 375, top = (VH - 667 * k) / 2;
    const tap = async (x, y) => {
      const point = { x: x * k, y: top + y * k };
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(400);
    };
    const ev = expr => p.evaluate(expr);

    await tap(187.5, 457);
    check(await ev('__game.scene') === 'levels', '点「开始游戏」进入选关');
    await tap(250, 340);
    check(await ev('__game.scene') === 'levels', '点未解锁的第 7 关没有反应');
    await tap(62, 180);
    check(await ev('__game.scene') === 'play', '点第 1 关进入游戏');
    await sleep(300);
    await tap(187, 400);
    check(['DROP', 'CLOSE', 'RISE'].includes(await ev('__game.claw.state')), '点屏幕放钩');
    // 多放几钩，确认会有团子入槽
    for (let i = 0; i < 6 && (await ev('__game.tray.filter(Boolean).length + __game.groupsDone')) === 0; i++) {
      for (let g = 0; g < 40 && (await ev('__game.claw.state')) !== 'SWING'; g++) await sleep(100);
      await sleep(300 + i * 170);
      await tap(187, 400);
    }
    await sleep(1500);
    const progress = await ev('__game.tray.filter(Boolean).length + __game.groupsDone');
    check(progress > 0, `团子成功入槽（槽位 + 已消除组数 = ${progress}）`);
  } finally {
    p.close();
  }
  console.log(fails ? `\n❌ 失败 ${fails} 项` : '\n✅ 点击流程全部通过');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
