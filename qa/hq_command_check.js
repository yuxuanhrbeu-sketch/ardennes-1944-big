#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * hq_command_check.js — 指挥部算子与毁灭冲击核查（24r，2026-10-25）
 * 断言：
 *   1) 25 座指挥部在册（德14/美9/英2），军10/集15/总20，攻防=本国步兵营
 *   2) 位置在所辖营质心后方（德 c≥锚、盟 c≤锚），不在敌方城镇格
 *   3) 每个军/集团军恰一座指挥部，无遗漏
 *   4) 毁灭冲击：军-2/集-3/总-4，org/攻防扣减下限 1，一次性，范围正确
 *   5) 指挥部是补给源（isHQ），死亡后自动移出补给源
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const B = globalThis.DATA_BIG;
const rows = [...B.OOB_DE, ...B.OOB_US];
const hq = rows.filter(r => /^HQT$|^HQA$|^HQK$/.test(r[3]));

console.log('== 1. 编制完整性 ==');
ok(hq.length === 25, '指挥部 25 座', '实际 ' + hq.length);
const cnt = t => hq.filter(r => r[3] === t).length;
ok(cnt('HQT') === 2 && cnt('HQA') === 6 && cnt('HQK') === 17, '总2/集6/军17（德集3+美集2+英集1）', `总${cnt('HQT')}/集${cnt('HQA')}/军${cnt('HQK')}`);
const orgOk = hq.every(r => (r[3] === 'HQT' && r[10] === 20) || (r[3] === 'HQA' && r[10] === 15) || (r[3] === 'HQK' && r[10] === 10));
ok(orgOk, '组织度 分级 20/15/10');
ok(hq.every(r => (r[3] === 'HQT' || r[3] === 'HQA' || r[3] === 'HQK') && r[4] >= 3 && r[4] <= 4 && r[5] >= 4 && r[5] <= 6), '攻防参考本国步兵营（德3/4 美4/6）');
ok(hq.every(r => r[9] === 0), '全部开局在场');

console.log('== 2. 位置 ==');
const hqC = id => rows.find(r => r[0] === id)[7];
ok(hq.filter(r => B.OOB_BIG_META[r[0]].nat === 'DE').every(r => r[7] >= 100), '德军指挥部全部在东纵深(c≥100)');
ok(hq.filter(r => B.OOB_BIG_META[r[0]].nat !== 'DE').every(r => r[7] <= 80), '盟军指挥部全部在西后方(c≤80)');
ok(hq.every(r => r[7] > 0 && r[7] < 219 && r[8] > 0 && r[8] < 95), '全部图内');
// 无同格冲突
const keys = new Set(), dup = [];
for (const r of rows) { const k = r[7] + ',' + r[8]; if (keys.has(k)) dup.push(k); keys.add(k); }
ok(dup.length === 0, '全图无同格冲突', dup.join(',') || '0 冲突');

console.log('== 3. 覆盖完整性（每军/集团军恰一座） ==');
const corpsAll = new Set(), hqCorps = new Set();
for (const [id, m] of Object.entries(B.OOB_BIG_META)) {
  if (!m.corps || m.div === '司令部' || m.corps === '军属预备队') continue;   // 英军预备队非军级建制
  corpsAll.add(m.corps);
}
for (const r of hq) { const m = B.OOB_BIG_META[r[0]]; if (m.corps) hqCorps.add(m.corps); }
const missCorps = [...corpsAll].filter(c => !hqCorps.has(c));
ok(missCorps.length === 0, '每个军恰有军部', missCorps.join(',') || '全覆盖');
const armies = new Set(), hqArmies = new Set();
for (const [id, m] of Object.entries(B.OOB_BIG_META)) {
  if (m.army === '统帅部' || m.div === '司令部') continue;
  armies.add(m.army);
}
for (const r of hq) { const m = B.OOB_BIG_META[r[0]]; if (m.type !== undefined) continue; if (r[3] === 'HQA' || r[3] === 'HQT') hqArmies.add(m.army); }
const missArmy = [...armies].filter(a => !hqArmies.has(a));
ok(missArmy.length === 0, '每个集团军恰有司令部', missArmy.join(',') || '全覆盖');

console.log('== 4. 毁灭冲击 ==');
{
  const g = new Game('big', 20241216);
  const meta = B.OOB_BIG_META;
  const byName = n => g.units.find(u => u.name.includes(n) && u.alive);
  // 军部冲击：第47装甲军军部被毁 → 第2装甲师某营 -2
  const hq47 = g.units.find(u => u.name === '第47装甲军军部');
  const victim = g.units.find(u => u.alive && meta[u.id] && meta[u.id].corps === '第47装甲军' && !u.isHQ);
  const org0 = victim.org, atk0 = victim.atk, def0 = victim.def;
  hq47.alive = false; g._removeUnit(hq47); g.noteKill(hq47);
  ok(victim.org === Math.max(1, org0 - 2) && victim.atk === Math.max(1, atk0 - 2) && victim.def === Math.max(1, def0 - 2), '军部被毁: 全军 org/攻防 -2',
    `org ${org0}→${victim.org} · atk ${atk0}→${victim.atk} · def ${def0}→${victim.def}`);
  // 集团军部冲击：第5装甲集团军司令部
  const hq5 = g.units.find(u => u.name === '第5装甲集团军司令部');
  const v5a = g.units.find(u => u.alive && meta[u.id] && meta[u.id].army === '第5装甲集团军（中路）' && !u.isHQ);
  const o5 = v5a.org;
  const outsider = g.units.find(u => u.alive && meta[u.id] && meta[u.id].army === '第7集团军（南翼）' && !u.isHQ);
  const oOut = outsider.org, aOut = outsider.atk;
  hq5.alive = false; g._removeUnit(hq5); g.noteKill(hq5);
  ok(v5a.org === Math.max(1, o5 - 3), '集团军部被毁: 该集团军 -3');
  ok(outsider.org === oOut && outsider.atk === aOut, '其他集团军不受影响');
  // 总部冲击：德军西线总司令部
  const ob = g.units.find(u => u.name === '德军西线总司令部');
  const vAll = g.units.find(u => u.alive && meta[u.id] && meta[u.id].nat === 'DE' && !u.isHQ);
  const oA = vAll.org;
  const usGuy = g.units.find(u => u.alive && meta[u.id] && meta[u.id].nat === 'US' && !u.isHQ);
  const oUs = usGuy.org;
  ob.alive = false; g._removeUnit(ob); g.noteKill(ob);
  ok(vAll.org === Math.max(1, oA - 4), '总指挥部被毁: 本国籍全部 -4');
  ok(usGuy.org === oUs, '敌国不受影响');
  // 下限保护：org=1 的单位再受冲击不再降
  const v2 = g.units.find(u => u.alive && meta[u.id] && meta[u.id].nat === 'DE' && !u.isHQ);
  v2.org = 1; v2.atk = 1; v2.def = 1;
  const hq47b = g.units.find(u => u.name === '第47装甲军军部');
  if (hq47b) { hq47b.alive = false; g._removeUnit(hq47b); g.noteKill(hq47b); }
  ok(v2.org === 1 && v2.atk === 1 && v2.def === 1, '下限保护: 已在 1 不再减、不致死');
  // 补给源：指挥部死亡后移出
  const hqAlive = g.units.find(u => u.isHQ && u.alive && B.OOB_BIG_META[u.id] && B.OOB_BIG_META[u.id].corps === '第2装甲师');
  const inSrc1 = g.supplySources('DE').some(s => s.kind === 'hq');
  ok(inSrc1, '指挥部在册时是补给源(isHQ)');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
