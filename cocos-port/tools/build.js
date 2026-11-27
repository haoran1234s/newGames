/**
 * 命令行构建 web-mobile（无需打开编辑器界面）
 * 用法：node tools/build.js            → 调试包（未压缩，带性能面板）
 *       node tools/build.js --release  → 发布包（压缩混淆）
 * 环境变量 COCOS_CREATOR 可指定编辑器路径，默认 D:\Cocos\Creator\3.8.8\CocosCreator.exe
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CREATOR = process.env.COCOS_CREATOR ?? 'D:\\Cocos\\Creator\\3.8.8\\CocosCreator.exe';
const release = process.argv.includes('--release');
const sceneUuid = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/main.scene.meta'), 'utf-8')).uuid;
const LOG = path.join(ROOT, 'build-cli.log');

const opts = [
  'platform=web-mobile',
  `debug=${!release}`,
  `startScene=${sceneUuid}`,
  'outputName=web-mobile',
  'md5Cache=false',
].join(';');

// 本工具常在 Electron 宿主（IDE）里运行，会继承 ELECTRON_RUN_AS_NODE=1，
// 导致 CocosCreator.exe 以纯 Node 模式启动并报 "bad option: --project"，必须清掉
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

console.log(`构建 web-mobile（${release ? '发布' : '调试'}包）…`);
const t0 = Date.now();
const r = spawnSync(CREATOR, ['--project', ROOT, '--build', opts], { env, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
fs.writeFileSync(LOG, log);

// Cocos 命令行构建：退出码 36 = 成功，其余为失败
// 压缩引擎时 Electron 崩溃上报组件偶尔打出 "crashpad ... self-terminating"，不影响产物，只作提示
const SUCCESS = 36;
const errors = log.split(/\r?\n/).filter(l => / - error:|Build failed/i.test(l));
const out = path.join(ROOT, 'build/web-mobile/index.html');
const ok = r.status === SUCCESS && fs.existsSync(out) && fs.statSync(out).mtimeMs > t0;
console.log(`退出码 ${r.status}，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒，日志 ${path.relative(ROOT, LOG)}`);
errors.slice(0, 20).forEach(l => (ok ? console.warn : console.error)(`  ${ok ? '[提示]' : '[错误]'} ` + l.slice(0, 300)));
console.log(ok ? '✓ 构建成功 → build/web-mobile/' : '✗ 构建失败');
process.exit(ok ? 0 : 1);
