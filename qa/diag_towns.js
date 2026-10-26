#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* 诊断：① TOWNS 里哪些点 mapgen 没建成城镇  ② 补给覆盖里有没有地图外的键 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;
const g = new Game('big', 20241216);

console.log('DATA_BIG.TOWNS = ' + D.TOWNS.length);
console.log('mapgen towns   = ' + g.map.towns.length);
const built = new Set(g.map.towns.map(t => t.name));
const missing = D.TOWNS.filter(t => !built.has(t[2]));
console.log('未建成城镇 ' + missing.length + ' 座:');
for (const t of missing) console.log('   [' + t[0] + ',' + t[1] + '] ' + t[2] + ' ctrl=' + t[6] + ' 补给=' + t[5]);

/* 检查是否有补给覆盖键不属于地图 */
const bad = [];
for (const side of ['DE', 'US']) {
  for (const sc of g.supplySources(side)) {
    for (const k of g.supplyCoverageFrom(sc).keys()) if (!g.map.hexes.has(k)) bad.push(k + ' (from ' + sc.name + ')');
  }
}
console.log('\n地图外的覆盖键 ' + bad.length + ' 个' + (bad.length ? ': ' + bad.slice(0, 6).join(' ') : ''));

/* 地图 hex 统计 */
let byKind = {};
for (const [, h] of g.map.hexes) byKind[h.terrain] = (byKind[h.terrain] || 0) + 1;
console.log('\nhex 总数 ' + g.map.hexes.size + '  按地形 ' + JSON.stringify(byKind));
