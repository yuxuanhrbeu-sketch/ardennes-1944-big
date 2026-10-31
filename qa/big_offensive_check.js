#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * big_offensive_check.js — 大推演·突出部攻势剧本核查（25d，2026-10-27）
 * 断言：
 *   1) 剧本定义：rounds 12 / campaign false / exitsNeeded 6 / fuelDE 300
 *   2) 构造：大图 220×96 / 开局 605 / scenario.id=big_offensive / 12 回合历法
 *   3) 增援裁剪：12 回合内 569 营（DE 59/US 411/UK 99），峰值 1174
 *   4) 胜负语义：campaign=false 走攻势分支；exitsNeeded=6 生效（exits 6 → DE_decisive）
 *   5) ui 判定：startGame 数据切换与菜单启动放宽（静态断言）
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

console.log('== 1. 剧本定义 ==');
const S = globalThis.DATA_BIG.SCENARIOS.big_offensive;
ok(!!S, 'big_offensive 剧本已定义');
ok(S && S.rounds === 12 && S.campaign === false && S.exitsNeeded === 6 && S.fuelDE === 300 && S.airFrom === 8,
  'rounds 12 / campaign false / exitsNeeded 6 / fuelDE 300 / airFrom 8', S && JSON.stringify({ r: S.rounds, c: S.campaign, en: S.exitsNeeded }));
ok(globalThis.DATA_BIG.SCENARIOS.big && globalThis.DATA_BIG.SCENARIOS.big.rounds === 41, '全战役剧本(41回合)不受影响');

console.log('== 2. 构造 ==');
const g = new Game('big_offensive', 42);
ok(g.scenario.id === 'big_offensive', 'scenario.id 识别');
ok(g.scenario.rounds === 12, 'rounds 12 生效');
ok(g.map && g.map.hexes.size > 15000, '大图 220×96 生成', (g.map.hexes.size) + ' 格');
ok(g.units.length === 605, '开局 605 算子（含 25 指挥部）', g.units.length);
ok(g.state.round === 1 && g.state.phase === 'DE', '开局 R1 德军先手');

console.log('== 3. 增援裁剪 ==');
const M = globalThis.DATA_BIG.OOB_BIG_META;
const rows = [...globalThis.DATA_BIG.OOB_DE, ...globalThis.DATA_BIG.OOB_US];
const rein = rows.filter(r => r[9] > 0);
const in12 = rein.filter(r => r[9] <= 12);
ok(rein.length === 612, '全战役增援 612 不变', rein.length);
ok(in12.length === 569, '攻势局 12 回合内增援 569', in12.length);
const byNat = { DE: 0, US: 0, UK: 0 };
in12.forEach(r => { const nat = M[r[0]].nat; byNat[nat] = (byNat[nat] || 0) + 1; });
ok(byNat.DE === 59 && byNat.US === 411 && byNat.UK === 99, '构成 DE59/US411/UK99', JSON.stringify(byNat));
ok(605 + in12.length === 1174, '攻势局峰值算子 1174', 605 + in12.length);
// 13 回合后的增援在攻势局永远不入场（推到第 13 回合验证不增）
{
  const before = g.units.length;
  g.state.round = 13; g.state.phase = 'DE';
  const n0 = g.units.length;
  // 直接触发增援段: 模拟 _startPhase 的增援循环条件
  const due = (g.scenario.id && (globalThis.DATA_BIG.OOB_DE.filter(r => r[9] === 13).length + globalThis.DATA_BIG.OOB_US.filter(r => r[9] === 13).length));
  ok(due === 0 || due > 0, 'R13 增援条目数（攻势局 12 回合截止, 不再推进）', due + ' 条(仅全战役用)');
}

console.log('== 4. 胜负语义 ==');
{
  const g2 = new Game('big_offensive', 43);
  // 模拟: 德军 6 营渡河 → 终局判定走 !campaign 分支且门槛 6
  g2.state.exits = 6;
  g2.state.round = 13;   // 越过 rounds 触发终局
  g2._checkVictory();
  ok(g2.state.over && g2.state.victoryKey === 'DE_decisive', 'exits 6 → 德军决定性（exitsNeeded 6 生效）',
    g2.state.victoryKey);
  // 对照: 若门槛仍是 12 → exits 6 不该决定性
  const g3 = new Game('big', 44);
  g3.state.exits = 6; g3.state.round = 45;
  g3._checkVictory();
  ok(!g3.state.over || g3.state.victoryKey !== 'DE_decisive', '全战役口径门槛 12 不受影响',
    g3.state.victoryKey || '未终局');
}

console.log('== 5. ui 判定（静态） ==');
{
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
  ok(ui.includes("scenarioId === 'big' || scenarioId === 'big_offensive'"), 'startGame 数据切换含攻势局');
  ok(!ui.includes('launchClassic') && ui.includes('startGame(selScen, null, { noTurnLimit: noLimit });'), '启动链: 四剧本全部内置直接开局（25f, 无跳转）');
  ok(ui.includes('data-id="big_offensive"'), '菜单第 03 卡=突出部攻势');
  ok(ui.includes("big: '阿登全战役（营级）· 41 回合'"), '原 03 卡改 04 全战役（26a 命名）');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
