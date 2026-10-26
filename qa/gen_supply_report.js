'use strict';
/* 生成补给点清单报告（只读数据，输出 Markdown） */
const fs = require('fs');
const pathm = require('path');
const ROOT = pathm.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(pathm.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;
const g = new Game('big', 20241216);
const total = D.COLS * D.ROWS;

const L = [];
L.push('# 补给点总表（big 剧本 · 开局基线）');
L.push('');
L.push('> 由 `node qa/gen_supply_report.js` 生成 ｜ 地图 ' + D.COLS + '×' + D.ROWS + ' ｜ 城镇 ' + g.map.towns.length + ' 座');
L.push('');
L.push('**等级与成本预算**（`range` 是成本预算，不是格数；实际覆盖由地形/道路/河流决定）：');
L.push('');
L.push('| 等级 | 职能 | 预算 | 座数 | 平均覆盖 | 折算面积 | 最大单城 |');
L.push('|---|---|---|---|---|---|---|');
for (const tier of [3, 2, 1]) {
  const ts = g.map.towns.filter(t => t.supply && t.tier === tier);
  if (!ts.length) continue;
  let s = 0, mx = 0;
  for (const x of ts) { const c = g.townCoverage(x.c, x.r); s += c.cost.size; mx = Math.max(mx, c.cost.size); }
  const nm = { 3: '集团军群/集团军级枢纽', 2: '军级补给中心', 1: '师级补给点' }[tier];
  L.push('| ' + tier + ' | ' + nm + ' | ' + ts[0].range + ' | ' + ts.length + ' | ' +
    (s / ts.length).toFixed(0) + ' 格 | ' + (s / ts.length * 7.8).toFixed(0) + ' km² | ' + mx + ' 格 |');
}
L.push('');
const reachBy = {};
for (const side of ['DE', 'US']) {
  const src = g.supplySources(side);
  const reach = new Set();
  for (const sc of src) for (const k of g.supplyCoverageFrom(sc).keys()) reach.add(k);
  reachBy[side] = reach.size;
  L.push('- **' + (side === 'DE' ? '德军' : '盟军') + '**：补给点 ' + src.length +
    ' 座，合计覆盖 ' + reach.size + ' 格（全图 ' + (100 * reach.size / total).toFixed(0) + '%）');
}
L.push('');
L.push('---');
L.push('');

for (const tier of [3, 2, 1]) {
  const ts = g.map.towns.filter(t => t.supply && t.tier === tier)
    .sort((a, b) => (a.ctrl < b.ctrl ? -1 : a.ctrl > b.ctrl ? 1 : a.r - b.r));
  const nm = { 3: '集团军级枢纽', 2: '军级补给中心', 1: '师级补给点' }[tier];
  L.push('## ' + nm + '（预算 ' + (ts[0] ? ts[0].range : '-') + '，共 ' + ts.length + ' 座）');
  L.push('');
  L.push('| # | 阵营 | 坐标 | 名称 | 覆盖格数 |');
  L.push('|---|---|---|---|---|');
  let i = 0;
  for (const t of ts) {
    const cov = g.townCoverage(t.c, t.r);
    i++;
    L.push('| ' + i + ' | ' + (t.ctrl === 'DE' ? '德' : '盟') + ' | ' + t.c + ',' + t.r + ' | ' + t.name + ' | ' + cov.cost.size + ' |');
  }
  L.push('');
}
L.push('---');
L.push('');
L.push('*补给点 ' + g.map.towns.filter(t => t.supply).length + ' / ' + g.map.towns.length +
  ' 座城镇；开局面积覆盖：德军 ' + (100 * reachBy.DE / total).toFixed(1) + '% / 盟军 ' +
  (100 * reachBy.US / total).toFixed(1) + '%（全图 ' + total + ' 格）。' +
  '本表由 `node qa/gen_supply_report.js` 生成，勿手改。*');
fs.writeFileSync(pathm.join(ROOT, 'docs', 'SUPPLY_POINTS.md'), L.join('\n') + '\n', 'utf8');
console.log('已生成 SUPPLY_POINTS.md，共 ' + (L.length) + ' 行');
