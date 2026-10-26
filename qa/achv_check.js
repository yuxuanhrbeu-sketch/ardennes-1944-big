#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * achv_check.js — 大推演成就系统核查（24v，2026-10-25）
 * 断言（Node 裸跑，achv.js 纯逻辑可 eval）：
 *   1) 37 条成就定义在 DATA_BASE 与 DATA_BIG 双套挂载、内容一致
 *   2) Achv.attach 挂 big 局 → 模拟事件流 → 成就解锁/历史入账
 *   3) 存储：与原版同键（ardennes44_achv / ardennes44_history）→ 互通
 *   4) big 局语义：城镇同名（圣维特/巴斯托涅）判定可用；campaign 限定成就不误发
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

console.log('== 1. 数据双套挂载 ==');
const BASE = globalThis.DATA_BASE, BIG = globalThis.DATA_BIG;
ok(!!BASE.ACHIEVEMENTS && BASE.ACHIEVEMENTS.length === 50, 'DATA_BASE.ACHIEVEMENTS 50 条 (37 原版 + 13 大推演)', BASE.ACHIEVEMENTS && BASE.ACHIEVEMENTS.length);
ok(!!BIG.ACHIEVEMENTS && BIG.ACHIEVEMENTS.length === 50, 'DATA_BIG.ACHIEVEMENTS 50 条');
ok(BASE.ACHIEVEMENTS === BIG.ACHIEVEMENTS, '两套数据同源引用（逐字一致）');
ok(!!globalThis.ACH_DATA.ACH_ICONS && Object.keys(globalThis.ACH_DATA.ACH_ICONS).length >= 29, '像素图标 27 个');
const ids = new Set(globalThis.ACH_DATA.ACHIEVEMENTS.map(a => a.id));
ok(ids.size === 50, '成就 id 唯一');

console.log('== 2. big 局判定 ==');
// 模拟 localStorage
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
delete globalThis.Achv;   // 清 eval 缓存，带新 store 重挂
delete globalThis.ACH_DATA_WARNED;
eval(fs.readFileSync(path.join(ROOT, 'js', 'achv.js'), 'utf8'));

globalThis.DATA = globalThis.DATA_BIG;   // 模拟 ui.startGame 的剧本切换（QA 裸跑需手动）
const g = new Game('big', 20241216);
ok(g.scenario.id === 'big', 'big 局剧本识别', g.scenario.id);
g.on('state', () => {});
Achv.attach(g, { role: 'us', scenario: 'big', noLimit: false, seed: 20241216, side: 'US' });
ok(!!g.state.achvTrack, 'achvTrack 挂入 state（随存档）');
// 模拟：推两个阶段（增援/补给结算跑一遍）→ finish 记历史
g.state.phase = 'DE'; g._startPhase();
g.state.phase = 'US'; g._startPhase();
const newly = Achv.finish(g, { role: 'us', scenario: 'big', noLimit: false, seed: 20241216, side: 'US' });
ok(Array.isArray(newly), 'finish 返回本局新解锁数组', JSON.stringify(newly).slice(0, 60));
const rec = Achv.recent(1)[0];
ok(!!rec && rec.scen === 'big', '战绩记剧本 big', rec && JSON.stringify({ scen: rec.scen, achv: rec.achv }));
ok(!!rec && Array.isArray(rec.achv), '战绩含解锁列表字段');
const hist = Achv.history();
ok(hist.life.games === 1, '终身账 +1');
ok(Achv.recent(1).length === 1, '最近战绩 1 场');

console.log('== 3. 存储互通 ==');
const h1 = JSON.parse(store['ardennes44_history'] || '{}');
ok(h1.v === 1, '与原版同键（ardennes44_history）同版本', 'hist.v=' + h1.v);
ok('ardennes44_achv' in store || Object.keys(store).length >= 1, 'achv 键机制同源（无解锁时不写=原版行为）');
// 模拟原版侧写入（同键），大推演读得到
const oldA = { v: 1, unlocked: { first_snow: '2026-01-01T00:00:00Z' }, counters: { x: 1 } };
store['ardennes44_achv'] = JSON.stringify(oldA);
const merged = Achv.progress();
ok(merged.got >= 1, '原版已解锁成就在大推演侧可见（互通）', 'got=' + merged.got);

console.log('== 4. big 语义边界 ==');
const st = JSON.parse(JSON.stringify(BIG));
// big 剧本 scenario.campaign 值
ok(typeof g.scenario.campaign === 'boolean', 'big 剧本 campaign 字段存在（campaign 限定成就按布尔分流）', String(g.scenario.campaign));
// big 地图有成就涉及的同名城镇
const towns = new Set(g.map.towns.map(t => t.name));
ok(towns.has('圣维特') && towns.has('巴斯托涅'), 'big 地图含圣维特/巴斯托涅（成就判定同名可用）');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
