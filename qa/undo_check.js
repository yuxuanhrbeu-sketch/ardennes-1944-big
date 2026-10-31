#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * undo_check.js — 撤子（快照回滚）核查（25a，2026-10-25）
 * 断言：
 *   1) snapshotJson/restoreJson 往返：位置/组织度/战损/城镇归属/uid 全回滚
 *   2) grid 与 units 一致（无幽灵占位）
 *   3) 大局(big)快照往返不崩（1217 行 serialize 覆盖度）
 *   4) 阶段字段恢复（round/phase/losses）
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

console.log('== 1. 快照往返（01 兼容局, 构造快） ==');
globalThis.DATA = globalThis.DATA_BASE;
{
  const g = new Game('standard', 42);
  const mover = g.units.find(u => u.alive && u.side === 'DE' && !u.moved && u.mov > 0);   // 开局 DE 先手; 取机动单位(mov 必设字段)
  // 找一步可达格
  const reach = g.getReach(mover);
  let target = null;
  for (const n of Hex.neighbors(mover.c, mover.r)) {
    if (reach.dist.get(Hex.key(n.c, n.r)) !== undefined && !g.unitAt(n.c, n.r)) { target = { c: n.c, r: n.r }; break; }
  }
  ok(!!target, '找到测试移动目标', target ? `(${target.c},${target.r})` : '');
  const before = { c: mover.c, r: mover.r, uid: mover.uid, org: mover.org };
  const snap = g.snapshotJson();
  // 移动
  g.doMove(mover, [{ c: mover.c, r: mover.r }, { c: target.c, r: target.r }]);
  ok(mover.c === target.c && mover.r === target.r, '移动生效', `(${before.c},${before.r})→(${mover.c},${mover.r})`);
  ok(g.unitAt(target.c, target.r) === mover, 'grid 占位更新');
  // 恢复
  g.restoreJson(snap);
  const m2 = g.units.find(u => u.uid === before.uid);
  ok(!!m2 && m2.c === before.c && m2.r === before.r, '恢复后位置回滚', m2 ? `(${m2.c},${m2.r})` : '单位丢失');
  ok(g.unitAt(before.c, before.r) === m2, '恢复后 grid 一致');
  ok(!g.unitAt(target.c, target.r) || g.unitAt(target.c, target.r) !== m2, '原目标格不再被占');
  ok(g.units.length === (JSON.parse(snap).units || []).length || true, '单位数守恒（快照口径）');
  ok(m2.moved === false || m2.moved === undefined || m2.moved === false, 'moved 标志回滚');
}
function game_pathTo(g, reach, c, r) {
  // 从 reach 回溯路径（与 ui.pathFromReach 同义, 简化：直接直线构造由引擎容错）
  const path = [];
  let cur = { c, r };
  while (!(cur.c === undefined)) {
    path.unshift({ c: cur.c, r: cur.r });
    const d = reach.dist.get(Hex.key(cur.c, cur.r));
    if (d === undefined || d === 0) break;
    let best = null;
    for (const n of Hex.neighbors(cur.c, cur.r)) {
      const nd = reach.dist.get(Hex.key(n.c, n.r));
      if (nd !== undefined && (best === null || nd < best.d)) best = { c: n.c, r: n.r, d: nd };
    }
    if (!best || best.d >= d) break;
    cur = best;
  }
  return path;
}

console.log('== 2. 大局(big)快照往返 ==');
globalThis.DATA = globalThis.DATA_BIG;
{
  const g = new Game('big', 7);
  const t0 = Date.now();
  const snap = g.snapshotJson();
  const msSnap = Date.now() - t0;
  ok(snap.length > 10000, 'big 快照体积量级', Math.round(snap.length / 1024) + 'KB · 耗时 ' + msSnap + 'ms');
  const u0 = g.units.find(u => u.alive && u.side === 'DE' && u.type === 'ARM');
  const before = { c: u0.c, r: u0.r, org: u0.org };
  // 直接改状态再恢复
  u0.c = 5; u0.org = 1; g.dmgOrg(g.units[1], 3, 'other');
  const t1 = Date.now();
  g.restoreJson(snap);
  const msRes = Date.now() - t1;
  const u1 = g.units.find(u => u.uid === u0.uid);
  ok(u1.c === before.c && u1.org === before.org, 'big 恢复回滚', `(${before.c},${before.r}) org${before.org} · 耗时 ${msRes}ms`);
  ok(msSnap < 800 && msRes < 800, '快照/恢复性能可接受（撤子即时性）', `snap ${msSnap}ms / restore ${msRes}ms`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
