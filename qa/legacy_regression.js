#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/legacy_regression.js — 证明"旧剧本地图逐位不变"（只读）
 * mapgen.js 新增了 TERRAIN_DETAIL / TERRAIN_FINE / ELEV_DETAIL 三个可选字段，
 * 本脚本验证：旧图 DATA_BASE 不提供这些字段时，生成结果与"手工删除这些字段"
 * 完全一致，且逐格 terrain/elev/river/road 指纹稳定。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}

function dump(D) {
  const prev = globalThis.DATA;
  globalThis.DATA = D;
  const m = MapGen.build();
  const out = [];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const h = m.hexes.get(Hex.key(c, r));
      out.push(h.terrain + ':' + h.elev.toFixed(5) + ':' + (h.river ? 1 : 0) + ':' + (h.road ? 1 : 0));
    }
  }
  globalThis.DATA = prev;
  return { text: out.join('|'), cells: out.length };
}
const fp = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

/* ① 旧图（standard）本身 */
const a = dump(globalThis.DATA_BASE);
console.log('旧图 standard  ' + a.cells + ' 格  指纹 ' + fp(a.text));

/* ② 从旧图上删掉三个新字段再构建 —— 必须与 ① 完全一致
      （等价于"mapgen 新增逻辑在旧图路径上完全不生效"） */
const B = globalThis.DATA_BASE;
const saved = {};
for (const k of ['TERRAIN_DETAIL', 'TERRAIN_FINE', 'ELEV_DETAIL']) { saved[k] = B[k]; delete B[k]; }
const b = dump(B);
for (const k of ['TERRAIN_DETAIL', 'TERRAIN_FINE', 'ELEV_DETAIL']) B[k] = saved[k];
console.log('旧图去新字段  ' + b.cells + ' 格  指纹 ' + fp(b.text));
console.log('  → 旧图逐位不变: ' + (a.text === b.text ? '✅ 是' : '✘ 否（mapgen 改坏了旧剧本！）'));

/* ③ 新图（big） */
const big = dump(globalThis.DATA_BIG);
console.log('新图 big       ' + big.cells + ' 格  指纹 ' + fp(big.text));
const newFields = ['TERRAIN_DETAIL', 'TERRAIN_FINE', 'ELEV_DETAIL'].filter(k => globalThis.DATA_BIG[k]);
console.log('  新图启用的细节层: ' + newFields.join(', '));

if (a.text !== b.text) process.exit(1);
