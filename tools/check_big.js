#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * check_big.js — 大推演开局校验（Phase 1，Node 裸跑引擎）
 *
 * 性质与 test/check.js 相同：构造开局、断言静态与开局性质，
 * 不运行任何 AI 回合/推演（工程纪律 2026-10-08）。
 * 验证：DATA 运行时切换、76×48 地图生成、576 营开局、
 *       无同格冲突、补给覆盖率、城镇/桥梁规模、旧剧本回归。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ✔ ' + msg + (detail ? ' — ' + detail : '')); }
  else { fail++; fails.push(msg); console.log('  ✘ ' + msg + (detail ? ' — ' + detail : '')); }
}

console.log('== 1. 数据切换 ==');
ok(!!globalThis.DATA_BASE && !!globalThis.DATA_BIG, 'DATA_BASE / DATA_BIG 已挂载');
ok(globalThis.DATA === globalThis.DATA_BASE, '当前 DATA 仍指向旧版(未误切)');
const BT = globalThis.DATA_BIG;
ok(BT.COLS === 220 && BT.ROWS === 96, '大推演地图 220×96');
ok(BT.OOB_DE.length === 463 && BT.OOB_US.length === 754, '大 OOB 德 463 / 盟 754（含指挥部）');
ok(globalThis.DATA_BASE.OOB_DE.length === 99, '旧版 OOB 未被改动(99 行)');

console.log('== 2. 旧剧本回归 ==');
{
  const g = new Game('standard', 20241216);
  ok(g.map.cols === 52 && g.map.rows === 32, 'standard 地图仍为 52×32');
  ok(g.units.length === 122, 'standard 开局仍 122 算子 (实际 ' + g.units.length + ')');
  ok(g.map.towns.length === 25, 'standard 城镇仍 25 座');
  ok(g.map.bridges.size === 40, 'standard 桥梁仍 40 座 (实际 ' + g.map.bridges.size + ')');
}

console.log('== 3. 大推演开局 ==');
globalThis.DATA = globalThis.DATA_BIG;   // 与 ui.startGame 同款切换
{
  const g = new Game('big', 20241216);
  ok(g.scenario.id === 'big', '剧本 big 已装配');
  ok(g.map.cols === 220 && g.map.rows === 96, '地图 220×96 已生成');
  ok(g.map.towns.length >= 52, '城镇 ≥52 座（全部史实城镇，无自造名）(实际 ' + g.map.towns.length + ')');
  // 补给城镇必须全部有成本预算（等级制：集团军级 52 / 军级 34 / 师级 22）
  {
    const supT = g.map.towns.filter(t => t.supply);
    ok(supT.every(t => typeof t.range === 'number' && t.range > 0),
      '每座补给城镇都带成本预算 range (实际 ' + supT.filter(t => t.range > 0).length + '/' + supT.length + ')');
    const tiers = {};
    for (const t of supT) tiers[t.tier] = (tiers[t.tier] || 0) + 1;
    ok(tiers[3] > 0 && tiers[2] > 0 && tiers[1] > 0,
      '补给城镇分三级 (集团军级 ' + (tiers[3] || 0) + ' / 军级 ' + (tiers[2] || 0) + ' / 师级 ' + (tiers[1] || 0) + ')');
  }
  ok(g.map.bridges.size >= 40, '桥梁自动检测 ≥40 座 (实际 ' + g.map.bridges.size + ')');
  const open = g.units.filter(u => u.alive && !u.arrive);
  ok(g.units.length === 605, '开局 605 = 580 营 + 25 指挥部 = 德 404 + 盟 201 (实际 ' + g.units.length + ')');
  ok(open.filter(u => u.side === 'DE').length === 404, '德军开局 404 = 390 营 + 14 指挥部');
  ok(open.filter(u => u.side === 'US').length === 201, '盟军开局 201 = 190 营 + 11 指挥部');
  // 同格冲突
  const occ = new Set();
  let dup = 0;
  for (const u of open) { const k = u.c + ',' + u.r; if (occ.has(k)) dup++; occ.add(k); }
  ok(dup === 0, '开局无同格冲突 (冲突 ' + dup + ')');
  // 边界
  const inB = g.units.every(u => u.c >= 0 && u.c < 220 && u.r >= 0 && u.r < 96);
  ok(inB, '全部算子在图内');
  // 阵营不越界: 德军开局不得越过马斯河一线(EXIT_C=5), 盟军不得进入德军纵深(c>105)
  ok(open.filter(u => u.side === 'DE' && u.c <= 5).length === 0, '德军开局无越马斯河一线者');
  ok(open.filter(u => u.side === 'US' && u.c > 105).length === 0, '盟军开局无越艾费尔纵深者(c>105)');
  // 算子间距: 新图布防的核心目标 —— 算子之间不得贴死（同阵营相邻对数应远小于算子数）
  {
    let adj = 0, total = 0;
    for (const u of open) {
      total++;
      for (const p of Hex.neighbors(u.c, u.r)) {
        const o = g.unitAt(p.c, p.r);
        if (o && o.side === u.side && o.uid > u.uid) adj++;
      }
    }
    ok(adj / total < 1.6, '同阵营相邻对数/算子数 <1.6 (实际 ' + (adj / total).toFixed(2) + ')');
  }
  // 补给覆盖
  const sup = { DE: [0, 0], US: [0, 0] };
  for (const u of open) { sup[u.side][0] += u.supplied ? 1 : 0; sup[u.side][1]++; }
  const dePct = Math.round(100 * sup.DE[0] / sup.DE[1]);
  const usPct = Math.round(100 * sup.US[0] / sup.US[1]);
  ok(dePct >= 85, '德军开局补给覆盖 ≥85% (实际 ' + dePct + '%)');
  ok(usPct >= 85, '盟军开局补给覆盖 ≥85% (实际 ' + usPct + '%)');
  const usUnsup = sup.US[1] - sup.US[0];
  ok(usUnsup <= 15, '盟军开局断补 ≤15 营 (实际 ' + usUnsup + ')');
  // 日历
  ok(g._dateStr().indexOf('12月16日') >= 0 || DATA.DATES[0] === '1944-12-16', '第1回合 = 1944-12-16 (实际 ' + DATA.DATES[0] + ')');
  ok(DATA.DATES[16] === '1945-01-01', '底板行动回合 = 第17回合(1945-01-01)');
  // 增援在册
  ok(DATA.OOB_DE.filter(r => r[9] > 0).length + DATA.OOB_US.filter(r => r[9] > 0).length === 612,
    '增援在册 612 营 (实际 ' + (DATA.OOB_DE.filter(r => r[9] > 0).length + DATA.OOB_US.filter(r => r[9] > 0).length) + ')');
  // 英军已并入盟军池且带 META
  const ukIn = g.units.filter(u => u.side === 'US' && DATA.OOB_BIG_META[u.id] && DATA.OOB_BIG_META[u.id].nat === 'UK').length;
  ok(ukIn === 2, '开局英军 = 2 座指挥部(21集团军群/30军部; 营 12.20 起入场) (实际 ' + ukIn + ')');
  ok(DATA.OOB_BIG_META && Object.keys(DATA.OOB_BIG_META).length === 1217, 'META 归属链 1217 条在册');
}


/* ============================================================
 * 组织度大平衡断言（2026-10-24i）：开局全员满编 + 分层区间
 * ============================================================ */
{
  const gO = new Game('big', 20241216);
  const openO = gO.units.filter(u => u.alive && !u.arrive);
  ok(openO.every(u => u.org === u.maxOrg), '开局全员满组织度 (org===maxOrg, ' + openO.filter(u => u.org === u.maxOrg).length + '/' + openO.length + ')');
  ok(openO.every(u => u.maxOrg >= 8 && u.maxOrg <= 20), '组织度区间 [8,20] (实际 [' + Math.min(...openO.map(u => u.maxOrg)) + '..' + Math.max(...openO.map(u => u.maxOrg)) + '])');
}

/* ============================================================
 * 移动规则断言（2026-10-24f，原版31/33轮移植的回归防护）
 * ============================================================ */
{
  /* ① 友军借道: 后方找一条 空-空 直线两格, 把友军塞进第一格 →
     可达域应含第二格(穿过)、不含第一格(不能停在友军身上) */
  const g2 = new Game('big', 20241216);
  const arm = g2.units.find(u => u.side === 'DE' && u.type === 'ARM' && u.c > 150 && !u.moved);
  const mate = g2.units.find(u => u.side === 'DE' && u !== arm && u.type === 'ARM' && u.c > 150);
  let borrowOK = null, why = '未找到几何';
  if (arm && mate) {
    for (const n1 of Hex.neighbors(arm.c, arm.r)) {
      if (g2.unitAt(n1.c, n1.r) || !g2.map.hexes.has(Hex.key(n1.c, n1.r))) continue;
      const t = g2.map.hexes.get(Hex.key(n1.c, n1.r));
      if (t.terrain === 'mountain' || t.terrain === 'marsh') continue;
      for (const n2 of Hex.neighbors(n1.c, n1.r)) {
        if (n2.c === arm.c && n2.r === arm.r) continue;
        if (g2.unitAt(n2.c, n2.r) || !g2.map.hexes.has(Hex.key(n2.c, n2.r))) continue;
        g2._setPos(mate, n1.c, n1.r);
        const reach = g2.getReach(arm);
        const k1 = Hex.key(n1.c, n1.r), k2 = Hex.key(n2.c, n2.r);
        borrowOK = !reach.dist.has(k1) && reach.dist.has(k2);
        why = 'mate@' + k1 + ' → ' + k2 + (borrowOK ? ' ✓' : ' ✗');
        break;
      }
      if (borrowOK !== null) break;
    }
  }
  ok(borrowOK === true, '友军借道: 穿过友军格可达、不可停留 (' + why + ')');

  /* ② ZOC 起点守卫: 贴敌的非装甲单位可达域 > 0 (不再被钉死) */
  const g3 = new Game('big', 20241216);
  const pinned = g3.units.find(u => {
    if (u.moved || DATA.TYPES[u.type].armor) return false;
    return Hex.neighbors(u.c, u.r).some(n => { const e = g3.unitAt(n.c, n.r); return e && e.side !== u.side; });
  });
  ok(!!pinned && g3.getReach(pinned).dist.size > 0, 'ZOC 起点守卫: 贴敌非装甲单位可达域 > 0' + (pinned ? ' (样本 ' + pinned.abbr + ')' : ' (未找到贴敌样本)'));
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail > 0) { console.log(fails.map(s => '✘ ' + s).join('\n')); process.exit(1); }
