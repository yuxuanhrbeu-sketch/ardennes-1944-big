#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/geo_convert.js — 经纬度 → 新图格坐标（只读，纯换算）
 *   标定口径（data_big.js §5.3a）：
 *     列 = 1 + (经度 - 4.40) × 51.2
 *     行 = 20 + (50.70 - 纬度) × 40.9
 *   用法:
 *     node qa/geo_convert.js 6.03 50.42          # 单点
 *     node qa/geo_convert.js --box 5.95 6.35 50.40 50.60   # 经纬度包围盒 → c/r 范围
 *   说明：本工具只做换算，不写任何文件；改地理数据前先用它，避免手估。
 * ============================================================ */
const COLS = 220, ROWS = 96;
const col = lon => 1 + (lon - 4.40) * 51.2;
const row = lat => 20 + (50.70 - lat) * 40.9;
const rc = v => Math.max(0, Math.min(COLS - 1, Math.round(v)));
const rr = v => Math.max(0, Math.min(ROWS - 1, Math.round(v)));

const a = process.argv.slice(2);
if (a[0] === '--box') {
  const [lon0, lon1, lat0, lat1] = a.slice(1, 5).map(Number);
  const c0 = rc(col(Math.min(lon0, lon1))), c1 = rc(col(Math.max(lon0, lon1)));
  const r0 = rr(row(Math.max(lat0, lat1))), r1 = rr(row(Math.min(lat0, lat1)));
  console.log('box lon ' + Math.min(lon0, lon1) + '..' + Math.max(lon0, lon1) +
    '  lat ' + Math.min(lat0, lat1) + '..' + Math.max(lat0, lat1));
  console.log('  → c ' + c0 + '..' + c1 + '   r ' + r0 + '..' + r1 +
    (c0 === 0 || c1 === COLS - 1 || r0 === 0 || r1 === ROWS - 1 ? '   ⚠ 触边' : ''));
} else {
  const lon = Number(a[0]), lat = Number(a[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    console.log('用法: node qa/geo_convert.js <lon> <lat> | --box <lon0> <lon1> <lat0> <lat1>');
    process.exit(1);
  }
  console.log(lon + 'E ' + lat + 'N  →  c=' + rc(col(lon)) + ' r=' + rr(row(lat)) +
    '   (raw c=' + col(lon).toFixed(1) + ' r=' + row(lat).toFixed(1) + ')');
}
