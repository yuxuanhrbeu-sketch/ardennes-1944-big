#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/terrain_map.js — 地形分布核查（只读，不跑推演）
 *   ① 全图地形构成比例
 *   ② 按门地理区域统计地形构成（对照史实：阿登密林 / 埃尔森博恩 /
 *      高沼地 / 雪艾费尔 / 艾费尔高原 / 卢森堡古特兰 / 摩泽尔河谷 /
 *      马斯河谷 / 莱茵河谷 / 北部低地）
 *   ③ 输出 ASCII 地形图（F森林 r丘陵 M山地 m沼泽 .平原 T城镇 ~河流）
 * 用法: node qa/terrain_map.js [c0 c1 r0 r1]   (可选窗口)
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;
const map = MapGen.build();
const at = (c, r) => map.hexes.get(Hex.key(c, r));

/* ① 全图构成 */
const tot = {};
for (const [, h] of map.hexes) tot[h.terrain] = (tot[h.terrain] || 0) + 1;
const N = map.hexes.size;
console.log('== 全图地形构成 (' + map.cols + 'x' + map.rows + ' = ' + N + ' 格) ==');
for (const k of Object.keys(tot).sort((a, b) => tot[b] - tot[a])) {
  console.log('   ' + k.padEnd(9) + String(tot[k]).padStart(6) + '  ' + (100 * tot[k] / N).toFixed(1) + '%');
}
console.log('   参考：旧图 standard 52x32 = 森林42.2% 丘陵30.7% 平原13.3% 山地6.5% 沼泽5.8%');

/* ② 地理区域构成 */
const REGIONS = [
  ['阿登核心林区(乌尔河—马斯河)', 55, 93, 34, 55],
  ['高沼地/埃尔森博恩(北肩)', 86, 103, 23, 33],
  ['雪艾费尔(施内艾费尔)', 96, 119, 29, 39],
  ['艾费尔高原(中北)', 88, 139, 24, 51],
  ['卢森堡古特兰(南)', 80, 111, 53, 71],
  ['摩泽尔河谷带(含两岸)', 106, 155, 36, 61],
  ['马斯河谷(西缘)', 19, 75, 12, 42],
  ['马斯河西岸平原', 0, 24, 18, 48],
  ['莱茵河谷带(含两岸高地)', 126, 214, 8, 82],
  ['北部低地(鲁尔—马斯特里赫特)', 0, 139, 0, 18],
  ['法梅尼/孔德里兹', 24, 54, 35, 47],
  ['洛林高原(南)', 73, 134, 65, 95],
  ['普法尔茨森林', 145, 190, 45, 70],
  ['法国阿登/香槟(西南)', 0, 47, 49, 95],
];
console.log('\n== 地理区域地形构成（对照史实） ==');
console.log('   区域'.padEnd(34) + '格数   森林   丘陵   平原   山地   沼泽');
for (const [name, c0, c1, r0, r1] of REGIONS) {
  const cnt = {}; let n = 0;
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
    const h = at(c, r); if (!h) continue; cnt[h.terrain] = (cnt[h.terrain] || 0) + 1; n++;
  }
  if (!n) continue;
  const p = k => (100 * (cnt[k] || 0) / n).toFixed(0).padStart(5) + '%';
  console.log('   ' + name.padEnd(32) + String(n).padStart(5) + p('forest') + p('rough') + p('plain') + p('mountain') + p('marsh'));
}

/* ②b 河谷走廊构成（河道格 + 1 环）——直接验证"河谷不是森林/山地" */
console.log('\n== 河谷走廊地形构成（河道格 + 1 环）==');
{
  const corridor = new Set();
  for (const k of map.riverSet) {
    corridor.add(k);
    const p = Hex.parse(k);
    for (const n of Hex.neighbors(p.c, p.r)) corridor.add(Hex.key(n.c, n.r));
  }
  const cc = {}; let cn = 0;
  for (const k of corridor) { const h = map.hexes.get(k); if (!h) continue; cc[h.terrain] = (cc[h.terrain] || 0) + 1; cn++; }
  const cp = k => (100 * (cc[k] || 0) / cn).toFixed(1).padStart(5) + '%';
  console.log('   格数 ' + cn + '  森林' + cp('forest') + '  丘陵' + cp('rough') +
    '  平原' + cp('plain') + '  山地' + cp('mountain') + '  沼泽' + cp('marsh'));
}

/* ③ ASCII 图 */
const args = process.argv.slice(2).map(Number);
let c0 = 0, c1 = map.cols - 1, r0 = 0, r1 = map.rows - 1;
if (args.length === 4) { c0 = args[0]; c1 = args[1]; r0 = args[2]; r1 = args[3]; }
const CH = { forest: 'F', rough: 'r', plain: '.', mountain: 'M', marsh: 'm', town: 'T' };
console.log('\n== ASCII 地形图  c' + c0 + '..' + c1 + '  r' + r0 + '..' + r1 + ' ==');
console.log('   F森林 r丘陵 .平原 M山地 m沼泽 T城镇 ~河流 *河流+道路');
let header = '      ';
for (let c = c0; c <= c1; c++) header += (c % 10 === 0) ? String((c / 10) % 10) : ' ';
console.log(header);
for (let r = r0; r <= r1; r++) {
  let line = String(r).padStart(4) + '  ';
  for (let c = c0; c <= c1; c++) {
    const h = at(c, r);
    if (!h) { line += ' '; continue; }
    if (h.river && h.road) line += '*';
    else if (h.river) line += '~';
    else if (h.route === 'x') line += '?';
    else line += (CH[h.terrain] || '?');
  }
  console.log(line);
}
