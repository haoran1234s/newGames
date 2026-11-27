/**
 * 视觉截图工具：无头 Edge + CDP（零依赖，连接逻辑见 test/cdp.js）
 * 用法：先在 claw-machine-demo 目录起静态服务（python -m http.server 8321），再 node test/shots.js
 * 输出：test/shots/*.png（iPhone 12 尺寸 390×844 @2x）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { openPage, sleep } = require('./cdp');

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:8321/';
const OUT = path.join(__dirname, 'shots');

/** 场景脚本：每项在页面内执行 setup，等待 wait 毫秒后截图 */
const SCENES = [
  { name: '1-menu', wait: 600, setup: `localStorage.clear(); game.scene = 'menu';` },
  { name: '2-levels', wait: 500, setup: `
      localStorage.setItem('tt_unlock', '5');
      localStorage.setItem('tt_stars', JSON.stringify({ 0: 3, 1: 2, 2: 3, 3: 1 }));
      game.scene = 'levels';` },
  { name: '3-play-tutorial', wait: 900, setup: `startLevel(0);` },
  { name: '4-play-mid', wait: 1600, setup: `
      startLevel(5);
      game.tutorT = 0;
      const put = (i, id) => { const it = new PondItem(id, 0, 0, 20); it.state = 'tray'; game.tray[i] = it; game.items.push(it); };
      put(0, 'cat'); put(1, 'cat'); put(2, 'shiba');
      game.combo = 2; game.score = 860;
      claw.state = 'DROP'; claw.x = 150; claw.y = 200;` },
  { name: '5-play-danger', wait: 1200, setup: `
      startLevel(7);
      game.tutorT = 0;
      const put = (i, id) => { const it = new PondItem(id, 0, 0, 20); it.state = 'tray'; game.tray[i] = it; game.items.push(it); };
      ['rabbit', 'rabbit', 'bear', 'unicorn', 'wild', 'strawberry'].forEach((id, i) => put(i, id));
      game.timeLeft = 8.4;` },
  { name: '6-win', wait: 1800, setup: `
      startLevel(2); game.groupsDone = 6; game.maxCombo = 3; game.score = 1450; game.timeLeft = 50; endWin();` },
  { name: '7-fail', wait: 900, setup: `
      startLevel(3);
      const put = (i, id) => { const it = new PondItem(id, 0, 0, 20); it.state = 'tray'; game.tray[i] = it; game.items.push(it); };
      ['cat', 'rabbit', 'bear', 'cat', 'rabbit', 'shiba', 'strawberry'].forEach((id, i) => put(i, id));
      endFail('full');` },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await openPage(URL);
  try {
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
      console.log(`✓ ${sc.name}.png`);
    }
  } finally {
    page.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
