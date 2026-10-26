#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * qa/outline_check.js — 补给轮廓连续性核查（只读）
 *   验证 renderer.showSupplyCoverage 的边界边是否构成**闭合连续折线**。
 *   判据：把每条轮廓边建成无向图（顶点 = 世界坐标端点），
 *        若轮廓连续，则每个顶点度数必为 2，且连通分量数 = 轮廓条数。
 *   度数 1 = 断头（不连续）；度数 >2 = 自交/重复。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG;
const D = globalThis.DATA;
const g = new Game('big', 20241216);
const SIZE = 1.3;                       // 与 render.js 的 SIZE 一致
const hexes = g.map.hexes;

const wx = (c, r) => ({ x: SIZE * Math.sqrt(3) * (c + 0.5 * (r & 1)), z: SIZE * 1.5 * r });
const corners = (c, r) => {
  const w = wx(c, r), pts = [];
  for (let a = 0; a < 6; a++) {
    const ang = Math.PI / 2 + a * Math.PI / 3;
    pts.push([w.x + SIZE * Math.cos(ang), w.z + SIZE * Math.sin(ang)]);
  }
  return pts;
};
const edgeNormalAngle = a => Math.PI / 2 + (a + 0.5) * Math.PI / 3;

/* —— 方案 A：当前实现（邻居方向角 → 边序号） —— */
function edgesCurrent(cov) {
  const pos = [], seen = new Set();
  for (const key of cov.cost.keys()) {
    const p = Hex.parse(key);
    const nb = Hex.neighbors(p.c, p.r);
    const cps = corners(p.c, p.r);
    for (let i = 0; i < 6; i++) {
      const n = nb[i];
      if (cov.cost.has(Hex.key(n.c, n.r))) continue;
      const ang = Math.atan2(n.r - p.r, n.c - p.c);
      let bestA = 0, bestD = 1e9;
      for (let a = 0; a < 6; a++) {
        let d = Math.abs(ang - edgeNormalAngle(a));
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < bestD) { bestD = d; bestA = a; }
      }
      const A = cps[bestA], B = cps[(bestA + 1) % 6];
      const ka = A[0].toFixed(3) + ',' + A[1].toFixed(3);
      const kb = B[0].toFixed(3) + ',' + B[1].toFixed(3);
      const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (seen.has(ek)) continue;
      seen.add(ek);
      pos.push([A, B]);
    }
  }
  return pos;
}

/* —— 方案 B：显式取"未覆盖格"的边（该边两侧中至少一侧被覆盖） —— */
function edgesExplicit(cov) {
  const edges = new Map();               // 边键 → [A,B]
  const addEdge = (A, B) => {
    const ka = A[0].toFixed(3) + ',' + A[1].toFixed(3);
    const kb = B[0].toFixed(3) + ',' + B[1].toFixed(3);
    const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (!edges.has(ek)) edges.set(ek, [A, B]);
  };
  // 遍历所有格：对每条边看两侧是否恰好一侧被覆盖
  for (const [key, h] of hexes) {
    const cps = corners(h.c, h.r);
    for (let a = 0; a < 6; a++) {
      const A = cps[a], B = cps[(a + 1) % 6];
      // 找这条边另一侧的邻居：用中点 + 外方向推进
      const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
      const ex = (mx - wx(h.c, h.r).x), ez = (mz - wx(h.c, h.r).z);
      const L = Math.hypot(ex, ez) || 1;
      const px = wx(h.c, h.r).x + (ex / L) * SIZE * 1.78;
      const pz = wx(h.c, h.r).z + (ez / L) * SIZE * 1.78;
      const other = pixelToHex(px, pz);
      const here = cov.cost.has(Hex.key(h.c, h.r));
      const there = other && cov.cost.has(Hex.key(other.c, other.r));
      if (here !== there) addEdge(A, B);
    }
  }
  return [...edges.values()];
}

/* 世界坐标 → 六角格（pointy-top odd-r 的精确逆变换） */
function pixelToHex(x, z) {
  const q = (Math.sqrt(3) / 3 * x - z / 3) / SIZE;
  const rr = (2 / 3 * z) / SIZE;
  let cx = q, cz = rr, cy = -cx - cz;
  let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
  const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  const r = rz, c = rx + ((rz - (rz & 1)) >> 1);
  return hexes.has(Hex.key(c, r)) ? { c, r } : null;
}

/* —— 方案 C：逐边用"边中点最近的邻居格中心"确定对侧（不依赖角度映射） —— */
function edgesRobust(cov) {
  const out = new Map();
  const addEdge = (A, B) => {
    const ka = A[0].toFixed(3) + ',' + A[1].toFixed(3);
    const kb = B[0].toFixed(3) + ',' + B[1].toFixed(3);
    const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (!out.has(ek)) out.set(ek, [A, B]);
  };
  for (const key of cov.cost.keys()) {
    const p = Hex.parse(key);
    const cps = corners(p.c, p.r);
    const w = wx(p.c, p.r);
    const nb = Hex.neighbors(p.c, p.r);
    for (let a = 0; a < 6; a++) {
      const A = cps[a], B = cps[(a + 1) % 6];
      const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
      // 在 6 个邻居里找中心离边中点最近的那个（就是这条边的对侧格）
      let best = null, bd = 1e9;
      for (const n of nb) {
        const nw = wx(n.c, n.r);
        const d = Math.hypot(nw.x - mx, nw.z - mz);
        if (d < bd) { bd = d; best = n; }
      }
      const other = best && hexes.has(Hex.key(best.c, best.r)) ? best : null;
      const there = other && cov.cost.has(Hex.key(other.c, other.r));
      // 对侧未覆盖（或越界）→ 这条边属于轮廓
      if (!there) addEdge(A, B);
    }
  }
  return [...out.values()];
}

/* —— 连续性分析 —— */
function analyse(tag, segs) {
  const deg = new Map();                 // 端点 → 关联边数
  const adj = new Map();                 // 端点 → 邻居端点列表
  const K = P => P[0].toFixed(3) + ',' + P[1].toFixed(3);
  for (const [A, B] of segs) {
    const ka = K(A), kb = K(B);
    deg.set(ka, (deg.get(ka) || 0) + 1);
    deg.set(kb, (deg.get(kb) || 0) + 1);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(kb); adj.get(kb).push(ka);
  }
  let d1 = 0, d2 = 0, dOther = 0;
  for (const v of deg.values()) { if (v === 1) d1++; else if (v === 2) d2++; else dOther++; }
  // 连通分量（按顶点）
  const seen = new Set(); let comps = 0;
  for (const k of adj.keys()) {
    if (seen.has(k)) continue;
    comps++;
    const st = [k]; seen.add(k);
    while (st.length) {
      const cur = st.pop();
      for (const nb of adj.get(cur) || []) if (!seen.has(nb)) { seen.add(nb); st.push(nb); }
    }
  }
  console.log('  ' + tag.padEnd(10) + ' 边 ' + String(segs.length).padStart(5) +
    '  端点 ' + String(deg.size).padStart(5) +
    '  度1(断头) ' + String(d1).padStart(5) +
    '  度2(正常) ' + String(d2).padStart(5) +
    '  度>2(自交) ' + String(dOther).padStart(4) +
    '  闭合环 ' + comps);
  return { d1, comps };
}

const t = g.map.towns.find(x => x.name === '巴斯托涅');
const cov = g.townCoverage(t.c, t.r);
console.log('巴斯托涅 覆盖 ' + cov.cost.size + ' 格');
console.log('轮廓连续性对比（度1 = 断头，越多越破碎）：');
const a = analyse('方案A(现)', edgesCurrent(cov));
const b = analyse('方案B(显式)', edgesExplicit(cov));
const c = analyse('方案C(逐边)', edgesRobust(cov));
console.log('');
console.log(a.d1 > 0 ? '✘ 方案A 存在断头，轮廓不连续' : '✅ 方案A 连续');
console.log(b.d1 > 0 ? '✘ 方案B 存在断头，轮廓不连续' : '✅ 方案B 连续（每个顶点度数为 2）');
console.log(c.d1 > 0 ? '✘ 方案C 存在断头，轮廓不连续' : '✅ 方案C 连续（每个顶点度数为 2）');
