#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/layout_try.js — 布防/城镇方案快速试算（只读，不动项目文件）
 *
 * 用途：地图重制期间反复试"城镇 + 部署扇区"坐标，不必反复改
 *       js/data_big.js 与重跑生成器。直接读 OOB 的既有坐标，
 *       只替换城镇/扇区即可评估补给覆盖与地理自洽性。
 *
 * 输出：两侧补给覆盖率、断补按师聚合、算子跨度、按扇区中心到最近
 *       补给源的距离排序（找出补给真空区）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;
const R = D.SUPPLY_R_TOWN;

const g = new Game('big', 20241216);
const open = g.units.filter(u => !u.arrive);

/* 每个补给源的覆盖贡献 */
const sources = g.map.towns.filter(t => t.supply);
console.log('补给源', sources.length, '座  半径', R);
for (const side of ['DE', 'US']) {
  const all = open.filter(u => u.side === side);
  const bad = all.filter(u => !u.supplied);
  console.log(`  ${side}: ${String(bad.length).padStart(3)}/${all.length} 断补 → 覆盖 ${(100 * (1 - bad.length / all.length)).toFixed(0)}%`);
}

/* 断补按师聚合 */
const bad = open.filter(u => !u.supplied);
if (bad.length) {
  const m = {};
  for (const u of bad) {
    const meta = D.OOB_BIG_META[u.id];
    const k = u.side + '|' + (meta ? meta.div : '?');
    if (!m[k]) m[k] = { n: 0, c0: 999, c1: -1, r0: 999, r1: -1 };
    const b = m[k];
    b.n++; b.c0 = Math.min(b.c0, u.c); b.c1 = Math.max(b.c1, u.c);
    b.r0 = Math.min(b.r0, u.r); b.r1 = Math.max(b.r1, u.r);
  }
  const list = Object.entries(m).sort((a, b) => b[1].n - a[1].n);
  console.log('\n断补师（前 18）:');
  for (const [k, v] of list.slice(0, 18)) {
    console.log('  ' + k.padEnd(34) + String(v.n).padStart(3) + ' 营  c' + v.c0 + '-' + v.c1 + ' r' + v.r0 + '-' + v.r1);
  }
  console.log('  断补师数 ' + list.length);
}

/* 每座自己的补给源覆盖了多少营（找出冗余源） */
console.log('\n各补给源覆盖本阵营算子数（0 = 冗余）:');
const rows = [];
for (const t of sources) {
  let de = 0, us = 0;
  for (const u of open) {
    if (Hex.distance(t.c, t.r, u.c, u.r) > R) continue;
    if (u.side === 'DE') de++; else us++;
  }
  rows.push({ n: t.name, c: t.c, r: t.r, side: t.ctrl, de, us, tot: de + us });
}
for (const x of rows.sort((a, b) => a.tot - b.tot)) {
  console.log('  ' + x.n.padEnd(14) + '[' + String(x.c).padStart(3) + ',' + String(x.r).padStart(2) + '] ' + x.side +
    '  德' + String(x.de).padStart(3) + ' 盟' + String(x.us).padStart(3));
}
