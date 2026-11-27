/**
 * 视觉截图工具：无头 Edge + CDP（Node 内置 WebSocket，零依赖）
 * 用法：先在 claw-machine-demo 目录起静态服务（python -m http.server 8321），再 node test/shots.js
 * 输出：test/shots/*.png（iPhone 12 尺寸 390×844 @2x）
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:8321/';
const PORT = 9333;
const OUT = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

/** 极简 CDP 客户端 */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') console.error('页面异常:', msg.params.exceptionDetails.exception?.description);
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    // 等待调试端口就绪
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = list.find(t => t.type === 'page');
      } catch { /* 端口尚未就绪 */ }
    }
    if (!target) throw new Error('Edge 调试端口未就绪');
    const c = cdp(target.webSocketDebuggerUrl);
    await c.ready;
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Page.navigate', { url: URL });
    await sleep(1200);
    for (const sc of SCENES) {
      const r = await c.send('Runtime.evaluate', { expression: `(() => { ${sc.setup} return 'ok'; })()`, returnByValue: true });
      if (r.result?.exceptionDetails) {
        console.error(`✗ ${sc.name} setup 报错:`, r.result.exceptionDetails.exception?.description);
        continue;
      }
      await sleep(sc.wait);
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${sc.name}.png`), Buffer.from(shot.result.data, 'base64'));
      console.log(`✓ ${sc.name}.png`);
    }
    c.close();
  } finally {
    edge.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
