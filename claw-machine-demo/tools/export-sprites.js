/**
 * 素材导出（路线 B）：复用 index.html 现有绘制函数，把每个元素单独画到透明画布，
 * 自动裁掉透明边后存为 PNG，并生成 manifest.json（尺寸、锚点、基准半径），供 Cocos 工程直接使用。
 *
 * 用法：在 claw-machine-demo 目录起静态服务（python -m http.server 8321），然后
 *       node tools/export-sprites.js
 * 输出：../cocos-port/assets/resources/art/{atlas|screen}/<分类>/<名称>.png 与 manifest.json
 *       atlas/ 下有 Cocos 自动图集配置（art.pac），构建时打成一张图集以便合批
 *
 * 约定：
 *  - 导出倍率 K=3（对应 3 倍屏），manifest 中 w/h 为像素，left/top 为逻辑坐标
 *  - 团子/物品按基准半径 REF_R 绘制，Cocos 中节点缩放 = 实际半径 / REF_R
 *  - anchorX/anchorY 为 Cocos 锚点（y 轴向上），即「绘制原点」在裁剪后图片中的位置
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { openPage } = require('../test/cdp');

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:8321/';
const OUT = path.resolve(__dirname, '../../cocos-port/assets/resources/art');
const K = 3;
const REF_R = 20;
/** 全屏尺寸的大图：单独成图，不进自动图集（图集上限 2048） */
const SCREEN_SPRITES = ['bg/paper', 'pond/frame'];

/** 页面内注入：导出器 + 素材清单（全部调用游戏现有绘制函数） */
const PAGE_SCRIPT = String.raw`(() => {
  window.requestAnimationFrame = () => 0;   // 停掉游戏主循环，独占主画布
  const realRandom = Math.random;
  Math.random = () => 0.5;                  // 消除绘制里的随机抖动（rand(a,b) 取中值）
  const K = ${K}, R = ${REF_R}, BOX = 240;
  const out = document.createElement('canvas');

  /** 绘制并自动裁边；mode=center 以 BOX 中心为原点，mode=screen 直接用游戏坐标 */
  window.__shoot = (draw, mode) => {
    const screen = mode === 'screen';
    const W = screen ? CONFIG.W : BOX, H = screen ? CONFIG.H : BOX;
    const ox = screen ? 0 : W / 2, oy = screen ? 0 : H / 2;
    canvas.width = W * K; canvas.height = H * K;      // 重置画布即清空
    ctx.setTransform(K, 0, 0, K, ox * K, oy * K);
    ctx.save(); draw(); ctx.restore();
    const cw = canvas.width, ch = canvas.height;
    const { data } = ctx.getImageData(0, 0, cw, ch);
    // 逐像素扫描非透明包围盒（一次性离线工具，此处传统循环出于性能考虑）
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] > 2) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error('空白素材');
    const pad = 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(cw - 1, x1 + pad); y1 = Math.min(ch - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    out.width = w; out.height = h;
    const o = out.getContext('2d');
    o.clearRect(0, 0, w, h);
    o.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
    return {
      data: out.toDataURL('image/png').slice('data:image/png;base64,'.length),
      w, h,
      anchorX: +((ox * K - x0) / w).toFixed(4),
      anchorY: +(1 - (oy * K - y0) / h).toFixed(4),
      left: +(x0 / K - ox).toFixed(3),
      top: +(y0 / K - oy).toFixed(3),
      touchesEdge: !screen && (x0 === 0 || y0 === 0 || x1 === cw - 1 || y1 === ch - 1),
    };
  };

  /** 可复现的伪随机（纸张颗粒用，保证每次导出一致） */
  const seeded = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** 让石头头顶的「z」透明度归零（z 单独导出做动画） */
  const hideZ = ph => (((0.9999 - ph) % 1 + 1) % 1) / 0.6;
  /** 团子数据：去掉稀有度，闪光单独导出 */
  const doll = (id, r, blink) => ({ type: { ...ITEMS[id], rarity: 'common' }, typeId: id, r, blink });

  const specs = [];
  const add = (name, draw, meta = {}, mode = 'center') => specs.push({ name, draw, meta, mode });
  const ids = ['cat', 'rabbit', 'bear', 'strawberry', 'shiba', 'unicorn', 'wild'];
  // 表情变体：key → [表情, blink 参数]；blink=0.05 时闭眼
  const FACE = {
    normal: ['normal', 1], blink: ['normal', 0.05], happy: ['happy', 1], shock: ['shock', 1],
    worried: ['worried', 1], 'worried-blink': ['worried', 0.05],
  };

  // 1) 池塘里的团子：基准半径 R、描边 2px
  ids.forEach(id => ['normal', 'blink', 'happy', 'shock'].forEach(k => {
    const [face, blink] = FACE[k];
    add('dolls/' + id + '-' + k, () => drawDoll(doll(id, R, blink), { lw: LW, face }), { refR: R });
  }));
  // 2) 槽位/吸拢动画里的团子：显示半径 SLOT_R，描边按显示尺寸保持 2px
  ids.forEach(id => ['normal', 'blink', 'worried', 'worried-blink', 'happy'].forEach(k => {
    const [face, blink] = FACE[k];
    add('dolls-tray/' + id + '-' + k, () => drawDoll(doll(id, R, blink), { lw: LW * R / SLOT_R, face }),
      { refR: R, displayR: SLOT_R });
  }));
  // 3) 界面里的大团子：按原尺寸导出，描边与现版一致
  [
    ['ui/menu-cat-happy', 'cat', 50, 'happy'],
    ['ui/menu-rabbit-normal', 'rabbit', 28, 'normal'], ['ui/menu-rabbit-blink', 'rabbit', 28, 'blink'],
    ['ui/menu-bear-normal', 'bear', 28, 'normal'], ['ui/menu-bear-blink', 'bear', 28, 'blink'],
    ['ui/levels-bear-normal', 'bear', 26, 'normal'], ['ui/levels-bear-blink', 'bear', 26, 'blink'],
    ['ui/levels-cat-happy', 'cat', 20, 'happy'],
    ['ui/fail-rabbit-worried', 'rabbit', 38, 'worried'], ['ui/fail-rabbit-shock', 'rabbit', 38, 'shock'],
  ].forEach(([name, id, r, k]) => {
    const [face, blink] = FACE[k];
    add(name, () => drawDoll(doll(id, r, blink), { face }), { refR: r });
  });
  // 4) 障碍物与道具
  [0, 2.1, 4.2].forEach((ph, i) => add('items/rock-' + i, () => {
    game.pondT = hideZ(ph);
    drawRock({ r: R, phase: ph, rot: 0 });
  }, { refR: R, phase: ph }));
  add('items/rock-z', () => label('z', 0, 0, { size: Math.max(9, R * 0.5), weight: 800, color: PAL.ink2 }), { refR: R });
  add('items/puffer', () => { game.pondT = 0; drawPuffer({ r: R, phase: 0 }); }, { refR: R, note: '呼吸缩放 1±0.08' });
  add('items/clock', () => { game.pondT = 0; drawClockItem({ r: R }, { glow: false }); }, { refR: R, note: '摇摆 ±0.08rad' });
  add('fx/clock-glow', () => {
    ctx.beginPath(); ctx.arc(0, 0, R * 1.15 * 1.7, 0, 7);
    ctx.fillStyle = 'rgba(255,231,168,0.55)'; ctx.fill();
  }, { refR: R, note: '半径 (1.7±0.15)×1.15r 呼吸' });
  // 5) 特效
  add('fx/shadow', () => {
    ctx.beginPath(); ctx.ellipse(0, R * 0.95, R * 0.85, R * 0.22, 0, 0, 7);
    ctx.fillStyle = 'rgba(46,127,115,0.18)'; ctx.fill();
  }, { refR: R, note: '池塘物品的水中投影，原点 = 物品中心' });
  add('fx/sparkle-coral', () => sparkle(0, 0, 8, PAL.coral), { refSize: 8 });
  add('fx/sparkle-gold', () => sparkle(0, 0, 8, '#F6C453'), { refSize: 8 });
  add('fx/heart', () => {
    heartPath(8);
    ctx.fillStyle = PAL.coral; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = PAL.line; ctx.stroke();
  }, { refSize: 8 });
  // 6) 钩子（拆成部件，Cocos 中钩臂绕钩头中心旋转：角度 = ±(0.25 + 张开度 × 0.75)）
  add('claw/carriage', () => {
    const ry = CONFIG.railY; CONFIG.railY = 0;
    drawCarriage(0);
    CONFIG.railY = ry;
  }, { note: '原点 = 滑轨中线' });
  add('claw/arm-left', () => drawClawArm(-1, 0), { note: '原点 = 钩头中心' });
  add('claw/arm-right', () => drawClawArm(1, 0), { note: '原点 = 钩头中心' });
  ['normal', 'sweat', 'stun'].forEach(f => add('claw/head-' + f, () => drawClawHead(f)));
  add('claw/rail', () => drawRail(), {}, 'screen');
  // 7) 池塘
  add('pond/frame', () => drawPondFrame(), { note: '静态：木框 + 渐变水体 + 叶子' }, 'screen');
  add('pond/wave', () => {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    wavePath(-20, 0); ctx.stroke();
  }, { note: '单段波纹宽 40，三行分别以 14/20/26 px/s 平移' });
  // 8) 纸张背景（点阵 + 固定种子颗粒）
  add('bg/paper', () => {
    Math.random = seeded(42);
    const s0 = SCALE; SCALE = K; bgCache = null; buildBackground();
    ctx.drawImage(bgCache.c, 0, 0, CONFIG.W, CONFIG.H);
    SCALE = s0; bgCache = null;
    Math.random = () => 0.5;
  }, {}, 'screen');

  window.__specs = specs;
  window.__restoreRandom = () => { Math.random = realRandom; };
  return specs.length;
})()`;

(async () => {
  const page = await openPage(URL, { width: 400, height: 700, dpr: 1 });
  try {
    const total = await page.evaluate(PAGE_SCRIPT);
    const sprites = {};
    const warnings = [];
    for (let i = 0; i < total; i++) {
      const r = await page.evaluate(`(() => {
        const s = __specs[${i}];
        return { name: s.name, meta: s.meta, ...__shoot(s.draw, s.mode) };
      })()`);
      const big = SCREEN_SPRITES.includes(r.name);
      const file = `${big ? 'screen' : 'atlas'}/${r.name}.png`;
      fs.mkdirSync(path.join(OUT, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
      const { data, name, meta, touchesEdge, ...geo } = r;
      if (touchesEdge) warnings.push(`${name} 触到导出画布边缘，可能被裁切`);
      sprites[name] = { file, ...geo, ...meta };
    }
    const manifest = {
      generatedFrom: 'claw-machine-demo/index.html',
      scale: K,
      refR: REF_R,
      count: total,
      sprites,
    };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`✓ 导出 ${total} 张素材 → ${OUT}`);
    warnings.forEach(w => console.warn('⚠', w));
  } finally {
    page.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
