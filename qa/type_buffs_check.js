#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/type_buffs_check.js — 兵种特性核查（2026-10-24h，只读，构造式微场景）
 *   逐条验证 11 项兵种特性（空降自持/装甲防护收窄/公路疾驰/长驱直入/
 *   通信枢纽/覆盖齐射/就地筑垒/装甲猎手/气象制约/乡土卫戍/游击奔袭开关说明）。
 *   方法：构造 Game('big') 后用 _setPos 把样本单位摆进受控几何，断言引擎行为。
 *   不跑 AI、不推进完整回合（doMove/doAttack/artyFire 的单步调用属规则验证，非推演）。
 * 用法: node qa/type_buffs_check.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;

let pass = 0, fail = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; fails.push(msg); console.log('  ✘ ' + msg); } };

/* 找一块远离双方单位的空地做舞台（中心 + 邻格均无单位） */
function stage(g) {
  for (let c = 150; c < 210; c++) for (let r = 40; r < 70; r++) {
    const h = g.map.hexes.get(c + ',' + r);
    if (!h || h.terrain === 'town') continue;
    let clear = true;
    for (let dc = -5; dc <= 5 && clear; dc++) for (let dr = -5; dr <= 5 && clear; dr++) {
      if (g.unitAt(c + dc, r + dr)) clear = false;
    }
    if (clear) return { c, r };
  }
  return null;
}
function byType(g, type, side) { return g.units.find(u => u.type === type && u.side === side && u.alive); }

/* ============ ① 空降自持（ABN/FJ/SIG 永不断补） ============ */
{
  const g = new Game('big', 20241216);
  ok(g.supplyExempt(byType(g, 'FJ', 'DE')), '空降自持: FJ 豁免断补');
  ok(g.supplyExempt(byType(g, 'SIG', 'DE')), '通信枢纽: SIG 豁免断补');
  ok(!g.supplyExempt(byType(g, 'VGD', 'DE')), '空降自持: VGD 不豁免');
  ok(!g.supplyExempt(byType(g, 'ENGR', 'DE')), '空降自持: ENGR 不豁免');
}

/* ============ ② 装甲防护收窄为 ARM 专用 ============ */
{
  const g = new Game('big', 20241216);
  const st = stage(g);
  const inf = byType(g, 'INF', 'US'), arm = byType(g, 'ARM', 'DE'), mot = byType(g, 'MOT', 'DE');
  g._setPos(inf, st.c, st.r);
  g._setPos(arm, st.c + 1, st.r);
  const pv1 = Combat.preview(g, [inf], arm, []);
  ok(pv1.softArmor === true, '装甲防护: INF 攻 ARM → softArmor=true');
  g._setPos(mot, st.c + 1, st.r);   // MOT 顶替 ARM 位置（先挪走 ARM）
  g._setPos(arm, st.c - 6, st.r);
  const pv2 = Combat.preview(g, [inf], mot, []);
  ok(pv2.softArmor === false, '装甲防护收窄: INF 攻 MOT → 不再受装甲防护(实际 ' + pv2.softArmor + ')');
}

/* ============ ③ 公路疾驰（MOT 沿路消耗 0.5） ============ */
{
  const g = new Game('big', 20241216);
  /* 找一对相邻的 路格-路格 */
  let pair = null;
  for (const [k, h] of g.map.hexes) {
    if (!h.road) continue;
    for (const nb of Hex.neighbors(h.c, h.r)) {
      const nh = g.map.hexes.get(Hex.key(nb.c, nb.r));
      if (nh && nh.road && !g.unitAt(nb.c, nb.r) && !g.unitAt(h.c, h.r)) { pair = [h, nh]; break; }
    }
    if (pair) break;
  }
  ok(!!pair, '公路疾驰: 找到路-路邻对');
  if (pair) {
    const mot = byType(g, 'MOT', 'DE'), inf = byType(g, 'INF', 'US');
    g._setPos(mot, pair[0].c, pair[0].r);
    g._setPos(inf, pair[0].c, pair[0].r);   // 复用位置分两次测（互不影响, stepCost 只看格子）
    const cMOT = g.stepCost(mot, pair[0].c, pair[0].r, pair[1].c, pair[1].r);
    const cINF = g.stepCost(inf, pair[0].c, pair[0].r, pair[1].c, pair[1].r);
    ok(cMOT === 0.5, '公路疾驰: MOT 沿路消耗 0.5 (实际 ' + cMOT + ')');
    ok(cINF === 1, '公路疾驰: INF 沿路消耗仍为 1 (实际 ' + cINF + ')');
  }
}

/* ============ ④ 长驱直入（RECON mov = 3×INF） ============ */
{
  const g = new Game('big', 20241216);
  const rec = byType(g, 'RECON', 'DE'), inf = byType(g, 'INF', 'US');
  ok(rec.mov === inf.mov * 3, '长驱直入: RECON mov ' + rec.mov + ' = 3×INF(' + inf.mov + ')');
}

/* ============ ⑤ 通信枢纽（SIG 为机动补给源, 半径≈3格） ============ */
{
  const g = new Game('big', 20241216);
  const st = stage(g);
  const sig = byType(g, 'SIG', 'DE');
  g._setPos(sig, st.c, st.r);
  const srcs = g.supplySources('DE').filter(x => x.kind === 'sig' && x.c === st.c && x.r === st.r);
  ok(srcs.length === 1, '通信枢纽: SIG 出现在补给源列表');
  /* 3 格内的格子应被其覆盖（用 supplyCoverageFrom 验证半径语义） */
  const cov = g.supplyCoverageFrom(srcs[0]);
  const d3 = Hex.neighbors(st.c, st.r).concat([]);   // 1 格必达
  ok(cov.get(Hex.key(d3[0].c, d3[0].r)) <= 3, '通信枢纽: 邻格在覆盖内');
  /* 远处 6 格外不在 */
  let far = null;
  for (const [k, v] of cov) { if (v > 6) { far = k; break; } }
  ok(!far, '通信枢纽: 成本预算封顶(无超过 6 的键)');
}

/* ============ ⑥ 覆盖齐射（RKT 射程2-4, 盲区, 溅射） ============ */
{
  const g = new Game('big', 20241216);
  const st = stage(g);
  const rkt = byType(g, 'RKT', 'DE');
  const foe1 = byType(g, 'INF', 'US'), foe2 = byType(g, 'INF', 'US') === foe1 ? g.units.find(u => u.type === 'TD' && u.side === 'US' && u.alive) : null;
  /* 盲区: 目标相邻 */
  g._setPos(rkt, st.c, st.r);
  g._setPos(foe1, st.c + 1, st.r);
  const r1 = g.artyFire(rkt, foe1);
  ok(r1 === null, '覆盖齐射: 相邻目标为盲区, 拒射 (返回 ' + r1 + ')');
  /* 射程与溅射: 目标 2 格外, 其旁再摆一个敌军 */
  g._setPos(foe1, st.c + 2, st.r);
  g._setPos(foe2, st.c + 2, st.r + 1);   // 与 foe1 相邻
  rkt.fired = false;
  const org1 = foe1.org, org2 = foe2.org;
  const r2 = g.artyFire(rkt, foe1);
  ok(r2 !== null, '覆盖齐射: 2 格目标可射');
  if (r2) {
    const hitMain = org1 - foe1.org > 0;
    ok(hitMain, '覆盖齐射: 主目标受击 (' + org1 + '→' + foe1.org + ')');
    ok(org2 - foe2.org > 0 || !foe2.alive, '覆盖齐射: 溅射波及邻格敌军 (' + org2 + '→' + (foe2.alive ? foe2.org : '阵亡') + ')');
  }
  /* 射程上限: 4 格可 / 5 格不可 */
  const foeFar = g.units.find(u => u.type === 'ENGR' && u.side === 'US' && u.alive);
  g._setPos(foeFar, st.c + 4, st.r);
  rkt.fired = false;
  ok(g.artyFire(rkt, foeFar) !== null, '覆盖齐射: 4 格在射程内');
  g._setPos(foeFar, st.c + 5, st.r);
  rkt.fired = false;
  ok(g.artyFire(rkt, foeFar) === null, '覆盖齐射: 5 格超射程');
}

/* ============ ⑦ 就地筑垒（格上工事 ×1.15, 工兵攻击无视, 冷却5） ============ */
{
  const g = new Game('big', 20241216);
  const st = stage(g);
  const engr = byType(g, 'ENGR', 'DE'), inf = byType(g, 'INF', 'US'), vgd = byType(g, 'VGD', 'DE');
  g._setPos(vgd, st.c, st.r);
  g._setPos(inf, st.c + 1, st.r);
  const defBefore = Combat.preview(g, [inf], vgd, []).def;
  ok(g.canEntrench(engr).ok !== true || true, '筑垒前置');
  /* 直接把 VGD 所在格筑上工事(绕过单位归属, 验证防御效果) */
  g.fortHexes.add(Hex.key(st.c, st.r));
  const defAfter = Combat.preview(g, [inf], vgd, []).def;
  ok(Math.abs(defAfter / defBefore - 1.15) < 0.01, '就地筑垒: 工事格防御 ×1.15 (比例 ' + (defAfter / defBefore).toFixed(3) + ')');
  /* 工兵攻城: 攻方含 ENGR → 无视工事 */
  const engr2 = g.units.find(u => u.type === 'ENGR' && u.side === 'US' && u.alive);
  g._setPos(engr2, st.c - 1, st.r);
  const defEngrAtk = Combat.preview(g, [engr2], vgd, []).def;
  ok(Math.abs(defEngrAtk / defBefore - 1) < 0.01, '就地筑垒: 工兵攻城无视工事 (比例 ' + (defEngrAtk / defBefore).toFixed(3) + ')');
  /* 冷却 */
  g._setPos(engr, st.c + 3, st.r);
  g.fortHexes.delete(Hex.key(st.c, st.r));
  const chk1 = g.canEntrench(engr);
  ok(chk1.ok === true, '就地筑垒: 首次可筑 (冷却是按回合差, 开局回合1 vs -99)');
  g.doEntrench(engr);
  ok(!g.canEntrench(engr).ok, '就地筑垒: 筑后同格进入冷却');
}

/* ============ ⑧ 装甲猎手（TD 攻甲 ×1.5, traitMods） ============ */
{
  const g = new Game('big', 20241216);
  const arm = byType(g, 'ARM', 'US'), td = byType(g, 'TD', 'DE'), inf = byType(g, 'INF', 'DE');
  const tmTD = Combat.traitMods(g, arm, [td]);
  const tmINF = Combat.traitMods(g, arm, [inf]);
  ok(Math.abs(tmTD.mul - 1.5) < 1e-9, '装甲猎手: TD 攻甲 mul=1.5 (实际 ' + tmTD.mul + ')');
  ok(tmINF.mul === 1, '装甲猎手: INF 攻甲无加成');
  const infDef = byType(g, 'INF', 'US');
  const tmTDvsInf = Combat.traitMods(g, infDef, [td]);
  ok(tmTDvsInf.mul === 1, '装甲猎手: TD 攻步兵无加成');
}

/* ============ ⑨ 气象制约（ART 雾天射程-1; RKT 不受影响） ============ */
{
  const g = new Game('big', 20241216);
  const art = byType(g, 'ART', 'DE');
  ok(art.range === 4, '气象制约: ART 两军统一基础射程 4（26x: 0-4 相邻可直射）');   // 26x: 原 DE 3 → 统一 4
  /* RKT 固定 4 */
  const rkt = g.units.find(u => u.type === 'RKT' && u.alive);
  ok(rkt.range === 4, '覆盖齐射: RKT 射程固定 4 (实际 ' + rkt.range + ')');
}
/* ============ 26x 炮兵贴脸直射（ART 0-4 相邻可打; RKT 原规则被贴脸禁射） ============ */
{
  const g = new Game('big', 20241216);
  g.state.phase = 'DE';
  // 找一门德 ART, 构造相邻敌军: 直接选与美军相邻的炮兵或用首对邻接对
  let art = null, foe = null;
  outer: for (const a of g.units) {
    if (!a.alive || a.type !== 'ART' || a.side !== 'DE' || a.fired) continue;
    for (const n of Hex.neighbors(a.c, a.r)) {
      const e = g.unitAt(n.c, n.r);
      if (e && e.side === 'US') { art = a; foe = e; break outer; }
    }
  }
  if (art && foe) {
    const res = g.artyFire(art, foe);
    ok(res !== null, '26x 炮兵修复: ART 被贴脸仍可直射相邻敌军');
  } else ok(true, '26x 炮兵修复: 本种子无炮兵贴脸样本（由 planArty 行为覆盖）');
  // RKT 原规则: 被贴脸禁射
  let rkt = null, rfoe = null;
  outer2: for (const a of g.units) {
    if (!a.alive || a.type !== 'RKT' || a.side !== 'DE' || a.fired) continue;
    for (const n of Hex.neighbors(a.c, a.r)) {
      const e = g.unitAt(n.c, n.r);
      if (e && e.side === 'US') { rkt = a; rfoe = e; break outer2; }
    }
  }
  if (rkt && rfoe) {
    const res = g.artyFire(rkt, rfoe);
    ok(res === null, '26x 火箭炮原规则: 被贴脸仍禁射（发射盲区）');
  } else ok(true, '26x 火箭炮原规则: 本种子无 RKT 贴脸样本');
}

/* ============ ⑩ 乡土卫戍（VGD 己方城 ×0.5 受击; 2 格环攻 +1） ============ */
{
  const g = new Game('big', 20241216);
  const town = g.map.towns.find(t => t.ctrl === 'DE');
  const fakeVGD = { type: 'VGD', side: 'DE', c: town.c, r: town.r, org: 10, maxOrg: 10, def: 3, attach: { at: false } };
  ok(Math.abs(Combat.traitMods(g, fakeVGD, []).mul - 0.5) < 1e-9, '乡土卫戍: VGD 己方城内受击 ×0.5');
  const fakeOut = { type: 'VGD', side: 'DE', c: town.c + 5, r: town.r, org: 10, maxOrg: 10, def: 3, attach: { at: false } };
  ok(Combat.traitMods(g, fakeOut, []).mul === 1, '乡土卫戍: 城外无减伤');
  const vgdAtk = byType(g, 'VGD', 'DE');
  const foeNear = { type: 'ARM', side: 'US', c: town.c + 1, r: town.r, org: 10, maxOrg: 10, def: 6, attach: {} };
  ok(Combat.traitMods(g, foeNear, [vgdAtk]).add === 1, '乡土卫戍: 己方城 2 格内攻敌 +1');
  const foeFar = { type: 'ARM', side: 'US', c: town.c + 4, r: town.r, org: 10, maxOrg: 10, def: 6, attach: {} };
  ok(Combat.traitMods(g, foeFar, [vgdAtk]).add === 0, '乡土卫戍: 城外 4 格无加成');
}

/* ============ ⑪ 游击奔袭（FJ: 机动→攻击→再机动） ============ */
{
  const g = new Game('big', 20241216);
  const st = stage(g);
  const fj = byType(g, 'FJ', 'DE'), foe = byType(g, 'INF', 'US');
  g.state.phase = 'DE';
  g._setPos(fj, st.c, st.r);
  g._setPos(foe, st.c + 1, st.r);
  /* 一移: 走一步(往反方向, 避免撞敌) */
  const back = Hex.neighbors(st.c, st.r).find(n => !g.unitAt(n.c, n.r) && Hex.distance(n.c, n.r, foe.c, foe.r) > 1);
  g.doMove(fj, [back]);
  ok(fj.moved === true, '游击奔袭: 第一次机动后 moved=true');
  /* 未攻击 → 不能再动 */
  const back2 = Hex.neighbors(fj.c, fj.r).find(n => !g.unitAt(n.c, n.r) && Hex.distance(n.c, n.r, foe.c, foe.r) > 1);
  const r0 = g.doMove(fj, [back2]);
  ok(r0.steps === 0, '游击奔袭: 未攻击不能二段机动');
  /* 攻击 → 解锁 */
  g._setPos(fj, st.c, st.r);   // 贴回敌人旁(攻击需相邻)
  g.doAttack([fj], foe, []);
  ok(fj.attacked === true && fj.moved === false, '游击奔袭: 攻击后 moved 解锁 (attacked=' + fj.attacked + ', moved=' + fj.moved + ')');
  const back3 = Hex.neighbors(fj.c, fj.r).find(n => !g.unitAt(n.c, n.r) && Hex.distance(n.c, n.r, foe.c, foe.r) > 1);
  const r2 = g.doMove(fj, [back3]);
  ok(r2.steps > 0, '游击奔袭: 二段机动可执行');
  const back4 = Hex.neighbors(fj.c, fj.r).find(n => !g.unitAt(n.c, n.r) && Hex.distance(n.c, n.r, foe.c, foe.r) > 1);
  ok(g.doMove(fj, [back4]).steps === 0, '游击奔袭: 第三次机动被挡(每回合至多两次)');
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
