'use strict';
/* ============================================================
 * hex.js — 六角格数学（odd-r 偏移坐标，pointy-top 尖顶朝上）
 * 坐标: {c, r}  列/行。邻居中心距离恒为 sqrt(3)*size。
 * ============================================================ */
globalThis.Hex = (function () {
  // 偶数行/奇数行的 6 邻居偏移（顺序: E, NE, NW, W, SW, SE）
  const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  const DIRS_ODD  = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

  function key(c, r) { return c + ',' + r; }
  function parse(k) { const p = k.split(','); return { c: +p[0], r: +p[1] }; }

  function neighbors(c, r) {
    const d = (r & 1) ? DIRS_ODD : DIRS_EVEN;
    const out = new Array(6);
    for (let i = 0; i < 6; i++) out[i] = { c: c + d[i][0], r: r + d[i][1] };
    return out;
  }

  function inBounds(c, r, cols, rows) {
    return c >= 0 && c < cols && r >= 0 && r < rows;
  }

  function offsetToAxial(c, r) {
    return { q: c - ((r - (r & 1)) >> 1), r: r };
  }

  function distance(c1, r1, c2, r2) {
    const a = offsetToAxial(c1, r1), b = offsetToAxial(c2, r2);
    const dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  // 世界坐标（x 向东，z 向南），size 为外接圆半径
  function worldX(c, r, size) { return size * Math.sqrt(3) * (c + 0.5 * (r & 1)); }
  function worldZ(r, size) { return size * 1.5 * r; }

  // 六角直线插值（用于河流/道路折线栅格化）
  function line(c1, r1, c2, r2) {
    const a = offsetToAxial(c1, r1), b = offsetToAxial(c2, r2);
    const n = Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(-a.q - a.r + b.q + b.r));
    if (n === 0) return [{ c: c1, r: r1 }];
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const q = a.q + (b.q - a.q) * t;
      const r = a.r + (b.r - a.r) * t;
      pts.push(cubeRound(q, r));
    }
    // 保证折线相邻格真正相邻（浮动误差修补）
    const fixed = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      let prev = fixed[fixed.length - 1];
      if (distance(prev.c, prev.r, pts[i].c, pts[i].r) > 1) {
        const mid = bridge(prev, pts[i]);
        if (mid) fixed.push(mid);
      }
      fixed.push(pts[i]);
    }
    return fixed;
  }

  function bridge(a, b) {
    // a,b 不相邻时找一个中间格
    const cand = neighbors(a.c, a.r);
    for (const n of cand) {
      if (distance(n.c, n.r, b.c, b.r) === 1) return n;
    }
    return null;
  }

  function cubeRound(q, r) {
    const x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { c: rx + ((rz - (rz & 1)) >> 1), r: rz };
  }

  // 距离 ≤ n 的所有格（含自身），可选边界过滤
  function range(c, r, n, cols, rows) {
    const out = [];
    for (let dc = -n; dc <= n; dc++) {
      for (let dr = Math.max(-n, -dc - n); dr <= Math.min(n, -dc + n); dr++) {
        const ax = offsetToAxial(c, r);
        const q = ax.q + dc, rr = ax.r + dr;
        const p = { c: q + ((rr - (rr & 1)) >> 1), r: rr };
        if (cols === undefined || inBounds(p.c, p.r, cols, rows)) out.push(p);
      }
    }
    return out;
  }

  return { key, parse, neighbors, inBounds, distance, worldX, worldZ, line, range };
})();
