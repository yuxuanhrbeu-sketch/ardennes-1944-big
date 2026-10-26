#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/probe_findpath.js — 复核 §ai.js 位移引擎注释里的性能结论
 *   ① findPath 打向"被占用目标格"是否真的穷搜整图（文档称均值 25.6ms）
 *   ② getReach（Dijkstra 可达域）的真实单次成本
 * 只读：不开写盘、不跑推演。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js', 'ai.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;

const g = new Game('big', 20241216);
const S = g.state;
S.phase = 'DE';

function bench(label, fn, n) {
  fn(); // 预热
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${label.padEnd(46)} n=${String(n).padStart(4)}  ${(ms / n).toFixed(2)}ms/次  合计 ${ms.toFixed(0)}ms`);
  return ms / n;
}

const de = g.units.filter(u => u.side === 'DE' && u.alive);
const us = g.units.filter(u => u.side === 'US' && u.alive);
// 找一个"被占用"的敌方目标格与一个"空"的远目标格
const occupied = us[Math.floor(us.length / 2)];
const emptyFar = { c: 14, r: 40 };
const armorU = de.find(u => DATA.TYPES[u.type].armor) || de[0];

console.log('== ① findPath: 空目标 vs 被占用目标 ==');
console.log(`  测试单位 ${armorU.name}(${armorU.type}) @${armorU.c},${armorU.r}  装甲=${!!DATA.TYPES[armorU.type].armor}`);
bench('findPath → 空目标格 (emptyFar 14,40)', () => g.findPath(armorU, emptyFar.c, emptyFar.r, { avoidZOC: false }), 40);
bench('findPath → 空目标格 (avoidZOC=true)', () => g.findPath(armorU, emptyFar.c, emptyFar.r, { avoidZOC: true }), 40);
bench(`findPath → 被占用目标格 (${occupied.abbr}@${occupied.c},${occupied.r})`,
  () => g.findPath(armorU, occupied.c, occupied.r, { avoidZOC: false }), 40);
bench(`findPath → 被占用目标格 (avoidZOC=true)`,
  () => g.findPath(armorU, occupied.c, occupied.r, { avoidZOC: true }), 40);
// 非装甲（ZOC 停止规则会频繁剪枝，对比装甲）
const infU = de.find(u => !DATA.TYPES[u.type].armor && u.mov >= 3) || de[1];
bench(`非装甲 ${infU.name} → 被占用目标格`, () => g.findPath(infU, occupied.c, occupied.r, { avoidZOC: true }), 40);

console.log('\n== ② getReach (Dijkstra 可达域) ==');
bench('getReach 装甲', () => g.getReach(armorU), 200);
bench('getReach 步兵', () => g.getReach(infU), 200);
const distant = de.reduce((a, b) => (Math.hypot(a.c - 20, a.r - 30) > Math.hypot(b.c - 20, b.r - 30) ? a : b));
bench(`getReach 远离前线的单位 ${distant.name}`, () => g.getReach(distant), 200);

console.log('\n== ③ 基础查找成本 ==');
bench('unitAt (grid.get + Hex.key)', () => g.unitAt(30, 20), 200000);
bench('inZOC', () => g.inZOC(armorU.c, armorU.r, 'DE'), 100000);
bench('Hex.neighbors', () => Hex.neighbors(30, 20), 200000);
