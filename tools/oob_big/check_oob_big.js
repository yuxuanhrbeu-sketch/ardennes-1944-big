#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * check_oob_big.js — 大推演 OOB 数据静态自检（Phase 0，零依赖）
 *
 * 只做数据校验，不生成地图、不跑任何推演（工程纪律 2026-10-08）。
 * 用法：node tools/oob_big/check_oob_big.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'js', 'data_big_oob.js');
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); console.log('  [FAIL] ' + msg); }
}

// 在 Node 里裸跑数据模块（模拟引擎 eval 方式）
const src = fs.readFileSync(FILE, 'utf8');
eval(src);
const D = globalThis.DATA_BIG_OOB;
ok(!!D, 'DATA_BIG_OOB 已导出');
if (!D) { console.log('致命：数据模块不可用'); process.exit(1); }

const { OOB_BIG_DE, OOB_BIG_US, OOB_BIG_META, DATES_BIG } = D;
const all = [
  ...OOB_BIG_DE.map(r => [r, 'DE']),
  ...OOB_BIG_US.map(r => ['US']),
];
const rows = [
  ...OOB_BIG_DE.map(r => ({ row: r, side: 'DE' })),
  ...OOB_BIG_US.map(r => ({ row: r, side: 'US' })),
];

console.log('== 1. 规模 ==');
ok(OOB_BIG_DE.length === 463, '德军 463 行 = 449 营 + 14 指挥部 (实际 ' + OOB_BIG_DE.length + ')');
ok(OOB_BIG_US.length === 754, '盟军池 754 行 = 美 644 + 英 99 + 11 指挥部 (实际 ' + OOB_BIG_US.length + ')');
ok(rows.length === 1217, '合计 1217 行 = 1192 营 + 25 指挥部 (实际 ' + rows.length + ')');
const ukCount = Object.values(OOB_BIG_META).filter(m => m.nat === 'UK').length;
ok(ukCount === 101, '英军标记 101 = 99 营 + 2 座英军指挥部 (实际 ' + ukCount + ')');

console.log('== 2. 来源口径 ==');
const srcRec = Object.values(OOB_BIG_META).filter(m => m.src === '记载').length;
const srcInf = Object.values(OOB_BIG_META).filter(m => m.src === '推定').length;
ok(srcRec === 671, '记载 671 = 646 + 25 指挥部 (实际 ' + srcRec + ')');
ok(srcInf === 546, '推定 546 (实际 ' + srcInf + ')');

console.log('== 3. id / 缩写 / 类型 ==');
const ids = new Set();
for (const { row } of rows) ids.add(row[0]);
ok(ids.size === 1217, 'id 全局唯一 (实际 ' + ids.size + ')');
const TYPES_OK = new Set(['INF','FJ','VGD','MOT','ARM','ABN','ART','RECON','TD','ENGR','SIG','RKT','HQK','HQA','HQT']);
const badType = rows.filter(r => !TYPES_OK.has(r.row[3]));
ok(badType.length === 0, '类型枚举合法 (非法 ' + badType.length + ')');
const abbrByPool = { DE: new Set(), US: new Set() };
let abbrBad = 0, abbrDup = 0;
for (const { row, side } of rows) {
  const a = row[2], pool = abbrByPool[side];
  if (!a || a.length > 8) abbrBad++;
  if (pool.has(a)) abbrDup++;
  pool.add(a);
}
ok(abbrBad === 0, '缩写非空且 ≤8 字 (违规 ' + abbrBad + ')');
ok(abbrDup === 0, '缩写同侧唯一 (重复 ' + abbrDup + ')');

console.log('== 4. 坐标 ==');
const inMap = rows.every(r => r.row[7] >= 0 && r.row[7] < 220 && r.row[8] >= 0 && r.row[8] < 96);
ok(inMap, '全部落格在 220×96 新图内');
const opening = rows.filter(r => r.row[9] === 0);
const occ = new Set();
let dupOpen = 0;
for (const { row } of opening) {
  const k = row[7] + ',' + row[8];
  if (occ.has(k)) dupOpen++;
  occ.add(k);
}
ok(dupOpen === 0, '开局(回合0)落格无同格冲突 (冲突 ' + dupOpen + ')');
ok(opening.filter(r => r.side === 'DE').length === 404, '德军开局 404 = 390 营 + 14 指挥部 (实际 ' + opening.filter(r => r.side === 'DE').length + ')');
ok(opening.filter(r => r.side === 'US').length === 201, '盟军开局 201 = 190 营 + 11 指挥部 (实际 ' + opening.filter(r => r.side === 'US').length + ')');

console.log('== 5. 入场回合与日历 ==');
ok(DATES_BIG.length === 41, '日历 41 回合 (实际 ' + DATES_BIG.length + ')');
ok(DATES_BIG[0] === '1944-12-16' && DATES_BIG[40] === '1945-01-25', '日历首尾 12.16 → 1.25');
const badTurn = rows.filter(r => r.row[9] < 0 || r.row[9] > 40);
ok(badTurn.length === 0, '入场回合 ∈ [0,40] (越界 ' + badTurn.length + ')');
// META.from 与行内入场回合一致
function toTurn(s) {
  const m = s.match(/^(1944\.12|1945\.01)-(\d+)$/);
  if (!m) return -999;
  return m[1] === '1944.12' ? parseInt(m[2], 10) - 16 : 15 + parseInt(m[2], 10);
}
let metaMismatch = 0;
for (const { row } of rows) {
  const m = OOB_BIG_META[row[0]];
  if (!m || Math.max(0, toTurn(m.from)) !== row[9]) metaMismatch++;  // 与生成端同口径: 早于 12.16 钳为 0
}
ok(metaMismatch === 0, 'META.from 与入场回合一致 (不一致 ' + metaMismatch + ')');

console.log('== 6. 增援曲线抽查（对照战斗序列统计页） ==');
function arrivals(side, turn) {
  return rows.filter(r => r.side === side && r.row[9] === turn).length;
}
ok(arrivals('DE', 18 - 16) === 42, '德军 12.18 入场 42 (实际 ' + arrivals('DE', 2) + ')');
ok(arrivals('DE', 19 - 16) === 17, '德军 12.19 入场 17 (实际 ' + arrivals('DE', 3) + ')');
ok(arrivals('US', 17 - 16) === 82, '美军 12.17 入场 82 (实际 ' + arrivals('US', 1) + ')');
ok(arrivals('US', 19 - 16) === 121, '美军 12.19 入场 121 (实际 ' + arrivals('US', 3) + ')');
ok(arrivals('US', 20 - 16) === 117, '盟军池 12.20 入场 117 = 美军 49 + 英军 68 (实际 ' + arrivals('US', 4) + ')');
ok(rows.filter(r => r.side === 'US' && OOB_BIG_META[r.row[0]].nat === 'UK' && r.row[9] === 4).length === 68, '英军 12.20 入场 68');

console.log('== 7. META 完整性 ==');
let missing = 0;
for (const { row } of rows) if (!OOB_BIG_META[row[0]]) missing++;
ok(missing === 0, '每个算子都有 META (缺失 ' + missing + ')');
const noDiv = Object.values(OOB_BIG_META).filter(m => !m.div).length;
  { // 24i 组织度大平衡: 8~20 分层, 开局满编
    const badOrg = rows.filter(r => r.row.length < 12 || typeof r.row[11] !== 'number' || r.row[10] !== r.row[11] || r.row[11] < 8 || r.row[11] > 20);
    ok(badOrg.length === 0, '组织度分层: 全行 [10]==[11] 且 ∈[8,20] (违规 ' + badOrg.length + ')');
    const dist = {};
    for (const r of rows) dist[r.row[11]] = (dist[r.row[11]] || 0) + 1;
    const spread = Object.keys(dist).map(Number);
    ok(Math.min(...spread) >= 8 && Math.max(...spread) <= 20, '组织度区间 [' + Math.min(...spread) + '..' + Math.max(...spread) + ']');
  }
ok(noDiv === 0, 'META 归属链完整 (缺师/旅 ' + noDiv + ')');

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail > 0) { console.log(fails.join('\n')); process.exit(1); }
