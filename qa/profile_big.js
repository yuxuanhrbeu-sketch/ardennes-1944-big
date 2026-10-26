#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/profile_big.js — 只读性能剖面（Phase 2 风险评估用）
 * ------------------------------------------------------------
 * 不改任何项目文件、不跑完整推演：
 *   1) 载入引擎 → new Game('big')
 *   2) 用多次 endPhase() 推进到指定回合（只推进阶段，不执行 AI 动作）
 *   3) 对该回合被调用的热点函数打点，统计调用次数与累计耗时
 *   4) 单独测 planTurn 的墙钟耗时（AI 峰值成本）
 * 输出: 每回合 单位数 / planTurn 毫秒 / 热点 Top 表
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js', 'ai.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;

const HRS = 3600 * 1000;
function alive(g, side) { return g.units.filter(u => u.alive && !u.exited && u.side === side).length; }
function onBoard(g) { return g.units.filter(u => u.alive && !u.exited && u.arrive <= g.state.round).length; }

// ---- 打点器：包住原型/闭包暴露的方法 ----
function instrument(obj, name, stats, saved) {
  const orig = obj[name];
  if (typeof orig !== 'function') return false;
  saved[name] = orig;
  obj[name] = function () {
    const t0 = process.hrtime.bigint();
    try { return orig.apply(this, arguments); }
    finally {
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      const s = stats[name] || (stats[name] = { n: 0, ms: 0, max: 0 });
      s.n++; s.ms += dt; if (dt > s.max) s.max = dt;
    }
  };
  return true;
}

function report(tag, stats, totalMs) {
  const rows = Object.keys(stats).map(k => ({ k, ...stats[k] }))
    .sort((a, b) => b.ms - a.ms).slice(0, 12);
  console.log(`\n  [${tag}] 探针总窗 ${totalMs.toFixed(1)}ms`);
  console.log('  ' + 'function'.padEnd(22) + 'calls'.padStart(9) + 'total ms'.padStart(11) + 'self%'.padStart(8) + 'max ms'.padStart(9) + 'avg us'.padStart(9));
  for (const r of rows) {
    console.log('  ' + r.k.padEnd(22) + String(r.n).padStart(9) + r.ms.toFixed(1).padStart(11) +
      (100 * r.ms / totalMs).toFixed(1).padStart(8) + r.max.toFixed(1).padStart(9) +
      (1000 * r.ms / r.n).toFixed(1).padStart(9));
  }
}

// ============================================================
// 阶段 A: 推进到目标回合，测量该回合的 AI 计划成本与热点
// ============================================================
function run(targetRound, side) {
  const g = new Game('big', 20241216);
  // 快速推进（不执行 AI 动作，只走阶段翻转：增援/补给/整补照常发生）
  while (g.state.round < targetRound && !g.state.over) g.endPhase();

  const stats = {};
  const saved = {};
  for (const m of ['getReach', 'findPath', 'stepCost', 'inZOC', 'unitAt', 'hexAt', 'attackersFor',
    'artyInRange', 'previewAttack', 'doMove', 'doAttack', 'artyFire', '_supply', 'movEff',
    'pathFromReach', '_terrainStep']) instrument(Game.prototype, m, stats, saved);

  const units = onBoard(g);
  const nDe = alive(g, 'DE'), nUs = alive(g, 'US');
  const t0 = process.hrtime.bigint();
  let acts = [];
  try { acts = AI.planTurn(g, side); } catch (e) { console.log('  planTurn 抛错: ' + e.message); }
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  for (const m of Object.keys(saved)) Game.prototype[m] = saved[m];

  console.log(`\n=== 回合 ${targetRound} (${DATA.DATES[targetRound - 1] || '?'})  ${side} 方 planTurn ===`);
  console.log(`  在图算子 ${units} (德 ${nDe} / 盟 ${nUs})  计划动作 ${acts.length} 条  planTurn 墙钟 ${totalMs.toFixed(0)}ms`);
  report(`R${targetRound} ${side}`, stats, totalMs);
  return { targetRound, units, totalMs, acts: acts.length, stats };
}

// 参数形态: "20:DE,20:US"（避开 PowerShell 引号剥离），缺省测 R1/R20
const arg = (process.argv[2] || '1:DE,20:DE,20:US').split(',').map(s => {
  const [r, s2] = s.split(':'); return { r: +r, s: s2 || 'DE' };
});
const results = [];
for (const j of arg) results.push(run(j.r, j.s));

console.log('\n== 汇总 ==');
for (const r of results) console.log(`  R${String(r.targetRound).padStart(2)} ${r.units} 算子: planTurn ${r.totalMs.toFixed(0)}ms (${r.acts} 动作)`);
