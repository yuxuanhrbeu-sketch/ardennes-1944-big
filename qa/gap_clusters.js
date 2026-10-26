#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* 列出未覆盖格，按单连通聚类给出补点中心（只读） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;
const g = new Game('big', 20241216);

function reachOf(side) {
  const blocked = new Set();
  for (const u of g.units) if (u.alive && !u.exited && u.side !== side) blocked.add(Hex.key(u.c, u.r));
  const s = new Set();
  for (const sc of g.supplySources(side)) for (const k of g.supplyCoverageFrom(sc).keys()) if (!blocked.has(k)) s.add(k);
  return s;
}
const both = new Set([...reachOf('DE'), ...reachOf('US')]);
const pts = new Set();
for (const [k] of g.map.hexes) if (!both.has(k)) pts.add(k);

/* 单连通聚类（邻接 ≤6 步内视为同簇） */
const seen = new Set(); const cl = [];
for (const k of pts) {
  if (seen.has(k)) continue;
  const st = [k], comp = []; seen.add(k);
  while (st.length) {
    const cur = st.pop(); comp.push(cur);
    const p = Hex.parse(cur);
    for (let dc = -3; dc <= 3; dc++) for (let dr = -3; dr <= 3; dr++) {
      const nk = Hex.key(p.c + dc, p.r + dr);
      if (pts.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); }
    }
  }
  cl.push(comp);
}
cl.sort((a, b) => b.length - a.length);
console.log('未覆盖 ' + pts.size + ' 格，聚成 ' + cl.length + ' 簇；前 30 簇：');
for (const comp of cl.slice(0, 30)) {
  let c0 = 999, c1 = -1, r0 = 999, r1 = -1;
  for (const k of comp) { const p = Hex.parse(k); c0 = Math.min(c0, p.c); c1 = Math.max(c1, p.c); r0 = Math.min(r0, p.r); r1 = Math.max(r1, p.r); }
  // 选覆盖本簇最多的补点中心
  let best = null, bn = 0;
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
    let n = 0;
    for (const k of comp) { const p = Hex.parse(k); if (Hex.distance(c, r, p.c, p.r) <= 8) n++; }
    if (n > bn) { bn = n; best = [c, r]; }
  }
  console.log('  ' + String(comp.length).padStart(4) + ' 格  c' + c0 + '-' + c1 + ' r' + r0 + '-' + r1 +
    '  → 补点 [' + best[0] + ',' + best[1] + '] (可覆盖 ' + bn + ')');
}
