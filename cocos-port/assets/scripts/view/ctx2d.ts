/**
 * Canvas 2D 兼容层：在 Cocos Graphics / Sprite / Label 之上实现原型用到的 Canvas 2D 子集，
 * 让 claw-machine-demo/index.html 的绘制代码几乎原样移植，保证画面 1:1。
 *
 * 实现方式（立即模式 → 节点池）：
 *  - 每帧 begin() 后按原型顺序调用绘制 API，end() 时回收未使用的节点
 *  - 矢量路径在 JS 侧按当前变换矩阵展平成折线，再交给 Graphics 填充/描边（因此支持虚线、任意变换）
 *  - 精灵、文字各用节点池，按调用顺序排列兄弟节点，保证与原型的画家算法一致的遮挡关系
 *  - 坐标统一使用原型坐标（左上原点、y 向下），输出时换算为 Cocos 坐标
 *
 * 不支持：渐变（原型里的渐变都已导出为精灵）、clip（改用 pushClip 矩形遮罩）
 */
import { Node, Graphics, Sprite, Label, UITransform, Layers, Color, Mask, SpriteFrame } from 'cc';

/** manifest.json 中单个素材的描述 */
export interface SpriteMeta {
  file: string; w: number; h: number; anchorX: number; anchorY: number;
  left: number; top: number; refR?: number; refSize?: number; displayR?: number;
}

/** 素材查询接口 */
export interface ArtSource {
  frame(name: string): SpriteFrame | null;
  meta(name: string): SpriteMeta | undefined;
  readonly scale: number;
}

/** 仿射矩阵 [a, b, c, d, e, f]：x' = a·x + c·y + e，y' = b·x + d·y + f */
type Mat = [number, number, number, number, number, number];

interface DrawState {
  m: Mat;
  alpha: number;
  fill: string;
  stroke: string;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  dash: number[];
}

/** 子路径：屏幕坐标点序列（原型坐标系） */
interface SubPath { pts: number[]; closed: boolean }

/** 文字参数（与原型 label() 一致） */
export interface TextOpts {
  size?: number; weight?: number; color?: string;
  align?: 'left' | 'center' | 'right'; outline?: string | null;
}

/** 精灵参数 */
export interface SpriteOpts {
  /** 额外的统一缩放（如 实际半径 / 基准半径） */
  scale?: number;
}

const TAU = Math.PI * 2;

/* ------------------------------ 颜色解析 ------------------------------ */
const colorCache = new Map<string, [number, number, number, number]>();
/** 解析 #RGB / #RRGGBB / #RRGGBBAA / rgba(r,g,b,a) 为 0..255 的 RGBA */
function parseColor(s: string): [number, number, number, number] {
  const hit = colorCache.get(s);
  if (hit) return hit;
  let out: [number, number, number, number] = [0, 0, 0, 255];
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.slice(1).split('').map(ch => ch + ch).join('') : s.slice(1);
    out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
      h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b, a = '1'] = m[1].split(',').map(v => v.trim());
      out = [+r, +g, +b, Math.round(parseFloat(a) * 255)];
    }
  }
  colorCache.set(s, out);
  return out;
}

const tmpColor = new Color();
/** 转为 cc.Color（返回共享临时对象，调用方须立即通过 setter 赋值） */
function ccColor(s: string, alpha: number): Color {
  const [r, g, b, a] = parseColor(s);
  return tmpColor.set(r, g, b, Math.round(a * alpha));
}

/* ------------------------------ 节点池 ------------------------------ */
/** 按种类复用节点；每帧按调用顺序取用 */
class Pool<T> {
  private items: T[] = [];
  private used = 0;
  constructor(private readonly create: () => T) {}
  take(): T {
    if (this.used >= this.items.length) this.items.push(this.create());
    return this.items[this.used++];
  }
  reset(): void { this.used = 0; }
  /** 本帧未使用的元素 */
  unused(): T[] { return this.items.slice(this.used); }
}

/**
 * Canvas 2D 兼容上下文
 */
export class Ctx2D {
  /** 设计分辨率（原型坐标 → Cocos 坐标换算用） */
  readonly W: number;
  readonly H: number;
  private readonly root: Node;
  private readonly art: ArtSource;

  private st: DrawState;
  private stack: DrawState[] = [];
  private path: SubPath[] = [];
  private cur: SubPath | null = null;

  /** 本帧按顺序排列的节点（决定遮挡关系） */
  private order: Node[] = [];
  /** 当前父节点栈（pushClip 时进入遮罩节点） */
  private parents: Node[] = [];
  /** 当前可继续追加矢量的 Graphics（被精灵/文字打断后需要新开一个） */
  private activeGfx: Graphics | null = null;

  private gfxPool: Pool<Graphics>;
  private spritePool: Pool<Sprite>;
  private labelPool: Pool<Label>;
  private clipPool: Pool<Node>;

  constructor(root: Node, art: ArtSource, W: number, H: number, fontFamily = 'sans-serif') {
    this.root = root;
    this.art = art;
    this.W = W; this.H = H;
    this.st = Ctx2D.defaultState();
    const mk = (name: string) => {
      const n = new Node(name);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform);
      return n;
    };
    this.gfxPool = new Pool(() => mk('gfx').addComponent(Graphics));
    this.spritePool = new Pool(() => {
      const s = mk('sprite').addComponent(Sprite);
      s.sizeMode = Sprite.SizeMode.CUSTOM;
      s.trim = false;
      return s;
    });
    this.labelPool = new Pool(() => {
      const l = mk('label').addComponent(Label);
      l.useSystemFont = true;
      l.fontFamily = fontFamily;
      l.overflow = Label.Overflow.NONE;
      l.cacheMode = Label.CacheMode.NONE;
      return l;
    });
    this.clipPool = new Pool(() => {
      const n = mk('clip');
      const mask = n.addComponent(Mask);
      mask.type = Mask.Type.GRAPHICS_RECT;
      return n;
    });
  }

  private static defaultState(): DrawState {
    return {
      m: [1, 0, 0, 1, 0, 0], alpha: 1, fill: '#000000', stroke: '#000000',
      lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', dash: [],
    };
  }

  /* ============================ 帧生命周期 ============================ */
  /** 开始一帧 */
  begin(): void {
    [this.gfxPool, this.spritePool, this.labelPool, this.clipPool].forEach(p => p.reset());
    this.order = [];
    this.parents = [this.root];
    this.activeGfx = null;
    this.st = Ctx2D.defaultState();
    this.stack = [];
    this.path = []; this.cur = null;
  }

  /** 结束一帧：隐藏未用节点，按调用顺序排列兄弟节点 */
  end(): void {
    this.gfxPool.unused().forEach(g => { g.clear(); g.node.active = false; });
    this.spritePool.unused().forEach(s => { s.node.active = false; });
    this.labelPool.unused().forEach(l => { l.node.active = false; });
    this.clipPool.unused().forEach(n => { n.active = false; });
    // 同一父节点下按出现顺序排列；顺序未变时 setSiblingIndex 不会产生开销
    const counters = new Map<Node, number>();
    this.order.forEach(n => {
      const parent = n.parent as Node;
      const idx = counters.get(parent) ?? 0;
      counters.set(parent, idx + 1);
      if (n.getSiblingIndex() !== idx) n.setSiblingIndex(idx);
    });
  }

  /** 把节点挂到当前父节点并登记顺序 */
  private attach(n: Node): void {
    const parent = this.parents[this.parents.length - 1];
    if (n.parent !== parent) n.setParent(parent);
    n.active = true;
    this.order.push(n);
  }

  /* ============================ 状态与变换 ============================ */
  save(): void { this.stack.push({ ...this.st, m: [...this.st.m] as Mat, dash: [...this.st.dash] }); }
  restore(): void { this.st = this.stack.pop() ?? Ctx2D.defaultState(); }

  translate(x: number, y: number): void {
    const m = this.st.m;
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
  }
  rotate(r: number): void {
    const [a, b, c, d] = this.st.m;
    const cs = Math.cos(r), sn = Math.sin(r);
    this.st.m[0] = a * cs + c * sn; this.st.m[1] = b * cs + d * sn;
    this.st.m[2] = c * cs - a * sn; this.st.m[3] = d * cs - b * sn;
  }
  scale(sx: number, sy: number): void {
    const m = this.st.m;
    m[0] *= sx; m[1] *= sx; m[2] *= sy; m[3] *= sy;
  }

  get globalAlpha(): number { return this.st.alpha; }
  set globalAlpha(v: number) { this.st.alpha = v; }
  set fillStyle(v: string) { this.st.fill = v; }
  set strokeStyle(v: string) { this.st.stroke = v; }
  set lineWidth(v: number) { this.st.lineWidth = v; }
  set lineCap(v: 'butt' | 'round' | 'square') { this.st.lineCap = v; }
  set lineJoin(v: 'miter' | 'round' | 'bevel') { this.st.lineJoin = v; }
  setLineDash(d: number[]): void { this.st.dash = [...d]; }

  /** 当前矩阵的平均缩放（线宽、采样精度用） */
  private matScale(): number {
    const [a, b, c, d] = this.st.m;
    return Math.sqrt(Math.abs(a * d - b * c)) || 1;
  }
  private tx(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.st.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  /* ============================== 路径 ============================== */
  beginPath(): void { this.path = []; this.cur = null; }

  /** 当前点与子路径起点（变换前坐标），曲线从当前点出发 */
  private last: [number, number] = [0, 0];
  private start: [number, number] = [0, 0];

  moveTo(x: number, y: number): void {
    this.cur = { pts: [...this.tx(x, y)], closed: false };
    this.path.push(this.cur);
    this.last = [x, y]; this.start = [x, y];
  }
  lineTo(x: number, y: number): void {
    if (!this.cur) { this.moveTo(x, y); return; }
    this.cur.pts.push(...this.tx(x, y));
    this.last = [x, y];
  }
  /** 闭合子路径，当前点回到起点（Canvas 语义） */
  closePath(): void {
    if (!this.cur) return;
    this.cur.closed = true;
    this.cur = null;
    this.last = [...this.start];
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const [x0, y0] = this.last;
    const n = this.segments(Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy));
    Array.from({ length: n }, (_, i) => (i + 1) / n).forEach(t => {
      const u = 1 - t;
      this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    });
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const [x0, y0] = this.last;
    const n = this.segments(Math.hypot(c1x - x0, c1y - y0) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x - c2x, y - c2y));
    Array.from({ length: n }, (_, i) => (i + 1) / n).forEach(t => {
      const u = 1 - t;
      this.lineTo(
        u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
    });
  }
  /** 椭圆弧（arc 的通用形式）；a0→a1 顺时针（屏幕坐标），ccw 为逆时针 */
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = (sweep % TAU) + TAU;
    if (ccw && sweep > 0) sweep = (sweep % TAU) - TAU;
    if (Math.abs(sweep) > TAU) sweep = Math.sign(sweep) * TAU;
    const n = Math.max(4, this.segments(Math.abs(sweep) * Math.max(rx, ry)));
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const pt = (a: number): [number, number] => {
      const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      return [cx + ex * cr - ey * sr, cy + ex * sr + ey * cr];
    };
    const [sx, sy] = pt(a0);
    // Canvas 语义：若已有当前子路径，从当前点连线到弧起点；否则新开子路径
    if (this.cur) this.lineTo(sx, sy); else this.moveTo(sx, sy);
    Array.from({ length: n }, (_, i) => a0 + sweep * (i + 1) / n).forEach(a => {
      const [x, y] = pt(a);
      this.lineTo(x, y);
    });
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    this.ellipse(cx, cy, r, r, 0, a0, a1, ccw);
  }
  /** 曲线采样段数：按屏幕长度约 2.5px 一段 */
  private segments(len: number): number {
    return Math.max(2, Math.min(64, Math.ceil(len * this.matScale() / 2.5)));
  }

  /** 原型 roundRect：四角用 90° 圆弧（等价于原型 arcTo 实现） */
  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    this.beginPath();
    this.moveTo(x + rr, y);
    this.lineTo(x + w - rr, y);
    this.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - rr);
    this.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
    this.lineTo(x + rr, y + h);
    this.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
    this.lineTo(x, y + rr);
    this.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
    this.closePath();
  }

  /* ============================== 绘制 ============================== */
  /** 取当前可追加的 Graphics；被精灵/文字打断后新开一个，保证遮挡顺序 */
  private gfx(): Graphics {
    if (!this.activeGfx) {
      const g = this.gfxPool.take();
      g.clear();
      const ut = g.node.getComponent(UITransform) as UITransform;
      ut.setContentSize(this.W, this.H);
      g.node.setPosition(0, 0, 0);
      this.attach(g.node);
      this.activeGfx = g;
    }
    return this.activeGfx;
  }

  /** 把子路径（原型屏幕坐标）写入 Graphics */
  private emit(g: Graphics, pts: number[], closed: boolean): void {
    g.moveTo(pts[0] - this.W / 2, this.H / 2 - pts[1]);
    Array.from({ length: pts.length / 2 - 1 }, (_, i) => i + 1).forEach(i =>
      g.lineTo(pts[i * 2] - this.W / 2, this.H / 2 - pts[i * 2 + 1]));
    if (closed) g.close();
  }

  fill(): void {
    const subs = this.path.filter(p => p.pts.length >= 6);
    if (!subs.length) return;
    const g = this.gfx();
    subs.forEach(p => this.emit(g, p.pts, true));
    g.fillColor = ccColor(this.st.fill, this.st.alpha);
    g.fill();
  }

  stroke(): void {
    const subs = this.path.filter(p => p.pts.length >= 4);
    if (!subs.length) return;
    const g = this.gfx();
    g.lineWidth = this.st.lineWidth * this.matScale();
    g.lineCap = this.st.lineCap === 'round' ? Graphics.LineCap.ROUND
      : this.st.lineCap === 'square' ? Graphics.LineCap.SQUARE : Graphics.LineCap.BUTT;
    g.lineJoin = this.st.lineJoin === 'round' ? Graphics.LineJoin.ROUND
      : this.st.lineJoin === 'bevel' ? Graphics.LineJoin.BEVEL : Graphics.LineJoin.MITER;
    g.strokeColor = ccColor(this.st.stroke, this.st.alpha);
    const dash = this.st.dash.map(d => d * this.matScale());
    subs.forEach(p => {
      const pts = p.closed ? [...p.pts, p.pts[0], p.pts[1]] : p.pts;
      if (dash.length) this.emitDashed(g, pts, dash);
      else this.emit(g, pts, false);
    });
    g.stroke();
  }

  /** 虚线：沿折线按 dash 数组切段 */
  private emitDashed(g: Graphics, pts: number[], dash: number[]): void {
    let di = 0, left = dash[0], on = true;
    let seg: number[] = [pts[0], pts[1]];
    const flush = () => { if (on && seg.length >= 4) this.emit(g, seg, false); };
    Array.from({ length: pts.length / 2 - 1 }, (_, i) => i).forEach(i => {
      let [x0, y0] = [pts[i * 2], pts[i * 2 + 1]];
      const [x1, y1] = [pts[i * 2 + 2], pts[i * 2 + 3]];
      let len = Math.hypot(x1 - x0, y1 - y0);
      while (len > 0) {
        const step = Math.min(left, len);
        const k = step / len;
        x0 += (x1 - x0) * k; y0 += (y1 - y0) * k;
        seg.push(x0, y0);
        len -= step; left -= step;
        if (left <= 1e-6) {
          flush();
          on = !on; di = (di + 1) % dash.length; left = dash[di];
          seg = [x0, y0];
        }
      }
    });
    flush();
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h);
    this.closePath();
    this.fill();
  }

  /* ============================ 精灵 / 文字 ============================ */
  /**
   * 在当前变换原点绘制素材（等价于原型在 translate 后调用的绘制函数）
   * 素材锚点 = 原绘制原点，因此位置、旋转、缩放直接取当前矩阵
   */
  sprite(name: string, opts: SpriteOpts = {}): void {
    const meta = this.art.meta(name);
    const frame = this.art.frame(name);
    if (!meta || !frame) return;
    this.activeGfx = null;
    const s = this.spritePool.take();
    if (s.spriteFrame !== frame) s.spriteFrame = frame;
    const n = s.node;
    const ut = n.getComponent(UITransform) as UITransform;
    const k = (opts.scale ?? 1) / this.art.scale;
    ut.setContentSize(meta.w * k, meta.h * k);
    ut.setAnchorPoint(meta.anchorX, meta.anchorY);
    this.placeNode(n);
    s.color = ccColor('#FFFFFF', this.st.alpha);
    this.attach(n);
  }

  /** screen 类素材：left/top 为原型坐标左上角 */
  spriteAt(name: string): void {
    const meta = this.art.meta(name);
    if (!meta) return;
    this.save();
    this.translate(meta.left, meta.top);
    this.spriteTopLeft(name);
    this.restore();
  }
  private spriteTopLeft(name: string): void {
    const meta = this.art.meta(name) as SpriteMeta;
    const frame = this.art.frame(name);
    if (!frame) return;
    this.activeGfx = null;
    const s = this.spritePool.take();
    if (s.spriteFrame !== frame) s.spriteFrame = frame;
    const ut = s.node.getComponent(UITransform) as UITransform;
    ut.setContentSize(meta.w / this.art.scale, meta.h / this.art.scale);
    ut.setAnchorPoint(0, 1);
    this.placeNode(s.node);
    s.color = ccColor('#FFFFFF', this.st.alpha);
    this.attach(s.node);
  }

  /** 用当前矩阵设置节点位置/旋转/缩放（矩阵按 T·R·S 分解） */
  private placeNode(n: Node): void {
    const [a, b, c, d, e, f] = this.st.m;
    const sx = Math.hypot(a, b), sy = Math.hypot(c, d);
    const rot = Math.atan2(b, a);
    n.setPosition(e - this.W / 2, this.H / 2 - f, 0);
    n.angle = -rot * 180 / Math.PI;
    n.setScale(sx, sy, 1);
  }

  /** 文字（对应原型 label()），基线居中 */
  text(str: string, x: number, y: number, o: TextOpts = {}): void {
    const { size = 14, weight = 700, color = '#000000', align = 'center', outline = null } = o;
    this.activeGfx = null;
    const l = this.labelPool.take();
    if (l.string !== str) l.string = str;
    if (l.fontSize !== size) { l.fontSize = size; l.lineHeight = Math.ceil(size * 1.25); }
    // 与浏览器一致：系统中文字体只有常规/粗体两档，font-weight ≥ 600 时浏览器选用粗体
    const bold = weight >= 600;
    if (l.isBold !== bold) l.isBold = bold;
    l.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
    l.color = ccColor(color, this.st.alpha);
    if (outline) {
      l.enableOutline = true;
      // 原型描边宽度为 max(3, size·0.28)，以字形边缘为中心，外露一半
      l.outlineWidth = Math.max(3, size * 0.28) / 2;
      l.outlineColor = ccColor(outline, this.st.alpha);
    } else if (l.enableOutline) l.enableOutline = false;
    const ut = l.node.getComponent(UITransform) as UITransform;
    ut.setAnchorPoint(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
    this.save();
    this.translate(x, y);
    this.placeNode(l.node);
    this.restore();
    this.attach(l.node);
  }

  /* ============================== 裁剪 ============================== */
  /** 矩形遮罩：之后的绘制都放进遮罩节点，直到 popClip */
  pushClip(x: number, y: number, w: number, h: number): void {
    this.activeGfx = null;
    const n = this.clipPool.take();
    const ut = n.getComponent(UITransform) as UITransform;
    ut.setContentSize(w, h);
    // 遮罩按 UITransform 锚点绘制矩形（见引擎 mask.ts _updateGraphics）：
    // 节点留在原点，用锚点把矩形放到 (x, y, w, h)，这样遮罩内子节点坐标与外部完全一致
    ut.setAnchorPoint((this.W / 2 - x) / w, (y + h - this.H / 2) / h);
    n.setPosition(0, 0, 0);
    n.angle = 0;
    n.setScale(1, 1, 1);
    this.attach(n);
    this.parents.push(n);
  }
  popClip(): void {
    this.activeGfx = null;
    this.parents.pop();
  }
}
