'use strict';
/* ============================================================
 * gen_data_div.js — 师级 OOB 生成器 v2（26f，2026-10-28）
 * 口径：师主力参战按师、仅旅参战按旅（docs 报告）。
 *   德 26 师 + 11 旅 = 37 ｜ 美 28 师 ｜ 英 4 师 + 6 旅 = 10
 *   合计 75 师旅 + 25 指挥部 = 100 算子
 * 位置：营质心 → 52×32（25d 校准）→ 34×21（地图同步缩小）。
 * ============================================================ */
global.window = global;
const fs = require('fs');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js']) eval(fs.readFileSync('D:/ardennes-big/js/' + f, 'utf8'));

const BIG = globalThis.DATA_BIG;
const META = BIG.OOB_BIG_META;
const ROWS = new Map();
for (const r of [...BIG.OOB_DE, ...BIG.OOB_US]) ROWS.set(r[0], r);

const to52c = c => 0.5077 * c - 13.89;
const to52r = r => 0.9173 * r - 21.71;
const S34 = 34 / 52, S21 = 21 / 32;
const mapC = c => Math.max(1, Math.min(33, Math.round(to52c(c) * S34)));
const mapR = r => Math.max(1, Math.min(20, Math.round(to52r(r) * S21)));


/* 26h 史实部署坐标（34×21，1944-12-16 展开线） */
const POS = {
  /* —— 德军 第6装甲集团军（北翼：蒙绍—洛斯海姆—圣维特以北）—— */
  '党卫军第1装甲师「警卫旗队」': [24, 3],
  '党卫军第12装甲师「青年团」': [25, 2],
  '第3伞兵师': [26, 4],
  '第12国民掷弹兵师': [21, 5],
  '第277国民掷弹兵师': [27, 3],
  '第246国民掷弹兵师': [23, 6],
  '第272国民掷弹兵师': [25, 6],
  '第326国民掷弹兵师': [27, 6],
  '第3装甲掷弹兵师': [27, 4],
  '党卫军第2装甲师「帝国」': [28, 8],
  '党卫军第9装甲师「霍恩施陶芬」': [29, 9],
  '第150装甲旅': [23, 4],
  /* —— 德军 第5装甲集团军（中路：豪法利兹—巴斯托涅以东）—— */
  '第2装甲师': [18, 12],
  '装甲教导师': [16, 12],
  '第9装甲师': [10, 10],
  '第116装甲师': [20, 10],
  '第26国民掷弹兵师': [17, 13],
  '第560国民掷弹兵师': [21, 12],
  '第18国民掷弹兵师': [22, 11],
  '第62国民掷弹兵师': [23, 13],
  '最高统帅部护卫旅': [16, 10],
  /* —— 德军 第7集团军（南翼：迪基希—埃希特纳赫以东）—— */
  '第5伞兵师': [22, 17],
  '第352国民掷弹兵师': [17, 16],
  '第79国民掷弹兵师': [21, 20],
  '第212国民掷弹兵师': [25, 17],
  '第276国民掷弹兵师': [26, 19],
  '第340国民掷弹兵师': [27, 20],
  '最高统帅部掷弹兵旅': [19, 16],
  /* —— 德军 火箭炮旅（各军后方）—— */
  '第4国民火箭炮旅': [28, 5],
  '第7国民火箭炮旅': [26, 8],
  '第9国民火箭炮旅': [28, 10],
  '第15国民火箭炮旅': [19, 12],
  '第16国民火箭炮旅': [23, 10],
  '第17国民火箭炮旅': [26, 7],
  '第18国民火箭炮旅': [21, 17],
  '第8国民火箭炮旅': [22, 18],
  /* —— 美军 第5军（北肩：蒙绍—埃尔森博恩岭）—— */
  '第1步兵师': [20, 2],
  '第2步兵师': [21, 3],
  '第9步兵师': [24, 2],
  '第99步兵师': [22, 5],
  '第78步兵师': [18, 3],
  /* —— 美军 第7军（圣维特—西侧）—— */
  '第7装甲师': [18, 7],
  '第2装甲师': [15, 7],
  '第3装甲师': [12, 9],
  '第83步兵师': [14, 6],
  '第84步兵师': [12, 5],
  /* —— 美军 第18空降军（圣维特—巴斯托涅—雪艾菲尔）—— */
  '第82空降师': [17, 10],
  '第101空降师': [14, 14],
  '第30步兵师': [16, 4],
  '第75步兵师': [13, 3],
  '第106步兵师': [24, 7],
  /* —— 美军 第8军（巴斯托涅以南—东南）—— */
  '第28步兵师': [19, 14],
  '第9装甲师': [16, 18],
  '第11装甲师': [10, 20],
  '第17空降师': [8, 20],
  '第87步兵师': [6, 18],
  /* —— 美军 第3军（西南—南）—— */
  '第4装甲师': [12, 16],
  '第26步兵师': [9, 14],
  '第35步兵师': [14, 19],
  '第80步兵师': [8, 16],
  '第90步兵师': [6, 14],
  /* —— 美军 第12军（东南：埃希特纳赫方向）—— */
  '第4步兵师': [22, 19],
  '第5步兵师': [26, 20],
  '第10装甲师': [25, 19],
  /* —— 英军（默兹河防线 c≤8）—— */
  '英军近卫装甲师': [5, 7],
  '英军第51（高地）步兵师': [7, 11],
  '英军第53（威尔士）步兵师': [5, 14],
  '英军第6空降师': [3, 16],
  '英军第43（威塞克斯）步兵师': [5, 2],
  '英军第29装甲旅': [9, 12],
  '英军第33装甲旅': [11, 8],
};

/* 26j 师旅数值梯表（攻/防/组织度）——覆盖营合计，体现师素质差异
 * 参照营级：装甲营 9-10/6、步兵营 4/6、国民掷弹兵营 2/3、空降营 5-7/7
 * 键 = 阵营|单位名（德美同名师「第2/第9装甲师」不串） */
const DIV_STATS = {
  /* ==== 德军 37（装甲 8 / 装掷 1 / 伞兵 2 / 国民掷弹兵 15 / 旅 11）==== */
  'DE|党卫军第1装甲师「警卫旗队」': [78, 58, 128],
  'DE|党卫军第12装甲师「青年团」': [72, 54, 121],
  'DE|党卫军第2装甲师「帝国」': [70, 52, 119],
  'DE|党卫军第9装甲师「霍恩施陶芬」': [66, 50, 115],
  'DE|装甲教导师': [68, 50, 117],
  'DE|第2装甲师': [60, 44, 106],
  'DE|第9装甲师': [58, 43, 105],
  'DE|第116装甲师': [57, 42, 103],
  'DE|第3装甲掷弹兵师': [50, 40, 99],
  'DE|第3伞兵师': [46, 42, 97],
  'DE|第5伞兵师': [50, 44, 101],
  'DE|第12国民掷弹兵师': [38, 33, 87],
  'DE|第26国民掷弹兵师': [38, 33, 87],
  'DE|第18国民掷弹兵师': [38, 33, 87],
  'DE|第9国民掷弹兵师': [34, 30, 81],
  'DE|第62国民掷弹兵师': [34, 30, 81],
  'DE|第79国民掷弹兵师': [34, 30, 81],
  'DE|第212国民掷弹兵师': [34, 30, 81],
  'DE|第246国民掷弹兵师': [34, 30, 81],
  'DE|第272国民掷弹兵师': [34, 30, 81],
  'DE|第277国民掷弹兵师': [34, 30, 81],
  'DE|第352国民掷弹兵师': [34, 30, 81],
  'DE|第560国民掷弹兵师': [34, 30, 81],
  'DE|第276国民掷弹兵师': [30, 27, 78],
  'DE|第326国民掷弹兵师': [30, 27, 78],
  'DE|第340国民掷弹兵师': [30, 27, 78],
  'DE|最高统帅部护卫旅': [30, 20, 74],
  'DE|最高统帅部掷弹兵旅': [32, 22, 76],
  'DE|第150装甲旅': [8, 5, 56],
  'DE|第7国民火箭炮旅': [20, 8, 65],
  'DE|第15国民火箭炮旅': [18, 7, 63],
  'DE|第4国民火箭炮旅': [16, 6, 63],
  'DE|第9国民火箭炮旅': [16, 6, 63],
  'DE|第16国民火箭炮旅': [16, 6, 63],
  'DE|第17国民火箭炮旅': [16, 6, 63],
  'DE|第18国民火箭炮旅': [16, 6, 63],
  'DE|第8国民火箭炮旅': [14, 5, 61],
  /* ==== 美军 28（步兵 17 / 装甲 8 / 空降 3）==== */
  'US|第30步兵师': [62, 56, 115],
  'US|第1步兵师': [60, 54, 114],
  'US|第2步兵师': [60, 54, 114],
  'US|第4步兵师': [58, 52, 110],
  'US|第9步兵师': [58, 52, 110],
  'US|第87步兵师': [56, 50, 108],
  'US|第5步兵师': [56, 50, 108],
  'US|第75步兵师': [54, 49, 106],
  'US|第78步兵师': [54, 49, 106],
  'US|第80步兵师': [54, 49, 106],
  'US|第26步兵师': [52, 47, 103],
  'US|第35步兵师': [52, 47, 103],
  'US|第83步兵师': [52, 47, 103],
  'US|第84步兵师': [52, 47, 103],
  'US|第28步兵师': [52, 48, 105],
  'US|第106步兵师': [48, 44, 99],
  'US|第99步兵师': [46, 42, 97],
  'US|第2装甲师': [66, 46, 112],
  'US|第7装甲师': [64, 45, 110],
  'US|第3装甲师': [62, 44, 108],
  'US|第4装甲师': [62, 44, 108],
  'US|第9装甲师': [60, 42, 106],
  'US|第10装甲师': [60, 42, 106],
  'US|第6装甲师': [58, 41, 103],
  'US|第11装甲师': [58, 41, 103],
  'US|第82空降师': [68, 62, 123],
  'US|第101空降师': [64, 58, 119],
  'US|第17空降师': [56, 50, 108],
  /* ==== 英军 7（师 5 / 旅 2）==== */
  'UK|英军近卫装甲师': [60, 46, 108],
  'UK|英军第6空降师': [56, 54, 110],
  'UK|英军第53（威尔士）步兵师': [54, 50, 106],
  'UK|英军第51（高地）步兵师': [52, 48, 105],
  'UK|英军第43（威塞克斯）步兵师': [50, 46, 101],
  'UK|英军第29装甲旅': [20, 12, 67],
  'UK|英军第33装甲旅': [14, 9, 61],
};


/* 总指挥部（东/西后方） */
const HQ_POS = { DE: [29, 12], US: [9, 5] };

/* 72 个师旅单位映射表 */
const RAW = [
  ['DE', 'div', '党卫军第1装甲师「警卫旗队」', ['党卫军第1装甲师（警卫旗队）']],
  ['DE', 'div', '党卫军第12装甲师「青年团」', ['党卫军第12装甲师（青年团）']],
  ['DE', 'div', '党卫军第2装甲师「帝国」', ['党卫军第2装甲师（帝国）']],
  ['DE', 'div', '党卫军第9装甲师「霍恩施陶芬」', ['党卫军第9装甲师（霍恩施陶芬）']],
  ['DE', 'div', '第2装甲师', ['第2装甲师']],
  ['DE', 'div', '第9装甲师', ['第9装甲师']],
  ['DE', 'div', '第116装甲师', ['第116装甲师']],
  ['DE', 'div', '装甲教导师', ['装甲教导师']],
  ['DE', 'div', '第3装甲掷弹兵师', ['第3装甲掷弹兵师']],
  ['DE', 'div', '第3伞兵师', ['第3伞兵师']],
  ['DE', 'div', '第5伞兵师', ['第5伞兵师']],
  ['DE', 'div', '第9国民掷弹兵师', ['第9国民掷弹兵师']],
  ['DE', 'div', '第12国民掷弹兵师', ['第12国民掷弹兵师']],
  ['DE', 'div', '第18国民掷弹兵师', ['第18国民掷弹兵师']],
  ['DE', 'div', '第26国民掷弹兵师', ['第26国民掷弹兵师']],
  ['DE', 'div', '第62国民掷弹兵师', ['第62国民掷弹兵师']],
  ['DE', 'div', '第79国民掷弹兵师', ['第79国民掷弹兵师']],
  ['DE', 'div', '第212国民掷弹兵师', ['第212国民掷弹兵师']],
  ['DE', 'div', '第246国民掷弹兵师', ['第246国民掷弹兵师']],
  ['DE', 'div', '第272国民掷弹兵师', ['第272国民掷弹兵师']],
  ['DE', 'div', '第276国民掷弹兵师', ['第276国民掷弹兵师']],
  ['DE', 'div', '第277国民掷弹兵师', ['第277国民掷弹兵师']],
  ['DE', 'div', '第326国民掷弹兵师', ['第326国民掷弹兵师']],
  ['DE', 'div', '第340国民掷弹兵师', ['第340国民掷弹兵师']],
  ['DE', 'div', '第352国民掷弹兵师', ['第352国民掷弹兵师']],
  ['DE', 'div', '第560国民掷弹兵师', ['第560国民掷弹兵师']],
  ['DE', 'brig', '最高统帅部护卫旅', ['最高统帅部护卫旅']],
  ['DE', 'brig', '最高统帅部掷弹兵旅', ['最高统帅部掷弹兵旅']],
  ['DE', 'brig', '第150装甲旅', ['第150装甲旅']],
  ['DE', 'brig', '第4国民火箭炮旅', ['第4国民火箭炮旅']],
  ['DE', 'brig', '第7国民火箭炮旅', ['第7国民火箭炮旅']],
  ['DE', 'brig', '第8国民火箭炮旅', ['第8国民火箭炮旅']],
  ['DE', 'brig', '第9国民火箭炮旅', ['第9国民火箭炮旅']],
  ['DE', 'brig', '第15国民火箭炮旅', ['第15国民火箭炮旅']],
  ['DE', 'brig', '第16国民火箭炮旅', ['第16国民火箭炮旅']],
  ['DE', 'brig', '第17国民火箭炮旅', ['第17国民火箭炮旅']],
  ['DE', 'brig', '第18国民火箭炮旅', ['第18国民火箭炮旅']],
  ['US', 'div', '第1步兵师', ['第1步兵师']],
  ['US', 'div', '第2步兵师', ['第2步兵师']],
  ['US', 'div', '第4步兵师', ['第4步兵师']],
  ['US', 'div', '第5步兵师', ['第5步兵师']],
  ['US', 'div', '第9步兵师', ['第9步兵师']],
  ['US', 'div', '第26步兵师', ['第26步兵师']],
  ['US', 'div', '第28步兵师', ['第28步兵师']],
  ['US', 'div', '第30步兵师', ['第30步兵师']],
  ['US', 'div', '第35步兵师', ['第35步兵师']],
  ['US', 'div', '第75步兵师', ['第75步兵师']],
  ['US', 'div', '第78步兵师', ['第78步兵师']],
  ['US', 'div', '第80步兵师', ['第80步兵师']],
  ['US', 'div', '第83步兵师', ['第83步兵师']],
  ['US', 'div', '第84步兵师', ['第84步兵师']],
  ['US', 'div', '第87步兵师', ['第87步兵师']],
  ['US', 'div', '第99步兵师', ['第99步兵师']],
  ['US', 'div', '第106步兵师', ['第106步兵师']],
  ['US', 'div', '第2装甲师', ['第2装甲师']],
  ['US', 'div', '第3装甲师', ['第3装甲师']],
  ['US', 'div', '第4装甲师', ['第4装甲师']],
  ['US', 'div', '第6装甲师', ['第6装甲师']],
  ['US', 'div', '第7装甲师', ['第7装甲师']],
  ['US', 'div', '第9装甲师', ['第9装甲师']],
  ['US', 'div', '第10装甲师', ['第10装甲师']],
  ['US', 'div', '第11装甲师', ['第11装甲师']],
  ['US', 'div', '第17空降师', ['第17空降师']],
  ['US', 'div', '第82空降师', ['第82空降师']],
  ['US', 'div', '第101空降师', ['第101空降师']],
  ['US', 'div', '英军第51（高地）步兵师', ['第152步兵旅', '第153步兵旅', '第154步兵旅'], 'UK'],
  ['US', 'div', '英军第53（威尔士）步兵师', ['第71步兵旅', '第158步兵旅', '第160步兵旅'], 'UK'],
  ['US', 'div', '英军第6空降师', ['第3伞兵旅', '第5伞兵旅', '第6机降旅', '第34陆军坦克旅'], 'UK'],
  ['US', 'div', '英军第43（威塞克斯）步兵师', ['第129步兵旅', '第130步兵旅', '第214步兵旅'], 'UK'],
  ['US', 'div', '英军近卫装甲师', ['第5近卫装甲旅', '第32近卫旅'], 'UK'],
  ['US', 'brig', '英军第29装甲旅', ['第29装甲旅'], 'UK'],
  ['US', 'brig', '英军第33装甲旅', ['第33装甲旅'], 'UK'],
];
/* 26o: B站审核整改——部队名称脱敏 */
const SENSITIVE_MAP = [["阿道夫·希特勒警卫旗队","警卫旗队"],["警卫旗队","警卫旗队"],["希特勒青年团","青年团"],["元首护卫旅","最高统帅部护卫旅"],["元首掷弹兵旅","最高统帅部掷弹兵旅"],["元首卫队旅","最高统帅部护卫旅"],["元首掷弹旅","最高统帅部掷弹兵旅"]];
function deSensitize(name) { if (!name) return name; let out = name; for (const [from, to] of SENSITIVE_MAP) out = out.split(from).join(to); return out; }

const UNITS = RAW.map(a => ({ side: a[0], kind: a[1], name: a[2], divs: a[3], nat: a[4] || a[0] }));
const totalUnits = UNITS.length;
console.log('映射表单位数:', totalUnits);

/* 师级机动（每回合格数）：由主导兵种决定——师里炮兵慢，但不拖累全师机动 */
const MOV_BY_TYPE = { ARM: 6, MOT: 5, INF: 4, ABN: 4, FJ: 4, RECON: 6, RKT: 3, TD: 5, ENGR: 4 };

function domType(counts, name) {
  if (/火箭炮旅/.test(name)) return 'RKT';
  if (/伞兵师|空降师/.test(name)) return 'ABN';
  if (/装甲旅|装甲师/.test(name)) return 'ARM';   // 26i: 英军装甲师按营标注为 INF, 按名称纠正
  if (/装甲掷弹兵师/.test(name)) return 'MOT';
  const infLike = (counts.INF || 0) + (counts.VGD || 0);   // 26i: 国民掷弹兵也是步兵类
  if (counts.ARM >= 3) return 'ARM';
  if (counts.ARM >= 1 && infLike <= 2) return 'ARM';
  if (counts.MOT >= 3) return 'MOT';
  if (counts.FJ >= 1 && counts.FJ >= infLike) return 'FJ';
  if (counts.RECON >= 1 && infLike <= 1) return 'RECON';
  return 'INF';
}

const OOB_DE = [], OOB_US = [];
const META_DIV = {};
const occupied = new Set();
/* 环形就近搜索：从 (c0,r0) 向外找第一个空格（最多 12 圈） */
const RING = [];
for (let rad = 0; rad <= 12; rad++) {
  const pts = [];
  for (let dc = -rad; dc <= rad; dc++) for (let dr = -rad; dr <= rad; dr++) {
    if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
    pts.push([dc, dr]);
  }
  RING.push(pts);
}
function findSpot(c0, r0) {
  if (!occupied.has(c0 + ',' + r0)) return [c0, r0];
  for (let rad = 1; rad <= 12; rad++) {
    let best = null, bestD = 1e9;
    for (const [dc, dr] of RING[rad]) {
      const c = c0 + dc, r = r0 + dr;
      if (c < 1 || c > 33 || r < 1 || r > 20) continue;
      if (occupied.has(c + ',' + r)) continue;
      const d = dc * dc + dr * dr;
      if (d < bestD) { bestD = d; best = [c, r]; }
    }
    if (best) return best;
  }
  return [c0, r0];
}
let idcDE = 0, idcUS = 0;
const unmatched = [];

for (const u of UNITS) {
  const units = [];
  for (const key of u.divs) {
    for (const [id, m] of Object.entries(META)) {
      if (m.div !== key) continue;
      if ((m.nat || 'DE') !== u.nat) continue;
      const row = ROWS.get(id);
      if (row) units.push(row);
    }
  }
  if (!units.length) { unmatched.push(u.name); continue; }

  let atk = 0, def = 0, mov = 99, orgSum = 0, arrive = 99, cx = 0, cy = 0;
  const tc = {};
  for (const row of units) {
    atk += row[4]; def += row[5]; mov = Math.min(mov, row[6]);
    orgSum += row[10]; arrive = Math.min(arrive, row[9]);
    cx += row[7]; cy += row[8];
    tc[row[3]] = (tc[row[3]] || 0) + 1;
  }
  const n = units.length;
  const type = domType(tc, u.name);
  const p0 = POS[u.name] ? POS[u.name] : [mapC(cx / n), mapR(cy / n)];   // 26h: 史实坐标优先
  const spot = findSpot(p0[0], p0[1]);
  const c = spot[0], r = spot[1];
  occupied.add(c + ',' + r);

  const id = (u.side === 'DE' ? 'Q' : 'W') + String((u.side === 'DE' ? ++idcDE : ++idcUS)).padStart(3, '0');
  const movFinal = MOV_BY_TYPE[type] || 4;   // 26i: 师级机动按主导兵种
  /* 26j: 数值以手工梯度表为准（覆盖营合计）；表外的用聚合值兜底 */
  const DS = DIV_STATS[(u.nat === 'UK' ? 'UK' : u.side) + '|' + u.name] || DIV_STATS[u.name];   // 26j: 复合键（德美同名师不串）
  const atkF = DS ? DS[0] : atk;
  const defF = DS ? DS[1] : def;
  const orgF = DS ? DS[2] : Math.max(6, Math.round(orgSum / n));
  if (!DS) console.log('⚠ 无梯度表项（用聚合值）:', u.name);
  const safeName = deSensitize(u.name);   // 26o
  const row = [id, safeName, safeName.replace(/英军|党卫军/g, '').slice(0, 8), type, atkF, defF, movFinal, c, r, arrive, orgF, orgF];
  (u.side === 'DE' ? OOB_DE : OOB_US).push(row);
  META_DIV[id] = {
    nat: u.nat, army: '', corps: '', div: u.name, parent: u.name,
    raw: u.kind === 'div' ? '师' : '旅', src: '聚合', srcRaw: '26f 师旅聚合',
    from: '1944.12-16', to: '1945.01-25', orig: u.name, note: u.kind === 'div' ? '师' : '旅',
  };
}

/* 指挥部 25 座 */
let hqN = 0;
for (const [id, m] of Object.entries(META)) {
  if (m.div !== '司令部') continue;
  const row = ROWS.get(id);
  if (!row) continue;
  if (row[3] !== 'HQT') continue;   // 26g: 师级只保留两军总指挥部
  if (!row) continue;
  const hp = HQ_POS[m.nat === 'DE' ? 'DE' : 'US'] || [mapC(row[7]), mapR(row[8])];   // 26h: 后方固定位
  const spot2 = findSpot(hp[0], hp[1]);
  const c = spot2[0], r = spot2[1];
  occupied.add(c + ',' + r);
  const side = m.nat === 'DE' ? 'DE' : 'US';
  const nid = (side === 'DE' ? 'Q' : 'W') + String((side === 'DE' ? ++idcDE : ++idcUS)).padStart(3, '0');
  /* 26k: 师级总指挥部组织度按量级换算（营级 20 × 2.5 = 50，与 8–48 的师级组织度同量级） */
  const hqOrg = 128;   // 26l: 师级总指挥部组织度（区间上限，统帅机构最耐打）
  (side === 'DE' ? OOB_DE : OOB_US).push([nid, row[1], row[2], row[3], row[4], row[5], row[6], c, r, 0, hqOrg, hqOrg]);
  META_DIV[nid] = { nat: m.nat, army: m.army, corps: m.corps, div: '司令部', parent: '', raw: '司令部', src: '记载', srcRaw: '26f 映射', from: '1944.12-16', to: '1945.01-25', orig: row[1], note: '指挥部' };
  hqN++;
}

if (unmatched.length) console.log('⚠ 未匹配:', unmatched.join(', '));
const built = totalUnits - unmatched.length;
console.log('师旅算子:', built, '· 指挥部:', hqN, '· 合计', OOB_DE.length + OOB_US.length);

const L = [];
L.push("'use strict';");
L.push('/* ============================================================');
L.push(' * data_div_oob.js — 师级 OOB（生成物 gen_data_div.js 产出，勿手改）');
L.push(' * ' + built + ' 师旅（德 26师+11旅 / 美 28师 / 英 4师+6旅）+ ' + hqN + ' 指挥部');
L.push(' * 地图 34×21（52×32 同步缩小）。行格式同主 OOB。');
L.push(' * ============================================================ */');
L.push('globalThis.DATA_DIV_OOB = (function () {');
L.push('  const OOB_DIV_DE = [');
for (const r of OOB_DE) L.push('    ' + JSON.stringify(r) + ',');
L.push('  ];');
L.push('  const OOB_DIV_US = [');
for (const r of OOB_US) L.push('    ' + JSON.stringify(r) + ',');
L.push('  ];');
L.push('  const META_DIV = {');
for (const [id, m] of Object.entries(META_DIV)) L.push('    ' + JSON.stringify(id) + ': ' + JSON.stringify(m) + ',');
L.push('  };');
L.push('  return { OOB_DIV_DE, OOB_DIV_US, META_DIV };');
L.push('})();');
fs.writeFileSync('D:/ardennes-big/js/data_div_oob.js', L.join('\n') + '\n');
console.log('✓ data_div_oob.js', OOB_DE.length + OOB_US.length, '算子 · META', Object.keys(META_DIV).length);
