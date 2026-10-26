#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/density_check.js — 算子布防密度核查（只读，不跑推演）
 *   ① 开局算子整体占格率
 *   ② 同阵营相邻对数 ÷ 算子数（拥挤度指标，越低越舒展）
 *   ③ 按扇区（师）统计：包围盒、算子数、实际占格、密度、与最近他师间距
 *   ④ 最密的 N 个师 + 最空的地方
 * 用法: node qa/density_check.js [N]
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;
const g = new Game('big', 20241216);
const open = g.units.filter(u => !u.arrive);
const N = +(process.argv[2] || 14);

console.log('地图 ' + D.COLS + 'x' + D.ROWS + ' = ' + (D.COLS * D.ROWS) + ' 格');
console.log('开局算子 ' + open.length + ' (德 ' + open.filter(u => u.side === 'DE').length +
  ' / 盟 ' + open.filter(u => u.side === 'US').length + ')');
console.log('占格率 ' + (100 * open.length / (D.COLS * D.ROWS)).toFixed(2) + '%');

/* 拥挤度：同阵营相邻对数 / 算子数 */
let adj = 0;
for (const u of open) {
  for (const p of Hex.neighbors(u.c, u.r)) {
    const o = g.unitAt(p.c, p.r);
    if (o && o.side === u.side && o.uid > u.uid) adj++;
  }
}
console.log('同阵营相邻对数 ' + adj + '  → 拥挤度 ' + (adj / open.length).toFixed(2) + '（旧 76×48 布防约 0.9；越接近 0 越舒展）');

/* 按师聚合 */
const byDiv = {};
for (const u of open) {
  const m = D.OOB_BIG_META[u.id] || {};
  const k = u.side + '|' + (m.div || '?');
  if (!byDiv[k]) byDiv[k] = { n: 0, side: u.side, cells: new Set(), c0: 999, c1: -1, r0: 999, r1: -1, div: m.div, corps: m.corps };
  const b = byDiv[k];
  b.n++; b.cells.add(u.c + ',' + u.r);
  b.c0 = Math.min(b.c0, u.c); b.c1 = Math.max(b.c1, u.c);
  b.r0 = Math.min(b.r0, u.r); b.r1 = Math.max(b.r1, u.r);
}
const list = Object.entries(byDiv).map(([k, v]) => {
  const w = v.c1 - v.c0 + 1, h = v.r1 - v.r0 + 1;
  const area = w * h;
  return { key: k, ...v, w, h, area, density: v.n / area, expand: area / v.n };
}).sort((a, b) => b.density - a.density);

console.log('\n=== 最密的 ' + N + ' 个师（密度 = 算子数/包围盒面积；舒展度 = 面积/算子数） ===');
console.log('  ' + '师'.padEnd(30) + '算子  包围盒      面积  密度   舒展度');
for (const x of list.slice(0, N)) {
  console.log('  ' + String(x.div).padEnd(28) + String(x.n).padStart(3) + '   c' + x.c0 + '-' + x.c1 + ' r' + x.r0 + '-' + x.r1 +
    '  ' + String(x.area).padStart(5) + '  ' + x.density.toFixed(3) + '  ' + x.expand.toFixed(1));
}

console.log('\n=== 最舒展的 ' + N + ' 个师 ===');
for (const x of list.slice(-N)) {
  console.log('  ' + String(x.div).padEnd(28) + String(x.n).padStart(3) + '   c' + x.c0 + '-' + x.c1 + ' r' + x.r0 + '-' + x.r1 +
    '  ' + String(x.area).padStart(5) + '  ' + x.density.toFixed(3) + '  ' + x.expand.toFixed(1));
}

/* 全阵营整体：按 10x10 区块统计算子数，找最挤的区块 */
const blocks = {};
for (const u of open) {
  const k = Math.floor(u.c / 10) * 10 + ',' + Math.floor(u.r / 10) * 10;
  blocks[k] = (blocks[k] || 0) + 1;
}
console.log('\n=== 算子最多的 10×10 区块 ===');
for (const [k, n] of Object.entries(blocks).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log('   c' + k + '   ' + n + ' 算子  (密度 ' + (n / 100).toFixed(2) + ')');
}
