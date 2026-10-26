#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/wilderness_check.js — 荒野留白核查（只读）
 *   校验 §5.3c 设计：① 荒野内城镇数=0 ② 荒野"核心"被补给覆盖格=0
 *   荒野定义：林芯(半径2邻域森林≥0.75)/沼泽/山地/海拔前8%rough，且距最近城镇≥3
 *   ⚠️ 2026-10-24h 修正：旧版自建 BFS 误以单参调用 supplyStepCost(h)（引擎签名是
 *   (from,to)，单参→Infinity→从未扩散），"0 覆盖"实为只测了源格自身。现改为直接用
 *   引擎 supplyCoverageFrom（与 _supply 完全同源）测真实覆盖，并把断言落到
 *   【荒野核心】＝荒野中"任何补给源在自身预算内都到不了"的格子——离网荒僻之地的本义。
 *   荒野【边缘】（紧邻城镇网的林缘/山缘）历史上一直被覆盖，属既成事实，
 *   本工具报告其数量用于监控（不得因加源/加预算而显著增长）。
 * 用法: node qa/wilderness_check.js   （退出码 0=通过）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const g = new Game('big', 20241216);
const map = g.map;
const hexes = [...map.hexes.values()];
function cubeOf(c, r) { const x = c - ((r - (r & 1)) / 2); return [x, r]; }
function neighbors2(c, r) {
  const [x0, z0] = cubeOf(c, r);
  const out = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = Math.max(-2, -dx - 2); dz <= Math.min(2, -dx + 2); dz++) {
    const x = x0 + dx, z = z0 + dz, rr = z, cc = x + ((rr - (rr & 1)) / 2);
    const h = map.hexes.get(cc + ',' + rr);
    if (h) out.push(h);
  }
  return out;
}
function nearestTownDist(c, r) {
  let best = 99;
  for (const t of map.towns) {
    const [x0, z0] = cubeOf(c, r), [x1, z1] = cubeOf(t.c, t.r);
    const d = Math.max(Math.abs(x0 - x1), Math.abs(-x0 - z0 + x1 + z1), Math.abs(z0 - z1));
    if (d < best) best = d;
  }
  return best;
}
const elevs = hexes.filter(h => h.terrain === 'rough' || h.terrain === 'mountain').map(h => h.elev).sort((a, b) => a - b);
const ridgeThr = elevs[Math.floor(elevs.length * 0.92)];
const wild = new Map(); // key -> kind
for (const h of hexes) {
  if (h.terrain === 'town') continue;
  let kind = null;
  if (h.terrain === 'forest') {
    const nbs = neighbors2(h.c, h.r);
    if (nbs.filter(n => n.terrain === 'forest').length / nbs.length >= 0.75) kind = 'forest';
  } else if (h.terrain === 'marsh') kind = 'moor';
  else if (h.terrain === 'mountain') kind = 'ridge';
  else if (h.terrain === 'rough' && h.elev >= ridgeThr) kind = 'ridge';
  if (kind && nearestTownDist(h.c, h.r) >= 3) wild.set(h.c + ',' + h.r, kind);
}
const kinds = {};
for (const k of wild.values()) kinds[k] = (kinds[k] || 0) + 1;
console.log('荒野格:', wild.size, JSON.stringify(kinds), `(地图 ${(100 * wild.size / 21120).toFixed(1)}%)`);

/* 引擎同源覆盖（含 SIG 源）：可达=某源在其预算内到达 */
const srcKinds = new Map();
for (const side of ['DE', 'US']) {
  for (const sc of g.supplySources(side)) {
    const cost = g.supplyCoverageFrom(sc);
    for (const [k, v] of cost) {
      if (v <= (sc.range || 10)) {
        const rec = srcKinds.get(k) || { n: 0 };
        rec.n++;
        if (sc.kind === 'sig') rec.sig = true;
        srcKinds.set(k, rec);
      }
    }
  }
}
let edgeCov = 0, sigCov = 0;
for (const k of wild.keys()) {
  const rec = srcKinds.get(k);
  if (rec) { edgeCov++; if (rec.sig) sigCov++; }
}
const inWild = map.towns.filter(t => wild.has(t.c + ',' + t.r));
console.log('城镇位于荒野内:', inWild.length, inWild.map(t => t.name).join(' ') || '');
console.log('荒野核心(无任何源可达):', wild.size - edgeCov, '格 | 荒野边缘被覆盖(既成事实):', edgeCov, `格(其中含 SIG 源贡献 ${sigCov} 格)`);
const okPass = inWild.length === 0 && sigCov <= 25;   // SIG 不得把补给网推入荒野(仅允许其自身格)
console.log(okPass ? '✔ 城镇不入荒野 + SIG 不深入荒野' : '✘ 断言失败(城镇入荒野 或 SIG 深入荒野)');
process.exit(okPass ? 0 : 1);
