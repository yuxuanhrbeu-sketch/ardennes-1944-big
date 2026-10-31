#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * classic_launch_check.js — 01/02 剧本继承核查（25f 口径，2026-10-27）
 * 25f 用户改令：01/02 不再跳转原版文件，改为**内置直接开局**
 *   （原版冻结数据 DATA_BASE + 共享引擎）；classic.html 仍随包分发。
 * 断言：
 *   1) classic 快照存在且纯净（随包分发的完整版）
 *   2) dist/ardennes44_classic.html 与快照逐字节一致
 *   3) ui.js：01/02 内置直接开局（无 launchClassic 跳转链）、AI 语义正确
 *   4) 菜单文案「原版数据」徽标
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const CL = path.join(ROOT, 'vendor', 'classic', 'ardennes44_classic.html');
const html = fs.existsSync(CL) ? fs.readFileSync(CL, 'utf8') : '';
console.log('== 1. 原版本体快照（随包分发） ==');
ok(html.length > 500000, 'classic 快照存在且体积量级正常', html.length ? Math.round(html.length / 1024) + 'KB' : '缺失');
ok(html.includes('<title>阿登1944 · 突出部战役兵棋推演</title>'), '是原版《阿登1944》成品（标题标记）');
ok(!html.includes('大阿登推演'), '未被大阿登产物污染');

console.log('== 2. dist 同步 ==');
const DC = path.join(ROOT, 'dist', 'ardennes44_classic.html');
if (fs.existsSync(DC)) {
  const a = fs.readFileSync(CL), b = fs.readFileSync(DC);
  ok(a.equals(b), 'dist/ardennes44_classic.html 与快照逐字节一致', Math.round(b.length / 1024) + 'KB');
} else ok(false, 'dist/ardennes44_classic.html 存在（先跑 node build.js）');

console.log('== 3. 启动链（ui.js 静态断言, 25f 口径） ==');
const ui = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
ok(!ui.includes('launchClassic'), '跳转原版启动链已移除（25f 用户改令）');
ok(ui.includes("startGame(selScen, null, { noTurnLimit: noLimit });"), '01/02 → startGame 内置直接开局');
ok(ui.includes("isBigScen"), '大推演系与 01/02 的 AI 语义分流（01/02 双方人类）');
const build = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
ok(build.includes('ardennes44_classic.html'), 'build 同步 classic 到 dist');

console.log('== 4. 菜单文案 ==');
ok(!ui.includes('sc-origin'), '01/02 无「原版数据」徽标（26b 用户指令删除）');
ok(!ui.includes('原版数据'), '已选提示不含原版数据标注（26b）');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
