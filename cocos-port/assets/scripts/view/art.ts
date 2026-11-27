/**
 * 素材库：读取 resources/art/manifest.json，并按完整路径加载全部 SpriteFrame
 * （不同目录下有同名文件，如 dolls/cat-normal 与 dolls-tray/cat-normal，因此不能按文件名索引）
 */
import { resources, JsonAsset, SpriteFrame, Asset } from 'cc';
import type { ArtSource, SpriteMeta } from './ctx2d';

interface Manifest { scale: number; refR: number; sprites: Record<string, SpriteMeta> }

/** Promise 化的 resources.load */
function loadAsset<T extends Asset>(path: string, type: new () => T): Promise<T> {
  return new Promise((res, rej) => resources.load(path, type, (e: Error | null, a: T) => (e ? rej(e) : res(a))));
}

export class Art implements ArtSource {
  scale = 3;
  refR = 20;
  private metas: Record<string, SpriteMeta> = {};
  private frames = new Map<string, SpriteFrame>();

  /** 加载 manifest 与全部素材；onProgress 回调 0..1 */
  async load(onProgress?: (p: number) => void): Promise<void> {
    const json = (await loadAsset('art/manifest', JsonAsset)).json as unknown as Manifest;
    this.scale = json.scale;
    this.refR = json.refR;
    this.metas = json.sprites;
    const names = Object.keys(this.metas);
    let done = 0;
    await Promise.all(names.map(async name => {
      // file 形如 atlas/dolls/cat-normal.png → 资源路径 art/atlas/dolls/cat-normal/spriteFrame
      const file = this.metas[name].file.replace(/\.png$/, '');
      const frame = await loadAsset(`art/${file}/spriteFrame`, SpriteFrame);
      this.frames.set(name, frame);
      onProgress?.(++done / names.length);
    }));
  }

  frame(name: string): SpriteFrame | null { return this.frames.get(name) ?? null; }
  meta(name: string): SpriteMeta | undefined { return this.metas[name]; }
}
