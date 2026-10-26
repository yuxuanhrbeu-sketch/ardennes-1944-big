#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * dossier_coverage_check.js — 全员部队档案覆盖检查（24o，2026-10-25）
 * 性质：构造式静态校验，不运行推演（工程纪律）。
 * 断言：
 *   1) 分片可加载、key 唯一、字段齐备、增援条目有 histDate
 *   2) 挂载一致性：DOSSIERS / DOSSIERS_OPEN / REINFORCE_DOSSIERS
 *   3) META.dos 逐营映射 1192/1192（dispName→div→parent 三级命中）
 *   4) dos 指向的档案 key 存在且阵营一致
 *   5) 抽查：直属营/师属营/英军营 各命中正确档案
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
const all = require(path.join(ROOT, 'js', 'dossiers_big.js'));

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

console.log('== 1. 档案数据完整性 ==');
const keys = new Set(), dup = [];
for (const d of all) { if (keys.has(d.key)) dup.push(d.key); keys.add(d.key); }
ok(all.length >= 270, '档案总条数 ≥ 270 (245 + 25 指挥部)', '实际 ' + all.length);
ok(dup.length === 0, 'key 无重复', dup.join(',') || '0 重复');
ok(all.every(d => d.match && d.match.length >= 1), '每条有 match[]');
ok(all.every(d => d.name && d.intro && d.side && d.branch && d.type && d.strength), '每条 name/intro/side/branch/type/strength 齐备');
ok(all.every(d => d.open ? true : !!d.histDate), '每条增援档案有 histDate');

console.log('== 2. 挂载一致性 ==');
const DB = globalThis.DATA_BIG;
ok(!!DB.DOSSIERS && DB.DOSSIERS.length === all.length, 'DATA_BIG.DOSSIERS 挂载', String(DB.DOSSIERS && DB.DOSSIERS.length));
ok(!!DB.DOSSIERS_OPEN && DB.DOSSIERS_OPEN.length === all.filter(d => d.open).length, 'DOSSIERS_OPEN = 开局子集', '开局 ' + DB.DOSSIERS_OPEN.length);
ok(!!DB.REINFORCE_DOSSIERS && DB.REINFORCE_DOSSIERS.length === all.filter(d => !d.open).length, 'REINFORCE_DOSSIERS = 非open子集', '增援 ' + DB.REINFORCE_DOSSIERS.length);
ok(DB.REINFORCE_DOSSIERS.every(d => d.match && d.intro), '增援条目保留 match/intro（弹卡兼容）');

console.log('== 3. 1217 算子逐个映射 ==');
const M = DB.OOB_BIG_META;
const byKey = {}; for (const d of all) byKey[d.key] = d;
const noDos = [], badRef = [];
for (const [id, m] of Object.entries(M)) {
  if (!m.dos) { noDos.push(id + ':' + (m.div || '?')); continue; }
  const d = byKey[m.dos];
  if (!d) { badRef.push(id + '→' + m.dos); continue; }
  const side = (m.nat || 'DE') === 'DE' ? 'DE' : (m.nat || '') === 'UK' ? 'UK' : 'US';
  if (d.side !== side) badRef.push(id + ' 阵营不符 ' + d.side + '/' + side);
}
ok(noDos.length === 0, 'META.dos 全 1217 映射', noDos.length ? ('未映射 ' + noDos.length + ' 例: ' + noDos.slice(0, 10).join(' | ')) : '1217/1217');
ok(badRef.length === 0, 'dos 指向档案存在且阵营一致', badRef.slice(0, 8).join(' | ') || '全部有效');

console.log('== 4. 抽查 ==');
const chk = (id, wantKey, label) => ok(M[id] && M[id].dos === wantKey, label, (M[id] ? M[id].dos : '无META') + ' (期望 ' + wantKey + ')');
chk('D001', 'hq_d001', '集团军直属营 D001 命中本营档案');
chk('D005', 'de_167vgd', '167VG 团属营命中师档案');
chk('D147', 'hq_d147', '海德特伞兵营命中本营档案');
const usArm = Object.keys(M).find(id => M[id].div === '美军第3集团军直属');
ok(usArm && M[usArm].dos && byKey[M[usArm].dos] && byKey[M[usArm].dos].branch === '美军第3集团军直属', '美军第3集团军直属营命中', (M[usArm] && M[usArm].dos) || '未映射');
const ukId = Object.keys(M).find(id => M[id].nat === 'UK');
ok(ukId && M[ukId].dos && byKey[M[ukId].dos].branch === '英军', '英军营命中英军档案', ukId + ' → ' + (M[ukId] && M[ukId].dos));
const lahs = Object.keys(M).find(id => (M[id].div || '').indexOf('党卫军第1装甲师') >= 0);
ok(lahs && byKey[M[lahs].dos] && byKey[M[lahs].dos].key === 'de_1ss', '警卫旗队师属营命中 de_1ss', (M[lahs] && M[lahs].dos) || '未映射');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
