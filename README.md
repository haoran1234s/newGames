# newGames

手机小游戏原型集，目标平台：抖音小游戏 / 微信小游戏。

## 原型列表

| 目录 | 玩法 | 状态 |
|---|---|---|
| `claw-machine-demo/` | 心动娃娃机（黄金矿工魔改：摆动→下落→夹取→滑落/出货） | 可玩原型 |

## 试玩

GitHub Pages 部署地址（手机浏览器直接打开）：

**https://haoran1234s.github.io/newGames/claw-machine-demo/**

操作：爪子自动左右摆动，点击屏幕任意处放下爪子，夹到娃娃送往出货口。

## 技术路线

- 原型阶段：纯 HTML5 Canvas + WebAudio 合成音效，零依赖单文件
- 正式版：Cocos Creator 3.x（TypeScript），一套工程发布微信/抖音双端
