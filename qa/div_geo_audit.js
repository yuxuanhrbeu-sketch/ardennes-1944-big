'use strict';
/* 26h 师级地图史实核查：城镇相对关系 / 师级单位落位 / 地形构成 / 河流道路 */
global.window = global;
const fs = require('fs');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'data_div_oob.js', 'data_div.js', 'mapgen.js', 'combat.js', 'game.js']) eval(fs.readFileSync('D:/ardennes-big/js/' + f, 'utf8'));
globalThis.DATA = globalThis.DATA_DIV;
const D = globalThis.DATA_DIV;
const g = new Game('div_standard', 42);

const T = n => { const t = g.map.towns.find(x => x.name === n); return t ? `(${t.c},${t.r})` : '无'; };
const U = n => { const u = g.units.find(x => x.name.includes(n) && x.alive); return u ? `(${u.c},${u.r})` : '不在场'; };

console.log('=== 1. 城镇相对关系（史实 → 图面）===');
const pairs = [
  ['圣维特', '巴斯托涅', '圣维特应在巴斯托涅东北（c大 r小）'],
  ['马尔梅迪', '圣维特', '马尔梅迪应在圣维特北（r小）'],
  ['蒙绍', '马尔梅迪', '蒙绍应在马尔梅迪东北'],
  ['斯帕', '马尔梅迪', '斯帕应在马尔梅迪西南（c小 r大）'],
  ['斯塔沃洛', '斯帕', '斯塔沃洛应在斯帕东南'],
  ['巴斯托涅', '豪法利兹', '巴斯托涅应在豪法利兹南（r大）'],
  ['维尔茨', '巴斯托涅', '维尔茨应在巴斯托涅北'],
  ['迪基希', '埃希特纳赫', '迪基希应在埃希特纳赫东北'],
  ['拉罗什', '巴斯托涅', '拉罗什应在巴斯托涅西北'],
  ['迪南', '日韦', '迪南应在日韦西南（马斯河线）'],
];
for (const [a, b, expect] of pairs) {
  const ta = g.map.towns.find(x => x.name === a), tb = g.map.towns.find(x => x.name === b);
  if (!ta || !tb) { console.log(`  ✗ ${a}/${b} 缺城镇`); continue; }
  const dc = ta.c - tb.c, dr = ta.r - tb.r;
  const rel = `${a} 相对 ${b}: Δc=${dc} Δr=${dr}`;
  console.log('  ' + rel + ' | 期望: ' + expect);
}

console.log('\n=== 2. 关键师落位（史实区域）===');
const checks = [
  ['党卫军第1装甲师', '北翼突击，圣维特以西-马尔梅迪以南（c 应与圣维特接近, r 略大）'],
  ['第99步兵师', '北肩洛斯海姆缺口（圣维特以北）'],
  ['第2步兵师', '埃尔森博恩岭（蒙绍以南）'],
  ['第106步兵师', '雪艾菲尔（圣维特东南）'],
  ['第28步兵师', '克莱沃（巴斯托涅以东）'],
  ['第101空降师', '巴斯托涅'],
  ['第82空降师', '圣维特以西/西北'],
  ['第2装甲师', '中路马斯河方向（西南, c 小 r 大）'],
  ['装甲教导师', '巴斯托涅以北'],
  ['第116装甲师', '中路偏北'],
  ['第5伞兵师', '南翼（迪基希/埃希特纳赫方向, r 大）'],
  ['第352国民掷弹兵师', '南翼巴斯托涅以南'],
  ['第9装甲师', '西翼（预备, 后期）'],
];
for (const [n, expect] of checks) console.log(`  ${n}: ${U(n)} | ${expect}`);
console.log('  城镇锚点 圣维特' + T('圣维特') + ' 巴斯托涅' + T('巴斯托涅') + ' 蒙绍' + T('蒙绍') + ' 迪基希' + T('迪基希') + ' 迪南' + T('迪南'));

console.log('\n=== 3. 地形构成（师级 34×21）===');
{
  const cnt = {};
  for (const [, h] of g.map.hexes) cnt[h.terrain] = (cnt[h.terrain] || 0) + 1;
  const total = g.map.hexes.size;
  const names = { plain: '开阔', rough: '丘陵', forest: '森林', mountain: '山地', marsh: '沼泽', town: '城镇' };
  for (const [k, v] of Object.entries(cnt)) console.log(`  ${names[k] || k}: ${(v / total * 100).toFixed(1)}% (${v})`);
  console.log('  合计格:', total);
}

console.log('\n=== 4. 河流/道路 ===');
for (const [k, pts] of Object.entries(g.map.rivers ? {} : {})) {}
console.log('  河流条数:', Object.keys(D.RIVERS).length, '· 道路条数:', Object.keys(D.ROADS).length, '· 桥:', g.map.bridges.size);
// 马斯河位置（应贴西缘）
{
  const meuse = g.map.rivers && g.map.rivers.get ? null : null;
  const pts = D.RIVERS.meuse || [];
  const cs = pts.map(p => p[0]);
  console.log('  马斯河 c 范围:', Math.min(...cs), '~', Math.max(...cs), '（应贴图西缘 c≤3）');
}
// 城镇间距
{
  const towns = g.map.towns;
  let minD = 99, pair = '';
  for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) {
    const d = Hex.distance(towns[i].c, towns[i].r, towns[j].c, towns[j].r);
    if (d < minD) { minD = d; pair = towns[i].name + '-' + towns[j].name; }
  }
  let sum = 0, cnt = 0;
  for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) { sum += Hex.distance(towns[i].c, towns[i].r, towns[j].c, towns[j].r); cnt++; }
  console.log('  城镇最近间距:', minD, '(' + pair + ') · 平均间距:', (sum / cnt).toFixed(1));
}

console.log('\n=== 5. 双方阵地分界 ===');
{
  const de = g.units.filter(u => u.side === 'DE' && u.alive);
  const us = g.units.filter(u => u.side === 'US' && u.alive);
  const deC = de.reduce((s, u) => s + u.c, 0) / de.length;
  const usC = us.reduce((s, u) => s + u.c, 0) / us.length;
  // 最近敌对间距
  let minD = 99, pair = '';
  for (const a of de) for (const b of us) { const d = Hex.distance(a.c, a.r, b.c, b.r); if (d < minD) { minD = d; pair = a.name.slice(0, 10) + ' vs ' + b.name.slice(0, 10); } }
  console.log('  德军质心 c=' + deC.toFixed(1), '· 盟军质心 c=' + usC.toFixed(1), '（德应更大=东侧）');
  console.log('  最近敌对间距:', minD, '(' + pair + ')');
  // 越界检查: 德军是否有跑到 c<10 的（马斯河以西）
  const deep = de.filter(u => u.c < 8);
  console.log('  德军在 c<8（马斯河以西）的单位:', deep.length, deep.map(u => u.name.slice(0, 8) + '@' + u.c + ',' + u.r).join(' ') || '无');
}
