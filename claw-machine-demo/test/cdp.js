/**
 * 无头 Edge + Chrome DevTools Protocol 极简封装（Node 内置 WebSocket / fetch，零依赖）
 * 供 test/shots.js（截图回归）与 tools/export-sprites.js（素材导出）共用
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 建立 CDP 会话：send(method, params) 返回响应；页面异常直接打印到控制台 */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown')
      console.error('页面异常:', msg.params.exceptionDetails.exception?.description);
    // 设置环境变量 CDP_CONSOLE=1 时转发页面 console 输出
    if (process.env.CDP_CONSOLE && msg.method === 'Runtime.consoleAPICalled')
      console.log(`[页面 ${msg.params.type}]`, msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

/**
 * 启动无头 Edge 并打开 url
 * @param {string} url 页面地址
 * @param {{ width?: number, height?: number, dpr?: number, port?: number }} opts 视口参数
 * @returns {Promise<{ send: Function, evaluate: Function, close: Function }>}
 */
async function openPage(url, { width = 390, height = 844, dpr = 2, port = 9333 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find(t => t.type === 'page');
    } catch { /* 调试端口尚未就绪 */ }
  }
  if (!target) { edge.kill(); throw new Error('Edge 调试端口未就绪'); }
  const c = connect(target.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Page.navigate', { url });
  await sleep(1200);
  /** 在页面内执行表达式并按值返回结果；页面抛错时抛出 */
  const evaluate = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description ?? ex.text);
    return r.result?.result?.value;
  };
  return {
    send: c.send,
    evaluate,
    close: () => { c.close(); edge.kill(); },
  };
}

module.exports = { openPage, sleep };
