#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* 全局检索：找出所有"城市+方位"形式的自造名（只读） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
const D = globalThis.DATA_BIG;
/* 判据：名称 = (已知锚点城名) + (方位后缀)，且**该带后缀的名字不与锚点同名**。
   单纯以"北/南/东/西/松"结尾的真实地名（迪南、米西、伊尔松…）不算。
   这里用一种更稳的判据：若去掉末尾方位字后，表中**存在同名锚点**，
   则该条目极可能是"锚点+方位"自造名。 */
const names = new Set(D.TOWNS.map(t => t[2]));
const SUF = ['东北', '东南', '西北', '西南', '北', '南', '东', '西', '后方'];
const suspects = [];
for (const t of D.TOWNS) {
  for (const s of SUF) {
    if (t[2].length > s.length && t[2].endsWith(s)) {
      const base = t[2].slice(0, t[2].length - s.length);
      if (names.has(base)) { suspects.push(t[2] + '  (锚点 "' + base + '" 也在表中)'); break; }
    }
  }
}
console.log('疑似"锚点+方位"自造名 ' + suspects.length + ' / 总 ' + D.TOWNS.length + ' 座');
for (const s of suspects) console.log('   ' + s);

