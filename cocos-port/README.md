# cocos-port · 团子捞捞乐 Cocos Creator 版

用 Cocos Creator 3.8.8 重做的版本，**画面、手感、数值与 `claw-machine-demo/index.html` 保持一致**。
Web 版在线试玩：**https://portfolio.horizondream.me/newGames/cocos/**

## 目录

| 路径 | 说明 |
|---|---|
| `assets/main.scene` | 手写的空场景；相机、画布、所有节点由 `scripts/boot.ts` 在运行时创建，不依赖编辑器拖拽 |
| `assets/scripts/core/game-core.ts` | 玩法核心（与渲染无关，不依赖 `cc`），从原型逐行移植，Node 可直接跑测试 |
| `assets/scripts/view/ctx2d.ts` | Canvas 2D 兼容层：在 Graphics / Sprite / Label 上实现原型用到的绘制 API，保证 1:1 |
| `assets/scripts/view/renderer.ts` | 表现层：逐函数移植原型绘制代码，团子/物品/钩子改用导出的精灵 |
| `assets/scripts/view/game-view.ts` | 主循环（顿帧）+ 点击分发 |
| `assets/scripts/view/audio.ts` | 音效表 + WebAudio 合成（与原型同一套音符） |
| `assets/resources/art/` | 由原型绘制函数导出的素材：`atlas/`（自动图集，构建后合成 1 张）+ `screen/`（背景、池框两张大图） |
| `test/core.test.ts` | 玩法核心单元测试（11 项） |
| `tools/` | 构建、部署、截图对比、点击测试脚本 |

## 常用命令

```bash
node --test "test/*.test.ts"          # 玩法核心单元测试（Node 24 直接运行 TS）
node tools/build.js                   # 构建调试包 → build/web-mobile/
node tools/build.js --release         # 构建发布包（压缩）
node tools/deploy.js                  # 发布包复制到仓库根目录 cocos/，提交推送后 GitHub Pages 生效

# 截图对比与点击测试（先起服务：python -m http.server 8323 --directory build/web-mobile）
node tools/shots.js                   # 7 个场景截图 → tools/shots/，并打印每个场景的 draw call
node tools/tap-check.js               # 模拟手指点击：菜单 → 选关 → 放钩 → 入槽
```

编辑器默认路径 `D:\Cocos\Creator\3.8.8\CocosCreator.exe`，可用环境变量 `COCOS_CREATOR` 覆盖。
构建脚本会自动清除 `ELECTRON_RUN_AS_NODE`（在 IDE 终端里运行时会继承这个变量，导致编辑器报 `bad option: --project`）。

## 修改画面

素材 PNG 不要手改：改 `claw-machine-demo/index.html` 里的绘制函数，然后重新导出：

```bash
cd claw-machine-demo
python -m http.server 8321            # 另开终端
node tools/export-sprites.js          # 输出到 ../cocos-port/assets/resources/art/
```

`manifest.json` 字段：`w`/`h` 像素尺寸（3 倍图）；`anchorX`/`anchorY` Cocos 锚点；`left`/`top` 大图在 375×667 中的左上角；`refR` 基准半径（节点缩放 = 实际半径 / refR）。

## 与原型的已知差异

- 池塘团子按半径 20 导出后缩放显示，描边在 1.6–2.5px 间变化（原型固定 2px），肉眼基本看不出
- 水面波纹的裁剪用矩形遮罩（原型是圆角矩形），波纹不经过圆角区域，看不出区别
- 字体粗细只有常规/粗体两档（与浏览器在 Windows 上的表现一致）

## 性能

- 发布包 2.76 MB（引擎 1.64 MB，已裁掉 Spine、龙骨、物理、瓦片地图、视频等 9 个用不到的模块）
- 最复杂的第 8 关画面 33 次 draw call（未用图集时 122 次）

## 后续：上架小游戏

- 构建平台改为 `wechatgame` / `bytedance-mini-game` 即可产出小游戏包
- 待接入：激励视频（复活、滑落挽回）、`wx.vibrateShort` 震动、分享、抖音侧边栏复访；小游戏平台没有 WebAudio 时需把 `audio.ts` 的音效表离线渲染为 WAV
