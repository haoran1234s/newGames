/**
 * 音效：与原型完全一致的振荡器合成音
 * 音效以「音符表」描述，Web 平台用 WebAudio 实时合成；同一张表也可离线渲染为 WAV 供小游戏平台使用
 */
import type { SfxName } from '../core/game-core';

/** 单个音符：频率、时长、波形、音量、相对起始时间（秒） */
export interface Note { f: number; dur: number; type: OscillatorType; vol: number; when: number }

const n = (f: number, dur: number, type: OscillatorType = 'sine', vol = 0.18, when = 0): Note => ({ f, dur, type, vol, when });

/** 音效表（数值与 claw-machine-demo/index.html 的 SFX 一一对应） */
export const SFX_TABLE: Record<SfxName, (arg?: number) => Note[]> = {
  drop: () => [n(500, 0.3, 'sine', 0.10)],
  clamp: () => [n(220, 0.08, 'square', 0.14), n(160, 0.1, 'square', 0.11, 0.05)],
  grab: () => [n(523, 0.12, 'sine', 0.15), n(659, 0.14, 'sine', 0.15, 0.08)],
  miss: () => [n(180, 0.2, 'triangle', 0.10)],
  deposit: () => [n(880, 0.1, 'sine', 0.14)],
  // 消除音随连击升调：combo 越高音阶越高
  eliminate: (combo = 1) => {
    const base = [523, 587, 659, 784, 880, 1047];
    const shift = Math.min(combo - 1, 5);
    return [0, 2, 4].map((k, i) => n(base[Math.min(shift + k, base.length - 1)], 0.14, 'triangle', 0.15, i * 0.07));
  },
  slip: () => [n(380, 0.18, 'sawtooth', 0.10), n(240, 0.25, 'sawtooth', 0.09, 0.12)],
  explode: () => [n(90, 0.5, 'sawtooth', 0.25), n(60, 0.6, 'square', 0.2, 0.05)],
  star: () => [784, 1047].map((f, i) => n(f, 0.14, 'sine', 0.14, i * 0.07)),
  tick: () => [n(1200, 0.05, 'square', 0.07)],
  win: () => [523, 659, 784, 1047, 1319].map((f, i) => n(f, 0.18, 'triangle', 0.15, i * 0.1)),
  fail: () => [440, 392, 330, 262].map((f, i) => n(f, 0.22, 'triangle', 0.12, i * 0.13)),
  rock: () => [n(140, 0.15, 'square', 0.12)],
  splash: () => [n(320, 0.12, 'sine', 0.07), n(190, 0.18, 'triangle', 0.05, 0.03)],
  starPop: (k = 0) => [n([784, 988, 1175][k] ?? 1175, 0.2, 'triangle', 0.16)],
};

type AudioCtor = new () => AudioContext;

/** WebAudio 合成播放器（环境不支持时静默） */
export class Sfx {
  private ac: AudioContext | null = null;

  constructor() {
    const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    try { this.ac = Ctor ? new Ctor() : null; } catch { this.ac = null; }
  }

  /** 浏览器要求用户交互后才能出声：在首次点击时调用 */
  resume(): void { void this.ac?.resume?.(); }

  play(name: SfxName, arg?: number): void {
    const ac = this.ac;
    if (!ac) return;
    SFX_TABLE[name](arg).forEach(({ f, dur, type, vol, when }) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = f;
      const t0 = ac.currentTime + when;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(ac.destination);
      o.start(t0); o.stop(t0 + dur);
    });
  }
}

/** 震动（Web：navigator.vibrate；小游戏平台后续接 wx/tt.vibrateShort） */
export function buzz(ms: number): void {
  try {
    (globalThis as unknown as { navigator?: { vibrate?: (ms: number) => boolean } }).navigator?.vibrate?.(ms);
  } catch { /* 部分浏览器禁止调用，忽略 */ }
}
