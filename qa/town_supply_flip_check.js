#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * town_supply_flip_check.js — 城镇占领补给翻转核查（24q，2026-10-25）
 * 规则（用户规定）：城市补给归属随占领动态翻转——敌单位占领该城，
 * 该城即刻为占领方提供补给；夺回则翻回原方。
 * 方法：构造 Game('big')，在偏远无源区注入测试城镇，摆受控几何，
 *       断言 doMove 占领 / 立即补给生效 / 原方失供 / 夺回恢复 / 存档往返。
 *       不跑 AI、不推进完整回合（构造式微场景，工程纪律）。
 * 用法: node qa/town_supply_flip_check.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/* 远离双方单位的空地做舞台 */
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
const T = (g, c, r) => g.map.hexes.get(Hex.key(c, r));

/* 计时单次 _supply（性能红线：占城即时重算不得明显卡顿） */
const g = new Game('big', 20241216);
const st = stage(g);
ok(!!st, '舞台选址成功', st ? `(${st.c},${st.r})` : '');

/* —— 注入测试城镇（运行时构造，不落盘）—— */
const TC = st.c + 2, TR = st.r;                 // 城格
g.map.towns.push({ c: TC, r: TR, name: 'QA测试镇', abbr: '测', tier: 1, supply: true, ctrl: 'US', vp: 1, range: 7 });
T(g, TC, TR).town = { name: 'QA测试镇', tier: 1, ctrl: 'US' };

/* —— 受控几何：uUS 距城2格(覆盖内·不邻城)；uDE 距城4格(覆盖外) —— */
const uUS = byType(g, 'INF', 'US'), uDE = byType(g, 'VGD', 'DE') || byType(g, 'INF', 'DE');
g._setPos(uUS, st.c, st.r);                     // 距城 2
g._setPos(uDE, st.c + 6, st.r);                 // 距城 4
g._supply('US'); g._supply('DE');
ok(uUS.supplied === true, '开局基线: 美军单位获该城补给', `supplied=${uUS.supplied}`);
ok(supplyHas(g, 'US', 'QA测试镇') && !supplyHas(g, 'DE', 'QA测试镇'), '开局基线: 城属美军补给源');

function supplyHas(g, side, name) { return g.supplySources(side).some(s => s.name === name); }

/* —— ① 德军 doMove 占城 —— */
const t0 = Date.now();
const res = g.doMove(uDE, [T(g, TC, TR)]);
const ms = Date.now() - t0;
ok(uDE.c === TC && uDE.r === TR, '德军进占城镇格', `(${uDE.c},${uDE.r}) steps=${res && res.steps}`);
ok(T(g, TC, TR).town.ctrl === 'DE' && g.map.towns.find(t => t.name === 'QA测试镇').ctrl === 'DE', '控制权翻转→德军（hex与towns双处）');
ok(uDE.supplied === true, '占领方补给立即生效（占城即重算）', `supplied=${uDE.supplied} · 占城耗时${ms}ms`);
ok(ms < 1500, '占城+_supply 性能可接受', `${ms}ms`);
ok(supplyHas(g, 'DE', 'QA测试镇') && !supplyHas(g, 'US', 'QA测试镇'), '补给源归属翻转: 城转入德军序列');

/* —— ② 原占有方失供在下阶段结算 —— */
ok(uUS.supplied === true, '占领后美军仍持旧状态（失供待其下阶段）');
g._supply('US');                                // 模拟美军阶段开始
ok(uUS.supplied === false, '美军阶段开始: 该城失供生效', `supplied=${uUS.supplied}`);

/* —— ③ 美军夺回（切阶段后 doMove；先把守城德军挪走模拟被歼/退——占领判定只看谁站在格上）—— */
g.state.phase = 'US';
uUS.moved = false;
g._setPos(uDE, st.c + 8, st.r);
const res2 = g.doMove(uUS, [T(g, TC, TR)]);
ok(uUS.c === TC, '美军夺回城镇格', `(${uUS.c},${uUS.r})`);
ok(T(g, TC, TR).town.ctrl === 'US', '控制权翻回美军');
ok(uUS.supplied === true, '夺回方补给立即恢复', `supplied=${uUS.supplied}`);
g._supply('DE');                                // 德军下阶段重算
ok(!supplyHas(g, 'DE', 'QA测试镇') && supplyHas(g, 'US', 'QA测试镇'), '夺回后源归属翻回美军（uDE 处纵深背景网仍覆盖属正常，关键看该城归属）');

/* —— ④ 三个占领入口都走 _occupyTown（静态断言防回归）—— */
const gs = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');
const cs = fs.readFileSync(path.join(ROOT, 'js', 'combat.js'), 'utf8');
ok(gs.includes('this._occupyTown(u, last.c, last.r)'), '移动终点占城 → _occupyTown');
ok(gs.includes('this._occupyTown(unit, pa.hex.c, pa.hex.r)'), '攻击推进占城 → _occupyTown');
ok(cs.includes('game._occupyTown(a, to.c, to.r)') && cs.includes('game._occupyTown(defUnit, to.c, to.r)'), '撤退落点占城 → _occupyTown（攻/守两处）');

/* —— ⑤ 存档往返：翻转后的 ctrl 随档保存 —— */
{
  const native = g.map.towns.find(t => t.supply && t.name !== 'QA测试镇');
  const hex = T(g, native.c, native.r);
  const before = native.ctrl;
  const walker = native.ctrl === 'US' ? uDE : uUS;
  g._setPos(walker, native.c, native.r);
  g._occupyTown(walker, native.c, native.r);    // 翻转一座原生城
  const flipped = native.ctrl;
  ok(flipped !== before, `原生城翻转成功（${native.name}: ${before}→${flipped}）`);
  const s = { state: { round: 1, phase: 'DE', fortHexes: [] }, towns: g.map.towns.map(t => ({ n: t.name, ctrl: t.ctrl })), depots: [], units: [], log: [] };
  const g2 = new Game('big', 999);
  g2._load(s);
  const rt = g2.map.towns.find(t => t.name === native.name);
  ok(rt && rt.ctrl === flipped, '读档后翻转保持', `${native.name}: ${rt && rt.ctrl}（存档值 ${flipped}）`);
  ok(T(g2, native.c, native.r).town.ctrl === flipped, '读档后 hex.town.ctrl 同步');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
