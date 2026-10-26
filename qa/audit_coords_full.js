#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * audit_coords_full.js — P1 全表坐标审计（只读，不写 data_big.js）
 *   用法: node qa/audit_coords_full.js [verify]
 *     无参数: 输出删除/修正/待核三张清单与统计
 *     verify: 只打印"行动前必须 WebSearch 校验"的清单（conf=2 且要动）
 * 数据: qa/town_gazetteer_a.js + town_gazetteer_b.js（真实经纬度）
 * 换算（data_big.js §5.3a 口径）:
 *   列 = 1 + (lon-4.40)×51.2 ； 行 = 20 + (50.70-lat)×40.9
 * 行动规则:
 *   act del-* / dup            → 删除
 *   真实位置超出图界 >2 格      → 删除（图外假址，绝不 clamp）
 *   超出 ≤2 格                  → 保留，坐标压到边缘格
 *   图内且 Δ>2 格               → 修正到换算值（conf=2 须先校验）
 *   Δ≤2 或 conf=1              → 保持
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const GAZ = [
  ...require('./town_gazetteer_a.js'),
  ...require('./town_gazetteer_b.js'),
  ...require('./town_gazetteer_c.js'),
];

const s = fs.readFileSync(path.join(__dirname, '..', 'js', 'data_big.js'), 'utf8');
const m = s.match(/const TOWNS = \[([\s\S]*?)\n  \];/);
const towns = [...m[1].matchAll(/\[(\d+), (\d+), '([^']+)', '([^']+)', (\d), (\d), '(DE|US)', (\d+)\]/g)]
  .map(r => ({ c: +r[1], r: +r[2], name: r[3], abbr: r[4], tier: +r[5], supply: +r[6], ctrl: r[7], budget: +r[8] }));

const col = lon => 1 + (lon - 4.40) * 51.2;
const row = lat => 20 + (50.70 - lat) * 40.9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

const del = [], fix = [], flag = [], keep = [], clampEdge = [];
const gazMap = new Map(GAZ.map(g => [g[0], g]));
for (const t of towns) {
  const g = gazMap.get(t.name);
  if (!g) { flag.push([t, '坐标册缺条目']); continue; }
  const [name, latin, cc, lat, lon, conf, act] = g;
  if (act === 'dup') { del.push([t, '重复条目（同地异名）', latin]); continue; }
  if (act === 'del-fake') { del.push([t, '自造名（锚点+方位变体）', '']); continue; }
  if (conf === 1) { flag.push([t, '无法确证真实位置（保持原状）']); continue; }
  if (!lat || !lon) { flag.push([t, '坐标缺失']); continue; }
  const rawC = col(lon), rawR = row(lat);
  const outC = Math.max(0 - rawC, rawC - 219), outR = Math.max(0 - rawR, rawR - 95);
  const outside = Math.max(outC, outR);
  if (outside > 2 || /del-out/.test(act || '')) {
    del.push([t, `真实位置图外 ${outside.toFixed(1)} 格 (${lat},${lon})`, latin]);
    continue;
  }
  const nc = clamp(rawC, 0, 219), nr = clamp(rawR, 0, 95);
  const d = Math.max(Math.abs(nc - t.c), Math.abs(nr - t.r));
  if (d <= 2) { keep.push(t); continue; }
  if (outside > 0 && outside <= 2) {
    clampEdge.push([t, nc, nr, `压边（图外 ${outside.toFixed(1)} 格）`, conf]);
    continue;
  }
  fix.push([t, nc, nr, conf]);
}

const sorted = (a, b) => a[0].name.localeCompare(b[0].name, 'zh');
del.sort(sorted); fix.sort(sorted); flag.sort(sorted); clampEdge.sort(sorted);

console.log(`=== 删除 ${del.length} 座 ===`);
for (const [t, why, latin] of del) console.log(`  ${t.name} [${t.c},${t.r}] ${t.ctrl} — ${why}${latin ? ' (' + latin + ')' : ''}`);
console.log(`\n=== 修正 ${fix.length} 座 ===`);
for (const [t, nc, nr, conf] of fix) console.log(`  ${t.name} [${t.c},${t.r}] → [${nc},${nr}]  Δc=${nc - t.c} Δr=${nr - t.r}  conf=${conf}`);
console.log(`\n=== 压边 ${clampEdge.length} 座 ===`);
for (const [t, nc, nr, why, conf] of clampEdge) console.log(`  ${t.name} [${t.c},${t.r}] → [${nc},${nr}]  ${why} conf=${conf}`);
console.log(`\n=== 无法确证（保持原状）${flag.length} 座 ===`);
for (const [t, why] of flag) console.log(`  ${t.name} [${t.c},${t.r}] — ${why}`);
console.log(`\n=== 保持 ${keep.length} 座 / 总 ${towns.length} ===`);
if (process.argv[2] === 'verify') {
  console.log('\n=== 待 WebSearch 校验（conf=2 且要动）===');
  for (const [t, nc, nr, conf] of fix) if (conf === 2) console.log(`  ${t.name} → [${nc},${nr}]`);
  for (const [t, nc, nr, why, conf] of clampEdge) if (conf === 2) console.log(`  ${t.name} → [${nc},${nr}] (压边)`);
}
/* 删除后的覆盖率影响提示（把删除座位的旧坐标贡献粗略标出） */
fs.writeFileSync(path.join(__dirname, '_audit_result.json'),
  JSON.stringify({ del: del.map(d => ({ name: d[0].name, c: d[0].c, r: d[0].r, why: d[1] })),
    fix: fix.map(f => ({ name: f[0].name, c0: f[0].c, r0: f[0].r, c1: f[1], r1: f[2], conf: f[3] })),
    clamp: clampEdge.map(f => ({ name: f[0].name, c0: f[0].c, r0: f[0].r, c1: f[1], r1: f[2], conf: f[4] })),
    flag: flag.map(f => f[0].name) }, null, 1), 'utf8');
console.log('结果已写入 qa/_audit_result.json');
