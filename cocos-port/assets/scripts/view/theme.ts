/**
 * 视觉主题：与原型 DESIGN.md「视觉与手感契约」一致的色板、字号与坐标换算
 */
import { Color, Vec3 } from 'cc';
import { CONFIG } from '../core/game-core';

/** 设计分辨率（与原型逻辑分辨率一致） */
export const DESIGN_W = CONFIG.W;
export const DESIGN_H = CONFIG.H;
/** 素材导出倍率（art/manifest.json 中的 scale） */
export const ART_SCALE = 3;
/** 团子/物品素材的基准半径 */
export const REF_R = 20;
/** 槽内团子显示半径 */
export const SLOT_R = 15;
/** 凑三吸拢动画时长（秒） */
export const MERGE_T = 0.2;

/** 色板（十六进制，与原型 PAL 一一对应） */
export const PAL = {
  cream: '#FFF6E9', paper: '#FFFDF7', ink: '#5A3D31', ink2: '#8A6A5A', line: '#6B4A3A',
  mint: '#BFE6DF', mintDeep: '#9FD6CC', honey: '#F3D9A8', butter: '#FFE7A8',
  coral: '#FF7A8A', btnInk: '#4A2E24', danger: '#C8394F', blush: '#FFB3C1',
  shadow: '#6B4A3A38', scoreInk: '#D94A60', timeInk: '#2E7F73', track: '#F1E6D6', gold: '#FFD873',
} as const;

/** 纸屑配色 */
export const CONFETTI = ['#FF7A8A', '#FFE7A8', '#BFE6DF', '#CDBCF2', '#FFFFFF', '#FFC9A8'];

/** 十六进制（#RRGGBB / #RRGGBBAA）→ cc.Color，带缓存 */
const colorCache = new Map<string, Color>();
export function hex(h: string): Color {
  const hit = colorCache.get(h);
  if (hit) return hit.clone();
  const c = new Color();
  Color.fromHEX(c, h);
  colorCache.set(h, c);
  return c.clone();
}

/** 常用颜色对象 */
export const PAL_COLOR = {
  cream: hex(PAL.cream),
  white: hex('#FFFFFF'),
};

/**
 * 原型坐标（左上原点、y 向下）→ Cocos 节点坐标（画布中心原点、y 向上）
 */
export function toView(x: number, y: number, out: Vec3 = new Vec3()): Vec3 {
  return out.set(x - DESIGN_W / 2, DESIGN_H / 2 - y, 0);
}

/** 原型角度（顺时针为正）→ Cocos 角度（逆时针为正，单位度） */
export function toAngle(rad: number): number {
  return -rad * 180 / Math.PI;
}

/** 系统圆体字体栈（Web 平台生效；小游戏平台用系统默认字体） */
export const FONT_FAMILY = 'PingFang SC, HarmonyOS Sans SC, MiSans, Microsoft YaHei, sans-serif';
