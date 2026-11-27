# cocos-port · 团子捞捞乐 Cocos Creator 移植

目标：用 Cocos Creator 3.8.9 重做，**画面和手感与 `claw-machine-demo/index.html` 保持一致**，同时可以构建微信/抖音小游戏和 Web 移动端（继续部署到 GitHub Pages）。

## 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0b 美术导出 | 用现版绘制函数导出 93 张 3 倍图 + `art/manifest.json` | 完成 |
| 0a 逻辑核心 | 与渲染无关的 TypeScript 玩法核心 `core/`，测试迁移 | 待做 |
| 0c 音效导出 | 合成音效离线渲染为 WAV | 待做 |
| 1 Cocos 工程 | 场景、渲染组件、动画、HUD、界面 | 需安装 Cocos Creator 3.8.9 |
| 2 发布 | 构建 web-mobile 部署到 `/newGames/cocos/`，截图对比验收 | 待做 |

## art/ 素材

由 `claw-machine-demo/tools/export-sprites.js` 生成，**不要手改 PNG**，改画面请改 `index.html` 的绘制函数后重新导出：

```bash
cd claw-machine-demo
python -m http.server 8321          # 另开一个终端
node tools/export-sprites.js        # 输出到 ../cocos-port/art/
```

| 目录 | 内容 |
|---|---|
| `dolls/` | 池塘团子 7 种 × 4 表情（normal / blink / happy / shock），基准半径 20 |
| `dolls-tray/` | 槽位团子 7 种 × 5 表情，描边按显示半径 15 加粗，显示时仍是 2px |
| `ui/` | 菜单、选关、失败面板里的大团子（按原尺寸导出） |
| `items/` | 石头 3 种形状 + 飘起的 z、河豚、闹钟 |
| `fx/` | 闹钟光晕、珊瑚/金色闪光、爱心 |
| `claw/` | 滑块、左右钩臂、钩头 3 种表情、滑轨 |
| `pond/` | 静态池框（含渐变水体和叶子）、单段波纹 |
| `bg/` | 纸张背景（点阵 + 固定种子颗粒） |

### manifest.json 字段

- `w` / `h`：PNG 像素尺寸（3 倍图），Cocos 中逻辑尺寸 = 像素 / 3
- `anchorX` / `anchorY`：Cocos 锚点（y 轴向上），即原绘制原点在图中的位置，直接填到 UITransform 的 anchorPoint
- `left` / `top`：`screen` 类素材（背景、池框、滑轨）在 375×667 游戏坐标中的左上角
- `refR`：绘制时的基准半径，节点缩放 = 实际半径 / refR

### 与现版的已知差异

- 池塘团子按半径 20 导出后缩放到 16–25，描边会随之变为 1.6–2.5px（现版固定 2px），肉眼基本看不出
- 稀有闪光、闹钟光晕、石头的 z、钩臂开合、河豚呼吸这些动画部件单独导出，由 Cocos 做动画
- 卡片、按钮、槽位格子、进度条、星星这类纯色矢量 UI 不导出，Cocos 中用 Graphics 组件绘制，文字用 Label 加描边
