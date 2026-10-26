#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/probe_costs.js — 关键子过程单次成本（Node，只读）
 *   _supply 全图 BFS / _startPhase / passiveState / syncUnits 的 CPU 等价路径
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js', 'ai.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;

function bench(label, fn, n) {
  fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('  ' + label.padEnd(52) + (ms / n).toFixed(2).padStart(9) + ' ms/次   n=' + n);
  return ms / n;
}

const g = new Game('big', 20241216);
console.log('== 开局（580 算子）==');
bench('_supply(DE)  全图补给 BFS', () => g._supply('DE'), 20);
bench('_supply(US)', () => g._supply('US'), 20);
bench('passiveState ×全部在场算子', () => { for (const u of g.units) Combat.passiveState(g, u); }, 20);
bench('_startPhase(DE) 单次', () => g._startPhase(), 5);

// 推到增援高峰：一次 _startPhase 里可能入场几十个营 → 每个营都 _supply 一次
console.log('\n== 推进到增援高峰（R2~R5）==');
const g2 = new Game('big', 20241216);
for (const target of [2, 3, 4, 5]) {
  while (g2.state.round < target && !g2.state.over) g2.endPhase();
  const before = g2.units.length;
  const t0 = process.hrtime.bigint();
  g2._startPhase();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const added = g2.units.length - before;
  console.log(`  R${target} _startPhase: ${ms.toFixed(0)}ms  (新入场 ${added} 营, 在图 ${g2.units.filter(u => u.alive && !u.exited).length})`);
  // 单次 _supply 成本随在场算子增长
  const t1 = process.hrtime.bigint();
  g2._supply('DE');
  console.log(`     单次 _supply(DE): ${(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(1)}ms`);
}

// passiveState 在高密度态势下的成本（邻接查找）
console.log('\n== passiveState 随规模 ==');
const g3 = new Game('big', 20241216);
for (let r = 0; r < 30; r++) if (!g3.state.over) g3.endPhase();
console.log('  在图算子 ' + g3.units.filter(u => u.alive && !u.exited).length);
bench('passiveState ×全部（高密度）', () => { for (const u of g3.units) Combat.passiveState(g3, u); }, 20);
bench('unitAt 邻接 6 次（passiveState 主体）', () => { for (const n of Hex.neighbors(30, 20)) g3.unitAt(n.c, n.r); }, 20000);

// 渲染层 CPU 侧等价成本：syncUnits 对每个单位做 passiveState + 位置计算
console.log('\n== syncUnits 的 CPU 等价成本（不含 canvas 重绘/上传）==');
const W = g3.map;
function syncCpu() {
  const seen = new Set();
  for (const u of g3.units) {
    if (!u.alive || u.exited) continue;
    seen.add(u.uid);
    const ps = Combat.passiveState(g3, u);
    const w = Hex.worldX(u.c, u.r, 2), z = Hex.worldZ(u.r, 2);
    const x = w + z * 0;
    void ps.key; void x;
  }
  for (const [uid, gr] of []) void uid;
  return seen.size;
}
bench('syncUnits CPU 等价（无 canvas）', syncCpu, 20);
