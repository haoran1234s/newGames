/**
 * 团子捞捞乐 · 玩法核心（与渲染无关）
 *
 * 从 claw-machine-demo/index.html 原样移植的游戏逻辑：钩子状态机、7 格槽位凑三消除、
 * 障碍物/道具、闯关目标与进度存储。不依赖 Cocos（不 import 'cc'），因此：
 *  - Node 24 可直接运行（类型擦除），用于单元测试
 *  - Cocos 工程中原样使用，表现层通过 emit 事件播放音效、粒子、飘字、震动
 *
 * 写法约束：不使用 enum / namespace / 构造函数参数属性（Node 类型擦除不支持）；单文件无相对导入。
 * 坐标系：与原型一致，逻辑分辨率 375×667，原点左上、y 向下（表现层自行转换）。
 */

/* ================================ 配置 ================================ */

/** 池塘矩形区域 */
export interface PondRect { x0: number; x1: number; y0: number; y1: number }

/** 手感调参（数值与原型完全一致） */
export const CONFIG = {
  W: 375, H: 667,
  railY: 110,                // 钩子滑轨高度
  clawHomeY: 142,            // 钩子待机高度
  clawSwingAmplitude: 140,   // 摆动幅度 px
  clawDropSpeed: 460,        // 下落速度 px/s
  clawRiseBase: 340,         // 上升基准速度（实际速度 = 该值 / 物品重量）
  closeAnimTime: 0.22,       // 闭合动画秒数
  hookLen: 26,               // 钩尖到爪头的距离（碰撞点偏移）
  pond: { x0: 22, x1: 353, y0: 248, y1: 542 } as PondRect,
  trayY: 618,                // 槽位中心高度
  traySlots: 7,              // 槽位数
  slotW: 46,                 // 单槽宽度
  slipBase: 0.85,            // 滑落概率基数
  deliverTime: 0.45,         // 物品飞入槽位动画秒数
  stunTime: 1.2,             // 河豚爆炸眩晕秒数
};

/* ============================== 物品与关卡 ============================== */

export type ItemKind = 'doll' | 'rock' | 'puffer' | 'star' | 'wild';
export type Rarity = 'common' | 'rare' | 'legend';
export type DollId = 'cat' | 'rabbit' | 'bear' | 'strawberry' | 'shiba' | 'unicorn';
export type ItemId = DollId | 'rock' | 'puffer' | 'star' | 'wild';

/** 物品类型定义 */
export interface ItemType {
  kind: ItemKind;
  name: string;
  weight: number;
  rarity?: Rarity;
  score?: number;
  slippery?: number;
}

/** 物品类型注册表 */
export const ITEMS: Record<ItemId, ItemType> = {
  cat:        { kind: 'doll', name: '奶猫团子',   rarity: 'common', score: 100, weight: 1.0,  slippery: 0.08 },
  rabbit:     { kind: 'doll', name: '灰灰兔团',   rarity: 'common', score: 100, weight: 1.0,  slippery: 0.08 },
  bear:       { kind: 'doll', name: '云朵熊团',   rarity: 'common', score: 100, weight: 1.0,  slippery: 0.08 },
  strawberry: { kind: 'doll', name: '草莓兔团',   rarity: 'rare',   score: 200, weight: 1.2,  slippery: 0.45 },
  shiba:      { kind: 'doll', name: '柴犬元宝',   rarity: 'rare',   score: 200, weight: 1.3,  slippery: 0.42 },
  unicorn:    { kind: 'doll', name: '彩虹独角兽', rarity: 'legend', score: 500, weight: 1.55, slippery: 0.68 },
  rock:       { kind: 'rock',   name: '石头',     weight: 2.6, score: 10 },
  puffer:     { kind: 'puffer', name: '河豚',     weight: 1.0 },
  star:       { kind: 'star',   name: '时钟星',   weight: 0.8 },
  wild:       { kind: 'wild',   name: '万能团子', weight: 1.0, score: 150 },
};

/** 可凑三的团子 id（不含万能） */
export const DOLL_IDS = (Object.keys(ITEMS) as ItemId[]).filter(k => ITEMS[k].kind === 'doll') as DollId[];

/** 关卡目标 */
export interface LevelGoal { type: 'groups' | 'score'; n: number }

/** 关卡配置 */
export interface LevelDef {
  goal: LevelGoal;
  time: number;
  swing: number;
  tip?: string;
  dolls: Partial<Record<DollId, number>>;
  rocks: number;
  puffers: number;
  stars: number;
  wilds: number;
}

/* 设计原则：团子数量必须大于目标所需（冗余 30%+），因为抓走即消耗、池塘会枯竭 */
export const LEVELS: LevelDef[] = [
  { goal: { type: 'groups', n: 3 },  time: 75, swing: 1.5,
    dolls: { cat: 4, rabbit: 4, bear: 4 }, rocks: 0, puffers: 0, stars: 1, wilds: 0 },
  { goal: { type: 'groups', n: 5 },  time: 85, swing: 1.5, tip: '新朋友：石头很重，拉上来很慢',
    dolls: { cat: 4, rabbit: 4, bear: 4, strawberry: 4, shiba: 4 }, rocks: 2, puffers: 0, stars: 1, wilds: 0 },
  { goal: { type: 'groups', n: 6 },  time: 85, swing: 1.7, tip: '团子种类变多，想好再下钩',
    dolls: { cat: 6, rabbit: 6, bear: 4, strawberry: 4 }, rocks: 3, puffers: 0, stars: 1, wilds: 0 },
  { goal: { type: 'score', n: 1200 }, time: 80, swing: 1.7, tip: '小心河豚，钩到会爆炸',
    dolls: { cat: 6, rabbit: 6, bear: 6, strawberry: 4, shiba: 4 }, rocks: 3, puffers: 1, stars: 1, wilds: 0 },
  { goal: { type: 'groups', n: 8 },  time: 85, swing: 1.8, tip: '时间更紧，障碍更多',
    dolls: { cat: 6, rabbit: 6, bear: 9, strawberry: 6, shiba: 3 }, rocks: 4, puffers: 1, stars: 1, wilds: 0 },
  { goal: { type: 'score', n: 2000 }, time: 85, swing: 1.8, tip: '独角兽很滑，钩准正中心',
    dolls: { cat: 6, rabbit: 6, bear: 6, strawberry: 6, shiba: 6, unicorn: 3 }, rocks: 3, puffers: 1, stars: 2, wilds: 0 },
  { goal: { type: 'groups', n: 9 },  time: 90, swing: 1.9, tip: '彩虹团子可以替代任意一只',
    dolls: { cat: 6, rabbit: 6, bear: 6, strawberry: 6, shiba: 6 }, rocks: 4, puffers: 1, stars: 1, wilds: 1 },
  { goal: { type: 'score', n: 2800 }, time: 90, swing: 2.0, tip: '最终考验：全员出动',
    dolls: { cat: 6, rabbit: 6, bear: 6, strawberry: 6, shiba: 6, unicorn: 3 }, rocks: 5, puffers: 2, stars: 2, wilds: 2 },
];

/** 按稀有度分层的生成高度区间 */
const SPAWN_BANDS: Record<string, [number, number]> = {
  common: [258, 385], rare: [380, 500], legend: [455, 520],
  rock: [350, 515], puffer: [300, 465], star: [260, 415], wild: [380, 495],
};
/** 各类物品半径区间 */
const SIZE_RANGE: Record<string, [number, number]> = {
  common: [16, 20], rare: [17, 22], legend: [22, 25],
  rock: [18, 22], puffer: [16, 20], star: [12, 13], wild: [17, 20],
};

/* ================================ 实体 ================================ */

export type ItemState = 'pond' | 'hooked' | 'deliver' | 'falling' | 'tray' | 'gone';
export type Rng = () => number;

/** 池塘中的物品（团子/障碍/道具），带漂浮漂移 */
export class PondItem {
  type: ItemType;
  typeId: ItemId;
  /** 漂浮锚点 */
  ax: number; ay: number;
  x: number; y: number; r: number;
  state: ItemState = 'pond';
  /** 漂浮相位 / 水平漂移幅度 / 漂移速度 */
  phase: number; driftAmp: number; driftSpd: number;
  rot: number;
  /** 眨眼计时（表现层用） */
  blink: number;
  /** 投递动画：进度 0..1、起点、目标槽位 */
  dt = 0; fromX = 0; fromY = 0; slotIdx = -1;
  /** 滑落抛物线速度 */
  vx = 0; vy = 0;

  constructor(typeId: ItemId, x: number, y: number, r: number, rng: Rng = Math.random) {
    const rand = (a: number, b: number) => a + rng() * (b - a);
    this.type = ITEMS[typeId];
    this.typeId = typeId;
    this.ax = x; this.ay = y;
    this.x = x; this.y = y; this.r = r;
    this.phase = rand(0, 6.28);
    this.driftAmp = rand(6, 14);
    this.driftSpd = rand(0.5, 1.1);
    this.rot = rand(-0.3, 0.3);
    this.blink = rand(0, 3);
  }

  /** 每帧更新漂浮位置（仅 pond 状态） */
  drift(t: number): void {
    this.x = this.ax + Math.sin(t * this.driftSpd + this.phase) * this.driftAmp;
    this.y = this.ay + Math.sin(t * this.driftSpd * 1.3 + this.phase * 2) * 4;
  }
}

export type ClawStateName = 'SWING' | 'DROP' | 'CLOSE' | 'RISE' | 'STUN';

/** 钩子状态 */
export interface ClawState {
  state: ClawStateName;
  swingT: number; x: number; y: number;
  /** 爪臂张开度 1=全开 0=闭合 */
  openAngle: number; closeT: number;
  grabbed: PondItem | null;
  /** 预设滑落高度（null = 本钩不滑落） */
  slipAtY: number | null;
  accuracy: number; stunT: number;
  /** 即将滑落时颤抖 */
  tremble: boolean;
}

/* ================================ 事件 ================================ */

export type SfxName = 'drop' | 'clamp' | 'grab' | 'miss' | 'deposit' | 'eliminate' | 'slip' | 'explode'
  | 'star' | 'tick' | 'win' | 'fail' | 'rock' | 'splash' | 'starPop';

/** 槽位消除时的单只团子 */
export interface MergePoint { x: number; y: number; item: PondItem }

/**
 * 逻辑 → 表现层事件。颜色/字号等视觉细节由表现层按 preset / style 决定，核心只描述「发生了什么」
 */
export type GameEvent =
  | { type: 'sfx'; name: SfxName; arg?: number }
  | { type: 'buzz'; ms: number }
  | { type: 'burst'; preset: 'puffer' | 'clock' | 'land' | 'winConfetti' | 'winHearts' | 'revive'; x: number; y: number; item?: PondItem }
  | { type: 'ring'; preset: 'puffer' | 'clock'; x: number; y: number }
  | { type: 'ripple'; x: number; y: number }
  | { type: 'text'; style: 'score' | 'scoreBig' | 'combo' | 'rock' | 'time' | 'boom'; x: number; y: number; text: string }
  | { type: 'hookHit'; item: PondItem }
  | { type: 'slotKick'; idx: number }
  | { type: 'merge'; pts: MergePoint[]; cx: number; cy: number; mult: number }
  | { type: 'scene'; scene: SceneName };

export type SceneName = 'menu' | 'levels' | 'play' | 'win' | 'fail';
export type FailReason = '' | 'full' | 'time';

/** 键值存储（浏览器 localStorage / Cocos sys.localStorage 均满足） */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 内存存储（测试用） */
export class MemoryStorage implements KVStorage {
  private m = new Map<string, string>();
  getItem(key: string): string | null { return this.m.get(key) ?? null; }
  setItem(key: string, value: string): void { this.m.set(key, String(value)); }
}

/** 可复现伪随机（mulberry32），测试与回放用 */
export function seededRandom(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

/** 槽位 i 的中心 x 坐标 */
export function slotX(i: number): number {
  const totalW = CONFIG.traySlots * CONFIG.slotW;
  return (CONFIG.W - totalW) / 2 + i * CONFIG.slotW + CONFIG.slotW / 2;
}

/* ================================ 游戏 ================================ */

export interface GameOptions {
  random?: Rng;
  storage?: KVStorage;
  /** 事件回调（表现层订阅） */
  emit?: (e: GameEvent) => void;
}

/** 游戏逻辑主体 */
export class ClawGame {
  scene: SceneName = 'menu';
  levelIdx = 0;
  score = 0;
  combo = 0;
  groupsDone = 0;
  maxCombo = 1;
  timeLeft = 0;
  lastTickSec = -1;
  reviveUsed = false;
  failReason: FailReason = '';
  winStars = 0;
  winScore = 0;
  items: PondItem[] = [];
  tray: (PondItem | null)[] = Array(CONFIG.traySlots).fill(null);
  /** 屏幕震动量 / 滑落横幅 / 教学提示剩余时间 */
  shake = 0;
  slipBanner = 0;
  tutorT = 0;
  /** 池塘全局时间（驱动漂移） */
  pondT = 0;
  /** 顿帧剩余秒数：期间逻辑时间放慢到 8% */
  hitStop = 0;
  claw: ClawState = {
    state: 'SWING', swingT: 0, x: CONFIG.W / 2, y: CONFIG.clawHomeY,
    openAngle: 1, closeT: 0, grabbed: null, slipAtY: null, accuracy: 0, stunT: 0, tremble: false,
  };

  private rng: Rng;
  private storage: KVStorage;
  private emitFn: (e: GameEvent) => void;

  constructor(opts: GameOptions = {}) {
    this.rng = opts.random ?? Math.random;
    this.storage = opts.storage ?? new MemoryStorage();
    this.emitFn = opts.emit ?? (() => {});
  }

  /* ------------------------------ 工具 ------------------------------ */
  private rand(a: number, b: number): number { return a + this.rng() * (b - a); }
  private emit(e: GameEvent): void { this.emitFn(e); }
  private sfx(name: SfxName, arg?: number): void { this.emit({ type: 'sfx', name, arg }); }
  private buzz(ms: number): void { this.emit({ type: 'buzz', ms }); }
  private setScene(scene: SceneName): void {
    this.scene = scene;
    this.emit({ type: 'scene', scene });
  }

  /* ------------------------------ 进度 ------------------------------ */
  /** 已解锁关卡数（至少 1） */
  get unlock(): number { return parseInt(this.storage.getItem('tt_unlock') ?? '1', 10); }
  set unlock(v: number) { this.storage.setItem('tt_unlock', String(v)); }
  /** 各关最高星级 */
  get stars(): Record<number, number> {
    try { return JSON.parse(this.storage.getItem('tt_stars') ?? '{}'); } catch { return {}; }
  }
  set stars(v: Record<number, number>) { this.storage.setItem('tt_stars', JSON.stringify(v)); }

  get level(): LevelDef { return LEVELS[this.levelIdx]; }

  /* ------------------------------ 场景 ------------------------------ */
  goMenu(): void { this.setScene('menu'); }
  goLevels(): void { this.setScene('levels'); }

  /** 开始第 idx 关（0 起） */
  startLevel(idx: number): void {
    const lv = LEVELS[idx];
    this.levelIdx = idx;
    this.score = 0; this.combo = 0; this.groupsDone = 0; this.maxCombo = 1;
    this.timeLeft = lv.time; this.lastTickSec = Math.ceil(lv.time);
    this.reviveUsed = false; this.failReason = '';
    this.items = []; this.tray = Array(CONFIG.traySlots).fill(null);
    this.slipBanner = 0; this.tutorT = idx === 0 ? 3.5 : (lv.tip ? 3 : 1.6);
    this.hitStop = 0;
    Object.assign(this.claw, { state: 'SWING', grabbed: null, openAngle: 1, slipAtY: null, tremble: false });

    // 生成物品：位置随机采样 + 碰撞排斥
    const P = CONFIG.pond;
    const spawnOne = (typeId: ItemId, bandKey: string) => {
      const [y0, y1] = SPAWN_BANDS[bandKey];
      const [r0, r1] = SIZE_RANGE[bandKey];
      const r = this.rand(r0, r1);
      const spot = Array.from({ length: 60 }).reduce<[number, number] | null>((found) => {
        if (found) return found;
        const x = this.rand(P.x0 + r + 4, P.x1 - r - 4);
        const y = this.rand(y0, y1);
        const overlap = this.items.some(it => dist2(x, y, it.ax, it.ay) < (r + it.r + 10) ** 2);
        return overlap ? null : [x, y];
      }, null) ?? [this.rand(P.x0 + r, P.x1 - r), this.rand(y0, y1)];
      this.items.push(new PondItem(typeId, spot[0], spot[1], r, this.rng));
    };
    (Object.keys(lv.dolls) as DollId[]).forEach(typeId => {
      Array.from({ length: lv.dolls[typeId] ?? 0 }).forEach(() => spawnOne(typeId, ITEMS[typeId].rarity as string));
    });
    const extras: [ItemId, number][] = [['rock', lv.rocks], ['puffer', lv.puffers], ['star', lv.stars], ['wild', lv.wilds]];
    extras.forEach(([id, n]) => Array.from({ length: n }).forEach(() => spawnOne(id, id)));

    this.setScene('play');
  }

  /** 玩家点击（游戏中 = 放钩） */
  tap(): void {
    if (this.scene === 'play' && this.claw.state === 'SWING') {
      this.claw.state = 'DROP';
      this.sfx('drop');
    }
  }

  /** 看广告复活：清空槽位 + 续 10 秒（每关限 1 次） */
  revive(): boolean {
    if (this.scene !== 'fail' || this.reviveUsed) return false;
    this.reviveUsed = true;
    this.tray.forEach((it, i) => {
      if (it) {
        this.emit({ type: 'burst', preset: 'revive', x: slotX(i), y: CONFIG.trayY, item: it });
        it.state = 'gone';
      }
      this.tray[i] = null;
    });
    this.items = this.items.filter(x => x.state !== 'gone');
    this.timeLeft += 10;
    this.combo = 0;
    this.setScene('play');
    this.sfx('win');
    return true;
  }

  private endWin(): void {
    const lv = this.level;
    const ratio = this.timeLeft / lv.time;
    this.winStars = ratio > 0.45 ? 3 : ratio > 0.2 ? 2 : 1;
    this.winScore = this.score + Math.floor(this.timeLeft) * 10;   // 剩余时间奖励
    this.score = this.winScore;
    this.unlock = Math.max(this.unlock, Math.min(this.levelIdx + 2, LEVELS.length));
    const stars = this.stars;
    stars[this.levelIdx] = Math.max(stars[this.levelIdx] ?? 0, this.winStars);
    this.stars = stars;
    this.setScene('win');
    this.sfx('win');
    this.emit({ type: 'burst', preset: 'winConfetti', x: CONFIG.W / 2, y: 200 });
    this.emit({ type: 'burst', preset: 'winHearts', x: CONFIG.W / 2, y: 200 });
  }

  private endFail(reason: FailReason): void {
    if (this.scene !== 'play') return;   // 防止与过关判定同帧冲突
    this.failReason = reason;
    this.setScene('fail');
    this.sfx('fail');
  }

  /* ------------------------------ 槽位 ------------------------------ */
  /** 入槽后消除结算，返回消除组数 */
  resolveTray(): number {
    const indicesOf = (id: ItemId) => this.tray.map((it, i) => (it && it.typeId === id ? i : -1)).filter(i => i >= 0);
    let groups = 0;
    let again = true;
    while (again) {
      again = false;
      // 1) 同款自然凑三
      const triple = DOLL_IDS.find(id => indicesOf(id).length >= 3);
      if (triple) {
        this.eliminate(indicesOf(triple).slice(0, 3), ITEMS[triple].score ?? 0);
        groups++; again = true; continue;
      }
      // 2) 万能团子补对：任意同款一对 + 万能 = 消除
      const wildIdx = this.tray.findIndex(it => it?.typeId === 'wild');
      const pair = wildIdx >= 0 ? DOLL_IDS.find(id => indicesOf(id).length === 2) : undefined;
      if (pair) {
        this.eliminate([...indicesOf(pair), wildIdx], ITEMS[pair].score ?? 0);
        groups++; again = true;
      }
    }
    return groups;
  }

  /** 消除一组：计分（连击倍率）、清槽，并通知表现层做吸拢动画 */
  eliminate(idxs: number[], baseScore: number): void {
    const mult = Math.max(1, this.combo);
    const gained = baseScore * mult;
    this.score += gained;
    this.groupsDone++;
    this.maxCombo = Math.max(this.maxCombo, mult);
    const pts: MergePoint[] = idxs
      .filter(i => this.tray[i])
      .map(i => ({ x: slotX(i), y: CONFIG.trayY + 3, item: this.tray[i] as PondItem }));
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / Math.max(1, pts.length);
    pts.forEach(p => { p.item.state = 'gone'; });
    idxs.forEach(i => { this.tray[i] = null; });
    this.items = this.items.filter(x => x.state !== 'gone');
    this.emit({ type: 'merge', pts, cx, cy: CONFIG.trayY - 4, mult });
    this.emit({ type: 'text', style: mult > 1 ? 'scoreBig' : 'score', x: cx, y: CONFIG.trayY - 42, text: `+${gained}` });
    if (mult > 1) this.emit({ type: 'text', style: 'combo', x: cx, y: CONFIG.trayY - 66, text: `连击 x${mult}` });
    this.checkGoal();
  }

  /** 检查关卡目标是否达成 */
  checkGoal(): void {
    const { goal } = this.level;
    const done = goal.type === 'groups' ? this.groupsDone >= goal.n : this.score >= goal.n;
    if (done && this.scene === 'play') this.endWin();
  }

  /* ------------------------------ 钩子 ------------------------------ */
  /** 下落中的碰撞检测：钩尖碰到第一个物品即命中 */
  private hookCollide(): PondItem | null {
    const { x, y } = this.claw;
    const tipY = y + CONFIG.hookLen;
    return this.items.find(it => it.state === 'pond' && dist2(x, tipY, it.x, it.y) < (it.r + 7) ** 2) ?? null;
  }

  /** 命中物品后的分流处理 */
  private onHookHit(it: PondItem): void {
    const claw = this.claw;
    if (it.type.kind === 'puffer') {
      this.explodeAt(it);
      claw.state = 'STUN'; claw.stunT = CONFIG.stunTime;
      claw.openAngle = 1;
      return;
    }
    claw.state = 'CLOSE'; claw.closeT = 0;
    claw.grabbed = it; it.state = 'hooked';
    claw.accuracy = Math.max(0, 1 - Math.abs(it.x - claw.x) / (it.r + 20));
    this.sfx('clamp');
    // 手感：顿帧 + 闪白 + 挤压回弹（表现层处理 hookHit）+ 短震
    this.emit({ type: 'hookHit', item: it });
    this.hitStop = Math.max(this.hitStop, 0.06);
    this.buzz(15);
  }

  /** 河豚爆炸：冲击波推开周围物品锚点 */
  private explodeAt(puffer: PondItem): void {
    puffer.state = 'gone';
    this.items = this.items.filter(x => x !== puffer);
    this.emit({ type: 'burst', preset: 'puffer', x: puffer.x, y: puffer.y });
    this.emit({ type: 'ring', preset: 'puffer', x: puffer.x, y: puffer.y });
    this.emit({ type: 'text', style: 'boom', x: puffer.x, y: puffer.y - 24, text: '砰！' });
    this.hitStop = Math.max(this.hitStop, 0.1);
    this.buzz(60);
    const P = CONFIG.pond;
    this.items.forEach(it => {
      if (it.state !== 'pond') return;
      const d2 = dist2(puffer.x, puffer.y, it.ax, it.ay);
      if (d2 < 130 ** 2) {
        const d = Math.sqrt(d2) || 1;
        const push = (130 - d) * 0.5;
        it.ax += (it.ax - puffer.x) / d * push;
        it.ay += (it.ay - puffer.y) / d * push * 0.6;
        it.ax = Math.max(P.x0 + it.r, Math.min(P.x1 - it.r, it.ax));
        it.ay = Math.max(P.y0 + it.r, Math.min(P.y1 - it.r, it.ay));
      }
    });
    this.shake = 14;
    this.sfx('explode');
  }

  /** 物品被拉到顶后的分流：进槽 / 丢弃石头 / 加时间 */
  private deliverItem(it: PondItem): void {
    const { kind } = it.type;
    const claw = this.claw;
    if (kind === 'rock') {
      this.score += 10;
      this.emit({ type: 'text', style: 'rock', x: claw.x, y: claw.y + 40, text: '+10 只是块石头' });
      it.state = 'gone';
      this.items = this.items.filter(x => x !== it);
      this.sfx('rock');
      this.combo = 0;   // 抓石头中断连击
      return;
    }
    if (kind === 'star') {
      this.timeLeft += 5;
      this.emit({ type: 'text', style: 'time', x: claw.x, y: claw.y + 40, text: '+5 秒' });
      this.emit({ type: 'burst', preset: 'clock', x: claw.x, y: claw.y + 30 });
      this.emit({ type: 'ring', preset: 'clock', x: claw.x, y: claw.y + 30 });
      it.state = 'gone';
      this.items = this.items.filter(x => x !== it);
      this.sfx('star');
      return;
    }
    const slotIdx = this.tray.findIndex(s => s === null);
    if (slotIdx < 0) {   // 理论上不会发生（槽满即败），防御性丢弃
      it.state = 'gone';
      this.items = this.items.filter(x => x !== it);
      return;
    }
    it.state = 'deliver';
    it.dt = 0; it.fromX = it.x; it.fromY = it.y; it.slotIdx = slotIdx;
    this.sfx('deposit');
  }

  /** 投递动画结束 → 入槽结算 */
  trayArrive(it: PondItem): void {
    this.tray[it.slotIdx] = it;
    it.state = 'tray';
    this.emit({ type: 'slotKick', idx: it.slotIdx });
    this.buzz(8);
    this.combo++;                          // 先假设延续连击
    const groups = this.resolveTray();
    if (groups === 0) this.combo = 0;      // 未消除 → 连击中断
    if (this.scene === 'play' && this.tray.every(s => s !== null)) this.endFail('full');
  }

  /* ------------------------------ 主循环 ------------------------------ */
  /** 按真实帧间隔推进：处理顿帧缩放后调用 update */
  step(rawDt: number): void {
    const raw = Math.min(rawDt, 0.05);
    const dt = this.hitStop > 0 ? raw * 0.08 : raw;
    this.hitStop = Math.max(0, this.hitStop - raw);
    this.update(dt);
  }

  /** 逻辑更新（dt 已含顿帧缩放） */
  update(dt: number): void {
    this.pondT += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.slipBanner = Math.max(0, this.slipBanner - dt);
    if (this.scene !== 'play') return;

    this.tutorT = Math.max(0, this.tutorT - dt);
    this.timeLeft -= dt;
    const sec = Math.ceil(this.timeLeft);
    if (sec !== this.lastTickSec) {
      this.lastTickSec = sec;
      if (sec <= 10 && sec > 0) this.sfx('tick');
    }
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.endFail('time'); }

    this.updateClaw(dt);
    this.updateItems(dt);
  }

  private updateClaw(dt: number): void {
    const claw = this.claw;
    switch (claw.state) {
      case 'SWING': {
        claw.swingT += dt * this.level.swing;
        claw.x = CONFIG.W / 2 + Math.sin(claw.swingT) * CONFIG.clawSwingAmplitude;
        claw.y = CONFIG.clawHomeY;
        claw.openAngle = Math.min(1, claw.openAngle + dt * 3);
        break;
      }
      case 'DROP': {
        claw.y += CONFIG.clawDropSpeed * dt;
        const hit = this.hookCollide();
        if (hit) this.onHookHit(hit);
        else if (claw.y + CONFIG.hookLen >= CONFIG.pond.y1 + 10) {
          claw.state = 'RISE';   // 空钩到底，直接返回
          this.sfx('miss');
        }
        break;
      }
      case 'CLOSE': {
        claw.closeT += dt;
        claw.openAngle = Math.max(0, 1 - claw.closeT / CONFIG.closeAnimTime);
        if (claw.closeT >= CONFIG.closeAnimTime) {
          // 滑落判定：只有滑落高度落在上升路径内（低于待机位置）才生效
          const it = claw.grabbed;
          claw.slipAtY = null;
          if (it && it.type.slippery) {
            const slipChance = CONFIG.slipBase * it.type.slippery * (1 - claw.accuracy) + 0.05 * it.type.weight;
            const at = this.rng() < slipChance ? claw.y - this.rand(60, 200) : null;
            claw.slipAtY = at !== null && at > CONFIG.clawHomeY ? at : null;
          }
          claw.state = 'RISE';
          this.sfx('grab');
          this.shake = Math.max(this.shake, 4);
        }
        break;
      }
      case 'RISE': {
        const w = claw.grabbed ? claw.grabbed.type.weight : 1;
        // 即将滑落：减速到 30% 并颤抖
        claw.tremble = claw.slipAtY !== null && claw.y - claw.slipAtY < 50;
        claw.y -= (CONFIG.clawRiseBase / w) * dt * (claw.tremble ? 0.3 : 1);
        if (claw.grabbed) {
          claw.grabbed.x = claw.x;
          claw.grabbed.y = claw.y + CONFIG.hookLen + claw.grabbed.r * 0.4;
          if (claw.slipAtY !== null && claw.y <= claw.slipAtY) {
            const d = claw.grabbed;
            d.state = 'falling'; d.vx = this.rand(-90, 90); d.vy = -50;
            claw.grabbed = null; claw.slipAtY = null;
            claw.openAngle = 0.5; claw.tremble = false;
            this.sfx('slip');
            this.buzz(40);
            this.slipBanner = 1.6;   // 激励视频点位：看广告稳住钩子
          }
        }
        if (claw.y <= CONFIG.clawHomeY) {
          claw.y = CONFIG.clawHomeY;
          claw.slipAtY = null; claw.tremble = false;   // 每钩结束清理滑落状态
          if (claw.grabbed) {
            const it = claw.grabbed;
            claw.grabbed = null;
            this.deliverItem(it);
          }
          claw.state = 'SWING';
          claw.swingT = Math.asin(Math.max(-1, Math.min(1, (claw.x - CONFIG.W / 2) / CONFIG.clawSwingAmplitude)));
        }
        break;
      }
      case 'STUN': {
        claw.stunT -= dt;
        claw.y = Math.max(CONFIG.clawHomeY, claw.y - CONFIG.clawRiseBase * 1.8 * dt);
        if (claw.stunT <= 0) claw.state = 'SWING';
        break;
      }
    }
  }

  private updateItems(dt: number): void {
    const P = CONFIG.pond;
    // 遍历快照：入槽结算可能替换 this.items
    [...this.items].forEach(it => {
      if (it.state === 'pond') it.drift(this.pondT);
      else if (it.state === 'deliver') {
        it.dt += dt / CONFIG.deliverTime;
        if (it.dt >= 1) this.trayArrive(it);
        else {
          const tx = slotX(it.slotIdx), ty = CONFIG.trayY;
          const t = it.dt, e = t * (2 - t);
          it.x = it.fromX + (tx - it.fromX) * e;
          it.y = it.fromY + (ty - it.fromY) * e - Math.sin(t * Math.PI) * 60;   // 弧线
        }
      } else if (it.state === 'falling') {
        it.vy += 900 * dt;
        it.x += it.vx * dt; it.y += it.vy * dt;
        if (it.y >= P.y1 - it.r) {
          it.ay = P.y1 - it.r - this.rand(0, 30);
          it.ax = Math.max(P.x0 + it.r, Math.min(P.x1 - it.r, it.x));
          it.state = 'pond';
          this.emit({ type: 'burst', preset: 'land', x: it.x, y: it.y });
          this.emit({ type: 'ripple', x: it.x, y: it.y });
        }
      }
      it.blink += dt;
    });
  }
}
