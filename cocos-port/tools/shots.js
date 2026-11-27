/**
 * Cocos 版截图（与 claw-machine-demo/test/shots.js 的 7 个场景一一对应，便于逐张对比）
 * 用法：先构建（node tools/build.js），再起静态服务：
 *       python -m http.server 8323 --directory build/web-mobile
 *       node tools/shots.js
 * 输出：tools/shots/*.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { openPage, sleep } = require('../../claw-machine-demo/test/cdp');

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:8323/';
const OUT = path.join(__dirname, 'shots');

/** 在页面里往槽位放团子（PondItem 构造函数从现有物品上取） */
const PUT = `const PI = __game.items[0].constructor;
  const put = (i, id) => { const it = new PI(id, 0, 0, 20); it.state = 'tray'; __game.tray[i] = it; __game.items.push(it); };`;

const SCENES = [
  { name: '1-menu', wait: 700, setup: `localStorage.clear(); __game.goMenu();` },
  { name: '2-levels', wait: 600, setup: `
      localStorage.setItem('tt_unlock', '5');
      localStorage.setItem('tt_stars', JSON.stringify({ 0: 3, 1: 2, 2: 3, 3: 1 }));
      __game.goLevels();` },
  { name: '3-play-tutorial', wait: 900, setup: `__view.startLevel(0);` },
  { name: '4-play-mid', wait: 1600, setup: `
      __view.startLevel(5); __game.tutorT = 0; ${PUT}
      put(0, 'cat'); put(1, 'cat'); put(2, 'shiba');
      __game.combo = 2; __game.score = 860;
      Object.assign(__game.claw, { state: 'DROP', x: 150, y: 200 });` },
  { name: '5-play-danger', wait: 1200, setup: `
      __view.startLevel(7); __game.tutorT = 0; ${PUT}
      ['rabbit', 'rabbit', 'bear', 'unicorn', 'wild', 'strawberry'].forEach((id, i) => put(i, id));
      __game.timeLeft = 8.4;` },
  { name: '6-win', wait: 1800, setup: `
      __view.startLevel(2); Object.assign(__game, { groupsDone: 6, maxCombo: 3, score: 1450, timeLeft: 50 });
      __game.endWin();` },
  { name: '7-fail', wait: 900, setup: `
      __view.startLevel(3); ${PUT}
      ['cat', 'rabbit', 'bear', 'cat', 'rabbit', 'shiba', 'strawberry'].forEach((id, i) => put(i, id));
      __game.endFail('full');` },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await openPage(URL);
  try {
    // 等引擎启动、素材加载完成
    // 线上首次加载可能较慢（国内访问 GitHub Pages），最多等 60 秒
    for (let i = 0; i < 240; i++) {
      if (await page.evaluate('!!globalThis.__game')) break;
      await sleep(250);
    }
    for (const sc of SCENES) {
      try {
        await page.evaluate(`(() => { ${sc.setup} })()`);
      } catch (e) {
        console.error(`✗ ${sc.name} setup 报错:`, e.message);
        continue;
      }
      await sleep(sc.wait);
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${sc.name}.png`), Buffer.from(shot.result.data, 'base64'));
      const dc = await page.evaluate('globalThis.cc?.director?.root?.device?.numDrawCalls ?? -1');
      console.log(`✓ ${sc.name}.png  draw calls: ${dc}`);
    }
  } finally {
    page.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
