# newGames

手机小游戏原型集，目标平台：抖音小游戏 / 微信小游戏。

## 原型列表

| 目录 | 玩法 | 状态 |
|---|---|---|
| `claw-machine-demo/` | **团子捞捞乐 v2**：黄金矿工钩子 × 槽位三消 × 闯关制 | 可玩原型（逻辑冒烟测试覆盖） |

v1（纯娃娃机收集版）存档于 `claw-machine-demo/index.v1.html`。

## 试玩

GitHub Pages 部署地址（手机浏览器直接打开）：

**https://portfolio.horizondream.me/newGames/claw-machine-demo/**

操作：钩子自动摆动，看准时机点击屏幕放钩；捞起的团子进入底部 7 格槽位，凑齐 3 只同款自动消除；倒计时内达成关卡目标过关，槽满即败。

## 团子捞捞乐 v2 设计要点

- **核心**：黄金矿工钩子物理 × 羊了个羊槽位三消压力 × 闯关制（8 关）
- **障碍物**：石头（重物时间惩罚）、河豚炸弹（爆炸震开物品+眩晕）
- **道具**：时钟星（+5s）、万能团子（替代任意款凑三）
- **紧张机制**：传说独角兽上升途中可能滑落（激励视频点位）
- **商业化标注**：槽满复活广告位、滑落挽回广告位
- 详见 `claw-machine-demo/DESIGN.md`

## 测试

```bash
cd claw-machine-demo
node test/smoke.js    # 逻辑冒烟测试（Node 桩掉浏览器环境跑真实游戏逻辑）
node test/probe.js    # 命中率/分布探针
```

## 技术路线

- 原型阶段：纯 HTML5 Canvas + WebAudio 合成音效，零依赖单文件
- 正式版：Cocos Creator 3.x（TypeScript），一套工程发布微信/抖音双端
