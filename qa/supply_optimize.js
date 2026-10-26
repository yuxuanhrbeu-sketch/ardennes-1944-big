#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/supply_optimize.js — 补给点冗余/空洞优化（只读）
 *   ① 每个补给源"独有覆盖"的算子数（=0 说明该源对开局补给无贡献）
 *   ② 去掉它后会导致多少营断补（评估能否精简）
 *   ③ 仍存在的空洞（应为 0 → 开局 100%）
 *
 * ⚠️ 读法说明：判据是"对**开局在场算子**的补给贡献"。
 *   后方大枢纽（列日/布鲁塞尔/科隆/波恩/特里尔…）距离前线近百格，
 *   在开局自然"无贡献"——但它们承担的是纵深/战役后期的补给，
 *   以及被割断时的备用节点，**不是冗余，不要删**。
 *   真正可精简的是"前线重叠区内完全被邻点包住"的点，而本次已经
 *   是靠重叠达成 100% 的，所以没有需要精简的点。
 * 用法: node qa/supply_optimize.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const g = new Game('big', 20241216);

function coverageSet(side, skip) {
  const blocked = new Set();
  for (const u of g.units) if (u.alive && !u.exited && u.side !== side) blocked.add(Hex.key(u.c, u.r));
  const reach = new Set();
  for (const sc of g.supplySources(side)) {
    if (skip && sc.name === skip && sc.kind === 'town') continue;
    for (const k of g.supplyCoverageFrom(sc).keys()) if (!blocked.has(k)) reach.add(k);
  }
  return reach;
}

for (const side of ['DE', 'US']) {
  const mine = g.units.filter(u => u.alive && !u.arrive && u.side === side);
  const base = coverageSet(side, null);
  const missBase = mine.filter(u => !base.has(Hex.key(u.c, u.r)));
  console.log('=== ' + side + ' ===');
  console.log('  在场 ' + mine.length + ' 营；基线断补 ' + missBase.length + ' 营');

  // 逐源：独有覆盖
  const srcs = g.supplySources(side).filter(s => s.kind === 'town');
  const useless = [];
  for (const sc of srcs) {
    const without = coverageSet(side, sc.name);
    const lost = mine.filter(u => !without.has(Hex.key(u.c, u.r))).length;
    if (lost === 0) useless.push(sc.name + '[' + sc.c + ',' + sc.r + ']');
  }
  console.log('  对开局补给无贡献（可精简）的补给点: ' + (useless.length ? useless.join('  ') : '无'));
}
