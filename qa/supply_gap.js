#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/supply_gap.js — 补给覆盖诊断（只读）
 *   ① 两侧开局补给覆盖率
 *   ② 断补按师聚合（真实包围盒）
 *   ③ 各补给源的实际覆盖营数（0 = 冗余源）
 *   ④ 贪心求"最优新增补给点"（半径 R）
 * 用法: node qa/supply_gap.js [diag]
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

console.log('补给半径 R =', R, '  补给源', g.map.towns.filter(t => t.supply).length, '/ 城镇', g.map.towns.length);
const bad = open.filter(u => !u.supplied);
for (const side of ['DE', 'US']) {
  const all = open.filter(u => u.side === side);
  const b = all.filter(u => !u.supplied);
  console.log(`  ${side}: ${String(b.length).padStart(3)}/${all.length} 断补 → 覆盖 ${(100 * (1 - b.length / all.length)).toFixed(0)}%`);
}

if (bad.length) {
  const m = {};
  for (const u of bad) {
    const meta = D.OOB_BIG_META[u.id];
    const k = u.side + '|' + (meta ? meta.div : '?');
    if (!m[k]) m[k] = { n: 0, c0: 999, c1: -1, r0: 999, r1: -1 };
    const b = m[k];
    b.n++;
    b.c0 = Math.min(b.c0, u.c); b.c1 = Math.max(b.c1, u.c);
    b.r0 = Math.min(b.r0, u.r); b.r1 = Math.max(b.r1, u.r);
  }
  const list = Object.entries(m).sort((a, b) => b[1].n - a[1].n);
  console.log('\n断补师（前 20 / 共 ' + list.length + '）:');
  for (const [k, v] of list.slice(0, 20)) {
    console.log('  ' + k.padEnd(34) + String(v.n).padStart(3) + ' 营  c' + v.c0 + '-' + v.c1 + ' r' + v.r0 + '-' + v.r1);
  }
}

/* 各补给源覆盖量（0 = 完全冗余）——按**本阵营**统计，且排除被敌占格截断的格 */
console.log('\n补给源覆盖量（按本阵营在场算子计）:');
const rows = [];
for (const t of g.map.towns.filter(t => t.supply)) {
  let own = 0, foe = 0;
  const cov = g.townCoverage(t.c, t.r, t.ctrl);
  if (cov && cov.usable) {
    for (const k of cov.cost.keys()) {
      const p = Hex.parse(k);
      const u = g.unitAt(p.c, p.r);
      if (!u || !u.alive || u.arrive > 0) continue;
      if (u.side === t.ctrl) own++; else foe++;
    }
  }
  rows.push({ n: t.name, c: t.c, r: t.r, ctrl: t.ctrl, own, foe, tot: own });
}
const zero = rows.filter(x => x.tot === 0);
console.log('  冗余源(覆盖 0): ' + (zero.length ? zero.map(x => x.n + '[' + x.c + ',' + x.r + ']').join('  ') : '无'));
const leaked = rows.filter(x => x.foe > 0);
console.log('  跨阵营泄漏源: ' + (leaked.length ? leaked.map(x => x.n + '(敌' + x.foe + ')').join('  ') : '无 ✓'));
for (const x of rows.filter(x => x.tot > 0).sort((a, b) => b.tot - a.tot).slice(0, 20)) {
  console.log('  ' + x.n.padEnd(15) + '[' + String(x.c).padStart(3) + ',' + String(x.r).padStart(2) + '] ' + x.ctrl +
    '  本方' + String(x.own).padStart(3) + ' 敌' + String(x.foe).padStart(3));
}

/* 贪心求最优新增补给点 */
if (process.argv[2] === 'diag' && bad.length) {
  console.log('\n最优新增补给点（贪心，半径 ' + R + '）:');
  const remain = bad.slice();
  const picks = [];
  while (remain.length && picks.length < 30) {
    let best = null, bestN = 0;
    for (let c = 0; c < D.COLS; c++) {
      for (let r = 0; r < D.ROWS; r++) {
        let n = 0;
        for (const u of remain) if (Hex.distance(c, r, u.c, u.r) <= R) n++;
        if (n > bestN) { bestN = n; best = [c, r]; }
      }
    }
    if (!best || !bestN) break;
    picks.push({ at: best, covers: bestN });
    for (let i = remain.length - 1; i >= 0; i--) {
      if (Hex.distance(best[0], best[1], remain[i].c, remain[i].r) <= R) remain.splice(i, 1);
    }
  }
  for (const p of picks) {
    let near = null, nd = 1e9;
    for (const t of D.TOWNS) { const d = Hex.distance(t.c, t.r, p.at[0], p.at[1]); if (d < nd) { nd = d; near = t.name; } }
    console.log(`  [${String(p.at[0]).padStart(3)},${String(p.at[1]).padStart(2)}] 覆盖 ${String(p.covers).padStart(3)}  最近 ${near}(${nd})`);
  }
  if (remain.length) console.log('  仍剩余 ' + remain.length + ' 营无法覆盖');
}
