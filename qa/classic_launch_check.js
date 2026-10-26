#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * classic_launch_check.js — 01/02 剧本彻底继承原版核查（24u，2026-10-25）
 * 断言：
 *   1) vendor/classic/ardennes44_classic.html 存在且为原版本体
 *      （<title>阿登1944、含原版引擎标记、体积量级正常）
 *   2) build 后 dist/ardennes44_classic.html 与 vendor 快照逐字节一致
 *   3) ui.js 启动链：非 big 剧本 → launchClassic(window.open) → 回退兼容
 *   4) 菜单文案标注「原版」
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const CL = path.join(ROOT, 'vendor', 'classic', 'ardennes44_classic.html');
const html = fs.existsSync(CL) ? fs.readFileSync(CL, 'utf8') : '';
console.log('== 1. 原版本体快照 ==');
ok(html.length > 500000, 'classic 快照存在且体积量级正常', html.length ? Math.round(html.length / 1024) + 'KB' : '缺失');
ok(html.includes('<title>阿登1944 · 突出部战役兵棋推演</title>'), '是原版《阿登1944》成品（标题标记）');
ok(!html.includes('大阿登推演'), '未被大阿登产物污染');
ok(html.includes('achv') || html.includes('成就'), '含原版后期特性（成就系统等）', '原版 10/18 完整版');

console.log('== 2. dist 同步 ==');
const DC = path.join(ROOT, 'dist', 'ardennes44_classic.html');
if (fs.existsSync(DC)) {
  const a = fs.readFileSync(CL), b = fs.readFileSync(DC);
  ok(a.equals(b), 'dist/ardennes44_classic.html 与快照逐字节一致', Math.round(b.length / 1024) + 'KB');
} else ok(false, 'dist/ardennes44_classic.html 存在（先跑 node build.js）');

console.log('== 3. 启动链（ui.js 静态断言） ==');
const ui = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
ok(ui.includes('launchClassic') && ui.includes("window.open(rel, '_blank')"), '01/02 → 新窗口打开原版本体');
ok(ui.includes('selScen !== \'big\''), '仅 03 走大推演引擎');
ok(ui.includes('改用内置兼容模式'), '打开失败回退内置兼容模式 + 横幅说明');
const build = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
ok(build.includes('ardennes44_classic.html'), 'build 同步 classic 到 dist');

console.log('== 4. 菜单文案 ==');
ok(ui.includes('sc-origin') && (ui.match(/sc-origin">原版</g) || []).length === 2, '01/02 卡片标注「原版」徽标');
ok(ui.includes('原版独立运行'), '已选提示注明原版独立运行');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
