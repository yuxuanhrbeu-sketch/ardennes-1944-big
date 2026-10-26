#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/fill_gaps.js — 补给空洞定位（只读，辅助补城镇）
 *   对指定阵营，输出"未被任何补给源覆盖、但己方算子所在的格子"
 *   聚类后的空洞中心，便于按史实城镇精确补点。
 * 用法: node qa/fill_gaps.js [DE|US]
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
const side = process.argv[2] || 'DE';

/* 该阵营当前的总覆盖（用与 _supply 同款规则：扩散穿越敌占格） */
const blocked = new Set();
for (const u of g.units) if (u.alive && !u.exited && u.side !== side) blocked.add(Hex.key(u.c, u.r));
const reach = new Set();
for (const sc of g.supplySources(side)) {
  for (const k of g.supplyCoverageFrom(sc).keys()) if (!blocked.has(k)) reach.add(k);
}

/* 未覆盖的己方算子位置 */
const unsup = g.units.filter(u => u.alive && !u.arrive && u.side === side && !reach.has(Hex.key(u.c, u.r)));
console.log(side + ' 源 ' + g.supplySources(side).length + ' 座 覆盖 ' + reach.size +
  ' 格；己方在场 ' + g.units.filter(u => u.alive && !u.arrive && u.side === side).length +
  ' 营，其中未覆盖 ' + unsup.length);

/* 单连通聚类（按 4 格邻接聚类，找空洞中心） */
const pts = new Set(unsup.map(u => Hex.key(u.c, u.r)));
const seen = new Set();
const clusters = [];
for (const k of pts) {
  if (seen.has(k)) continue;
  const stack = [k], comp = [];
  seen.add(k);
  while (stack.length) {
    const cur = stack.pop();
    comp.push(cur);
    const p = Hex.parse(cur);
    for (let dc = -4; dc <= 4; dc++) {
      for (let dr = -4; dr <= 4; dr++) {
        const nk = Hex.key(p.c + dc, p.r + dr);
        if (pts.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
  }
  clusters.push(comp);
}
clusters.sort((a, b) => b.length - a.length);

console.log('\n空洞聚类（按算子数降序，给出建议补点中心）：');
for (const comp of clusters.slice(0, 16)) {
  let c0 = 999, c1 = -1, r0 = 999, r1 = -1, sc = 0, sr = 0;
  for (const k of comp) {
    const p = Hex.parse(k);
    c0 = Math.min(c0, p.c); c1 = Math.max(c1, p.c);
    r0 = Math.min(r0, p.r); r1 = Math.max(r1, p.r);
    sc += p.c; sr += p.r;
  }
  // 空洞中心取"能覆盖该簇最多算子"的位置（在簇包围盒内枚举）
  let best = null, bn = 0;
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      let n = 0;
      for (const k of comp) { const p = Hex.parse(k); if (Hex.distance(c, r, p.c, p.r) <= 7) n++; }
      if (n > bn) { bn = n; best = [c, r]; }
    }
  }
  console.log('  ' + String(comp.length).padStart(3) + ' 营  范围 c' + c0 + '-' + c1 + ' r' + r0 + '-' + r1 +
    '  建议补点 [' + best[0] + ',' + best[1] + ']  (附近可覆盖 ' + bn + ' 营)');
}
