#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/reinforce_supply_check.js — 增援入场即在补给网内（只读核查）
 *   原版33轮④移植：纯阶段推进（不移动、不攻击、不跑 AI），逐回合 endPhase，
 *   在每批增援入场后的补给结算里检查其 supplied 状态。
 *   断言：612 行增援全部"入场即在补给网内"，且不出现误报的"补给被切断"日志。
 * 用法: node qa/reinforce_supply_check.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✘ ' + msg); } };

const g = new Game('big', 20241216);
const all = [...globalThis.DATA_BIG_OOB.OOB_BIG_DE, ...globalThis.DATA_BIG_OOB.OOB_BIG_US];
const arrivals = new Map();   // id -> {name, arrive, supplied}
const cutLogs = [];
let pendingIds = [];          // 本阶段入场的增援(emit 在整批补给之前, 须在阶段末回读终值)
g.on('log', e => { if (/补给被切断/.test(e.msg || e.text || '')) cutLogs.push(g.state.round + ':' + (e.msg || e.text)); });
g.on('reinforce', u => { pendingIds.push(u.id); });

let guard = 0;
while (!g.state.over && guard++ < 120) {
  g.endPhase();   // 纯阶段推进：补给→整补→增援→令牌→燃料→天气→胜负；无移动无攻击
  if (pendingIds.length) {
    for (const id of pendingIds) {
      const u = g.units.find(x => x.id === id);
      if (u) arrivals.set(id, { name: u.name, arrive: u.arrive, supplied: u.supplied });
    }
    pendingIds = [];
  }
}
console.log('阶段推进至 round', g.state.round, '| over =', g.state.over, '| 入场增援', arrivals.size, '/', all.filter(r => r[9] > 0).length);

const bad = [...arrivals.values()].filter(a => !a.supplied);
ok(arrivals.size === all.filter(r => r[9] > 0).length, '入场增援数 ' + arrivals.size + ' 应等于 OOB arrive>0 行数 ' + all.filter(r => r[9] > 0).length);
ok(bad.length === 0, '入场即断补的增援: ' + bad.length + (bad.length ? ' → ' + bad.slice(0, 10).map(b => b.name + '@R' + b.arrive).join(', ') : ''));
/* 第三条收窄(原版33④本意是防"同批落位未齐的瞬时误报"): 只拦"入场当回合"的切断日志;
   入场之后因敌军逼近补给源被切断属动态玩法(12.16 前线犬牙交错), 计为提示不计失败。 */
const sameRoundCut = cutLogs.filter(l => {
  const rd = +l.split(':')[0];
  for (const a of arrivals.values()) if (a.name && l.includes(a.name) && (rd === a.arrive || rd === a.arrive + 1)) return true;
  return false;
});
ok(sameRoundCut.length === 0, '入场当回合误报切断: ' + sameRoundCut.length + (sameRoundCut.length ? ' → ' + sameRoundCut.slice(0, 6).join(' | ') : ''));
if (cutLogs.length) console.log('  (提示) 后续回合因敌军贴近补给源被切断 ' + cutLogs.length + ' 条: ' + cutLogs.slice(0, 5).map(x => x.split(':')[1]?.slice(0, 14)).join('、') + (cutLogs.length > 5 ? '…' : ''));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
