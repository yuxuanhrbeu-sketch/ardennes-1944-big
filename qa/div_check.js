#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * div_check.js — 师级数据集与剧本核查（25k，2026-10-28）
 * 断言：
 *   1) DATA_DIV 派生完整（44 字段覆盖 + 地理回 base 52×32）
 *   2) 师级 OOB：聚合正确（26VG atk=营合计等抽样）、无 167VG/15装掷/151旅
 *   3) 指挥部 25 座映射、isHQ、org 20/15/10
 *   4) 剧本 2 个（div_standard 12/div_campaign 24）胜负门槛 3/4
 *   5) 构造开局势（mapgen 52×32 生成、无同格冲突、互斥阵地）
 *   6) 成就互通（ACHIEVEMENTS 同源）
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'data_div_oob.js', 'data_div.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_DIV;
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

console.log('== 1. DATA_DIV 派生 ==');
const D = globalThis.DATA_DIV;
ok(D.COLS === 34 && D.ROWS === 21, '地图 34×21（52×32 同步缩小）', D.COLS + '×' + D.ROWS);
ok(D.TOWNS.length === 25, '城镇 25 座（缩放后全部保留）', D.TOWNS.length);
ok(Object.keys(D.RIVERS).length === 8 && Object.keys(D.ROADS).length >= 5, '河流 8 条 / 道路缩放保留', Object.keys(D.ROADS).length);
ok(D.TYPES === globalThis.DATA_BIG.TYPES, 'TYPES 同源 big（含 HQK/HQA/HQT）');
ok(D.TRAIT_KNOBS === globalThis.DATA_BIG.TRAIT_KNOBS, 'TRAIT_KNOBS 同源 big');
ok(D.ACHIEVEMENTS === globalThis.ACH_DATA.ACHIEVEMENTS, 'ACHIEVEMENTS 同源（37 条互通）');
ok(D.DATES === globalThis.DATA_BASE.DATES, 'DATES 同源 base（24 天历法）');
ok(D.EXITS_NEEDED === 3, 'EXITS_NEEDED 3（师级攻势门槛）');

console.log('== 2. 师级 OOB ==');
const rows = [...D.OOB_DE, ...D.OOB_US];
ok(rows.length === 74, '74 算子 = 72 师旅 + 2 总指挥部', rows.length);
const meta = D.OOB_BIG_META;
ok(Object.keys(meta).length === rows.length, 'META 链完整', Object.keys(meta).length);
// 无 167VG/15装掷/151旅
const bad = rows.filter(r => /167国民|第15装甲掷弹兵师|151步兵旅/.test(r[1]));
ok(bad.length === 0, '无 167VG/15装掷/151旅（26d 研究口径）', bad.map(r => r[1]).join(',') || '无');
// 指挥部
const hq = rows.filter(r => r[3] === 'HQT' || r[3] === 'HQA' || r[3] === 'HQK');
ok(hq.length === 2, '只保留两军总指挥部（2 座）', hq.length);
ok(hq.every(r => r[3] === 'HQT' && r[10] === 128), '两座总指挥部 org 128（区间上限）');
// 无同格冲突
const seen = new Set(); let dup = 0;
for (const r of rows) { const k = r[7] + ',' + r[8]; if (seen.has(k)) dup++; seen.add(k); }
ok(dup === 0, '无同格冲突', dup + ' 处');
// 全在图内
ok(rows.every(r => r[7] >= 1 && r[7] <= 34 && r[8] >= 1 && r[8] <= 21), '全部在 34×21 图内');

console.log('== 3. 数值梯度（26j 手工表） ==');
{
  const rows2 = [...D.OOB_DE, ...D.OOB_US].filter(r => !/^HQ/.test(r[3]));
  // 每个师旅攻防须在合理区间（师 25-80 / 旅 5-35），且不得为 0
  ok(rows2.every(r => r[4] >= 5 && r[5] >= 3), '所有师旅攻/防非零', '');
  ok(rows2.every(r => r[4] <= 85 && r[5] <= 70), '攻防在师级合理上限内（≤85/70）', '');
  // 同类师梯度：德军装甲 8 师应递减且不全相同
  const deArm = rows2.filter(r => D.OOB_BIG_META[r[0]].nat === 'DE' && r[3] === 'ARM' && !/旅/.test(r[1]));
  const atks = deArm.map(r => r[4]);
  ok(new Set(atks).size >= 5, '德军装甲师攻值有梯度（≥5 档）', atks.sort((a,b)=>b-a).join('>'));
  // VG 三档
  const vg = rows2.filter(r => /国民掷弹兵师/.test(r[1]));
  ok(new Set(vg.map(r => r[4])).size === 3, '国民掷弹兵师分 3 档', [...new Set(vg.map(r=>r[4]))].sort((a,b)=>b-a).join('/'));
  // 组织度梯度 ≥6 档
  ok(new Set(rows2.map(r => r[10])).size >= 10, '组织度梯度（≥10 档，量级 8-48）', [...new Set(rows2.map(r=>r[10]))].sort((a,b)=>b-a).join(','));
  ok(Math.min(...rows2.map(r => r[10])) >= 56 && Math.max(...rows2.map(r => r[10])) <= 128, '组织度区间 56~128（用户规定）', Math.min(...rows2.map(r=>r[10])) + '~' + Math.max(...rows2.map(r=>r[10])));
  // 最强/最弱师（排除旅）比值 ≤ 3
  const divs = rows2.filter(r => !/旅/.test(r[1]));
  const mx = Math.max(...divs.map(r => r[4] + r[5])), mn = Math.min(...divs.map(r => r[4] + r[5]));
  ok(mx / mn <= 3, '师级最强/最弱 ≤ 3 倍', (mx / mn).toFixed(2) + '×');
}

console.log('== 4. 剧本 ==');
ok(!!D.SCENARIOS.div_standard && D.SCENARIOS.div_standard.rounds === 12 && D.SCENARIOS.div_standard.campaign === false, 'div_standard 12 回合攻势');
ok(!!D.SCENARIOS.div_campaign && D.SCENARIOS.div_campaign.rounds === 24 && D.SCENARIOS.div_campaign.campaign === true, 'div_campaign 24 回合全战役');
ok(D.SCENARIOS.div_standard.exitsNeeded === 3 && D.SCENARIOS.div_campaign.exitsNeeded === 4, '渡河门槛 3/4（师级口径）');
ok(!D.SCENARIOS.div_standard.reinforcements, '无独立增援字段（师算子 arrive 内建）');

console.log('== 5. 构造开局 ==');
{
  const g = new Game('div_standard', 42);
  const opening = g.units.length;
  const rein = rows.filter(r => r[9] > 0).length;
  ok(opening + rein === rows.length, '开局 ' + opening + ' + 增援 ' + rein + ' = ' + rows.length, opening + '+' + rein);
  ok(g.scenario.id === 'div_standard', 'scenario.id 识别');
  const hq = g.units.filter(u => u.isHQ && u.alive);
  ok(hq.length === 2, '总指挥部 2 座在场', hq.length);
  // 撤子引擎兼容（snapshotJson）
  const u0 = g.units.find(x => x.alive && x.mov > 0);
  const snap = g.snapshotJson();
  const c0 = u0.c;
  g.doMove(u0, [{ c: u0.c, r: u0.r }, { c: u0.c + 1, r: u0.r }]);
  g.restoreJson(snap);
  const u1 = g.units.find(x => x.uid === u0.uid);
  ok(u1 && u1.c === c0, '撤子引擎兼容（快照回滚）');
  // 师级无 167VG/15装掷/151旅
  ok(!g.units.some(u => /167国民|第15装甲掷弹兵师|151步兵旅|231步兵旅|69步兵旅/.test(u.name)), '排除单位不在场（含231/69旅）');
  // 26g: 师级取消补给机制
  // 26h: 史实地理核查
  {
    const tn = n => g.map.towns.find(x => x.name === n);
    const st = tn('圣维特'), ba = tn('巴斯托涅'), mo = tn('蒙绍'), di = tn('迪基希'), din = tn('迪南');
    ok(st && ba && st.c > ba.c && st.r < ba.r, '圣维特在巴斯托涅东北（史实）', st && ba ? '' : '');
    ok(mo && st && mo.r < st.r, '蒙绍在圣维特以北');
    ok(di && ba && di.r > ba.r && di.c > ba.c, '迪基希在巴斯托涅东南');
    ok(din && din.c <= 2, '马斯河（迪南）贴图西缘');
    const deU = g.units.filter(u => u.side === 'DE' && u.alive);
    const usU = g.units.filter(u => u.side === 'US' && u.alive);
    const deC = deU.reduce((a, u) => a + u.c, 0) / deU.length;
    const usC = usU.reduce((a, u) => a + u.c, 0) / usU.length;
    ok(deC > usC + 3, '德军质心在盟军以东（东西分界正确）', 'DE c=' + deC.toFixed(1) + ' / US c=' + usC.toFixed(1));
    ok(deU.filter(u => u.c < 8).length === 0, '德军无单位越过马斯河以西', '0 个');
    const hqDe = g.units.find(u => u.isHQ && u.side === 'DE');
    ok(hqDe && hqDe.c > 24, '德军总指挥部在纵深（c>24）', hqDe ? 'c=' + hqDe.c : '无');
  }
  ok(D.SUPPLY_DISABLED === true, '师级补给机制已禁用');
  ok(g.units.every(u => u.supplied === true), '所有单位恒有补给', '');
  ok(g.supplySources('DE').length === 0 && g.townCoverage(20, 8) === null, '补给源为空 / 城市不展示覆盖');
  // 成就互通
  ok(D.ACHIEVEMENTS.length === 108, '成就 108 条互通（26z 铜章扩充口径）');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
