/**
 * 部署：把 build/web-mobile 发布包复制到仓库根目录 cocos/，由 GitHub Pages 发布到 /newGames/cocos/
 * 用法：node tools/build.js --release && node tools/deploy.js，然后提交推送
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../build/web-mobile');
const DEST = path.resolve(__dirname, '../../cocos');

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error('✗ 未找到发布包，请先运行 node tools/build.js --release');
  process.exit(1);
}
// 目标目录只存放构建产物，整体替换
fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });
const files = fs.readdirSync(DEST, { recursive: true }).filter(f => fs.statSync(path.join(DEST, f)).isFile());
const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(DEST, f)).size, 0);
console.log(`✓ 已复制 ${files.length} 个文件（${(bytes / 1024 / 1024).toFixed(2)} MB）→ ${path.relative(path.resolve(__dirname, '../..'), DEST)}/`);
