'use strict';
/* ============================================================
 * data_div.js — 师级数据集（26f，2026-10-28）
 *
 * 地图 34×21（52×32 同步缩小 2/3）：全部地理要素按比例缩放，
 * 地形规则/高程特征同步缩放后交给 mapgen。
 * 规则/兵种特性/成就与大推演同源；OOB/指挥部来自师旅聚合（75+25）。
 * 剧本：div_standard（突出部·师级 12 回合）/ div_campaign（阿登全战役·师级 24 回合）
 * ============================================================ */
(function () {
  const base = globalThis.DATA;          // data.js 原始 52×32（DATA_BASE 由 data_big.js 建于其后）
  const src = globalThis.DATA_BASE || base;
  const big = globalThis.DATA_BIG;
  const B = globalThis.DATA_DIV_OOB;

  const COLS = 34, ROWS = 21;
  const SC = COLS / src.COLS, SR = ROWS / src.ROWS;   // 缩放系数
  const sc = v => Math.max(1, Math.min(COLS - 2, Math.round(v * SC)));
  const sr = v => Math.max(1, Math.min(ROWS - 2, Math.round(v * SR)));

  /* —— 城镇缩放（冲突螺旋找位，保持名称）—— */
  const occ = new Set();
  const TOWNS = [];
  const townsSorted = src.TOWNS.slice().sort((a, b) => (b[4] || 1) - (a[4] || 1));   // 高等级先落位
  for (const t of townsSorted) {
    let c = sc(t[0]), r = sr(t[1]);
    let guard = 0;
    while (occ.has(c + ',' + r) && guard++ < 400) {
      const rad = 1 + Math.floor(guard / 6);
      const idx = guard % 6;
      const dirs = [[rad, 0], [0, rad], [-rad, 0], [0, -rad], [rad, rad], [-rad, -rad]];
      c = Math.max(1, Math.min(COLS - 2, sc(t[0]) + dirs[idx][0]));
      r = Math.max(1, Math.min(ROWS - 2, sr(t[1]) + dirs[idx][1]));
    }
    occ.add(c + ',' + r);
    TOWNS.push([c, r, t[2], t[3], t[4], t[5], t[6]].concat(t.length > 7 ? [t[7]] : []));
  }

  /* —— 折线缩放（去连续重复点）—— */
  const scaleLine = pts => {
    const out = [];
    for (const p of pts) {
      const c = sc(p[0]), r = sr(p[1]);
      const last = out[out.length - 1];
      if (last && last[0] === c && last[1] === r) continue;
      out.push([c, r]);
    }
    return out.length >= 2 ? out : pts.slice(0, 2).map(p => [sc(p[0]), sr(p[1])]);
  };
  const RIVERS = {};
  for (const [k, pts] of Object.entries(src.RIVERS)) RIVERS[k] = scaleLine(pts);
  const ROADS = {};
  for (const [k, pts] of Object.entries(src.ROADS)) ROADS[k] = scaleLine(pts);

  /* —— 点集缩放去重 —— */
  const uniqPts = pts => {
    const seen = new Set(), out = [];
    for (const p of pts) {
      const k = sc(p[0]) + ',' + sr(p[1]);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([sc(p[0]), sr(p[1])]);
    }
    return out;
  };

  /* —— 地形规则/高程特征缩放（mapgen 内建规则的坐标同步缩放）—— */
  const LEGACY_RULES = [
    { cMin: 39, rMin: 8, rMax: 14, noise: 'n1', bands: [[0.45, 'mountain'], [0, 'rough']] },
    { cMin: 22, cMax: 38, rMax: 5, noise: 'n1', bands: [[0.52, 'mountain'], [0.3, 'marsh'], [0, 'forest']] },
    { cMin: 39, rMax: 3, noise: 'n1', bands: [[0, 'mountain']] },
    { cMin: 24, rMin: 26, noise: 'n2', bands: [[0.5, 'plain'], [0, 'rough']] },
    { cMax: 14, rMin: 6, rMax: 22, noise: 'n2', bands: [[0.35, 'plain'], [0, 'rough']] },
  ];
  const TERRAIN_RULES = LEGACY_RULES.map(g => {
    const o = { noise: g.noise, bands: g.bands };
    if (g.cMin !== undefined) o.cMin = sc(g.cMin);
    if (g.cMax !== undefined) o.cMax = sc(g.cMax);
    if (g.rMin !== undefined) o.rMin = sr(g.rMin);
    if (g.rMax !== undefined) o.rMax = sr(g.rMax);
    return o;
  });
  const LEGACY_ELEV = [
    { c: 30, r: 4, amp: 0.34, rad: 6.5 },
    { c: 37, r: 11, amp: 0.26, rad: 4.5 },
    { c: 24, r: 18, amp: 0.12, rad: 9 },
    { c: 10, r: 14, amp: -0.12, rad: 8 },
    { c: 30, r: 29, amp: -0.14, rad: 7 },
  ];
  const ELEV_FEATURES = LEGACY_ELEV.map(f => ({ c: sc(f.c), r: sr(f.r), amp: f.amp, rad: f.rad * SC }));

  globalThis.DATA_DIV = Object.assign({}, big, {
    /* —— 地图：34×21 缩放版 —— */
    COLS, ROWS,
    TOWNS, RIVERS, ROADS,
    BRIDGES: uniqPts(src.BRIDGES || []),
    DEPOTS: (src.DEPOTS || []).map(d => [sc(d[0]), sr(d[1]), d[2], d[3]]),
    EXIT_C: Math.max(1, sc(src.EXIT_C || 1)),
    TERRAIN_RULES, ELEV_FEATURES,
    TERRAIN_DEFAULT: undefined,   // null → mapgen 用内建缺省（阿登腹地）
    TERRAIN_DETAIL: null, TERRAIN_FINE: null, ELEV_DETAIL: null,
    US_LINES: (src.US_LINES || []).map(line => line.map(p => [sc(p[0]), sr(p[1])])),
    DE_TARGETS: src.DE_TARGETS, US_OFFENSIVE_TARGETS: src.US_OFFENSIVE_TARGETS,
    /* —— OOB：75 师旅 + 25 指挥部 —— */
    OOB_DE: B.OOB_DIV_DE, OOB_US: B.OOB_DIV_US, OOB_BIG_META: B.META_DIV,
    /* —— 剧本 —— */
    SCENARIOS: {
      div_standard: {
        id: 'div_standard',
        name: '突出部战役（师级）',
        sub: '1944.12.16 – 12.27 · 德军攻势窗口 · 12回合 · 师旅 75 · 34×21',
        desc: '师级编制推演（34×21 缩小地图，约 2/3 标准尺寸）：每个师/旅一个算子，25 座指挥部可被摧毁引发士气崩溃。德军须在时限内冲出马斯河或夺取两大枢纽，美军且战且退、等天气放晴。',
        rounds: 12, fuelDE: 90, airFrom: 8, lateWeather: 8,
        campaign: false, exitsNeeded: 3,
        usStart: 'US', deStart: 'DE',
      },
      div_campaign: {
        id: 'div_campaign',
        name: '阿登全战役（师级）',
        sub: '1944.12.16 – 1945.1.16 · 24回合 · 师旅 75 · 34×21',
        desc: '两阶段战役（师级编制，34×21 地图）：德军攻势 + 美军反攻，攻守易势，直到突出部被削平。含 1 月德军二梯队与美军增援师的投入。',
        rounds: 24, fuelDE: 120, airFrom: 8, lateWeather: 8,
        campaign: true, exitsNeeded: 4,
        usStart: 'US', deStart: 'DE',
      },
    },
    DMG_SCALE: 3.5, RECOVER_SCALE: 3.5,   // 26l: 组织度区间 56–128，伤害/整补同比 ×3.5
    SUPPLY_DISABLED: true,   // 26g: 师级剧本取消补给机制
    DATES: src.DATES, EVENTS: src.EVENTS,
    BRIEFINGS: src.BRIEFINGS,   // 26r 补: 此前漏拷, 师级开局简报被静默跳过（goals 按剧本 id 回退 standard）
    EXITS_NEEDED: 3,
    REINFORCE_DOSSIERS: src.REINFORCE_DOSSIERS, VICTORY: src.VICTORY,
    ACHIEVEMENTS: globalThis.ACH_DATA ? globalThis.ACH_DATA.ACHIEVEMENTS : [],
    ACH_ICONS: globalThis.ACH_DATA ? globalThis.ACH_DATA.ACH_ICONS : {},
    ACH_PALETTE: globalThis.ACH_DATA ? globalThis.ACH_DATA.ACH_PALETTE : {},
  });
})();
