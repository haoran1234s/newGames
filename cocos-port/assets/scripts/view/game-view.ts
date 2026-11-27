/**
 * 游戏主组件：加载素材 → 驱动玩法核心与表现层 → 处理点击
 * 主循环与原型一致：顿帧期间逻辑时间放慢到 8%，视觉层按真实时间推进
 */
import { _decorator, Component, input, Input, EventTouch, sys } from 'cc';
import { ClawGame, LEVELS } from '../core/game-core';
import type { KVStorage } from '../core/game-core';
import { Art } from './art';
import { Ctx2D } from './ctx2d';
import { Renderer, BTN, levelButtonCenter } from './renderer';
import type { Button } from './renderer';
import { DESIGN_W, DESIGN_H, FONT_FAMILY } from './theme';

const { ccclass } = _decorator;

const hitRect = (x: number, y: number, b: Button) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

@ccclass('GameView')
export class GameView extends Component {
  private game: ClawGame | null = null;
  private renderer: Renderer | null = null;

  async start(): Promise<void> {
    const art = new Art();
    await art.load();
    const ctx = new Ctx2D(this.node, art, DESIGN_W, DESIGN_H, FONT_FAMILY);
    // sys.localStorage 在 Web 与各小游戏平台均已适配
    const storage: KVStorage = sys.localStorage;
    let renderer: Renderer | null = null;
    const game = new ClawGame({ storage, emit: e => renderer?.onEvent(e) });
    renderer = new Renderer(ctx, game);
    this.game = game;
    this.renderer = renderer;
    // 截图 / 调试用：挂到页面全局（window.__game / window.__view）
    Object.assign(globalThis, { __game: game, __view: this });
    input.on(Input.EventType.TOUCH_START, this.onTouch, this);
  }

  onDestroy(): void {
    input.off(Input.EventType.TOUCH_START, this.onTouch, this);
  }

  update(dt: number): void {
    const { game, renderer } = this;
    if (!game || !renderer) return;
    const raw = Math.min(dt, 0.05);
    const logicDt = game.hitStop > 0 ? raw * 0.08 : raw;
    game.hitStop = Math.max(0, game.hitStop - raw);
    game.update(logicDt);
    renderer.update(raw, logicDt);
    renderer.render();
  }

  /** 开新关（同时清空上一关残留特效） */
  startLevel(idx: number): void {
    this.renderer?.resetLevelFx();
    this.game?.startLevel(idx);
  }

  /** 点击：UI 坐标（左下原点）→ 原型坐标（左上原点），分发逻辑与原型 onTap 一致 */
  private onTouch(e: EventTouch): void {
    const { game, renderer } = this;
    if (!game || !renderer) return;
    const loc = e.getUILocation();
    const x = loc.x, y = DESIGN_H - loc.y;
    renderer.sfx.resume();
    switch (game.scene) {
      case 'menu':
        if (hitRect(x, y, BTN.start)) { game.goLevels(); renderer.sfx.play('deposit'); }
        break;
      case 'levels': {
        const idx = LEVELS.findIndex((_, i) => {
          const [lx, ly] = levelButtonCenter(i);
          return (x - lx) ** 2 + (y - ly) ** 2 < 32 ** 2 && i < game.unlock;
        });
        if (idx >= 0) { this.startLevel(idx); renderer.sfx.play('deposit'); }
        else if (hitRect(x, y, BTN.levelsBack)) game.goMenu();
        break;
      }
      case 'play':
        game.tap();
        break;
      case 'win': {
        const isLast = game.levelIdx + 1 >= LEVELS.length;
        if (hitRect(x, y, BTN.next)) this.startLevel(isLast ? game.levelIdx : game.levelIdx + 1);
        else if (hitRect(x, y, BTN.retry)) this.startLevel(game.levelIdx);
        else if (hitRect(x, y, BTN.winMenu)) game.goLevels();
        break;
      }
      case 'fail':
        if (!game.reviveUsed && hitRect(x, y, BTN.revive)) game.revive();   // 正式版：看完激励视频后调用
        else if (hitRect(x, y, BTN.failRetry)) this.startLevel(game.levelIdx);
        else if (hitRect(x, y, BTN.failMenu)) game.goLevels();
        break;
    }
  }
}
