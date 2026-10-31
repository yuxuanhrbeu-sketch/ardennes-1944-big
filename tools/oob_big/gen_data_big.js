#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * gen_data_big.js — 《阿登 1944·大推演》OOB 转换脚本
 *
 * 输入：tools/oob_big/source/{de,us,uk}.csv（营级战斗序列，1192 条）
 * 输出：js/data_big_oob.js（生成物，勿手改）
 *
 * ------------------------------------------------------------
 * 2026-10-12 重制：地图 152×96 + 史实部署扇区
 * ------------------------------------------------------------
 * 旧版问题（用户反馈："所有算子挤在一起"）：
 *   每个师只给**一个锚点**，全师 4~8 个营靠 LCG 在同一锚点周围
 *   ±2 格内挤着找空格 → 师内营与营贴死，相邻师也贴死。
 *
 * 新版做法：**扇区（sector）布防**
 *   每个师/军给一个史实部署矩形 { c0,c1, r0,r1 }（营级战役的实际
 *   集结/防线扇区），再把该师全部营按 **最小 2 格中心间距**均匀铺在
 *   扇区内（网格抖动 + 确定性洗牌）。效果：
 *     ① 同师各营之间留出 1 格机动间隙 → 不再粘连；
 *     ② 相邻师各占自己的扇区 → 交界处可分辨；
 *     ③ 扇区是矩形的，不是点，铺得开 → 战术纵深可见。
 *   若扇区容不下（间距 2 放不下），自动退到间距 1，并在报告里记数。
 *
 * 坐标系：新图 152×96。旧图(52×32) ×2 平移 [50,32] 后落在
 *   c=50..153 / r=32..63 的中央带。扇区坐标一律用新图坐标。
 *   前缘（德军进攻出发线）= Our/Sauer 河一线，约 c=78..104。
 *
 * 确定性：散布用按 id 序号播种的 LCG，输出可复现；不触碰引擎 rng。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'source');
const OUT = path.join(__dirname, '..', '..', 'js', 'data_big_oob.js');

/* ⚠️ 必须与 js/data_big.js 的 COLS/ROWS 一致，否则自校验（spiralGlobal 边界、
   outOfMap 统计）会给出**假报警**：2026-10-13 加宽到 220 列后本文件漏改，
   误报"148 个落格越出地图"，实际全部在图内。改地图尺寸时两处必须同步。 */
const COLS = 220, ROWS = 96;
const OFF_C = 50, OFF_R = 32;          // 旧图→新图（×2 后平移）

/* ---------------- CSV 解析 ---------------- */
function parseCSV(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] && r[0].trim() !== ''));
}

/* ---------------- 日期 → 入场回合（1 天 = 1 回合，round0 = 12.16） ---------------- */
function startToTurn(s) {
  const m = s.trim().match(/^(1944\.12|1945\.01)-(\d+)$/);
  if (!m) throw new Error('无法解析参战起始日: ' + s);
  const d = parseInt(m[2], 10);
  if (m[1] === '1944.12') return d - 16;
  return 15 + d;
}

/* ---------------- 类型映射 ---------------- */
function mapType(raw, name, parent, side) {
  const t = (name + '|' + parent);
  switch (raw) {
    case '步兵':
      if (/Ost/i.test(t)) return 'VGD';
      if (/国民掷弹兵/.test(t)) return 'VGD';
      if (/装甲掷弹兵/.test(t)) return 'MOT';
      if (/伞兵|空降/.test(t)) return side === 'DE' ? 'FJ' : 'ABN';
      if (/猎兵/.test(t)) return 'FJ';
      return 'INF';
    case '装甲掷弹兵': return 'MOT';
    case '空降兵': return side === 'DE' ? 'FJ' : 'ABN';
    case '装甲兵': return 'ARM';
    case '突击炮': return 'TD';
    case '反坦克/坦克歼击': return 'TD';
    case '防空': return 'TD';
    case '炮兵': return /火箭/.test(name + '|' + parent) ? 'RKT' : 'ART';
    case '侦察': return 'RECON';
    case '工兵': return 'ENGR';
    case '通信': return 'SIG';
    default: throw new Error('未知类型: ' + raw);
  }
}

/* ---------------- 编制基准战力 ---------------- */
const STATS = {
  DE: { INF:[3,4,4], VGD:[3,4,4], FJ:[4,5,4], MOT:[6,5,6], ARM:[9,6,8],
        ART:[5,1,3], TD:[5,4,5], RECON:[3,2,12], ENGR:[3,4,3], SIG:[3,4,3], RKT:[5,1,3],
        HQK:[3,4,4], HQA:[3,4,4], HQT:[3,4,4] },   // 24r: 指挥部攻防参考本国普通步兵营
  US: { INF:[4,6,4], VGD:[4,6,4], FJ:[4,5,4], ABN:[5,7,4], MOT:[6,5,6], ARM:[9,6,8],
        ART:[7,1,3], TD:[5,4,6], RECON:[3,2,12], ENGR:[3,5,4], SIG:[3,5,4], RKT:[7,1,3],
        HQK:[4,6,4], HQA:[4,6,4], HQT:[4,6,4] },
};
/* ---------------- 史实素质分层(原版34轮移植, 2026-10-24f 适配) ----------------
 * 原版在其 204 行 OOB 上逐行调整; 大阿登按 [side+兵种+师名] 匹配到 1192 行:
 *   削弱: VGD(国民掷弹兵,1944秋组建的实质民兵) 攻3→2/防4→3 —— 全部 98+ 行
 *   德王牌: 党卫军4师+装甲教导师的 ARM 攻9→10; 其 MOT 攻6→7/防5→6;
 *           第2装师304团/第116装师156团 MOT 同强化; FJ(第3/5伞兵师) 攻4→5
 *   美王牌: 82/101/17空降 ABN 攻5→6; 第2/4/7/9/10装 ARM 攻9→10;
 *           第1/2/30/4/9步兵师 INF 攻4→5
 *   刻意不动: 美28师(被打残)/99/106(新兵)/26/80/84/87/90师/第11/6/3装, 英军全部
 *   (原版结论: 加数值救不了德军AI, 此处只为素质分层写实; 平衡基线待授权推演)
 */
const ELITE = {
  deArm: d => /党卫军/.test(d) || d === '装甲教导师',
  deMot: (d, n) => (/党卫军/.test(d) || d === '装甲教导师' || (d === '第2装甲师' && /304/.test(n)) || (d === '第116装甲师' && /156/.test(n))),   // n 传 parent+ cname(团名在 parent 列)
  usAbn: d => d === '第82空降师' || d === '第101空降师' || d === '第17空降师',
  usArm: d => ['第2装甲师','第4装甲师','第7装甲师','第9装甲师','第10装甲师'].includes(d),
  usInf: d => ['第1步兵师','第2步兵师','第30步兵师','第4步兵师','第9步兵师'].includes(d),
};
function eliteStats(side, type, div, cname, atk, def) {
  if (side === 'DE') {
    if (type === 'VGD') return [2, 3];
    if (type === 'ARM' && ELITE.deArm(div)) return [10, def];
    if (type === 'MOT' && ELITE.deMot(div, cname)) return [7, 6];
    if (type === 'FJ') return [5, def];
  } else {
    if (type === 'ABN' && ELITE.usAbn(div)) return [6, def];
    if (type === 'ARM' && ELITE.usArm(div)) return [10, def];
    if (type === 'INF' && ELITE.usInf(div)) return [5, def];
  }
  return null;
}

/* ---------------- 组织度大平衡(2026-10-24i, 用户规格) ----------------
 * maxOrg 8~20 按史实分层, 开局一律满编(org=maxOrg)。
 * 原 10 制下的"残兵/新兵开局降 org"(28师8/99与106师7/VGD9)改为分层 maxOrg 表达。
 * 分层依据: 党卫军装甲师(20/19) > 装甲教导(19/18) > 国防军装甲师(17/16) > 装甲掷弹兵师(15)
 *          > 伞兵师(16, von der Heydte 精锐 18) > 国民掷弹兵师(11~13) > Ost 营(8);
 *          美军: 82/101 空降(18, 滑翔团17) > 老牌步兵师 1/2/4/9/30(16) > 4装突围尖刀(17)
 *          > 一般装甲师(15~16) > 一般步兵师(14) > 残兵28师(12) > 新兵99/106师(11);
 *          英军: 近卫装甲旅(17) > 装甲旅(15) > 步兵/炮兵(14) > 6空降(16)。
 */
function orgFor(side, isUK, type, div, name, note) {
  const d = div || '', nm = name || '';
  if (side === 'DE') {
    const SS = /党卫军/.test(d), PG = d === '装甲教导师';
    const PZ = !SS && !PG && /装甲师$/.test(d.replace(/第\d+/, ''));
    const PZG = /装甲掷弹兵师/.test(d);
    const FJD = /伞兵师/.test(d), VGDd = /国民掷弹兵师/.test(d);
    const FBB = /元首/.test(d), B150 = /第150装甲旅/.test(d);
    if (/Ost/.test(nm)) return 8;
    if (/Heydte/.test(nm)) return 18;
    if (/506/.test(nm) && type === 'ARM') return 17;
    if (B150) return type === 'ARM' || type === 'MOT' ? 15 : 13;
    if (FBB) return type === 'ARM' || type === 'MOT' ? 16 : 14;
    if (/火箭炮旅/.test(d)) return 12;
    if (SS) return { ARM: 20, MOT: 19, RECON: 18, ART: 16, TD: 16, ENGR: 16, SIG: 15, FJ: 16, RKT: 15 }[type] || 15;
    if (PG) return { ARM: 19, MOT: 18, RECON: 17, ART: 15, TD: 15, ENGR: 15, SIG: 14 }[type] || 14;
    if (PZ) return { ARM: 17, MOT: 16, RECON: 15, ART: 14, TD: 14, ENGR: 14, SIG: 13 }[type] || 13;
    if (PZG) return { ARM: 16, MOT: 15, RECON: 14, ART: 13, TD: 13, ENGR: 13, SIG: 12 }[type] || 12;
    if (FJD) return { FJ: 16, ART: 13, ENGR: 13, TD: 13, SIG: 12 }[type] || 13;
    if (VGDd) {   // 24k: 师内梯度 8~12 —— 燧发枪营(师最好分队)12 / 首批突击团 11 / 掷弹兵团 10 / 师炮(满编骡马化)10 / 歼击·工兵 9 / 通信 8
      if (type === 'RECON') return 12;
      if (type === 'SIG') return 8;
      if (type === 'TD' || type === 'ENGR') return 9;
      if (type === 'ART') return 10;
      if (/首批突击/.test(note || '')) return 11;
      return 10;
    }
    return { ARM: 16, MOT: 15, TD: 13, ART: 13, ENGR: 12, SIG: 12, RECON: 13, INF: 12, VGD: 10, FJ: 15, RKT: 12 }[type] || 12;
  }
  if (isUK) {
    if (/近卫/.test(d)) return { ARM: 17, MOT: 16 }[type] || 14;
    if (/装甲旅/.test(d)) return { ARM: 15, MOT: 14 }[type] || 14;
    if (/空降/.test(d)) return { ABN: 16, INF: 15 }[type] || 14;
    return { INF: 14, ART: 14, TD: 13, ARM: 15, MOT: 14, RECON: 13, ENGR: 13, SIG: 13, ABN: 15 }[type] || 14;
  }
  const ABNd = /空降师/.test(d);
  const OLD = ['第1步兵师','第2步兵师','第4步兵师','第9步兵师','第30步兵师'].includes(d);
  const AD_E = ['第2装甲师','第7装甲师','第9装甲师','第10装甲师'].includes(d);
  const AD = ['第3装甲师','第6装甲师','第11装甲师'].includes(d);
  if (d === '第28步兵师') return 12;
  if (d === '第99步兵师' || d === '第106步兵师') return 11;
  if (ABNd) return { ABN: 18, INF: 17, ART: 15, ENGR: 14, TD: 14, SIG: 13, RECON: 14 }[type] || 14;
  if (d === '第4装甲师') return { ARM: 17, MOT: 16, RECON: 15, ART: 13, TD: 13, ENGR: 12, SIG: 12 }[type] || 13;
  if (AD_E) return { ARM: 16, MOT: 15, RECON: 14, ART: 13, TD: 13, ENGR: 12, SIG: 12 }[type] || 13;
  if (AD) return { ARM: 15, MOT: 14, RECON: 13, ART: 12, TD: 12, ENGR: 12, SIG: 11 }[type] || 12;
  if (OLD) return { INF: 16, ART: 14, TD: 14, ENGR: 13, SIG: 13, RECON: 13 }[type] || 13;
  return { INF: 14, ART: 12, TD: 12, ENGR: 12, SIG: 11, RECON: 12, ARM: 14, MOT: 13, ABN: 14 }[type] || 13;
}

/* ---------------- 缩写（≤8 字） ---------------- */
const SUFFIX = { INF:'步', VGD:'掷', FJ:'伞', ABN:'伞', MOT:'掷', ARM:'装',
                 ART:'炮', TD:'歼', RECON:'侦', ENGR:'工', SIG:'通', RKT:'火',
                 HQK:'军部', HQA:'集部', HQT:'总部' };
function romanOf(s) { const m = s.match(/第(IV|III|II|I)营/); return m ? m[1] : ''; }
/* 26o: B站审核整改——部队名称脱敏（去纳粹人名/尊称；"党卫军"作为史学译名保留） */
const SENSITIVE_MAP = [["阿道夫·希特勒警卫旗队","警卫旗队"],["警卫旗队","警卫旗队"],["希特勒青年团","青年团"],["元首护卫旅","最高统帅部护卫旅"],["元首掷弹兵旅","最高统帅部掷弹兵旅"],["元首卫队旅","最高统帅部护卫旅"],["元首掷弹旅","最高统帅部掷弹兵旅"]];
function deSensitize(name) {
  if (!name) return name;
  let out = name;
  for (const [from, to] of SENSITIVE_MAP) out = out.split(from).join(to);
  return out;
}

function makeAbbr(name, parent, type, side, used) {
  let s = '';
  const own = name.match(/(\d+)/);
  const par = parent.match(/(\d+)/);
  const num = own ? own[1] : (par ? par[1] : '');
  const ss = /^(党卫军|SS)/.test(own ? name : parent) ? 'SS' : '';
  const rom = romanOf(name);
  const ord = rom ? rom : (name.match(/第(\d)营/) ? name.match(/第(\d)营/)[1] : '');
  s = ss + num + SUFFIX[type] + (ord ? (ord.length + s.length <= 8 ? ord : '') : '');
  if (s.length > 8) s = (num || SUFFIX[type]) + SUFFIX[type];
  if (s.length > 8) s = s.slice(0, 8);
  let base = s, k = 2;
  while (used.has(s)) { s = (base + k).slice(0, 8); k++; }
  used.add(s);
  return s;
}

/* ============================================================
 * 史实部署扇区（sector）——新图 152×96 坐标
 * ------------------------------------------------------------
 * 形态：[c0, r0, c1, r1] 矩形（含边界）。
 * 依据：Cole《The Ardennes: Battle of the Bulge》(美陆军官方战史) 的
 *       12.16 双方态势 + 各师集结/防线扇区。列≈东西，行≈南北。
 *       前缘 Our/Sauer 河约在 c=78..104：
 *         北段（蒙绍—埃尔森博恩）c≈96..104
 *         中段（乌尔河—圣维特）  c≈84..96
 *         南段（乌尔河—埃希特纳赫）c≈78..90
 * ============================================================ */
const SECTORS = {
  /* ===== 美军 · 前缘（12.16 在场 5 个师 + 军直属） =====
   * 前缘线（west→east）：第2步兵师/第99步兵师（北肩·蒙绍—埃尔森博恩）
   *   → 第106步兵师（雪艾费尔）→ 第28步兵师（乌尔河）→ 第4步兵师（埃希特纳赫）
   * 德军扇区在这些扇区以东 2~4 格处列阵（见下方"德军前缘"）。 */
  'US|第2步兵师': [60, 6, 68, 20],
  'US|第99步兵师': [58, 22, 66, 34],
  'US|第106步兵师': [54, 36, 62, 44],
  'US|第28步兵师': [44, 34, 54, 46],
  'US|第4步兵师': [52, 50, 60, 58],
  'US|第9装甲师': [50, 26, 56, 34],
  'US|第14骑兵群': [62, 36, 65, 40],
  'US|美军第5军直属': [58, 4, 63, 14],
  'US|美军第8军直属': [46, 42, 51, 48],
  'US|美军第7军直属': [58, 24, 62, 32],

  /* ===== 德军 · 前缘（第6/第5/第7 集团军的第一梯队, 12.16 进攻出发线） ===== */
  'DE|党卫军第1装甲军': [70, 24, 75, 31],
  'DE|党卫军第1装甲师（阿道夫·希特勒警卫旗队）': [68, 22, 75, 31],
  'DE|党卫军第12装甲师（希特勒青年团）': [70, 34, 77, 42],
  'DE|第12国民掷弹兵师': [66, 12, 73, 21],
  'DE|第277国民掷弹兵师': [76, 36, 83, 44],
  'DE|第3伞兵师': [74, 46, 81, 54],
  'DE|第272国民掷弹兵师': [78, 22, 85, 30],
  'DE|第326国民掷弹兵师': [70, 4, 77, 13],
  'DE|第246国民掷弹兵师': [78, 52, 85, 60],
  'DE|第9国民掷弹兵师': [84, 28, 91, 36],        // 集团军预备队
  'DE|第15装甲掷弹兵师': [96, 6, 106, 16],        // (二梯队) OKW 预备队
  'DE|第67军': [66, 4, 73, 12],
  '第6装甲集团军（北翼）|集团军直属': [88, 12, 95, 20],
  'DE|第39装甲军': [72, 44, 78, 52],
  'DE|第2装甲师': [70, 44, 77, 53],
  'DE|装甲教导师': [76, 56, 82, 64],
  'DE|第116装甲师': [74, 36, 81, 45],
  'DE|第26国民掷弹兵师': [68, 32, 75, 40],
  'DE|第18国民掷弹兵师': [70, 46, 77, 54],
  'DE|第62国民掷弹兵师': [66, 24, 73, 32],
  'DE|第560国民掷弹兵师': [74, 56, 81, 64],
  'DE|第167国民掷弹兵师': [80, 60, 87, 68],
  'DE|第47装甲军': [82, 40, 88, 48],
  'DE|第58装甲军': [86, 50, 92, 58],
  'DE|第66军': [80, 58, 86, 65],
  'DE|元首护卫旅': [82, 48, 86, 54],
  'DE|元首掷弹兵旅': [86, 56, 90, 62],
  '第5装甲集团军（中路）|集团军直属': [92, 22, 98, 30],
  'DE|第80军': [70, 58, 76, 65],
  'DE|第212国民掷弹兵师': [74, 60, 80, 67],
  'DE|第276国民掷弹兵师': [78, 66, 84, 73],
  'DE|第340国民掷弹兵师': [74, 68, 80, 75],
  'DE|第79国民掷弹兵师': [72, 76, 78, 83],
  'DE|第352国民掷弹兵师': [68, 66, 74, 73],
  'DE|第5伞兵师': [64, 60, 70, 67],
  'DE|第150装甲旅': [82, 54, 86, 59],
  'DE|第85军': [82, 68, 88, 75],
  'DE|第53军': [84, 58, 90, 65],
  '第7集团军（南翼）直属': [86, 78, 92, 85],
  '第7集团军（南翼）|集团军直属': [90, 86, 96, 91],
  'DE|党卫军第2装甲军': [98, 18, 106, 28],
  'DE|党卫军第2装甲师（帝国）': [98, 18, 104, 26],
  'DE|党卫军第9装甲师（霍恩施陶芬）': [100, 28, 106, 36],
  'DE|第9装甲师': [108, 28, 114, 36],
  'DE|第3装甲掷弹兵师': [96, 8, 102, 16],
  'DE|第4国民火箭炮旅': [88, 32, 92, 38],
  'DE|第7国民火箭炮旅': [86, 8, 90, 14],
  'DE|第9国民火箭炮旅': [92, 44, 96, 50],
  'DE|第16国民火箭炮旅': [88, 46, 92, 52],
  'DE|第8国民火箭炮旅': [82, 76, 86, 82],
  'DE|第15国民火箭炮旅': [88, 84, 92, 89],
  'DE|第17国民火箭炮旅': [90, 66, 94, 72],
  'DE|第18国民火箭炮旅': [82, 50, 86, 56],

  /* ===== 美军 · 增援（扇区 = 该师史实作战/集结扇区） ===== */
  'US|第7装甲师': [46, 16, 54, 24],                // 12.17 北翼（圣维特北）
  'US|第10装甲师': [48, 54, 56, 62],               // 12.17 纳沙托
  'US|第82空降师': [46, 28, 54, 36],               // 12.18 圣维特方向
  'US|第101空降师': [34, 40, 42, 48],              // 12.18 巴斯托涅
  'US|第3装甲师': [48, 18, 55, 26],                // 12.19 斯塔沃洛—圣维特
  'US|第9步兵师': [50, 6, 57, 14],                 // 12.19 北翼
  'US|第30步兵师': [50, 26, 56, 33],               // 12.20 马尔梅迪
  'US|第1步兵师': [44, 6, 50, 14],                 // 12.21 北翼
  'US|第84步兵师': [36, 16, 44, 26],               // 12.20-22 迪南—马尔什
  'US|第2装甲师': [26, 20, 34, 30],                // 12.22-24 马尔什方向
  'US|第4装甲师': [38, 50, 46, 60],                // 12.22 巴斯托涅解围轴线
  'US|第26步兵师': [28, 62, 36, 70],               // 12.21 南翼
  'US|第80步兵师': [42, 62, 50, 70],               // 12.21-25 卢森堡段
  'US|第35步兵师': [28, 48, 36, 58],               // 12.22 阿隆方向
  'US|第5步兵师': [46, 62, 54, 70],                // 12.22 埃希特纳赫以南
  'US|第87步兵师': [32, 70, 40, 78],               // 12.29 南翼
  'US|第75步兵师': [38, 8, 44, 16],                // 12.20+ 北翼后方
  'US|第78步兵师': [50, 8, 57, 16],                // 12.20+ 北翼后方
  'US|第83步兵师': [30, 8, 38, 16],                // 12.20+ 马尔什方向
  'US|第90步兵师': [26, 64, 34, 74],               // 12.29+ 第3集团军
  'US|第6装甲师': [16, 60, 26, 70],                // 12.29+ 第3集团军
  'US|第11装甲师': [30, 38, 38, 46],               // 12.30+ 南翼
  'US|第17空降师': [32, 26, 40, 34],               // 1945.1.3
  'US|CCR, 5th装甲师': [24, 32, 32, 40],
  'US|美军第18空降军直属': [42, 50, 47, 56],
  'US|美军第12军直属': [38, 64, 44, 70],
  'US|美军第3军直属': [30, 54, 36, 60],
  'US|美军第3集团军直属': [22, 70, 28, 78],
  'US|美军第1集团军直属': [44, 4, 50, 12],         // 斯帕周边
  'US|英军第30军直属': [12, 26, 20, 34],
  'US|第214步兵旅': [8, 20, 14, 26], 'US|第160步兵旅': [8, 28, 14, 34],
  'US|第231步兵旅': [8, 36, 14, 42], 'US|第154步兵旅': [14, 18, 20, 24],
  'US|第32近卫旅': [14, 26, 20, 32], 'US|第129步兵旅': [14, 34, 20, 40],
  'US|第130步兵旅': [2, 20, 8, 26], 'US|第151步兵旅': [2, 28, 8, 34],
  'US|第69步兵旅': [2, 36, 8, 42], 'US|第152步兵旅': [20, 20, 26, 26],
  'US|第153步兵旅': [20, 28, 26, 34], 'US|第158步兵旅': [20, 36, 26, 42],
  'US|第71步兵旅': [2, 44, 8, 50], 'US|第5近卫装甲旅': [24, 24, 30, 30],
  'US|第29装甲旅': [24, 32, 30, 38], 'US|第33装甲旅': [2, 52, 8, 58],
  'US|第34陆军坦克旅': [2, 60, 8, 66], 'US|第3伞兵旅': [30, 18, 36, 24],
  'US|第5伞兵旅': [30, 26, 36, 32], 'US|第6机降旅': [30, 34, 36, 40],
};

/* 兜底扇区（军/集团军级） */
const CORPS_FALLBACK = {
  DE: { '党卫军第1装甲军': [84,8,90,16], '第39装甲军': [94,20,100,28], '第47装甲军': [100,30,106,38],
        '第58装甲军': [106,38,112,46], '第66军': [96,58,102,64], '第67军': [84,8,90,16],
        '第80军': [88,60,94,66], '第85军': [100,70,106,76], '第53军': [104,54,110,60],
        '党卫军第2装甲军': [114,20,122,30] },
  US: { '美军第18空降军': [40,46,46,52], '美军第5军': [54,4,60,16], '美军第7军': [56,20,62,28],
        '美军第8军': [42,40,48,48], '美军第12军': [36,60,42,66], '美军第3军': [28,50,34,56],
        '美军第1集团军': [42,4,48,12] },
  UK: { '英军第30军': [12,26,20,34], '军属预备队': [12,26,20,34] },
};
const ARMY_FALLBACK = {
  DE: { '第6装甲集团军（北翼）': [106,8,112,16], '第5装甲集团军（中路）': [112,24,118,32],
        '第7集团军（南翼）': [108,88,114,92] },
  US: { '美军第12集团军群': [20,8,28,16], '美军第3集团军': [20,66,26,74] },
  UK: { '英军第21集团军群': [12,26,20,34] },
};

/* ============================================================
 * 扇区防重叠（2026-10-12 新增）
 * ------------------------------------------------------------
 * 手写扇区时极易让两个师在行号上重叠——重叠就意味着同一片地塞两层
 * 算子，宏观占格率看着还行、局部却挤成一团（实测拥挤度 0.58、
 * 每 100 格挤 38 个算子）。
 * 这里按"史实前缘序"（SECTOR_ORDER）**自动**给每个扇区分配互不重叠的
 * 行段：每个扇区占满 (高+1) 行，相邻扇区留 1 行间隙，
 * 于是任意两个师的行段至少相隔 2 行 → 算子间距有保证。
 * 显式写在扇区里的行号被忽略（列范围仍然保留）。
 * ============================================================ */
const SECTOR_ORDER = {
  DE: ['DE|第12国民掷弹兵师', 'DE|第326国民掷弹兵师', 'DE|第67军', 'DE|第272国民掷弹兵师',
    'DE|党卫军第1装甲军', 'DE|党卫军第1装甲师（阿道夫·希特勒警卫旗队）', 'DE|第62国民掷弹兵师',
    'DE|第26国民掷弹兵师', 'DE|第12装甲师（希特勒青年团）', 'DE|第116装甲师', 'DE|第277国民掷弹兵师',
    'DE|第2装甲师', 'DE|第39装甲军', 'DE|第3伞兵师', 'DE|第18国民掷弹兵师', 'DE|第246国民掷弹兵师',
    'DE|第560国民掷弹兵师', 'DE|装甲教导师', 'DE|第167国民掷弹兵师', 'DE|第5伞兵师',
    'DE|第352国民掷弹兵师', 'DE|第80军', 'DE|第212国民掷弹兵师', 'DE|第340国民掷弹兵师',
    'DE|第276国民掷弹兵师', 'DE|第79国民掷弹兵师', 'DE|第85军', 'DE|第150装甲旅', 'DE|第53军',
    'DE|第58装甲军', 'DE|第47装甲军', 'DE|元首护卫旅', 'DE|元首掷弹兵旅', 'DE|第9国民掷弹兵师',
    '第5装甲集团军（中路）|集团军直属', 'DE|第15装甲掷弹兵师', 'DE|第3装甲掷弹兵师',
    'DE|党卫军第2装甲军', 'DE|党卫军第2装甲师（帝国）', 'DE|党卫军第9装甲师（霍恩施陶芬）',
    'DE|第9装甲师', '第6装甲集团军（北翼）|集团军直属', '第7集团军（南翼）直属',
    '第7集团军（南翼）|集团军直属'],
  US: ['US|第2步兵师', 'US|美军第5军直属', 'US|第99步兵师', 'US|第14骑兵群', 'US|第106步兵师',
    'US|第9装甲师', 'US|第28步兵师', 'US|美军第7军直属', 'US|第4步兵师', 'US|美军第8军直属',
    'US|美军第1集团军直属', 'US|第78步兵师', 'US|第9步兵师', 'US|第1步兵师', 'US|第30步兵师',
    'US|第3装甲师', 'US|第7装甲师', 'US|第75步兵师', 'US|第82空降师', 'US|第101空降师',
    'US|第17空降师', 'US|CCR, 5th装甲师', 'US|第11装甲师', 'US|第2装甲师', 'US|第83步兵师',
    'US|第84步兵师', 'US|第35步兵师', 'US|第4装甲师', 'US|美军第18空降军直属', 'US|第10装甲师',
    'US|美军第3军直属', 'US|第26步兵师', 'US|第80步兵师', 'US|美军第12军直属', 'US|第5步兵师',
    'US|第87步兵师', 'US|第90步兵师', 'US|美军第3集团军直属', 'US|第6装甲师'],
};

/* ============================================================
 * 扇区二维装箱（2026-10-12 重写）
 * ------------------------------------------------------------
 * 问题：手写扇区极易两两重叠 —— 重叠就是**同一片地塞两层算子**，
 *   宏观占格率看着正常、局部却挤成一团（实测拥挤度 0.69、
 *   每 100 格挤 38 个算子）。等比压缩行号也没用（还是重叠）。
 *
 * 做法：真正的二维装箱，保证**互不重叠**，并保持史实南北顺序。
 *   ① 每个扇区按"算子数"估个最小面积 A = n × expand（默认 2.6 格/算子），
 *      再按原高宽比反推宽度 → 得到"期望宽高"；
 *   ② 按原中心纬度排序（保留北→南的史实次序）；
 *   ③ 逐行填充：一行内的扇区按原中心经度排序（保留西→东次序）横向排开，
 *      放不下就换行。行带范围由本方 territory 给定。
 *   ④ 装箱后逐扇区按实际面积重算列范围（宽度取整、最小 5 列）。
 * 这样任意两个扇区在二维上不重叠，算子间距由 placer 的最小间距保证。
 * ============================================================ */
function packSectors(map, band, cols, expand, divCount, colStart, side) {
  const c0 = colStart || 1;
  const cMax = c0 + cols - 1;
  // ⚠️ 只处理**本阵营**的键：德美有同名师（第2装甲师/第9装甲师），
  //    不过滤会让美军分带把德军同名师一起重排（实测导致 135 处重叠）。
  const keys = Object.keys(map).filter(k => {
    if (!Array.isArray(map[k])) return false;
    if (!side) return true;
    const isUS = k.indexOf('US|') === 0;
    return (side === 'US') === isUS;
  });
  const items = keys.map(k => {
    const s = map[k];
    const n = (divCount && divCount[k]) || s[4] || 10;    // 该师实际营数
    const w0 = Math.max(2, s[2] - s[0] + 1), h0 = Math.max(2, s[3] - s[1] + 1);
    // 目标：每个算子 ≥ expand 格 → 间距 2 的网格能铺下（间距 2 时约 4 格/算子）
    const area = Math.max(60, Math.ceil(n * (expand || 2.8)));
    const ratio = w0 / h0;
    let w = Math.max(6, Math.round(Math.sqrt(area * ratio)));
    let h = Math.max(5, Math.round(area / w));
    return { k, n, cx: (s[0] + s[2]) / 2, cy: (s[1] + s[3]) / 2, w, h };
  });
  items.sort((a, b) => a.cy - b.cy || a.cx - b.cx);      // 北→南
  const MIN_W = 5;
  const bandH = band[1] - band[0];
  /* ① 先按宽度把 items 分行（首次适应递减，宽度含 1 格间隙），
        再按行数决定每行高度。这样保证所有 items 都能放下。 */
  const rows = [];
  for (const it of items) {
    const w = Math.max(MIN_W, it.w);
    let placed = false;
    for (const row of rows) {
      if (row.used + w <= cols) { row.items.push(it); row.used += w + 1; placed = true; break; }
    }
    if (!placed) rows.push({ items: [it], used: w + 1 });
  }
  const nRows = Math.max(1, rows.length);
  // 行高按可用高度均分；同时要求"每行高度 × 行内总宽 ≥ 该行算子数 × expand"，
  // 否则算子在细长条里会被迫贴在一起（实测拥挤度反弹到 0.95）。
  let rowH = Math.max(4, Math.floor((bandH - (nRows - 1)) / nRows));
  const minRowH = rows.map(rw => {
    const n = rw.items.reduce((s, x) => s + x.n, 0);
    const wTotal = rw.items.reduce((s, x) => s + Math.max(MIN_W, x.w) + 1, 0);
    return Math.max(4, Math.ceil((n * (expand || 2.8)) / Math.max(1, wTotal)));
  });
  rowH = Math.max(rowH, Math.max(...minRowH));
  const out = {};
  let r = band[0];
  for (const row of rows) {
    const h = Math.min(rowH, band[1] - r + 1);
    if (h < 4) break;
    row.items.sort((a, b) => a.cx - b.cx);                // 行内西→东
    let c = c0;
    for (const it of row.items) {
      const w = Math.min(Math.max(it.w, MIN_W), cMax - c + 1);
      if (w < MIN_W) break;
      out[it.k] = [c, r, c + w - 1, r + h - 1];
      c += w + 1;
    }
    r += h + 1;                                           // 行间留 1 行
  }
  return out;
}

/* 按阵营筛选出扇区表（键前缀 DE| / US|；无前缀的键按 DE 处理） */
function sectorsOfSide(map, side) {
  const out = {};
  for (const k of Object.keys(map)) {
    if (!Array.isArray(map[k])) continue;
    const isUS = k.indexOf('US|') === 0;
    if ((side === 'US') === isUS) out[k] = map[k];
  }
  return out;
}

/* 重叠检测：报告仍然重叠的扇区对（应为 0） */
function findOverlaps(map) {
  const keys = Object.keys(map).filter(k => Array.isArray(map[k]));
  const bad = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = map[keys[i]], b = map[keys[j]];
      const colOv = a[0] <= b[2] && b[0] <= a[2];
      const rowOv = a[1] <= b[3] && b[1] <= a[3];
      if (colOv && rowOv) bad.push(keys[i] + ' ∩ ' + keys[j]);
    }
  }
  return bad;
}

/* ============================================================
 * 确定性扇区铺设器
 * ------------------------------------------------------------
 * 目标：把 n 个营铺进矩形扇区，中心间距尽量 ≥ minSpacing（默认 2），
 *       同扇区内不重叠，且结果可复现。
 * 算法：① 按目标间距算网格 → 用 70% 概率按网格落位（保证均匀），
 *          30% 抖动到周边空格（避免"棋盘感"）；
 *       ② 网格位被占则螺旋外扩找最近空格；
 *       ③ 间距 2 放不下时退到间距 1，并在报告里记 fallback。
 * ============================================================ */
const MIN_SPACING = 2;

function makePlacer() {
  const occ = new Set();                       // 全图已占用格
  const key = (c, r) => c + ',' + r;
  const inSector = (s, c, r) => c >= s[0] && c <= s[2] && r >= s[1] && r <= s[3];

  // 螺旋找空格：从 (c,r) 起按切比雪夫环逐圈外扩，限制在扇区内
  function spiral(s, c, r, maxRad) {
    for (let rad = 0; rad <= maxRad; rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const cc = c + dc, rr = r + dr;
          if (!inSector(s, cc, rr)) continue;
          if (occ.has(key(cc, rr))) continue;
          return [cc, rr];
        }
      }
    }
    return null;
  }

  /* 全局螺旋找空格：允许越过扇区边界（新几何下扇区较窄，算子需要溢到
     邻区空位）。扇区内优先，找不到再放宽到全图——否则 placeSector 会
     回退到扇区左上角，造成**开局同格冲突**（实测 8 处）。 */
  function spiralGlobal(c, r, maxRad) {
    for (let rad = 0; rad <= maxRad; rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
          if (occ.has(key(cc, rr))) continue;
          return [cc, rr];
        }
      }
    }
    return null;
  }

  return {
    has: (c, r) => occ.has(key(c, r)),
    occupancy: () => occ.size,
    /* 把 n 个单位铺进扇区 s；返回坐标数组（长度 n） */
    placeSector(s, n, seed, report) {
      const w = s[2] - s[0] + 1, h = s[3] - s[1] + 1;
      const area = w * h;
      // 目标间距：先试 2，容量不足再退 1
      let sp = MIN_SPACING;
      if (Math.ceil(area / (sp * sp)) < n) sp = 1;
      if (sp < MIN_SPACING && report) report.spacingFallback++;
      const step = sp;
      const gw = Math.max(1, Math.floor((w - 1) / step) + 1);
      const gh = Math.max(1, Math.floor((h - 1) / step) + 1);
      // 网格位列表 + 确定性洗牌（按 seed）
      const cells = [];
      for (let i = 0; i < gw; i++) for (let j = 0; j < gh; j++) cells.push([i, j]);
      let a = (seed * 2654435761 + 12345) >>> 0;
      const rnd = () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296;
      for (let i = cells.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = cells[i]; cells[i] = cells[j]; cells[j] = t; }

      const out = [];
      let ci = 0;
      const maxRad = Math.max(w, h);
      while (out.length < n) {
        let pos = null;
        if (ci < cells.length) {
          const [i, j] = cells[ci++];
          const gc = s[0] + Math.min(i * step, w - 1);
          const gr = s[1] + Math.min(j * step, h - 1);
          pos = spiral(s, gc, gr, maxRad);
        } else {
          // 网格用尽：整扇区随机找空格
          pos = spiral(s, s[0] + ((rnd() * w) | 0), s[1] + ((rnd() * h) | 0), maxRad);
        }
        // 扇区内找不到空位 → 从扇区中心做**全图螺旋**（绝不回退到原点！）
        // 回退到 s.slice(0,2) 会让同一扇区的多个算子叠在同一格 → 开局同格冲突。
        if (!pos) {
          if (report) report.sectorOverflow.push(JSON.stringify(s) + ' 需 ' + n + ' 实得 ' + out.length);
          const cx = Math.round((s[0] + s[2]) / 2), cy = Math.round((s[1] + s[3]) / 2);
          pos = spiralGlobal(cx, cy, 60);
          if (!pos) break;
        }
        if (occ.has(key(pos[0], pos[1]))) {
          const alt = spiralGlobal(pos[0], pos[1], 60);
          if (!alt) break;
          pos = alt;
        }
        occ.add(key(pos[0], pos[1]));
        out.push(pos);
      }
      return out;
    },
  };
}

/* ---------------- 主流程 ---------------- */
function main() {
  const sides = [
    { file: 'de.csv', side: 'DE', idp: 'D' },
    { file: 'us.csv', side: 'US', idp: 'U' },
    { file: 'uk.csv', side: 'US', idp: 'B', nat: 'UK' },
  ];
  const meta = {};
  const warnings = [];
  const counts = { DE: 0, US: 0, UK: 0, srcRecorded: 0, srcInferred: 0, firstWave: 0, firstDay: 0 };
  const usedAbbr = { DE: new Set(), US: new Set() };
  const placer = makePlacer();
  const report = { spacingFallback: 0, sectorOverflow: [], sectorUse: {} };

  /* 第一遍：解析 CSV → 中间记录（同时定扇区）。
     必须先把整批记录按扇区分组，才能把同一师的营"一次性铺开"——
     逐个放置无法保证营与营之间的最小间距。 */
  const recs = [];
  /* ---- 预扫：先数出每个师/军有多少营，装箱时才知道该给多大扇区 ---- */
  const divCount = {};
  for (const s of sides) {
    const rows = parseCSV(fs.readFileSync(path.join(SRC, s.file), 'utf8'));
    const pfx = s.nat ? 'US' : s.side;
    for (const r of rows.slice(1)) {
      if (!r[6] || !r[6].trim()) continue;
      const k = pfx + '|' + r[4];
      divCount[k] = (divCount[k] || 0) + 1;
    }
  }
  /* ---- 扇区分配：按"算子数比例"切分本方 territory 的行 ----
     手写扇区的通病是**两两重叠**（同一片地塞两层 → 局部挤成一团）。
     重写为确定性分配：
       ① 本方所有扇区按原中心纬度排序（保留史实北→南关系）；
       ② 本方 territory 的总行数按**算子数比例**切给每个扇区
          （行高 = 总行数 × 该师算子数 / 本方总算子数）；
       ③ 列范围保留各扇区原有的东西位置（但不重叠）——同一行内多个扇区
          按原中心经度排序、横向切分本方列带。
     这样结构上不可能重叠，且面积与算子数成正比 → 密度均匀。 */
  function assignSectors(map, side, rowBand, colBand, totalUnits) {
    const keys = Object.keys(map).filter(k => Array.isArray(map[k]) &&
      (side === 'DE' ? k.indexOf('US|') !== 0 : k.indexOf('US|') === 0));
    if (!keys.length) return { map: {}, missed: [] };
    keys.sort((a, b) => (map[a][1] + map[a][3]) - (map[b][1] + map[b][3]) ||
      (map[a][0] + map[a][2]) - (map[b][0] + map[b][2]));
    const totUnits = keys.reduce((s, k) => s + (divCount[k] || 1), 0) || 1;
    const rowSpan = rowBand[1] - rowBand[0] + 1;
    const colSpanTotal = colBand[1] - colBand[0] + 1;
    const out = {};
    /* 每个扇区需要的格数：4.2 格/算子（间距 2 的网格约 4 格/算子）
       → 行数 = 总行数 × 该扇区所需格数 / 本方总格数 */
    const areaOf = k => Math.max(36, (divCount[k] || 1) * 4.2);
    const totArea = keys.reduce((s, k) => s + areaOf(k), 0);
    let r = rowBand[0];
    let i = 0;
    while (i < keys.length) {
      // 本行带高度：按本组所需面积 / 列宽 估算，最少 5 行
      const remainH = rowBand[1] - r + 1;
      if (remainH < 5) break;
      // 先选一批（按面积占满一行宽度）
      const rowKeys = [];
      let areaSum = 0;
      while (i < keys.length) {
        const k = keys[i];
        // 这一行带能容纳的总面积 ≈ colSpan × 该带高度；先按宽度估
        const estH = Math.max(5, Math.round(rowSpan * areaOf(k) / totArea));
        rowKeys.push({ k, w: Math.max(5, Math.round(colSpanTotal * areaOf(k) / totArea)), h: estH });
        areaSum += areaOf(k);
        i++;
        if (areaSum >= colSpanTotal * 5) break;      // 一行大约放 5 行高的面积
      }
      const h = Math.min(remainH, Math.max(5, Math.max(...rowKeys.map(x => x.h))));
      let c = colBand[0];
      for (const x of rowKeys) {
        let w = Math.max(5, Math.min(x.w, colBand[1] - c + 1));
        if (w < 5) { c = colBand[0]; break; }        // 本带放不下 → 直接结束（外层已保证 i 已前移）
        out[x.k] = [c, r, c + w - 1, r + h - 1];
        c += w + 1;
      }
      r += h + 1;
    }
    const missed = keys.filter(k => !out[k]);
    return { map: out, missed };
  }
  /* ---- 扇区独占化（消除重叠） ----
     手写扇区地理归属正确、且开局补给 100%，但存在两两重叠：重叠区被两个师
     各放一层算子 → 局部挤成一团。
     做法：按"算子少的先让"的顺序，把每个扇区**收缩到未被先前扇区占用的部分**；
     收缩后如果小于最小面积，就沿纬度挪到最近的空处。
     注意：扇区变小后 placer 会把算子挤到扇区外（螺旋外扩），
     因此这一步通常让算子更散而不是更挤。 */
  function exclusiveSectors(map, side) {
    const keys = Object.keys(map).filter(k => Array.isArray(map[k]) &&
      (side === 'DE' ? k.indexOf('US|') !== 0 : k.indexOf('US|') === 0));
    // 算子多的先占位（它们的地盘最大）
    keys.sort((a, b) => (divCount[b] || 0) - (divCount[a] || 0));
    const owners = [];                         // 已占用的矩形
    const out = {};
    const ov = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
    const area = s => (s[2] - s[0] + 1) * (s[3] - s[1] + 1);
    let shrunk = 0, moved = 0;
    for (const k of keys) {
      let s = map[k].slice();
      const need = Math.max(20, Math.ceil((divCount[k] || 1) * 1.6));
      // 反复：若有重叠，把重叠部分从自身切掉（选损失较小的一侧）
      let guard = 0;
      while (owners.some(p => ov(s, p)) && guard++ < 30) {
        const p = owners.find(q => ov(s, q));
        // 四个切法，选面积损失最小的
        const cands = [
          [p[2] + 1, s[1], s[2], s[3]],      // 切左
          [s[0], p[3] + 1, s[2], s[3]],      // 切上
          [s[0], s[1], p[0] - 1, s[3]],      // 切右
          [s[0], s[1], s[2], p[1] - 1],      // 切下
        ].filter(c => c[2] >= c[0] && c[3] >= c[1]);
        if (!cands.length) break;
        cands.sort((a, b) => area(b) - area(a));
        const best = cands[0];
        if (area(best) < need) break;
        s = best; shrunk++;
      }
      // 还是重叠 → 沿纬度下移找空位
      let g2 = 0;
      while (owners.some(p => ov(s, p)) && g2++ < 40) {
        const h = s[3] - s[1];
        s = [s[0], s[1] + 3, s[2], s[1] + 3 + h];
        if (s[3] > 95) s = [s[0], 2, s[2], 2 + h];
        moved++;
      }
      out[k] = s;
      owners.push(s);
    }
    return { map: out, shrunk, moved };
  }
  /* ---- 扇区网格分配（结构上不可能重叠） ----
     把本方 territory 划成等面积网格单元（列数×行数由扇区数决定），
     ① 扇区按**算子数降序**排序 → 让算子多的师拿单元时优先（并允许占 2 格）；
     ② 单元按"北→南、西→东"的史实次序分配给按原纬度排序的扇区列表；
     ③ 每个扇区占据 1~2 个相邻单元，矩形化。
     单位面积一致 → 密度均匀；单元互斥 → 零重叠。 */
  function gridSectors(map, side, rowBand, colBand) {
    const keys = Object.keys(map).filter(k => Array.isArray(map[k]) &&
      (side === 'DE' ? k.indexOf('US|') !== 0 : k.indexOf('US|') === 0));
    if (!keys.length) return { map: {}, info: '' };
    // 保持史实次序（北→南、西→东）
    keys.sort((a, b) => (map[a][1] + map[a][3]) - (map[b][1] + map[b][3]) ||
      (map[a][0] + map[a][2]) - (map[b][0] + map[b][2]));
    const R = rowBand[1] - rowBand[0] + 1, C = colBand[1] - colBand[0] + 1;
    const n = keys.length;
    // 网格：列数取 sqrt(n * C/R) 附近，保证单元接近正方形
    let nCols = Math.max(1, Math.round(Math.sqrt(n * C / R)));
    let nRows = Math.ceil(n / nCols);
    while (nRows * 4 > R && nCols < n) { nCols++; nRows = Math.ceil(n / nCols); }
    const cw = Math.max(5, Math.floor((C - (nCols - 1)) / nCols));
    const ch = Math.max(4, Math.floor((R - (nRows - 1)) / nRows));
    const out = {};
    keys.forEach((k, idx) => {
      const gi = idx % nCols, gj = Math.floor(idx / nCols);
      const c0 = colBand[0] + gi * (cw + 1);
      const r0 = rowBand[0] + gj * (ch + 1);
      if (r0 + ch - 1 > rowBand[1]) return;                 // 超出 → 保持原值（兜底）
      out[k] = [c0, r0, Math.min(colBand[1], c0 + cw - 1), r0 + ch - 1];
    });
    const area = cw * ch;
    return { map: out, info: 'DE/US 网格 ' + nCols + 'x' + nRows + ' 单元 ' + cw + 'x' + ch + ' = ' + area + ' 格/师' };
  }
  /* ---- 扇区货架装箱（零重叠 + 面积与算子数成正比） ----
     ① 本方扇区按原中心纬度排序（保留史实北→南关系）；
     ② 每个扇区按算子数算目标面积 A = n × PER（PER≈4.2 格/算子，够间距 2 铺开）；
     ③ 沿"行"依次摆放：一行内从本方列带起点往东摆，摆不下就换行；
        行高 = 该行内扇区的最大需求高度；行与行之间留 1 行间隙。
     结构上零重叠，且面积/算子数恒定 → 密度均匀。 */
  function shelfSectors(map, side, rowBand, colBand) {
    const keys = Object.keys(map).filter(k => Array.isArray(map[k]) &&
      (side === 'DE' ? k.indexOf('US|') !== 0 : k.indexOf('US|') === 0));
    if (!keys.length) return { map: {}, info: '' };
    keys.sort((a, b) => (map[a][1] + map[a][3]) - (map[b][1] + map[b][3]) ||
      (map[a][0] + map[a][2]) - (map[b][0] + map[b][2]));
    const C = colBand[1] - colBand[0] + 1, R = rowBand[1] - rowBand[0] + 1;
    const n = keys.length;
    /* 行数预算：先把总行数 R 分成 k 行（每行高度 = R/k - 1），
       每行能放 m = floor(C / 5) 个扇区（每个最少 5 列宽）→ k ≈ ceil(n/m)。
       行高由预算决定，扇区宽度再按"面积 ≥ 4.2×算子数"反推。 */
    const MINW = 5, MINH = 4;
    /* 单元格尺寸要够大：4.2 格/算子 × 最密师(18 营) ≈ 76 格。
       列带固定 → 用"少列宽格"换取"够高的格"：列数 m 取 sqrt(n × 4.2 × R / (C × 行高)) 附近，
       这里直接迭代 m，取"能全部放下且单元面积最大"的那个。 */
    let best = null;
    for (let mm = 1; mm <= Math.min(n, Math.floor(C / MINW)); mm++) {
      const kk = Math.ceil(n / mm);
      const rh = Math.floor((R - (kk - 1)) / kk);
      const cw = Math.floor((C - (mm - 1)) / mm);
      if (rh < MINH || cw < MINW) continue;
      const area = cw * rh;
      // 目标：面积尽量大，同时单元尽量接近正方形（细长条会让算子挤成一线）
      const aspect = Math.max(cw, rh) / Math.min(cw, rh);
      const score = area / (1 + 0.35 * aspect);
      if (!best || score > best.score) best = { m: mm, k: kk, rowH: rh, cellW: cw, area, score };
    }
    if (!best) best = { m: 1, k: n, rowH: MINH, cellW: Math.max(MINW, C), area: MINH * C };
    const m = best.m, k = best.k, rowH = best.rowH, cellW = best.cellW;
    const out = {};
    keys.forEach((key, idx) => {
      const gi = idx % m, gj = Math.floor(idx / m);
      if (gj >= k) return;
      const c0 = colBand[0] + gi * (cellW + 1);
      const r0 = rowBand[0] + gj * (rowH + 1);
      // 不做"向下扩高"——那会与下一行重叠（实测 56 处重叠）。
      // 单元面积不足时交给 placer 螺旋外扩，算子自然溢到空处。
      out[key] = [c0, r0, Math.min(colBand[1], c0 + cellW - 1), Math.min(rowBand[1], r0 + rowH - 1)];
    });
    return { map: out, info: '货架 ' + Object.keys(out).length + '/' + n + ' 放置 (' + m + '列x' + k + '行, 单元 ' + cellW + 'x' + rowH + ')' };
  }
  /* ============================================================
   * 扇区布局：结构性重排（2026-10-12 第二轮）
   * ------------------------------------------------------------
   * 上一轮试了 6 种自动装箱都失败，根因是**几何紧绷**：
   * 43 个德军师挤在约 60×66 格的 territory 里。
   * 本轮改用结构性方案（用户确认）：
   *   ① 德军铺满 r4..92（原来只用 r14-74）→ 行数 +47%；
   *   ② 美军前缘整体西移（列带上限 68）→ 双方前沿留出空隙；
   *   ③ 双方对峙间隙 ≥3 格（原来最近仅 1 格，前沿两层重叠）；
   *   ④ 接受局部密：德军**集结区**（偏东的行）允许更紧，
   *      前线（偏西的行）拉开——史实上艾费尔的交通堵塞正是战役标志。
   * 布局方式：行带 × 列带的**网格单元**，按"算子数降序"依次分配单元，
   * 结构上不可能重叠。
   * ============================================================ */
  const DE_ROWS = [
    // [行带, 本行扇区（按西→东 = 北→南的史实序）]
    [[4, 18], ['DE|第67军', 'DE|第12国民掷弹兵师', 'DE|第326国民掷弹兵师',
      'DE|第272国民掷弹兵师', 'DE|党卫军第1装甲军', 'DE|第15装甲掷弹兵师',
      'DE|第3装甲掷弹兵师', 'DE|党卫军第2装甲军']],
    [[20, 34], ['DE|党卫军第1装甲师（阿道夫·希特勒警卫旗队）', 'DE|第62国民掷弹兵师',
      'DE|第26国民掷弹兵师', 'DE|党卫军第12装甲师（希特勒青年团）', 'DE|第2装甲师',
      'DE|第116装甲师', 'DE|第39装甲军', 'DE|第277国民掷弹兵师']],
    [[36, 50], ['DE|元首掷弹兵旅', 'DE|第9国民掷弹兵师', 'DE|第47装甲军',
      '第5装甲集团军（中路）|集团军直属', 'DE|第9装甲师', 'DE|党卫军第2装甲师（帝国）',
      'DE|党卫军第9装甲师（霍恩施陶芬）', 'DE|第7国民火箭炮旅']],
    [[52, 66], ['DE|第4国民火箭炮旅', 'DE|第9国民火箭炮旅', 'DE|第16国民火箭炮旅',
      'DE|第18国民火箭炮旅', 'DE|第3伞兵师', 'DE|第18国民掷弹兵师', 'DE|第560国民掷弹兵师',
      'DE|装甲教导师']],
    [[68, 80], ['第6装甲集团军（北翼）|集团军直属', 'DE|第80军', 'DE|第5伞兵师',
      'DE|第352国民掷弹兵师', 'DE|第246国民掷弹兵师', 'DE|第66军', 'DE|第212国民掷弹兵师',
      'DE|第340国民掷弹兵师']],
    [[82, 92], ['DE|元首护卫旅', 'DE|第150装甲旅', 'DE|第276国民掷弹兵师',
      'DE|第79国民掷弹兵师', 'DE|第53军', 'DE|第58装甲军', 'DE|第85军', 'DE|第167国民掷弹兵师',
      'DE|第17国民火箭炮旅', 'DE|第8国民火箭炮旅', 'DE|第15国民火箭炮旅',
      '第7集团军（南翼）直属', '第7集团军（南翼）|集团军直属']],
  ];
  const US_ROWS = [
    [[2, 18], ['US|第2步兵师', 'US|美军第5军直属', 'US|第99步兵师', 'US|第14骑兵群',
      'US|第9装甲师', 'US|美军第7军直属', 'US|第106步兵师', 'US|第28步兵师']],
    [[20, 36], ['US|美军第1集团军直属', 'US|第78步兵师', 'US|第9步兵师', 'US|第1步兵师',
      'US|第30步兵师', 'US|第3装甲师', 'US|第7装甲师', 'US|第75步兵师', 'US|第82空降师']],
    [[38, 54], ['US|第101空降师', 'US|第17空降师', 'US|CCR, 5th装甲师', 'US|第11装甲师',
      'US|第2装甲师', 'US|第83步兵师', 'US|第84步兵师', 'US|第35步兵师']],
    [[56, 72], ['US|第4步兵师', 'US|美军第8军直属', 'US|第4装甲师', 'US|美军第18空降军直属',
      'US|第10装甲师', 'US|美军第3军直属', 'US|第26步兵师', 'US|第80步兵师',
      'US|美军第12军直属', 'US|第5步兵师', 'US|第87步兵师']],
    [[74, 90], ['US|第90步兵师', 'US|美军第3集团军直属', 'US|第6装甲师',
      'US|英军第30军直属', 'US|第214步兵旅', 'US|第160步兵旅', 'US|第231步兵旅',
      'US|第154步兵旅', 'US|第32近卫旅', 'US|第129步兵旅', 'US|第130步兵旅',
      'US|第151步兵旅', 'US|第69步兵旅', 'US|第152步兵旅', 'US|第153步兵旅',
      'US|第158步兵旅', 'US|第71步兵旅', 'US|第5近卫装甲旅', 'US|第29装甲旅',
      'US|第33装甲旅', 'US|第34陆军坦克旅', 'US|第3伞兵旅', 'US|第5伞兵旅', 'US|第6机降旅']],
  ];
  /* 每行拆成几个子行：美军最后一行有 24 个后方旅，必须拆 4 个子行，
     否则每个单元只有 1~2 列宽放不下算子（实测回退到扇区原点 → 同格冲突）。 */
  const US_SUBROWS = [2, 2, 2, 2, 4];
  const DE_SUBROWS = [2, 2, 2, 2, 2, 3];
  function gridRows(rows, colBand, subRows) {
    const out = {};
    const [c0, c1] = colBand;
    const C = c1 - c0 + 1;
    let rowIdx = 0;
    for (const [band, keys] of rows) {
      const sr = Array.isArray(subRows) ? (subRows[rowIdx] || 2) : (subRows || 1);
      rowIdx++;
      const list = keys.filter(k => SECTORS[k]);
      if (!list.length) continue;
      const H = band[1] - band[0] + 1;
      const K = Math.max(1, Math.min(sr, list.length, Math.floor(H / 4)));
      const per = Math.ceil(list.length / K);
      const rowH = Math.max(4, Math.floor((H - (K - 1)) / K));
      for (let g = 0; g < K; g++) {
        const grp = list.slice(g * per, (g + 1) * per);
        if (!grp.length) continue;
        const tot = grp.reduce((s, k) => s + (divCount[k] || 1), 0) || 1;
        let c = c0;
        const r0 = band[0] + g * (rowH + 1);
        grp.forEach((k, i) => {
          const n = divCount[k] || 1;
          // 列宽按算子数比例；最少 6 列（4 列以下放不下一个营的 4.2 格/算子）
          const w = (i === grp.length - 1) ? (c1 - c + 1)
            : Math.max(6, Math.round(C * n / tot));
          out[k] = [c, r0, Math.min(c1, c + w - 1), Math.min(band[1], r0 + rowH - 1)];
          c += w;
        });
      }
    }
    return out;
  }
  /* 列带按**真实经度**对齐（地图已加宽到 220 列）：
     德军 = 乌尔河/艾费尔(6.1~6.7E ≈ c88~118) 到特里尔/莱茵(c120~175)；
     美军 = 马斯河/阿登后方(c45~96)，前缘在圣维特(6.13E≈c90)西侧。 */
  const deRows = gridRows(DE_ROWS, [96, 176], DE_SUBROWS);
  const usRows = gridRows(US_ROWS, [45, 96], US_SUBROWS);
  const SECT = Object.assign({}, SECTORS, deRows, usRows);
  {
    const ovl = findOverlaps(sectorsOfSide(SECT, 'DE')).concat(findOverlaps(sectorsOfSide(SECT, 'US')));
    const missDe = Object.keys(sectorsOfSide(SECTORS, 'DE')).filter(k => !deRows[k]);
    const missUs = Object.keys(sectorsOfSide(SECTORS, 'US')).filter(k => !usRows[k]);
    console.error('[扇区结构性重排] 重叠 ' + ovl.length + '；未分配 DE ' + missDe.length +
      ' / US ' + missUs.length);
    if (missDe.length) console.error('  DE 未分配: ' + missDe.slice(0, 6).join(' / '));
    if (missUs.length) console.error('  US 未分配: ' + missUs.slice(0, 6).join(' / '));
  }
  const ovl = findOverlaps(sectorsOfSide(SECT, 'DE')).concat(findOverlaps(sectorsOfSide(SECT, 'US')));
  console.error('[扇区排布] 同阵营重叠扇区对: ' + (ovl.length ? ovl.length + '  ' + ovl.slice(0, 4).join(' / ') : '0 ✓'));
  if (process.env.DUMP_SECTORS) {
    for (const side of ['DE', 'US']) {
      console.error('--- ' + side + ' 扇区 ---');
      for (const [k, v] of Object.entries(sectorsOfSide(SECT, side)).sort((a, b) => a[1][1] - b[1][1] || a[1][0] - b[1][0])) {
        console.error('  ' + k.replace(/^(DE|US)\|/, '').padEnd(26) + ' [' + v.join(',') + '] ' +
          (v[2] - v[0] + 1) + 'x' + (v[3] - v[1] + 1) + ' n=' + (divCount[k] || 0));
      }
    }
  }
  for (const s of sides) {
    const rows = parseCSV(fs.readFileSync(path.join(SRC, s.file), 'utf8'));
    const head = rows[0];
    if (head[10] !== '营级建制依据' || head[11] !== '备注')
      throw new Error(s.file + ' 表头不符: ' + head.join(','));
    for (const r of rows.slice(1)) {
      if (!r[6] || !r[6].trim()) continue;
      const [no, camp, army, corps, div, parent, cname, oname, raw, dates, srcCol, note] = r;
      const side = s.side;
      const type = mapType(raw, cname, parent, side);
      let [atk, def, mov] = STATS[side === 'UK' ? 'US' : side][type];
      {   // 史实素质分层(原版34轮移植): 命中王牌/民兵名单则覆盖攻防
        const el = eliteStats(s.side, type, div, parent + cname, atk, def);
        if (el) { atk = el[0]; def = el[1]; }
      }
      const arrive = Math.max(0, startToTurn(dates.split('—')[0]));

      const generic = /^第(IV|III|II|I|\d)营$/.test(cname.trim());
      const dispName = deSensitize(generic ? (parent.replace(/（.*?）/g, '') + '·' + cname.trim()) : cname.trim());   // 26o 脱敏
      const orgFinal = orgFor(side, !!s.nat && s.nat === 'UK', type, div, dispName || cname, note);   // 24i: 满编=分层maxOrg

      // —— 扇区解析：师 → 军 → 集团军 三级兜底（键带阵营前缀，避免德美同名师撞键）——
      const pfx = s.nat ? 'US' : side;
      let sector = SECT[pfx + '|' + div]
        || SECT[army + '|' + div]
        || (div === '第7集团军（南翼）直属' ? SECT['第7集团军（南翼）直属'] : null);
      if (!sector && div && !/直属$/.test(div)) warnings.push('未知师扇区: ' + pfx + '|' + div);
      if (!sector) sector = CORPS_FALLBACK[pfx] && CORPS_FALLBACK[pfx][corps];
      if (!sector) sector = ARMY_FALLBACK[pfx] && ARMY_FALLBACK[pfx][army];
      if (!sector) { sector = pfx === 'DE' ? [118, 46, 126, 56] : [66, 46, 76, 56]; warnings.push('兜底扇区: ' + div + '|' + corps + ' #' + no); }

      const sk = pfx + '|' + div + '|' + sector.join(',');
      const srcIsRec = !/推定/.test(srcCol);
      if (srcIsRec) counts.srcRecorded++; else counts.srcInferred++;
      if (/首批突击/.test(note || '')) counts.firstWave++;
      if (/首日接战/.test(note || '')) counts.firstDay++;

      recs.push({
        side, s, no, army, corps, div, parent, dispName, oname, raw, type, atk, def, mov,
        arrive, orgFinal, sector, sk, srcIsRec,
        from: dates.split('—')[0].trim(), to: dates.split('—')[1] ? dates.split('—')[1].trim() : '',
        note: (note || '').trim(), srcRaw: (srcCol || '').trim(),
        firstWave: /首批突击/.test(note || ''), firstDay: /首日接战/.test(note || ''),
      });
      if (side === 'DE') counts.DE++; else (s.nat ? counts.UK++ : counts.US++);
    }
  }

  /* 第二遍：按扇区分组 → 整批铺设（这是"不再挤在一起"的关键） */
  const bySector = new Map();
  for (const rec of recs) {
    if (!bySector.has(rec.sk)) bySector.set(rec.sk, { sector: rec.sector, recs: [] });
    bySector.get(rec.sk).recs.push(rec);
  }
  let seed = 0;
  for (const [sk, g] of bySector) {
    const pts = placer.placeSector(g.sector, g.recs.length, ++seed, report);
    report.sectorUse[sk] = { sector: g.sector, n: g.recs.length, placed: pts.length };
    g.recs.forEach((rec, i) => { rec.pos = pts[i] || g.sector.slice(0, 2); });
  }

  /* 自校验（2026-10-12 加入）：每个营必须落在自己的扇区内且在地图内。
     旧版的锚点散布会静默跑到扇区外，是"算子跑到奇怪位置"的根源。 */
  let outOfSector = 0, outOfMap = 0;
  for (const rec of recs) {
    const [c, r] = rec.pos, s = rec.sector;
    if (c < s[0] || c > s[2] || r < s[1] || r > s[3]) outOfSector++;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) outOfMap++;
  }
  if (outOfSector) warnings.push('落格越出扇区: ' + outOfSector + ' 个');
  if (outOfMap) warnings.push('落格越出地图: ' + outOfMap + ' 个');
  report.outOfSector = outOfSector;
  report.outOfMap = outOfMap;
  report.bounds = recs.reduce((b, x) => ({
    c0: Math.min(b.c0, x.pos[0]), c1: Math.max(b.c1, x.pos[0]),
    r0: Math.min(b.r0, x.pos[1]), r1: Math.max(b.r1, x.pos[1]),
  }), { c0: 1e9, c1: -1, r0: 1e9, r1: -1 });

  /* 第三遍：按原顺序输出（与旧版行序一致，便于逐行比对） */
  const oob = { DE: [], US: [] };
  for (const rec of recs) {
    const { side, s, no, dispName, parent, type, pos } = rec;
    const id = s.idp + String(parseInt(no, 10)).padStart(3, '0');
    const abbr = makeAbbr(dispName, parent, type, side, usedAbbr[side === 'DE' ? 'DE' : 'US']);
    oob[side].push([id, dispName, abbr, type, rec.atk, rec.def, rec.mov, pos[0], pos[1], rec.arrive, rec.orgFinal, rec.orgFinal]);   // 24i: [10]=初始org(=满编) [11]=maxOrg
    meta[id] = {
      nat: s.nat || (side === 'DE' ? 'DE' : 'US'),
      army: rec.army, corps: rec.corps, div: deSensitize(rec.div), parent: deSensitize(rec.parent),   // 26o 脱敏
      raw: rec.raw, src: rec.srcIsRec ? '记载' : '推定', srcRaw: rec.srcRaw,
      from: rec.from, to: rec.to, firstWave: rec.firstWave, firstDay: rec.firstDay,
      orig: deSensitize(rec.oname), note: rec.note,   // 26o
    };
  }

  /* ---------------- 24r: 军/集团军/总指挥部算子（用户规定） ----------------
   * 每个军、每个集团军各一座指挥部；德/美各一座总指挥部；英军以集团军群
   * 司令部充当集团军级（用户未设英军总部）。组织度：军10 / 集团军15 / 总部20。
   * 攻防参考本国普通步兵营（STATS.HQK/HQA/HQT）。位置=所辖营质心向己方后方
   * （德 +c / 盟 -c）步进找空格（图内、避开已放置算子）。
   * 指挥部被摧毁的士气冲击（org/攻防扣减）由引擎 noteKill 实现。 */
  const HQ_ORG = { HQK: 10, HQA: 15, HQT: 20 };
  const HQSPECS = [
    { side: 'DE', type: 'HQT', name: '德军西线总司令部', abbr: '总部', anchor: { all: true } },
    { side: 'DE', type: 'HQA', name: '第6装甲集团军司令部', abbr: '6集部', anchor: { army: '第6装甲集团军（北翼）' } },
    { side: 'DE', type: 'HQA', name: '第5装甲集团军司令部', abbr: '5集部', anchor: { army: '第5装甲集团军（中路）' } },
    { side: 'DE', type: 'HQA', name: '第7集团军司令部', abbr: '7集部', anchor: { army: '第7集团军（南翼）' } },
    { side: 'DE', type: 'HQK', name: '党卫军第1装甲军军部', abbr: 'SS1军部', anchor: { army: '第6装甲集团军（北翼）', corps: '党卫军第1装甲军' } },
    { side: 'DE', type: 'HQK', name: '党卫军第2装甲军军部', abbr: 'SS2军部', anchor: { army: '第6装甲集团军（北翼）', corps: '党卫军第2装甲军' } },
    { side: 'DE', type: 'HQK', name: '第67军军部', abbr: '67军部', anchor: { army: '第6装甲集团军（北翼）', corps: '第67军' } },
    { side: 'DE', type: 'HQK', name: '第39装甲军军部', abbr: '39军部', anchor: { army: '第5装甲集团军（中路）', corps: '第39装甲军' } },
    { side: 'DE', type: 'HQK', name: '第47装甲军军部', abbr: '47军部', anchor: { army: '第5装甲集团军（中路）', corps: '第47装甲军' } },
    { side: 'DE', type: 'HQK', name: '第58装甲军军部', abbr: '58军部', anchor: { army: '第5装甲集团军（中路）', corps: '第58装甲军' } },
    { side: 'DE', type: 'HQK', name: '第66军军部', abbr: '66军部', anchor: { army: '第5装甲集团军（中路）', corps: '第66军' } },
    { side: 'DE', type: 'HQK', name: '第53军军部', abbr: '53军部', anchor: { army: '第7集团军（南翼）', corps: '第53军' } },
    { side: 'DE', type: 'HQK', name: '第80军军部', abbr: '80军部', anchor: { army: '第7集团军（南翼）', corps: '第80军' } },
    { side: 'DE', type: 'HQK', name: '第85军军部', abbr: '85军部', anchor: { army: '第7集团军（南翼）', corps: '第85军' } },
    { side: 'US', type: 'HQT', name: '美军第12集团军群司令部', abbr: '美总部', anchor: { nat: 'US' } },
    { side: 'US', type: 'HQA', name: '美军第1集团军司令部', abbr: '1集部', anchor: { corps: '美军第1集团军' } },
    { side: 'US', type: 'HQA', name: '美军第3集团军司令部', abbr: '3集部', anchor: { army: '美军第3集团军' } },
    { side: 'US', type: 'HQK', name: '美军第18空降军军部', abbr: '18军部', anchor: { corps: '美军第18空降军' } },
    { side: 'US', type: 'HQK', name: '美军第5军军部', abbr: '5军部', anchor: { corps: '美军第5军' } },
    { side: 'US', type: 'HQK', name: '美军第7军军部', abbr: '7军部', anchor: { corps: '美军第7军' } },
    { side: 'US', type: 'HQK', name: '美军第8军军部', abbr: '8军部', anchor: { corps: '美军第8军' } },
    { side: 'US', type: 'HQK', name: '美军第12军军部', abbr: '12军部', anchor: { corps: '美军第12军' } },
    { side: 'US', type: 'HQK', name: '美军第3军军部', abbr: '3军部', anchor: { corps: '美军第3军' } },
    { side: 'US', nat: 'UK', type: 'HQA', name: '英军第21集团军群司令部', abbr: '21集部', anchor: { nat: 'UK' } },
    { side: 'US', nat: 'UK', type: 'HQK', name: '英军第30军军部', abbr: '30军部', anchor: { army: '英军第21集团军群', corps: '英军第30军' } },
  ];
  const hqStats = side => (side === 'DE' ? STATS.DE : STATS.US);
  const hqOcc = new Set();
  for (const arr of [oob.DE, oob.US]) for (const r0 of arr) hqOcc.add(r0[7] + ',' + r0[8]);
  let hqIdQ = 0, hqIdV = 0;
  for (const spec of HQSPECS) {
    const pool = recs.filter(r0 => {
      if (r0.side !== spec.side) return false;
      if (spec.anchor.all) return true;
      const nat = r0.s.nat || (r0.side === 'DE' ? 'DE' : 'US');
      if (spec.anchor.nat) return nat === spec.anchor.nat;
      if (spec.anchor.army && r0.army !== spec.anchor.army) return false;
      if (spec.anchor.corps && r0.corps !== spec.anchor.corps) return false;
      return true;
    });
    if (!pool.length) { warnings.push('HQ 无锚定营: ' + spec.name); continue; }
    const cx = Math.round(pool.reduce((a, p) => a + p.pos[0], 0) / pool.length);
    const cr = Math.round(pool.reduce((a, p) => a + p.pos[1], 0) / pool.length);
    const dir = spec.side === 'DE' ? 1 : -1;
    let pos = null;
    outer:
    for (let d = 5; d <= 16; d++) {
      for (let dr = -4; dr <= 4; dr++) {
        const c = cx + dir * d, r = cr + dr;
        if (c < 1 || c >= COLS - 1 || r < 1 || r >= ROWS - 1) continue;
        if (hqOcc.has(c + ',' + r)) continue;
        pos = [c, r]; break outer;
      }
    }
    if (!pos) { warnings.push('HQ 无后方空格: ' + spec.name); continue; }
    hqOcc.add(pos[0] + ',' + pos[1]);
    const [atk, def, mov] = hqStats(spec.side)[spec.type];
    const org = HQ_ORG[spec.type];
    const id = (spec.side === 'DE' ? 'Q' + String(++hqIdQ).padStart(3, '0') : 'V' + String(++hqIdV).padStart(3, '0'));
    oob[spec.side].push([id, spec.name, spec.abbr, spec.type, atk, def, mov, pos[0], pos[1], 0, org, org]);
    meta[id] = {
      nat: spec.nat || spec.anchor.nat || (spec.side === 'DE' ? 'DE' : 'US'),
      army: spec.type === 'HQT' ? '统帅部' : (spec.anchor.army || (spec.anchor.nat === 'UK' ? '英军第21集团军群' : (spec.side === 'US' ? '美军第12集团军群' : ''))),
      corps: spec.anchor.corps || '', div: '司令部', parent: '',
      raw: '司令部', src: '记载', srcRaw: '司令部建制裁定(24r)',
      from: '1944.12-16', to: '1945.01-25', firstWave: false, firstDay: false,
      orig: spec.name, note: '指挥部',
    };
    if (spec.side === 'DE') counts.DE++; else counts.US++;
  }

  /* ---------------- 生成 js/data_big_oob.js ---------------- */
  const L = [];
  L.push("'use strict';");
  L.push('/* ============================================================');
  L.push(' * data_big_oob.js — 《阿登 1944·大推演》营级 OOB（生成物）');
  L.push(' *');
  L.push(' * 本文件由 tools/oob_big/gen_data_big.js 自动生成，请勿手改；');
  L.push(' * 数据源：tools/oob_big/source/*.csv（阿登战役参战部队战斗序列·仅营级，');
  L.push(' * 德 449 / 美 644 / 英 99，共 1192 营）。');
  L.push(' *');
  L.push(' * 行格式与 data.js 的 OOB_* 完全一致：');
  L.push(' *   [id, 名称, 缩写, 类型, atk, def, mov, 列, 行, 入场回合(0=12.16), 初始组织度]');
  L.push(' *');
  L.push(' * 坐标系：新图 152×96（约 3km/格）。布防按**史实部署扇区**铺开：');
  L.push(' *   每个师/军一个矩形扇区，师内各营中心间距 ≥2 格，营与营之间留出机动间隙。');
  L.push(' *   前缘（德军进攻出发线）= Our/Sauer 河一线，约 c=78..104。');
  L.push(' * 英军并入 US 池（META.nat="UK"）；缩写上限 8 字。');
  L.push(' * ============================================================ */');
  /* ============================================================
   * 部署修正（2026-10-24c，用户授权：断补营按史实调回德军补给区域）
   * 3 个营原落位在 1944-12-16 美控区腹地（152→220 扇区映射遗留）：
   *   D013 第167炮III  [100,92]→[124,78]  萨尔河东岸 167VGD 史实正面（萨尔路易/迪林根补给）
   *   D005 第331掷I    [106,92]→[127,76]  同上
   *   D188 第501SS炮   [ 86,16]→[105,31]  党卫军1装甲军炮兵集结地（罗特根-蒙绍线以东，米林根补给）
   * ============================================================ */
  /* ============================================================
   * 入场格修正（2026-10-24f，原版33轮④移植）：11 行增援原入场格落在补给网外
   * （多为荒野留白区/货架扇区伪坐标，如 [123,50] 是山地格）。修法=“报到本师”：
   * 锚定同师已补给在图单位、就近网内空格（位移 1~5 格），由 qa/_entryfix 求解。
   * U117 第643坦克歼击营（R19，另一同名行）入场在网内，不在本表。
   * ============================================================ */
  const ENTRY_FIX = {
    D245: [120, 45],   // 党卫军第2装甲团·第II营 R2 ← 师 SS2炮I
    D268: [149, 49],   // 党卫军第9侦察营 R3 ← 师 SS20掷I
    U284: [44, 31],   // 第643坦克歼击营 R3 ← 师 32装1（3装CCB，史实配属）
    U286: [48, 28],   // 第486自动武器高射炮营 R3 ← 师 32装2
    U521: [46, 78],   // 第359步兵团·第1营 R5 ← 师 359步2（90师）
    U509: [64, 73],   // 第50装甲步兵营 R13 ← 师 9装步（6装）
    U511: [65, 73],   // 第68Tank营 R13 ← 师 9装步
    U512: [66, 73],   // 第69Tank营 R13 ← 师 9装步
    U517: [66, 74],   // 第777自动武器高射炮营 R13 ← 师 9装步
    U518: [63, 72],   // 第25装甲工兵营 R13 ← 师 9装步
  };
  {
    const occ = new Set();
    for (const side of ['DE', 'US']) for (const r of oob[side]) occ.add(r[7] + ',' + r[8]);
    for (const [id, pos] of Object.entries(ENTRY_FIX)) {
      const row = oob.DE.concat(oob.US).find(r => r[0] === id);
      if (!row) throw new Error('ENTRY_FIX: 未找到 ' + id);
      const key = pos[0] + ',' + pos[1];
      if (occ.has(key) && row[7] + ',' + row[8] !== key) throw new Error('ENTRY_FIX: 目标格被占 ' + key);
      occ.delete(row[7] + ',' + row[8]);
      occ.add(key);
      row[7] = pos[0];
      row[8] = pos[1];
    }
  }

  const DEPLOY_FIX = { D013: [124, 78], D005: [127, 76], D188: [105, 31] };
  {
    const occ = new Set();
    for (const side of ['DE', 'US']) for (const r of oob[side]) occ.add(r[7] + ',' + r[8]);
    for (const [id, pos] of Object.entries(DEPLOY_FIX)) {
      const row = oob.DE.find(r => r[0] === id);
      if (!row) throw new Error('DEPLOY_FIX: 未找到 ' + id);
      const key = pos[0] + ',' + pos[1];
      if (occ.has(key) && row[7] + ',' + row[8] !== key) throw new Error('DEPLOY_FIX: 目标格被占 ' + key);
      occ.delete(row[7] + ',' + row[8]);
      occ.add(key);
      row[7] = pos[0];
      row[8] = pos[1];
    }
  }
  L.push('(function () {');
  L.push('  const OOB_BIG_DE = [');
  for (const r of oob.DE) L.push('    ' + JSON.stringify(r) + ',');
  L.push('  ];');
  L.push('');
  L.push('  const OOB_BIG_US = [');
  for (const r of oob.US) L.push('    ' + JSON.stringify(r) + ',');
  L.push('  ];');
  L.push('');
  L.push('  // 回合日历：round0=1944-12-16 … round40=1945-01-25（1 天 = 1 回合）');
  L.push('  const DATES_BIG = (function () {');
  L.push('    const out = [];');
  L.push('    for (let i = 0; i <= 40; i++) {');
  L.push('      const d = new Date(Date.UTC(1944, 11, 16 + i));');
  L.push('      out.push(d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"));');
  L.push('    }');
  L.push('    return out;');
  L.push('  })();');
  L.push('');
  L.push('  const OOB_BIG_META = {');
  for (const [id, m] of Object.entries(meta)) L.push('    ' + JSON.stringify(id) + ': ' + JSON.stringify(m) + ',');
  L.push('  };');
  L.push('');
  L.push('  globalThis.DATA_BIG_OOB = { OOB_BIG_DE, OOB_BIG_US, OOB_BIG_META, DATES_BIG };');
  L.push('})();');
  fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');

  counts.total = counts.DE + counts.US + counts.UK;
  counts.abbrMax = Math.max(...[...usedAbbr.DE, ...usedAbbr.US].map(a => a.length));
  counts.uniqueCells = placer.occupancy();
  fs.writeFileSync(path.join(__dirname, 'gen_report.json'),
    JSON.stringify({ counts, warnings, report }, null, 2), 'utf8');
  console.log('生成完成 →', OUT);
  console.log('counts:', JSON.stringify(counts));
  console.log('间距退回(扇区过密):', report.spacingFallback, ' 扇区溢出:', report.sectorOverflow.length);
  for (const o of report.sectorOverflow) console.log('  ! ' + o);
  console.log('warnings:', warnings.length);
  for (const w of warnings.slice(0, 20)) console.log('  -', w);
}
main();
