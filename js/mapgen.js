'use strict';
/* ============================================================
 * mapgen.js — 由 DATA 中的手工地理要素生成完整六角地图
 * 产物: map = {
 *   cols, rows, hexes: Map('c,r' -> hex),
 *   towns: [{c,r,name,tier,supply,ctrl}], rivers: Set, roads: Set,
 *   bridges: Set, depots: [...]
 * }
 * hex: {c,r,terrain,id,elev,river,road,bridge,town,exit}
 * ============================================================ */
globalThis.MapGen = (function () {

  // 可复现噪声
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function valueNoise(seed) {
    const rnd = mulberry32(seed);
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
    function h(x, y) { return perm[(perm[x & 255] + (y & 255)) & 255] / 255; }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function noise2(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = smooth(xf), v = smooth(yf);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return function fbm(x, y, oct) {
      let v = 0, amp = 0.5, f = 1;
      for (let i = 0; i < (oct || 3); i++) { v += amp * noise2(x * f, y * f); f *= 2; amp *= 0.5; }
      return v;
    };
  }

  function gauss(c, r, cc, rr, radius) {
    const dx = c - cc, dy = r - rr;
    return Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
  }

  function build() {
    const D = DATA;
    const cols = D.COLS, rows = D.ROWS;
    const fbm1 = valueNoise(19441216);
    const fbm2 = valueNoise(19450101);
    const fbm3 = valueNoise(19440606);
    const fbm4 = valueNoise(19440903);

    // —— 初始地形分布(贴近真实: 阿登密林/高地草原/法梅尼开阔地/卢森堡农田) ——
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ c, r, terrain: 'forest', elev: 0.3, river: false, road: false, bridge: false, town: null, exit: false });
      }
    }
    const at = (c, r) => (Hex.inBounds(c, r, cols, rows) ? cells[r * cols + c] : null);

    // —— 地形分区规则（2026-10-11 数据化: 大推演 DATA 提供新图规则;
    //     未提供时走下面的内建旧图规则, 与历史行为逐位一致） ——
    // 规则按序首中即止; bands 为 [阈值, 地形] 降序表, 噪声>阈值取该地形。
    const LEGACY_RULES = [
      { cMin: 39, rMin: 8, rMax: 14, noise: 'n1', bands: [[0.45, 'mountain'], [0, 'rough']] },                 // 雪艾菲尔
      { cMin: 22, cMax: 38, rMax: 5, noise: 'n1', bands: [[0.52, 'mountain'], [0.3, 'marsh'], [0, 'forest']] }, // 高沼地/埃尔森博恩
      { cMin: 39, rMax: 3, noise: 'n1', bands: [[0, 'mountain']] },                                            // 东北山地
      { cMin: 24, rMin: 26, noise: 'n2', bands: [[0.5, 'plain'], [0, 'rough']] },                              // 卢森堡古特兰
      { cMax: 14, rMin: 6, rMax: 22, noise: 'n2', bands: [[0.35, 'plain'], [0, 'rough']] },                    // 法梅尼/孔德里兹
    ];
    const LEGACY_DEFAULT = { noise: 'n1', bands: [[0.55, 'rough'], [0, 'forest']] };                           // 阿登腹地
    const RULES = D.TERRAIN_RULES || LEGACY_RULES;
    const RULE_DEFAULT = D.TERRAIN_DEFAULT || LEGACY_DEFAULT;

    // —— 高程特征（同为数据化, 旧图特征做内建缺省） ——
    const LEGACY_ELEV = [
      { c: 30, r: 4, amp: 0.34, rad: 6.5 },   // 埃尔森博恩高地
      { c: 37, r: 11, amp: 0.26, rad: 4.5 },  // 雪艾菲尔
      { c: 24, r: 18, amp: 0.12, rad: 9 },    // 阿登中部
      { c: 10, r: 14, amp: -0.12, rad: 8 },   // 法梅尼低地
      { c: 30, r: 29, amp: -0.14, rad: 7 },   // 古特兰
    ];
    const ELEV_FEATS = D.ELEV_FEATURES || LEGACY_ELEV;

    // —— 细尺度细节（可选，缺省关闭 → 旧图逐位不变）——
    // 大图的"平滑感"来自噪声特征尺度太粗（n1≈27km / n2≈43km 的色块）。
    // 史实阿登是**小块林区 + 窄河谷 + 高原农田交错**，所以大图额外叠一层
    // 中等尺度噪声（T_TERRAIN_DETAIL），把规则色块打碎成互相咬合的斑块。
    const TD = D.TERRAIN_DETAIL;
    const TD2 = D.TERRAIN_FINE;
    const ED = D.ELEV_DETAIL;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = at(c, r);
        const n1 = fbm1(c * 0.11, r * 0.11, 3);
        const n2 = fbm2(c * 0.07, r * 0.07, 3);
        let rule = null;
        for (const g of RULES) {
          if ((g.cMin === undefined || c >= g.cMin) && (g.cMax === undefined || c <= g.cMax) &&
              (g.rMin === undefined || r >= g.rMin) && (g.rMax === undefined || r <= g.rMax)) { rule = g; break; }
        }
        if (!rule) rule = RULE_DEFAULT;
        const n = rule.noise === 'n2' ? n2 : n1;
        let t = rule.bands[rule.bands.length - 1][1];
        for (const [thr, ty] of rule.bands) { if (n > thr) { t = ty; break; } }
        // 细尺度斑块：区域内按更细噪声"长出"另一类地形的碎块，边界互相咬合。
        // rule.patchable 是可被斑块改写的地形白名单——山地/山脊必须排除，
        // 否则整条山脊会被斑块打碎（2026-10-12 实测 mountain 2.3%→0%）。
        // TD2 是更细一级的次级斑块（林间小空地/草甸/零散树丛），只对指定地形生效。
        if (TD && rule.patch && (!rule.patchable || rule.patchable.indexOf(t) >= 0)) {
          const pn = fbm3(c * TD.freq, r * TD.freq, 3);
          for (const [thr, ty] of rule.patch) { if (pn > thr) { t = ty; break; } }
        }
        if (TD2 && rule.fine && rule.fine.types.indexOf(t) >= 0) {
          const fn = fbm4(c * TD2.freq, r * TD2.freq + 23, 2);
          if (fn > TD2.thr) t = rule.fine.to;
        }
        h.terrain = t;

        // 高程: 基础起伏 + 细尺度起伏(可选) + 数据化高地特征, 后续河流下切
        let e = 0.22 + 0.22 * fbm1(c * 0.09 + 40, r * 0.09, 3) + 0.1 * fbm2(c * 0.15, r * 0.15 + 9, 2);
        if (ED) e += ED.amp * fbm4(c * ED.freq, r * ED.freq + 17, 2);
        for (const f of ELEV_FEATS) e += f.amp * gauss(c, r, f.c, f.r, f.rad);
        h.elev = Math.min(1, Math.max(0.02, e));
      }
    }

    // —— 河流 ——
    const riverSet = new Set();
    for (const name in D.RIVERS) {
      const pts = D.RIVERS[name];
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = Hex.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        for (const p of seg) {
          const h = at(p.c, p.r);
          if (!h) continue;
          h.river = true; h.elev = Math.max(0.03, h.elev - 0.3);
          riverSet.add(Hex.key(p.c, p.r));
          // 河谷下切波及邻格
          for (const n of Hex.neighbors(p.c, p.r)) {
            const nh = at(n.c, n.r);
            if (nh && !nh.river) nh.elev = Math.max(0.03, nh.elev - 0.12);
          }
        }
      }
    }

    // —— 道路 ——
    const roadSet = new Set();
    for (const name in D.ROADS) {
      const pts = D.ROADS[name];
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = Hex.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        for (const p of seg) {
          const h = at(p.c, p.r);
          if (!h) continue;
          h.road = true;
          roadSet.add(Hex.key(p.c, p.r));
        }
      }
    }

    // —— 城镇 ——
    const towns = [];
    for (const t of D.TOWNS) {
      const h = at(t[0], t[1]);
      if (!h) continue;
      h.town = { name: t[2], abbr: t[3], tier: t[4], supply: t[5] === 1, ctrl: t[6] };
      h.terrain = 'town';
      if (h.elev < 0.1) h.elev = 0.12;
      // t[7] = 补给成本预算（可选；大图按城镇等级给不同预算，旧图无此字段 → 走 DATA.SUPPLY_R_TOWN）
      towns.push({ c: t[0], r: t[1], name: t[2], abbr: t[3], tier: t[4], supply: t[5] === 1, ctrl: t[6], vp: t[4], range: t[7] });
    }
    const townMap = {};
    for (const t of towns) townMap[t.name] = t;

    // —— 桥梁(自动检测: 河上城镇必有桥; 道路横穿河流格处为桥) ——
    const bridges = new Set();
    for (const h of cells) {
      if (!h.river) continue;
      if (h.town) { h.bridge = true; bridges.add(Hex.key(h.c, h.r)); continue; }
      if (h.road) {
        // 道路同时来自西侧(E,NE,SE)与东侧(NW,W,SW)邻格 → 判定为跨越
        const nb = Hex.neighbors(h.c, h.r);
        const westish = [2, 3, 4].some(i => { const n = nb[i]; const nh = at(n.c, n.r); return nh && nh.road; });
        const eastish = [0, 1, 5].some(i => { const n = nb[i]; const nh = at(n.c, n.r); return nh && nh.road; });
        if (westish && eastish) { h.bridge = true; bridges.add(Hex.key(h.c, h.r)); }
      }
    }

    // —— 油库 ——
    const depots = [];
    for (const d of D.DEPOTS) {
      const h = at(d[0], d[1]);
      if (h) depots.push({ c: d[0], r: d[1], name: d[2], fuel: d[3], captured: false });
    }

    // —— 突破出口(马斯河一线) ——
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= D.EXIT_C; c++) {
        const h = at(c, r);
        if (h) h.exit = true;
      }
    }

    const hexes = new Map();
    for (const h of cells) hexes.set(Hex.key(h.c, h.r), h);

    return {
      cols, rows, hexes, towns, townMap, riverSet, roadSet, bridges, depots,
      at,
    };
  }

  return { build };
})();
