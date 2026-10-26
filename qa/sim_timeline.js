#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/sim_timeline.js — 无渲染全量时序成本（Phase 2 风险量化）
 * ------------------------------------------------------------
 * 逐回合执行真实 AI 计划（planTurn + 动作执行，无调度延迟），
 * 记录每回合 plan / exec / endPhase 耗时、在图算子数、接触单位数、热点调用数。
 * 只读：不写盘、不改项目文件。
 * 用法: node qa/sim_timeline.js [maxRounds] [seed]
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js', 'ai.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;

const MAXR = +process.argv[2] || 41;
const SEED = +process.argv[3] || 20241216;
const g = new Game('big', SEED);
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const find = id => g.units.find(x => x.uid === id);

const execStats = { move: 0, moveNoop: 0, attack: 0, attackNoop: 0, arty: 0, air: 0 };
function execAction(a) {
  const side = g.state.phase;
  if (a.t === 'move') {
    const u = find(a.uid);
    if (u && u.alive && u.side === side && !u.moved) {
      const r = g.doMove(u, a.path);
      if (r && r.steps > 0) execStats.move++; else execStats.moveNoop++;
    } else execStats.moveNoop++;
  } else if (a.t === 'attack') {
    const target = find(a.target);
    if (!target || !target.alive) { execStats.attackNoop++; return; }
    const atts = a.uids.map(find).filter(u => u && u.alive && u.side === side && !u.attacked &&
      u.type !== 'ART' && Hex.distance(u.c, u.r, target.c, target.r) === 1);
    if (!atts.length) { execStats.attackNoop++; return; }
    const arty = (a.arty || []).map(find).filter(x => x && x.alive && !x.fired && !x.moved && x.type === 'ART');
    const res = g.doAttack(atts, target, arty);
    if (res) execStats.attack++; else execStats.attackNoop++;
  } else if (a.t === 'arty') {
    const u = find(a.uid), t = find(a.target);
    if (u && t && u.alive) { const r = g.artyFire(u, t); if (r) execStats.arty++; }
  } else if (a.t === 'air') {
    const t = find(a.target);
    if (t) g.airStrike(t, side);
  }
}

/* 动态补刀：与 ai.js dynamicAttackPass 相同的判定与执行，但同步一次跑完 */
function dynamicPass(side) {
  const T = DATA.TYPES;
  const armor = u => T[u.type].armor;
  const crtExpect = row => { let a = 0, d = 0; for (const r of row) { a += DATA.DMG[r].atk; d += DATA.DMG[r].def; } return { atk: a / row.length, def: d / row.length }; };
  const unitValue = u => { let v = (u.atk + u.def) / 10; if (armor(u)) v *= 1.5; else if (T[u.type].antiArmor) v *= 1.3; else if (u.type === 'ART') v *= 1.4; return v * (0.3 + 0.7 * u.org / u.maxOrg); };
  const friendsAt = (u, c, r) => { let n = 0; for (const p of Hex.neighbors(c, r)) { const f = g.unitAt(p.c, p.r); if (f && f.alive && f !== u && f.side === u.side) n++; } return n; };
  const enemiesAt = (u, c, r) => { let n = 0; for (const p of Hex.neighbors(c, r)) { const f = g.unitAt(p.c, p.r); if (f && f.alive && f.side !== u.side) n++; } return n; };
  const LOSS_AVERSION = 1.15;
  function attackGroup(e, planned, opts) {
    let pool = g.attackersFor(e).filter(u => !planned.has(u.uid) && !(opts && opts.excludeFire && u.fireSupport > 0));
    if (opts && opts.maxForce) pool = pool.sort((a, b) => b.atk * (b.org / b.maxOrg) - a.atk * (a.org / a.maxOrg));
    else pool = pool.sort((a, b) => unitValue(a) / (a.atk * (a.org / a.maxOrg) + 0.1) - unitValue(b) / (b.atk * (b.org / b.maxOrg) + 0.1));
    if (!pool.length) return null;
    const arty = g.artyInRange(e).filter(a => !planned.has(a.uid)).sort((a, b) => b.sup - a.sup).slice(0, 2);
    if (opts && opts.maxForce) {
      const atts = pool.slice(0, 3);
      const pv = g.previewAttack(atts, e, arty);
      if (!pv.key) return null;
      let atkLoss = 0; const ex = crtExpect(pv.row);
      for (const a of atts) atkLoss += unitValue(a) * Math.min(ex.atk, a.org) / Math.max(a.maxOrg, 1);
      let dLoss = Math.min(ex.def, e.org);
      if (pv.softArmor) dLoss = Math.max(DATA.SOFT_VS_ARMOR_MIN, dLoss * DATA.SOFT_VS_ARMOR_DMG);
      return { atts, arty, pv, w: unitValue(e) * dLoss / Math.max(e.maxOrg, 1) - atkLoss * LOSS_AVERSION };
    }
    let best = null;
    for (let k = 1; k <= Math.min(3, pool.length); k++) {
      const atts = pool.slice(0, k);
      const pv = g.previewAttack(atts, e, arty);
      if (!pv.key) continue;
      const ex = crtExpect(pv.row);
      let atkLoss = 0;
      for (const a of atts) atkLoss += unitValue(a) * Math.min(ex.atk, a.org) / Math.max(a.maxOrg, 1);
      if (arty.length) { let pHit = 0; for (const r of pv.row) if (DATA.DMG[r].atk >= 3) pHit++; const p = pHit / pv.row.length; for (const a of arty) atkLoss += unitValue(a) * p / Math.max(a.maxOrg, 1); }
      let dLoss = Math.min(ex.def, e.org);
      if (pv.softArmor) dLoss = Math.max(DATA.SOFT_VS_ARMOR_MIN, dLoss * DATA.SOFT_VS_ARMOR_DMG);
      const w = unitValue(e) * dLoss / Math.max(e.maxOrg, 1) - atkLoss * LOSS_AVERSION - k * 0.02;
      if (!best || w > best.w) best = { atts, arty, pv, w };
    }
    return best;
  }
  const allOut = g.state.noTurnLimit ||
    g.units.filter(u => u.alive && !u.exited && u.side === 'DE').length <= 8 ||
    g.units.filter(u => u.alive && !u.exited && u.side === 'US').length <= 8;
  const steps = [];
  const built = new Set();
  for (const e of g.units.filter(x => x.alive && !x.exited && x.side !== side)) {
    const gp = attackGroup(e, built, allOut ? { maxForce: true } : undefined);
    if (!gp || !gp.pv.key) continue;
    if (!allOut) {
      const dfr = friendsAt(e, e.c, e.r), sur = enemiesAt(e, e.c, e.r);
      const ps = Combat.passiveState(g, e);
      const wEff = gp.w + (dfr <= 1 ? 0.3 : 0) + (ps.key === 'broken' ? 0.4 : 0) + (sur >= 2 ? 0.2 : 0);
      if (wEff <= -0.05 || gp.pv.ratio < 1.2) continue;
    }
    for (const u of gp.atts) built.add(u.uid);
    for (const u of gp.arty) built.add(u.uid);
    steps.push({ atts: gp.atts, e, arty: gp.arty });
  }
  for (const s of steps) {
    if (g.state.over) break;
    const atts = s.atts.filter(u => u.alive && !u.attacked && Hex.distance(u.c, u.r, s.e.c, s.e.r) === 1);
    if (atts.length) {
      const res = g.doAttack(atts, s.e, s.arty.filter(a => a.alive && !a.fired));
      if (res && res.advanceOffer) {
        const alive = res.advanceOffer.units.filter(u => u.alive);
        if (alive.length) { if (side === 'US') alive.sort((a, b) => unitValue(a) - unitValue(b)); g.doAdvance(alive[0]); }
      }
    }
    execStats.attack++;
  }
}

/* 热点计数器 */
const counters = { unitAt: 0, inZOC: 0, findPath: 0, getReach: 0, previewAttack: 0, _supply: 0, doAttack: 0, artyInRange: 0 };
for (const k of Object.keys(counters)) {
  const orig = Game.prototype[k];
  if (typeof orig !== 'function') { console.log('缺少方法 ' + k); continue; }
  Game.prototype[k] = function () { counters[k]++; return orig.apply(this, arguments); };
}

const aliveN = side => g.units.filter(u => u.alive && !u.exited && u.side === side).length;
const onBoard = () => g.units.filter(u => u.alive && !u.exited && u.arrive <= g.state.round).length;
function inContact(side) {
  const foe = side === 'DE' ? 'US' : 'DE';
  let n = 0;
  for (const u of g.units) {
    if (!u.alive || u.exited || u.side !== side) continue;
    for (const p of Hex.neighbors(u.c, u.r)) { const e = g.unitAt(p.c, p.r); if (e && e.side === foe) { n++; break; } }
  }
  return n;
}

console.log('回合  日期         在图  德/盟      接触德/盟  计划动作  plan(ms)  exec(ms)  end(ms)  合计(ms)');
const totals = [];
const t0all = process.hrtime.bigint();
while (g.state.round <= MAXR && !g.state.over) {
  const r = g.state.round;
  let planMs = 0, execMs = 0, endMs = 0, actsN = 0;
  for (let k = 0; k < 2 && !g.state.over; k++) {
    const side = g.state.phase;
    let t = process.hrtime.bigint();
    const acts = AI.planTurn(g, side);
    planMs += ms(t); actsN += acts.length;
    t = process.hrtime.bigint();
    for (const a of acts) { if (g.state.over) break; execAction(a); }
    dynamicPass(side);
    execMs += ms(t);
    t = process.hrtime.bigint();
    g.endPhase();
    endMs += ms(t);
  }
  const tot = planMs + execMs + endMs;
  totals.push({ r, tot, planMs, execMs, endMs });
  console.log(String(r).padStart(3) + '  ' + String(DATA.DATES[r - 1] || '?').padEnd(11) +
    String(onBoard()).padStart(5) + '  ' + (aliveN('DE') + '/' + aliveN('US')).padStart(10) + '  ' +
    (inContact('DE') + '/' + inContact('US')).padStart(10) + '  ' + String(actsN).padStart(8) + '  ' +
    planMs.toFixed(0).padStart(8) + '  ' + execMs.toFixed(0).padStart(8) + '  ' + endMs.toFixed(0).padStart(6) + '  ' + tot.toFixed(0).padStart(8));
}
const wall = ms(t0all);
console.log('\n== 汇总 ==');
console.log('  实际回合数 ' + totals.length + ' / 上限 ' + MAXR + '  终局: over=' + g.state.over + ' winner=' + g.state.winner + ' (' + (g.state.victoryKey || '-') + ')');
console.log('  总墙钟 ' + (wall / 1000).toFixed(1) + 's   平均 ' + (wall / totals.length).toFixed(0) + 'ms/回合');
const worst = totals.slice().sort((a, b) => b.tot - a.tot).slice(0, 5);
console.log('  最慢 5 回合: ' + worst.map(w => `R${w.r}=${w.tot.toFixed(0)}ms(plan ${w.planMs.toFixed(0)}/exec ${w.execMs.toFixed(0)}/end ${w.endMs.toFixed(0)})`).join('  '));
const execTotal = totals.reduce((s, x) => s + x.execMs, 0);
console.log('  执行阶段动作数: move ' + execStats.move + ' (丢弃 ' + execStats.moveNoop + ')  attack ' + execStats.attack +
  ' (丢弃 ' + execStats.attackNoop + ')  arty ' + execStats.arty + '  空袭 ' + execStats.air);
console.log('  热点累计: ' + Object.entries(counters).map(([k, v]) => k + '=' + v).join('  '));
console.log('  终局日志尾部:');
for (const e of g.logEntries.slice(-4)) console.log('    ' + e.msg);
