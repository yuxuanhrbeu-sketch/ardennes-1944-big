#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/coverage_area.js — 补给"面积覆盖"核查（只读，不跑推演）
 *   与 supply_gap.js 不同：这里统计的是**地图格子的覆盖率**，
 *   而不是"算子是否被覆盖"。
 *   输出：双方各自覆盖的格数/占比、未覆盖格分布、按区域统计。
 * 用法: node qa/coverage_area.js [DE|US|ALL]
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
const total = D.COLS * D.ROWS;
const mode = process.argv[2] || 'ALL';

function reachOf(side) {
  const blocked = new Set();
  for (const u of g.units) if (u.alive && !u.exited && u.side !== side) blocked.add(Hex.key(u.c, u.r));
  const s = new Set();
  for (const sc of g.supplySources(side)) for (const k of g.supplyCoverageFrom(sc).keys()) if (!blocked.has(k)) s.add(k);
  return s;
}
const de = reachOf('DE'), us = reachOf('US');
const both = new Set([...de, ...us]);
const hexTotal = g.map.hexes.size;
console.log('地图 ' + D.COLS + '×' + D.ROWS + ' = ' + total + ' 格（实际 hex ' + hexTotal + '）');
console.log('  德军补给覆盖 ' + de.size + ' 格 (' + (100 * de.size / hexTotal).toFixed(1) + '%)');
console.log('  盟军补给覆盖 ' + us.size + ' 格 (' + (100 * us.size / hexTotal).toFixed(1) + '%)');
console.log('  双方合计覆盖 ' + both.size + ' 格 (' + (100 * both.size / hexTotal).toFixed(1) + '%)');
console.log('  **未覆盖 ' + (hexTotal - both.size) + ' 格 (' + (100 * (hexTotal - both.size) / hexTotal).toFixed(1) + '%)**');

/* 未覆盖格按 20×16 区块统计，找出面积缺口 */
const miss = new Map();
for (const [k, h] of g.map.hexes) if (!both.has(k)) miss.set(k, h);
const blocks = {};
for (const [k] of miss) {
  const p = Hex.parse(k);
  const bk = (Math.floor(p.c / 20) * 20) + ',' + (Math.floor(p.r / 16) * 16);
  blocks[bk] = (blocks[bk] || 0) + 1;
}
console.log('\n未覆盖格最多的区块（20×16=320 格/块）：');
for (const [b, n] of Object.entries(blocks).sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log('   c' + b.padEnd(8) + ' ' + String(n).padStart(3) + ' 格  (' + (100 * n / 320).toFixed(0) + '% 未覆盖)');
}

/* 若要"全图覆盖"还差多少：按每城平均新增覆盖估算 */
const srcs = g.supplySources('DE').length + g.supplySources('US').length;
const avg = (de.size + us.size) / Math.max(1, srcs);
console.log('\n现有补给点 ' + srcs + ' 座，平均每座覆盖 ' + avg.toFixed(0) + ' 格');
console.log('若要把 ' + (total - both.size) + ' 格全部补上，粗估还需约 ' +
  Math.ceil((total - both.size) / avg) + ' 座补给点（未计重叠损耗，实际更多）');
