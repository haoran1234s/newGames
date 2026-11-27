/**
 * 表现层：逐函数移植自 claw-machine-demo/index.html 的绘制代码（数值保持一致）
 *  - 团子 / 障碍物 / 道具 / 钩子 / 池框 / 背景：使用导出的精灵（art/manifest.json）
 *  - 卡片、按钮、HUD、槽位、星星、粒子、冲击圈等纯色矢量：通过 Ctx2D 兼容层绘制
 *  - 特效状态（粒子、飘字、涟漪、吸拢动画……）由核心事件驱动，只影响画面不影响玩法
 */
import type { Ctx2D, TextOpts } from './ctx2d';
import { CONFIG, LEVELS, ITEMS, slotX } from '../core/game-core';
import type { ClawGame, PondItem, GameEvent, ItemId, MergePoint, SceneName } from '../core/game-core';
import { PAL, CONFETTI, REF_R, SLOT_R, MERGE_T } from './theme';
import { Sfx, buzz } from './audio';

/* ------------------------------ 缓动与工具 ------------------------------ */
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInCubic = (t: number) => t * t * t;
const easeOutBack = (t: number) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
/** 阻尼弹簧：t 为事件发生后的秒数 */
const spring = (t: number, amp = 0.25) => amp * Math.exp(-7 * t) * Math.cos(22 * t);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const LW = 2;
/** 系统「减少动态效果」 */
const REDUCED = (() => {
  try {
    const mm = (globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
    return mm?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch { return false; }
})();

/** 团子主体色（复活时的纸屑颜色，与原型 ITEMS.body 一致） */
const DOLL_BODY: Partial<Record<ItemId, string>> = {
  cat: '#FFF3E4', rabbit: '#CFCBE0', bear: '#DCEEFF', strawberry: '#FFB7C9', shiba: '#F7B24A', unicorn: '#E8D5FF',
};

/* ------------------------------ 特效实体 ------------------------------ */
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; shape: 'rect' | 'heart'; size: number; spin: number }
interface FloatText { x: number; y: number; text: string; color: string; size: number; life: number }
interface Ring { x: number; y: number; maxR: number; color: string; width: number; life: number; maxLife: number }
interface Ripple { x: number; y: number; life: number; maxLife: number }
interface Trail { x: number; y: number; life: number }
interface Bubble { x: number; y: number; r: number; vy: number; ph: number }
interface Merge { pts: MergePoint[]; cx: number; cy: number; mult: number; t: number; done: boolean }
/** 物品的挤压回弹计时与闪白 */
interface ItemFx { sqT: number; flash: number }

/** 按钮（坐标与原型完全一致，点击判定共用） */
export interface Button { x: number; y: number; w: number; h: number; label: string; icon?: 'tv' }
export const BTN: Record<string, Button> = {
  start: { x: CONFIG.W / 2 - 90, y: 430, w: 180, h: 54, label: '开始游戏' },
  levelsBack: { x: CONFIG.W / 2 - 70, y: 560, w: 140, h: 44, label: '返回' },
  next: { x: CONFIG.W / 2 - 90, y: 400, w: 180, h: 50, label: '下一关' },
  retry: { x: CONFIG.W / 2 - 90, y: 462, w: 180, h: 44, label: '重玩本关' },
  winMenu: { x: CONFIG.W / 2 - 90, y: 516, w: 180, h: 40, label: '选关' },
  revive: { x: CONFIG.W / 2 - 90, y: 386, w: 180, h: 50, label: '看广告复活', icon: 'tv' },
  failRetry: { x: CONFIG.W / 2 - 90, y: 448, w: 180, h: 44, label: '重新开始' },
  failMenu: { x: CONFIG.W / 2 - 90, y: 502, w: 180, h: 40, label: '选关' },
};
/** 选关圆钮中心 */
export const levelButtonCenter = (i: number): [number, number] => [62 + (i % 4) * 84, 180 + Math.floor(i / 4) * 130];

/** 原型 label() 的参数形态 */
type LabelOpts = TextOpts;

export class Renderer {
  readonly sfx = new Sfx();
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private ripples: Ripple[] = [];
  private trail: Trail[] = [];
  private bubbles: Bubble[] = [];
  private merges: Merge[] = [];
  private slotKick: number[] = Array(CONFIG.traySlots).fill(9);
  private itemFx = new WeakMap<PondItem, ItemFx>();
  private sceneT = 0;
  private prevScene: SceneName = 'menu';
  private displayScore = 0;
  private prevTipY = 0;

  constructor(private readonly ctx: Ctx2D, private readonly game: ClawGame) {}

  /* ============================ 事件 → 特效 ============================ */
  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'sfx': this.sfx.play(e.name, e.arg); break;
      case 'buzz': buzz(e.ms); break;
      case 'burst': {
        const presets: Record<string, [string | string[], number, 'rect' | 'heart']> = {
          puffer: [['#F6C453', '#E9A93A', '#FFFFFF'], 26, 'rect'],
          clock: [[PAL.butter, '#FFD873', '#FFFFFF'], 14, 'rect'],
          land: ['#FFFFFF', 5, 'rect'],
          winConfetti: [CONFETTI, 30, 'rect'],
          winHearts: [PAL.coral, 12, 'heart'],
          revive: [(e.item && DOLL_BODY[e.item.typeId]) ?? '#FFFFFF', 8, 'rect'],
        };
        const [color, n, shape] = presets[e.preset];
        this.burst(e.x, e.y, color, n, shape);
        break;
      }
      case 'ring':
        if (e.preset === 'puffer') this.addRing(e.x, e.y, 110, PAL.danger, 6);
        else this.addRing(e.x, e.y, 40, '#F6C453');
        break;
      case 'ripple': this.addRipple(e.x, e.y); break;
      case 'text': {
        const styles: Record<string, [string, number]> = {
          score: [PAL.scoreInk, 18], scoreBig: [PAL.scoreInk, 22], combo: [PAL.ink, 15],
          rock: [PAL.ink2, 14], time: [PAL.timeInk, 20], boom: [PAL.danger, 24],
        };
        const [color, size] = styles[e.style];
        this.texts.push({ x: e.x, y: e.y, text: e.text, color, size, life: 1.1 });
        break;
      }
      case 'hookHit': this.fxOf(e.item).sqT = 0; this.fxOf(e.item).flash = 0.1; break;
      case 'slotKick': this.slotKick[e.idx] = 0; break;
      case 'merge': this.merges.push({ pts: e.pts, cx: e.cx, cy: e.cy, mult: e.mult, t: 0, done: false }); break;
      case 'scene': break;
    }
  }

  /** 新开一关时调用：清空残留特效（原型在 startLevel 中重置；复活不调用） */
  resetLevelFx(): void {
    this.particles = []; this.texts = []; this.rings = []; this.ripples = [];
    this.trail = []; this.bubbles = []; this.merges = [];
    this.slotKick = Array(CONFIG.traySlots).fill(9);
    this.displayScore = 0;
  }

  private fxOf(it: PondItem): ItemFx {
    let fx = this.itemFx.get(it);
    if (!fx) { fx = { sqT: 9, flash: 0 }; this.itemFx.set(it, fx); }
    return fx;
  }

  private burst(x: number, y: number, color: string | string[], n: number, shape: 'rect' | 'heart' = 'rect'): void {
    this.particles.push(...Array.from({ length: n }, () => {
      const a = rand(0, Math.PI * 2), s = rand(60, 240);
      const life = rand(0.6, 1.3);
      return {
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life, maxLife: life,
        color: Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color,
        shape, size: rand(3, 7), spin: rand(0, 3),
      };
    }));
  }
  private addRing(x: number, y: number, maxR: number, color: string, width = 4): void {
    this.rings.push({ x, y, maxR, color, width, life: 0.45, maxLife: 0.45 });
  }
  private addRipple(x: number, y: number): void {
    this.ripples.push({ x, y, life: 0.7, maxLife: 0.7 });
  }

  /* ============================== 更新 ============================== */
  /**
   * @param raw 真实帧间隔（视觉层特效）
   * @param logicDt 含顿帧缩放的逻辑时间（粒子、飘字与原型一致，在顿帧时一起放慢）
   */
  update(raw: number, logicDt: number): void {
    const g = this.game;
    // 场景切换计时（面板弹出、星星依次出现）
    if (g.scene !== this.prevScene) { this.prevScene = g.scene; this.sceneT = 0; }
    const prevT = this.sceneT;
    this.sceneT += raw;
    if (g.scene === 'win') {
      Array.from({ length: g.winStars }, (_, k) => 0.3 + k * 0.22).forEach((th, k) => {
        if (prevT < th && this.sceneT >= th) {
          this.sfx.play('starPop', k);
          this.burst(CONFIG.W / 2 + (k - 1) * 72, 222, CONFETTI, 12);
          buzz(12);
        }
      });
    }
    // 分数滚动
    this.displayScore += (g.score - this.displayScore) * Math.min(1, raw * 12);
    if (Math.abs(g.score - this.displayScore) < 0.5) this.displayScore = g.score;
    this.slotKick = this.slotKick.map(t => t + raw);
    g.items.forEach(it => { const fx = this.fxOf(it); fx.sqT += raw; fx.flash = Math.max(0, fx.flash - raw); });
    // 凑三吸拢 → 完成时爆开
    this.merges.forEach(m => {
      m.t += raw;
      if (!m.done && m.t >= MERGE_T) {
        m.done = true;
        this.burst(m.cx, m.cy, CONFETTI, 16);
        this.burst(m.cx, m.cy, PAL.coral, 7, 'heart');
        this.addRing(m.cx, m.cy, 46 + m.mult * 6, PAL.coral);
        this.sfx.play('eliminate', m.mult);
        g.hitStop = Math.max(g.hitStop, 0.07);
        g.shake = Math.max(g.shake, 3 + m.mult);
        buzz(30);
      }
    });
    this.merges = this.merges.filter(m => !m.done);
    this.rings.forEach(r => { r.life -= raw; });
    this.rings = this.rings.filter(r => r.life > 0);
    this.ripples.forEach(r => { r.life -= raw; });
    this.ripples = this.ripples.filter(r => r.life > 0);
    // 钩尖拖尾 + 入水涟漪
    const claw = g.claw;
    const tipY = claw.y + CONFIG.hookLen;
    if (g.scene === 'play' && claw.state === 'DROP') {
      this.trail.push({ x: claw.x, y: tipY, life: 0.22 });
      if (this.prevTipY < CONFIG.pond.y0 && tipY >= CONFIG.pond.y0) {
        this.addRipple(claw.x, CONFIG.pond.y0 + 2);
        this.sfx.play('splash');
      }
    }
    this.prevTipY = tipY;
    this.trail.forEach(p => { p.life -= raw; });
    this.trail = this.trail.filter(p => p.life > 0);
    // 池底气泡
    const P = CONFIG.pond;
    if (g.scene === 'play' && Math.random() < raw * 1.4)
      this.bubbles.push({ x: rand(P.x0 + 12, P.x1 - 12), y: P.y1 - 6, r: rand(2, 4), vy: rand(14, 26), ph: rand(0, 6) });
    this.bubbles.forEach(b => { b.y -= b.vy * raw; b.ph += raw * 3; });
    this.bubbles = this.bubbles.filter(b => b.y > P.y0 + 6);
    // 粒子 / 飘字（原型在逻辑 update 中推进，顿帧时一起放慢）
    this.particles.forEach(p => {
      p.vy += 500 * logicDt;
      p.x += p.vx * logicDt; p.y += p.vy * logicDt;
      p.life -= logicDt; p.spin += logicDt * 6;
    });
    this.particles = this.particles.filter(p => p.life > 0);
    this.texts.forEach(t => { t.y -= 32 * logicDt; t.life -= logicDt; });
    this.texts = this.texts.filter(t => t.life > 0);
  }

  /* ============================== 绘制 ============================== */
  render(): void {
    const { ctx, game } = this;
    ctx.begin();
    ctx.save();
    const shake = game.shake * (REDUCED ? 0.3 : 1);
    if (shake > 0) ctx.translate(rand(-0.5, 0.5) * shake, rand(-0.5, 0.5) * shake);
    ctx.spriteAt('bg/paper');
    if (game.scene === 'menu') this.drawMenu();
    else if (game.scene === 'levels') this.drawLevelSelect();
    else {
      ctx.spriteAt('pond/frame');
      this.drawPondWater();
      ctx.spriteAt('claw/rail');
      this.drawTrail();
      [...game.items].sort((a, b) => a.y - b.y).forEach(it => this.drawItem(it));
      this.drawClaw();
      this.drawTray();
      this.drawMerges();
      this.drawRings();
      this.particles.forEach(p => this.drawParticle(p));
      this.drawHUD();
      this.texts.forEach(t => this.drawFloatText(t));
      if (game.slipBanner > 0) this.drawSlipBanner();
      if (game.tutorT > 0 && game.scene === 'play') this.drawTutor();
      if (game.scene === 'win') this.drawWinPanel();
      if (game.scene === 'fail') this.drawFailPanel();
    }
    ctx.restore();
    ctx.end();
  }

  /* ---------------------------- 绘制基础工具 ---------------------------- */
  private label(text: string, x: number, y: number, o: LabelOpts = {}): void {
    this.ctx.text(text, x, y, { color: PAL.ink, ...o });
  }
  private fillStroke(fill: string, lw = LW): void {
    const { ctx } = this;
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.strokeStyle = PAL.line; ctx.stroke();
  }
  /** 带实色错位投影的圆角卡片 */
  private card(x: number, y: number, w: number, h: number, r: number, fill: string = PAL.paper, shadowY = 4): void {
    const { ctx } = this;
    ctx.roundRect(x, y + shadowY, w, h, r);
    ctx.fillStyle = PAL.shadow; ctx.fill();
    ctx.roundRect(x, y, w, h, r);
    this.fillStroke(fill);
  }
  /** 和纸胶带 */
  private washiTape(cx: number, cy: number, w: number, h: number, rot: number, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.88;
    ctx.fillStyle = color; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = a * 0.3;
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2;
    Array.from({ length: Math.floor(w / 9) }, (_, i) => -w / 2 + 5 + i * 9).forEach(x => {
      ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x - 5, h / 2); ctx.stroke();
    });
    ctx.restore();
  }
  private starPath(cx: number, cy: number, r: number, inner = 0.5): void {
    const { ctx } = this;
    ctx.beginPath();
    Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * inner : r;
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    }).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }
  private heartPath(s: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.75);
    ctx.bezierCurveTo(-s * 1.1, 0, -s * 0.55, -s * 0.9, 0, -s * 0.3);
    ctx.bezierCurveTo(s * 0.55, -s * 0.9, s * 1.1, 0, 0, s * 0.75);
    ctx.closePath();
  }
  private iconLock(cx: number, cy: number, s: number): void {
    const { ctx } = this;
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.2, s * 0.4, Math.PI, 0);
    ctx.lineWidth = 2.5; ctx.strokeStyle = PAL.ink2; ctx.stroke();
    ctx.roundRect(cx - s * 0.58, cy - s * 0.2, s * 1.16, s * 0.9, 4);
    ctx.fillStyle = PAL.ink2; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy + s * 0.2, s * 0.13, 0, 7);
    ctx.fillStyle = PAL.paper; ctx.fill();
  }
  private iconTv(cx: number, cy: number, s: number, color: string): void {
    const { ctx } = this;
    ctx.roundRect(cx - s, cy - s * 0.72, s * 2, s * 1.44, 4);
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.3, cy - s * 0.38); ctx.lineTo(cx + s * 0.45, cy); ctx.lineTo(cx - s * 0.3, cy + s * 0.38);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  /* ------------------------------ 团子精灵 ------------------------------ */
  /**
   * 在当前变换原点画团子（替代原型 drawDoll）
   * @param set 素材组：dolls 池塘 / dolls-tray 槽位与吸拢 / 直接给出 ui 素材名
   */
  private drawDoll(d: { typeId: ItemId; r: number; blink: number }, face: 'normal' | 'happy' | 'worried' | 'shock', set: 'dolls' | 'dolls-tray'): void {
    const { ctx } = this;
    const blinking = d.blink % 3 < 0.12 && (face === 'normal' || face === 'worried');
    const key = face === 'normal' ? (blinking ? 'blink' : 'normal') : face === 'worried' ? (blinking ? 'worried-blink' : 'worried') : face;
    ctx.sprite(`${set}/${d.typeId}-${key}`, { scale: d.r / REF_R });
    this.drawRareSparkles(d.typeId, d.r);
  }
  /** 稀有 / 传说闪光（导出素材时去掉了，这里按原型逻辑做呼吸） */
  private drawRareSparkles(id: ItemId, r: number): void {
    const rarity = ITEMS[id].rarity;
    if (rarity !== 'rare' && rarity !== 'legend') return;
    const { ctx } = this;
    const name = rarity === 'legend' ? 'fx/sparkle-gold' : 'fx/sparkle-coral';
    [[-r * 1.15, -r * 0.65], [r * 1.18, -r * 0.1]].forEach(([sx, sy], i) => {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(this.game.pondT * 2.5 + i * 1.7));
      ctx.translate(sx, sy);
      ctx.sprite(name, { scale: r * 0.2 / 8 });
      ctx.restore();
    });
  }
  /** 界面里的大团子（按原尺寸导出的 ui/ 素材） */
  private drawUiDoll(name: string, blink?: number): void {
    const useBlink = blink !== undefined && blink % 3 < 0.12;
    this.ctx.sprite(useBlink ? name.replace(/-normal$/, '-blink') : name);
  }

  /* ------------------------------ 池塘 ------------------------------ */
  private drawPondWater(): void {
    const { ctx, game } = this;
    const P = CONFIG.pond, w = P.x1 - P.x0, h = P.y1 - P.y0;
    ctx.pushClip(P.x0, P.y0 - 6, w, h + 12);
    // 波纹：单段素材宽 40，原点在段中心
    [0.28, 0.55, 0.8].forEach((frac, li) => {
      const baseY = P.y0 + h * frac;
      const off = (game.pondT * (14 + li * 6)) % 90;
      Array.from({ length: 6 }, (_, k) => P.x0 - 90 + k * 90 + off + li * 30).forEach(x0 => {
        ctx.save(); ctx.translate(x0 + 20, baseY); ctx.sprite('pond/wave'); ctx.restore();
      });
    });
    this.bubbles.forEach(b => {
      ctx.beginPath(); ctx.arc(b.x + Math.sin(b.ph) * 3, b.y, b.r, 0, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    });
    this.ripples.forEach(r => {
      const k = 1 - r.life / r.maxLife;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, 8 + k * 34, 3 + k * 9, 0, 0, 7);
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.globalAlpha = 1;
    });
    ctx.popClip();
  }

  private drawTrail(): void {
    const { ctx } = this;
    this.trail.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 * (p.life / 0.22) + 1, 0, 7);
      ctx.fillStyle = `rgba(255,255,255,${(p.life / 0.22 * 0.8).toFixed(3)})`; ctx.fill();
    });
  }

  /* ------------------------------ 钩子 ------------------------------ */
  private drawClaw(): void {
    const { ctx, game } = this;
    const claw = game.claw;
    const x = claw.x + (claw.tremble ? rand(-1.6, 1.6) : 0), y = claw.y;
    ctx.save(); ctx.translate(x, CONFIG.railY); ctx.sprite('claw/carriage'); ctx.restore();
    // 缆绳
    ctx.beginPath(); ctx.moveTo(x, CONFIG.railY + 7); ctx.lineTo(x, y);
    ctx.lineWidth = 2; ctx.strokeStyle = PAL.line; ctx.lineCap = 'butt'; ctx.stroke();
    ctx.save();
    ctx.translate(x, y + 8);
    const spread = 0.25 + claw.openAngle * 0.75;
    [-1, 1].forEach(s => {
      ctx.save(); ctx.rotate(s * spread); ctx.sprite(s < 0 ? 'claw/arm-left' : 'claw/arm-right'); ctx.restore();
    });
    const stun = claw.state === 'STUN';
    ctx.sprite(`claw/head-${stun ? 'stun' : claw.tremble ? 'sweat' : 'normal'}`);
    if (stun) {
      [0, 1, 2].forEach(k => {
        const a = game.pondT * 6 + k * 2.1;
        ctx.save(); ctx.translate(Math.cos(a) * 15, -15 + Math.sin(a) * 4); ctx.sprite('fx/sparkle-gold', { scale: 3.5 / 8 }); ctx.restore();
      });
    }
    ctx.restore();
  }

  /* ------------------------------ 物品 ------------------------------ */
  private drawItem(it: PondItem): void {
    if (it.state === 'gone' || it.state === 'tray') return;
    const { ctx, game } = this;
    const fx = this.fxOf(it);
    ctx.save();
    ctx.translate(it.x, it.y);
    const s = it.state === 'deliver' ? 1 + (SLOT_R / it.r - 1) * easeOutCubic(clamp01(it.dt)) : 1;
    const q = spring(fx.sqT, 0.26);
    // 水中投影用精灵（与团子同一张图集，整个池塘可以合批）
    if (it.state === 'pond') ctx.sprite('fx/shadow', { scale: it.r / REF_R });
    const sway = it.state === 'hooked' ? Math.sin(game.pondT * 5) * 0.09
      : it.rot * 0.4 + Math.sin(game.pondT * it.driftSpd + it.phase) * 0.06;
    ctx.rotate(sway);
    ctx.scale(s * (1 + q), s * (1 - q));
    const k = it.type.kind;
    if (k === 'doll' || k === 'wild') {
      const face = it.state === 'falling' ? 'shock' : (it.state === 'hooked' || it.state === 'deliver') ? 'happy' : 'normal';
      this.drawDoll(it, face, 'dolls');
    } else if (k === 'rock') this.drawRock(it);
    else if (k === 'puffer') {
      ctx.sprite('items/puffer', { scale: it.r / REF_R * (1 + 0.08 * Math.sin(game.pondT * 4 + it.phase)) });
    } else if (k === 'star') this.drawClockItem(it);
    if (fx.flash > 0) {
      ctx.beginPath(); ctx.arc(0, 0, it.r * 1.05, 0, 7);
      ctx.globalAlpha = clamp01(fx.flash / 0.1) * 0.75;
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** 石头：3 种形状按相位选取 + 飘起的 z */
  private drawRock(it: PondItem): void {
    const { ctx, game } = this;
    const variant = Math.min(2, Math.floor(((it.phase % 6.28) + 6.28) % 6.28 / 6.28 * 3));
    ctx.sprite(`items/rock-${variant}`, { scale: it.r / REF_R });
    const zt = (game.pondT * 0.6 + it.phase) % 1;
    ctx.save();
    ctx.globalAlpha = 1 - zt;
    ctx.translate(it.r * 0.85, -it.r * (0.7 + zt * 0.6));
    ctx.sprite('items/rock-z', { scale: Math.max(9, it.r * 0.5) / (REF_R * 0.5) });
    ctx.restore();
  }

  /** 时钟星：光晕呼吸 + 闹钟摇摆 */
  private drawClockItem(it: PondItem): void {
    const { ctx, game } = this;
    const k = it.r / REF_R;
    ctx.sprite('fx/clock-glow', { scale: k * (1.7 + 0.15 * Math.sin(game.pondT * 3)) / 1.7 });
    ctx.save();
    ctx.rotate(Math.sin(game.pondT * 9) * 0.08);
    ctx.sprite('items/clock', { scale: k });
    ctx.restore();
  }

  /* ------------------------------ 槽位 ------------------------------ */
  private drawTray(): void {
    const { ctx, game } = this;
    const filled = game.tray.filter(Boolean).length;
    const danger = filled >= 5 && (game.scene === 'play' || game.scene === 'fail');
    const pulse = danger ? 0.5 + 0.5 * Math.sin(game.pondT * (filled >= 6 ? 10 : 5)) : 0;
    const top = CONFIG.trayY - 31, h = 62;
    this.card(10, top, CONFIG.W - 20, h, 18, PAL.honey, 4);
    if (danger) {
      ctx.roundRect(10, top, CONFIG.W - 20, h, 18);
      ctx.globalAlpha = 0.45 + 0.55 * pulse;
      ctx.lineWidth = 2.5 + pulse * 2; ctx.strokeStyle = PAL.danger; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const tagW = 54;
    this.card(CONFIG.W - 24 - tagW, top - 15, tagW, 22, 11, danger ? PAL.danger : PAL.paper, 2);
    this.label(`${filled} / ${CONFIG.traySlots}`, CONFIG.W - 24 - tagW / 2, top - 4,
      { size: 12, weight: 800, color: danger ? '#FFFFFF' : PAL.ink });
    const counts = game.tray.reduce<Record<string, number>>((m, it) => {
      if (it) m[it.typeId] = (m[it.typeId] ?? 0) + 1;
      return m;
    }, {});
    game.tray.forEach((it, i) => {
      const cx = slotX(i), cy = CONFIG.trayY;
      const pairHint = !!it && it.typeId !== 'wild' && counts[it.typeId] === 2;
      ctx.roundRect(cx - 20, cy - 21, 40, 42, 11);
      ctx.fillStyle = pairHint ? PAL.butter : PAL.paper; ctx.fill();
      ctx.lineWidth = it ? 2 : 1.6; ctx.strokeStyle = it ? PAL.line : 'rgba(107,74,58,0.45)';
      if (!it) ctx.setLineDash([4, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      if (!it) return;
      const s = SLOT_R / it.r;
      const b = spring(this.slotKick[i], 0.3);
      ctx.save();
      ctx.translate(cx, cy + 3);
      ctx.scale(s * (1 + b), s * (1 - b));
      this.drawDoll(it, danger ? 'worried' : 'normal', 'dolls-tray');
      ctx.restore();
    });
  }

  private drawMerges(): void {
    const { ctx } = this;
    this.merges.forEach(m => {
      const k = easeInCubic(clamp01(m.t / MERGE_T));
      m.pts.forEach(p => {
        const s = SLOT_R / p.item.r * (1 + 0.25 * k);
        ctx.save();
        ctx.translate(p.x + (m.cx - p.x) * k, p.y + (m.cy - p.y) * k - Math.sin(k * Math.PI) * 10);
        ctx.scale(s, s);
        this.drawDoll(p.item, 'happy', 'dolls-tray');
        ctx.restore();
      });
    });
  }
  private drawRings(): void {
    const { ctx } = this;
    this.rings.forEach(r => {
      const k = 1 - r.life / r.maxLife;
      ctx.beginPath(); ctx.arc(r.x, r.y, 8 + easeOutCubic(k) * r.maxR, 0, 7);
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = r.width * (1 - k) + 1; ctx.strokeStyle = r.color; ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }
  private drawParticle(p: Particle): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = clamp01(p.life / p.maxLife * 1.6);
    ctx.translate(p.x, p.y); ctx.rotate(p.spin);
    if (p.shape === 'heart') {
      this.heartPath(p.size * 1.1);
      ctx.fillStyle = p.color; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = PAL.line; ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
    }
    ctx.restore();
  }
  private drawFloatText(t: FloatText): void {
    const { ctx } = this;
    const age = 1.1 - t.life;
    const s = 0.55 + 0.45 * easeOutBack(clamp01(age / 0.2));
    ctx.save();
    ctx.globalAlpha = clamp01(t.life * 1.8);
    ctx.translate(t.x, t.y); ctx.scale(s, s);
    this.label(t.text, 0, 0, { size: t.size, weight: 800, color: t.color, outline: PAL.paper });
    ctx.restore();
  }

  /* ------------------------------- HUD ------------------------------- */
  private drawHUD(): void {
    const { ctx, game } = this;
    const lv = LEVELS[game.levelIdx];
    this.card(12, 12, CONFIG.W - 24, 80, 18);
    ctx.beginPath(); ctx.arc(46, 52, 23, 0, 7); this.fillStroke(PAL.coral);
    this.label('第', 46, 39, { size: 9, weight: 700, color: PAL.btnInk });
    this.label(String(game.levelIdx + 1), 46, 55, { size: 20, weight: 800, color: PAL.btnInk });
    const isGroups = lv.goal.type === 'groups';
    const cur = isGroups ? game.groupsDone : Math.round(this.displayScore);
    const ratio = clamp01(cur / lv.goal.n);
    this.label(isGroups ? '目标  凑齐三只消除' : '目标  拿到分数', 82, 31, { size: 12, weight: 600, color: PAL.ink2, align: 'left' });
    this.label(`${Math.min(cur, lv.goal.n)} / ${lv.goal.n}`, 262, 31, { size: 12, weight: 800, color: PAL.ink, align: 'right' });
    ctx.roundRect(82, 43, 180, 14, 7); ctx.fillStyle = PAL.track; ctx.fill();
    if (ratio > 0) { ctx.roundRect(82, 43, Math.max(14, 180 * ratio), 14, 7); ctx.fillStyle = PAL.mintDeep; ctx.fill(); }
    ctx.roundRect(82, 43, 180, 14, 7); ctx.lineWidth = LW; ctx.strokeStyle = PAL.line; ctx.stroke();
    if (isGroups) {
      ctx.strokeStyle = 'rgba(107,74,58,0.35)'; ctx.lineWidth = 1.2;
      Array.from({ length: lv.goal.n - 1 }, (_, k) => 82 + 180 * (k + 1) / lv.goal.n).forEach(x => {
        ctx.beginPath(); ctx.moveTo(x, 46); ctx.lineTo(x, 54); ctx.stroke();
      });
    }
    this.label(`分数 ${Math.round(this.displayScore)}`, 82, 74, { size: 12, weight: 700, color: PAL.ink2, align: 'left' });
    if (game.combo > 1) this.label(`连击 x${game.combo}`, 262, 74, { size: 12, weight: 800, color: PAL.scoreInk, align: 'right' });
    // 倒计时环
    const tr = clamp01(game.timeLeft / lv.time);
    const urgent = game.timeLeft <= 10;
    const tc = urgent ? PAL.danger : PAL.timeInk;
    const pulse = urgent ? 1 + 0.08 * Math.max(0, Math.sin(game.pondT * 12)) : 1;
    ctx.save();
    ctx.translate(322, 52); ctx.scale(pulse, pulse);
    ctx.beginPath(); ctx.arc(0, 0, 25, 0, 7); ctx.fillStyle = PAL.paper; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = PAL.track; ctx.stroke();
    if (tr > 0) {
      ctx.beginPath(); ctx.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * tr);
      ctx.lineCap = 'round'; ctx.strokeStyle = urgent ? PAL.danger : PAL.mintDeep; ctx.stroke();
    }
    this.label(String(Math.ceil(game.timeLeft)), 0, -1, { size: 18, weight: 800, color: tc });
    this.label('秒', 0, 14, { size: 9, weight: 700, color: PAL.ink2 });
    ctx.restore();
  }

  private drawSlipBanner(): void {
    const { ctx, game } = this;
    ctx.save();
    ctx.globalAlpha = clamp01(game.slipBanner * 2);
    this.card(40, 166, CONFIG.W - 80, 58, 16);
    this.washiTape(CONFIG.W / 2, 166, 70, 14, 0.04, PAL.butter);
    this.label('哎呀，独角兽滑走了', CONFIG.W / 2, 189, { size: 15, weight: 800 });
    this.label('激励视频点位：看广告可稳住钩子', CONFIG.W / 2, 209, { size: 11, weight: 600, color: PAL.ink2 });
    ctx.restore();
  }

  private drawTutor(): void {
    const { ctx, game } = this;
    const lv = LEVELS[game.levelIdx];
    const first = game.levelIdx === 0;
    const title = first ? '看准时机，点击屏幕放钩' : (lv.tip ?? `第 ${game.levelIdx + 1} 关 · 加油`);
    const sub = first ? '凑齐 3 只同款自动消除，7 格放满就输' : (lv.goal.type === 'groups' ? `目标：消除 ${lv.goal.n} 组` : `目标：拿到 ${lv.goal.n} 分`);
    ctx.save();
    ctx.globalAlpha = clamp01(game.tutorT * 2);
    const y = 176 + (1 - easeOutCubic(clamp01((3.5 - game.tutorT) * 4))) * -8;
    this.card(44, y, CONFIG.W - 88, 50, 25);
    this.label(title, CONFIG.W / 2, y + 18, { size: 14, weight: 800 });
    this.label(sub, CONFIG.W / 2, y + 36, { size: 11, weight: 600, color: PAL.ink2 });
    ctx.restore();
  }

  /* ------------------------------- 界面 ------------------------------- */
  private drawButton(b: Button, primary = true): void {
    const { ctx } = this;
    const r = b.h / 2;
    ctx.roundRect(b.x, b.y + 4, b.w, b.h, r); ctx.fillStyle = PAL.shadow; ctx.fill();
    ctx.roundRect(b.x, b.y, b.w, b.h, r); this.fillStroke(primary ? PAL.coral : PAL.paper);
    if (primary) {
      ctx.roundRect(b.x + 12, b.y + 6, b.w - 24, b.h * 0.28, b.h * 0.14);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();
    }
    const color = primary ? PAL.btnInk : PAL.ink;
    if (b.icon === 'tv') {
      this.iconTv(b.x + b.w / 2 - 48, b.y + b.h / 2, 9, color);
      this.label(b.label, b.x + b.w / 2 + 12, b.y + b.h / 2 + 1, { size: 16, weight: 800, color });
    } else {
      this.label(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, { size: primary ? 17 : 14, weight: 800, color });
    }
  }

  private drawMenu(): void {
    const { ctx, game } = this;
    const t = game.pondT;
    const bob = (ph: number, amp = 6) => (REDUCED ? 0 : Math.sin(t * 2 + ph) * amp);
    const dolls: [number, number, string, number, number][] = [
      [95, 232, 'ui/menu-rabbit-normal', 28, 1.2], [282, 230, 'ui/menu-bear-normal', 28, 2.4], [187, 192, 'ui/menu-cat-happy', 50, 0],
    ];
    dolls.forEach(([x, y, name, r, ph]) => {
      ctx.save();
      ctx.translate(x, y + bob(ph));
      const q = REDUCED ? 0 : Math.sin(t * 4 + ph) * 0.03;
      ctx.scale(1 + q, 1 - q);
      ctx.beginPath(); ctx.ellipse(0, r * 1.02 - bob(ph), r * 0.8, r * 0.16, 0, 0, 7);
      ctx.fillStyle = 'rgba(107,74,58,0.12)'; ctx.fill();
      this.drawUiDoll(name, name.endsWith('-happy') ? undefined : t + r);
      ctx.restore();
    });
    ctx.roundRect(CONFIG.W / 2 - 98, 292, 196, 14, 7);
    ctx.fillStyle = PAL.butter; ctx.fill();
    this.label('团子捞捞乐', CONFIG.W / 2, 290, { size: 38, weight: 800 });
    this.label('钩子捞团子 · 凑齐三只就消除', CONFIG.W / 2, 334, { size: 14, weight: 600, color: PAL.ink2 });
    this.label('8 个池塘关卡 · 小心石头和河豚', CONFIG.W / 2, 356, { size: 13, weight: 600, color: PAL.ink2 });
    this.drawButton(BTN.start);
    this.label('Cocos 版 · 数值与原型一致', CONFIG.W / 2, CONFIG.H - 22, { size: 11, weight: 600, color: PAL.ink2 });
  }

  private drawLevelSelect(): void {
    const { ctx, game } = this;
    this.washiTape(CONFIG.W / 2, 66, 120, 22, -0.03, PAL.coral);
    this.label('选择池塘', CONFIG.W / 2, 92, { size: 24, weight: 800 });
    this.label('收集星星，解锁下一关', CONFIG.W / 2, 120, { size: 12, weight: 600, color: PAL.ink2 });
    const stars = game.stars;
    const unlock = game.unlock;
    LEVELS.forEach((_, i) => {
      const [cx, baseY] = levelButtonCenter(i);
      const isNext = i === unlock - 1 && !stars[i];
      const cy = baseY + (isNext && !REDUCED ? Math.sin(game.pondT * 4) * 3 : 0);
      const unlocked = i < unlock;
      ctx.beginPath(); ctx.arc(cx, cy + 4, 32, 0, 7); ctx.fillStyle = PAL.shadow; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 32, 0, 7);
      if (unlocked) {
        this.fillStroke(PAL.coral);
        ctx.beginPath(); ctx.ellipse(cx - 10, cy - 14, 9, 5, -0.5, 0, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
        this.label(String(i + 1), cx, cy + 1, { size: 24, weight: 800, color: PAL.btnInk });
      } else {
        ctx.fillStyle = PAL.paper; ctx.fill();
        ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(107,74,58,0.5)'; ctx.stroke();
        ctx.setLineDash([]);
        this.iconLock(cx, cy, 14);
      }
      const s = stars[i] ?? 0;
      [-1, 0, 1].forEach((o, k) => {
        this.starPath(cx + o * 17, cy + 50 - (o === 0 ? 3 : 0), 7.5);
        ctx.fillStyle = k < s ? PAL.gold : PAL.paper; ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = k < s ? PAL.line : 'rgba(107,74,58,0.35)'; ctx.stroke();
      });
    });
    const decor: [number, number, string, number, boolean][] = [
      [78, 488, 'ui/levels-bear-normal', 26, true], [120, 496, 'ui/levels-cat-happy', 20, false],
    ];
    decor.forEach(([x, y, name, r, blinks]) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath(); ctx.ellipse(0, r * 1.0, r * 0.8, r * 0.15, 0, 0, 7);
      ctx.fillStyle = 'rgba(107,74,58,0.12)'; ctx.fill();
      this.drawUiDoll(name, blinks ? game.pondT + r : undefined);
      ctx.restore();
    });
    this.drawButton(BTN.levelsBack, false);
  }

  /** 面板弹出：遮罩淡入 + 卡片 ease-out-back 缩放 */
  private panelIn(cy: number): void {
    const { ctx } = this;
    const t = this.sceneT;
    ctx.fillStyle = `rgba(90,61,49,${(0.38 * clamp01(t / 0.2)).toFixed(3)})`;
    ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
    const pop = REDUCED ? 1 : easeOutBack(clamp01(t / 0.32));
    ctx.translate(CONFIG.W / 2, cy); ctx.scale(pop, pop); ctx.translate(-CONFIG.W / 2, -cy);
  }

  private drawWinPanel(): void {
    const { ctx, game } = this;
    const t = this.sceneT;
    ctx.save();
    this.panelIn(340);
    this.card(36, 120, CONFIG.W - 72, 456, 24);
    this.washiTape(CONFIG.W / 2, 122, 110, 24, -0.04, PAL.coral);
    this.label('过关啦', CONFIG.W / 2, 170, { size: 28, weight: 800 });
    const starsDef: [number, number, number][] = [[-72, 230, 26], [0, 218, 34], [72, 230, 26]];
    starsDef.forEach(([dx, y, r], k) => {
      const x = CONFIG.W / 2 + dx;
      this.starPath(x, y, r);
      ctx.fillStyle = PAL.track; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(107,74,58,0.35)'; ctx.stroke();
      if (k >= game.winStars) return;
      const s = easeOutBack(clamp01((t - 0.3 - k * 0.22) / 0.25));
      if (s <= 0) return;
      ctx.save();
      ctx.translate(x, y); ctx.scale(s, s);
      this.starPath(0, 0, r);
      this.fillStroke(PAL.gold, 2.2);
      ctx.beginPath(); ctx.ellipse(-r * 0.2, -r * 0.25, r * 0.16, r * 0.09, -0.6, 0, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
      ctx.restore();
    });
    const shown = Math.round(game.winScore * easeOutCubic(clamp01((t - 0.35) / 0.8)));
    this.label('本关得分', CONFIG.W / 2, 276, { size: 12, weight: 600, color: PAL.ink2 });
    this.label(String(shown), CONFIG.W / 2, 304, { size: 32, weight: 800, color: PAL.scoreInk });
    this.label(`消除 ${game.groupsDone} 组 · 最高连击 x${game.maxCombo}`, CONFIG.W / 2, 338, { size: 13, weight: 700, color: PAL.ink });
    this.label('正式版此处展示「仅 X% 玩家通过」，驱动分享', CONFIG.W / 2, 364, { size: 11, weight: 600, color: PAL.ink2 });
    const isLast = game.levelIdx + 1 >= LEVELS.length;
    this.drawButton({ ...BTN.next, label: isLast ? '全部通关 · 再玩一次' : '下一关' });
    this.drawButton(BTN.retry, false);
    this.drawButton(BTN.winMenu, false);
    ctx.restore();
  }

  private drawFailPanel(): void {
    const { ctx, game } = this;
    ctx.save();
    this.panelIn(330);
    this.card(36, 120, CONFIG.W - 72, 436, 24);
    this.washiTape(CONFIG.W / 2, 122, 110, 24, 0.04, PAL.mintDeep);
    const full = game.failReason === 'full';
    this.label(full ? '槽位满啦' : '时间到啦', CONFIG.W / 2, 170, { size: 26, weight: 800 });
    this.label(full ? '7 个格子都放满了，没法凑成三只' : '只差一点点就达标了', CONFIG.W / 2, 200, { size: 13, weight: 600, color: PAL.ink2 });
    ctx.save();
    ctx.translate(CONFIG.W / 2, 272);
    ctx.sprite(full ? 'ui/fail-rabbit-worried' : 'ui/fail-rabbit-shock');
    ctx.restore();
    this.label('演示：复活按钮 = 激励视频点位（正式版接平台广告）', CONFIG.W / 2, 352, { size: 11, weight: 600, color: PAL.ink2 });
    if (!game.reviveUsed) this.drawButton(BTN.revive);
    this.drawButton(BTN.failRetry, false);
    this.drawButton(BTN.failMenu, false);
    ctx.restore();
  }
}
