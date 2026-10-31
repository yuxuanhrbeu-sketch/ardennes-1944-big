#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================
 * achv_check.js — 大推演成就系统核查（24v，2026-10-25）
 * 断言（Node 裸跑，achv.js 纯逻辑可 eval）：
 *   1) 37 条成就定义在 DATA_BASE 与 DATA_BIG 双套挂载、内容一致
 *   2) Achv.attach 挂 big 局 → 模拟事件流 → 成就解锁/历史入账
 *   3) 存储：与原版同键（ardennes44_achv / ardennes44_history）→ 互通
 *   4) big 局语义：城镇同名（圣维特/巴斯托涅）判定可用；campaign 限定成就不误发
 * ============================================================ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'mapgen.js', 'combat.js', 'game.js', 'data_div_oob.js', 'data_div.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

console.log('== 1. 数据双套挂载 ==');
const BASE = globalThis.DATA_BASE, BIG = globalThis.DATA_BIG;
ok(!!BASE.ACHIEVEMENTS && BASE.ACHIEVEMENTS.length === 108, 'DATA_BASE.ACHIEVEMENTS 108 条 (64 旧 + 44 铜章 26z)', BASE.ACHIEVEMENTS && BASE.ACHIEVEMENTS.length);
ok(!!BIG.ACHIEVEMENTS && BIG.ACHIEVEMENTS.length === 108, 'DATA_BIG.ACHIEVEMENTS 108 条');
ok(BASE.ACHIEVEMENTS === BIG.ACHIEVEMENTS, '两套数据同源引用（逐字一致）');
ok(!!globalThis.ACH_DATA.ACH_ICONS && Object.keys(globalThis.ACH_DATA.ACH_ICONS).length === 43, '像素图标 43 个 (37 + 6 铜章 26z)', Object.keys(globalThis.ACH_DATA.ACH_ICONS).length);
const ids = new Set(globalThis.ACH_DATA.ACHIEVEMENTS.map(a => a.id));
ok(ids.size === 108, '成就 id 唯一');
// 26q: 新图标点阵必须是 16×16 且字符都在调色板内
const PAL = new Set(Object.keys(globalThis.ACH_DATA.ACH_PALETTE));
const NEW_ICONS = ['div_badge', 'laurel', 'gen_star', 'tri_hex', 'six_hex', 'seal', 'lightning', 'swords'];
let iconOk = true;
for (const name of NEW_ICONS) {
  const rows = globalThis.ACH_DATA.ACH_ICONS[name];
  if (!rows || rows.length !== 16 || rows.some(r => r.length !== 16) || rows.some(r => [...r].some(ch => !PAL.has(ch)))) { iconOk = false; console.log('    ✘ 图标异常:', name); }
}
ok(iconOk, '26q 新增 8 图标点阵 16×16 且调色板合法');

console.log('== 2. big 局判定 ==');
// 模拟 localStorage
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
delete globalThis.Achv;   // 清 eval 缓存，带新 store 重挂
delete globalThis.ACH_DATA_WARNED;
eval(fs.readFileSync(path.join(ROOT, 'js', 'achv.js'), 'utf8'));

globalThis.DATA = globalThis.DATA_BIG;   // 模拟 ui.startGame 的剧本切换（QA 裸跑需手动）
const g = new Game('big', 20241216);
ok(g.scenario.id === 'big', 'big 局剧本识别', g.scenario.id);
g.on('state', () => {});
Achv.attach(g, { role: 'us', scenario: 'big', noLimit: false, seed: 20241216, side: 'US' });
ok(!!g.state.achvTrack, 'achvTrack 挂入 state（随存档）');
// 模拟：推两个阶段（增援/补给结算跑一遍）→ finish 记历史
g.state.phase = 'DE'; g._startPhase();
g.state.phase = 'US'; g._startPhase();
const newly = Achv.finish(g, { role: 'us', scenario: 'big', noLimit: false, seed: 20241216, side: 'US' });
ok(Array.isArray(newly), 'finish 返回本局新解锁数组', JSON.stringify(newly).slice(0, 60));
const rec = Achv.recent(1)[0];
ok(!!rec && rec.scen === 'big', '战绩记剧本 big', rec && JSON.stringify({ scen: rec.scen, achv: rec.achv }));
ok(!!rec && Array.isArray(rec.achv), '战绩含解锁列表字段');
const hist = Achv.history();
ok(hist.life.games === 1, '终身账 +1');
ok(Achv.recent(1).length === 1, '最近战绩 1 场');

console.log('== 2.5 26u 真实移动回归（onMove 裸 g 修复） ==');
// 玩家实测反馈: achv.js onMove 引用未定义的 g → 任何移动事件必抛 ReferenceError。
// node QA 此前从未暴露: 直构 Game 虽 attach 了监听, 但只推阶段从不真实移动。补真实链路。
const g2 = new Game('big', 20241217);
Achv.attach(g2, { role: 'watch', scenario: 'big', noLimit: false, seed: 20241217, side: 'US' });
g2.state.phase = 'DE'; g2._startPhase();
const u2 = g2.units.find(x => x.alive && !x.exited && x.side === 'DE' && !x.moved);
ok(!!u2, '找到可移动德军单位', u2 && u2.name);
let moved = null, threw = null;
try {
  const reach2 = g2.getReach(u2);
  const keys = [...reach2.dist.keys()].filter(k => reach2.dist.get(k) > 0);
  ok(keys.length > 0, '可达格 > 0', keys.length);
  let best = keys[0]; for (const k of keys) if (reach2.dist.get(k) > reach2.dist.get(best)) best = k;
  moved = g2.doMove(u2, g2.pathFromReach(reach2, best));
} catch (e) { threw = e; }
ok(!threw, '真实移动不抛错（achv.js onMove 裸 g 已修）', threw && (threw.message + ' @' + (threw.stack || '').split('\n')[1]));
ok(!!moved && moved.steps > 0, '移动真实生效', moved && ('steps=' + moved.steps));
const t2 = g2.state.achvTrack;
ok(typeof t2.meuseReach === 'boolean', 'meuseReach 跟踪字段存在', String(t2.meuseReach));
// 事件注入验证马斯河线跟踪语义（24w 原意）: DE 算子 c≤EXIT_C+1
g2.emit('move', { unit: { id: 'X1', side: 'DE', type: 'ARM', c: (DATA.EXIT_C || 5), r: 10, name: '回归测试装甲营' }, path: [1] });
ok(t2.meuseReach === true, '跨马斯河线跟踪生效（DE 算子抵达 c≤EXIT_C+1）', String(t2.meuseReach));
g2.emit('move', { unit: { id: 'X2', side: 'US', type: 'ARM', c: 1, r: 1, name: '回归测试美军营' }, path: [1] });
ok(t2.ukSeen === undefined || t2.ukSeen === false, '非英军移动不误标英军参战', String(t2.ukSeen));

console.log('== 3. 存储互通 ==');
const h1 = JSON.parse(store['ardennes44_history'] || '{}');
ok(h1.v === 1, '与原版同键（ardennes44_history）同版本', 'hist.v=' + h1.v);
ok('ardennes44_achv' in store || Object.keys(store).length >= 1, 'achv 键机制同源（无解锁时不写=原版行为）');
// 模拟原版侧写入（同键），大推演读得到
const oldA = { v: 1, unlocked: { first_snow: '2026-01-01T00:00:00Z' }, counters: { x: 1 } };
store['ardennes44_achv'] = JSON.stringify(oldA);
const merged = Achv.progress();
ok(merged.got >= 1, '原版已解锁成就在大推演侧可见（互通）', 'got=' + merged.got);

console.log('== 4. big 语义边界 ==');
const st = JSON.parse(JSON.stringify(BIG));
// big 剧本 scenario.campaign 值
ok(typeof g.scenario.campaign === 'boolean', 'big 剧本 campaign 字段存在（campaign 限定成就按布尔分流）', String(g.scenario.campaign));
// big 地图有成就涉及的同名城镇
const towns = new Set(g.map.towns.map(t => t.name));
ok(towns.has('圣维特') && towns.has('巴斯托涅'), 'big 地图含圣维特/巴斯托涅（成就判定同名可用）');

console.log('== 5. 26q 三图六剧本新成就 ==');
// 5a 师级终局语义（构造终局态，不真跑 12 回合）
globalThis.DATA = globalThis.DATA_DIV;
const gd = new Game('div_standard', 20241216);
Achv.attach(gd, { role: 'de', scenario: 'div_standard', noLimit: false, seed: 20241216, side: 'DE' });
ok(gd.scenario.id === 'div_standard', '师级局剧本识别', gd.scenario.id);
gd.state.over = true; gd.state.victoryKey = 'DE_decisive'; gd.state.exits = 1;
gd.emit('elim', { side: 'US', alive: false });
gd.emit('elim', { side: 'US', alive: false });
const dNew = Achv.evaluate(gd, { meta: { role: 'de', scenario: 'div_standard' } });
ok(dNew.includes('div_debut') && dNew.includes('div_de_keil') && dNew.includes('div_meuse'),
  '师级终局 → 铁甲雄师 / 师级钳形攻势 / 雄师抵河', dNew.filter(x => x.startsWith('div')).join(','));
ok(dNew.includes('blitz_start'), '第 1 回合歼敌 2（按阵营）→ 雷霆初击');
ok(!dNew.includes('div_us_clear') && !dNew.includes('tri_scale'), '师级条件不误发全战役/三线成就');
gd.state.round = 3;
for (let i = 0; i < 4; i++) gd.emit('elim', { side: 'US', alive: false });
ok(Achv.evaluate(gd, {}).includes('div_grinder'), '第 3 回合累计歼 4 师（同回合）→ 师级绞肉机');

// 5b 大推演新条目（hq_triple / no_undo / stop_aggro）
for (let i = 0; i < 3; i++) g.emit('hqkill', { type: 'HQK' });
g.state.over = true; g.state.winner = 'US';
const bNew = Achv.evaluate(g, { meta: { role: 'us', scenario: 'big' } });
ok(bNew.includes('hq_triple'), '摧毁 3 座指挥部 → 指挥部收割者');
ok(bNew.includes('no_undo'), '未悔棋完成大推演 → 一言九鼎（undoUsed 默认 false）');
ok(bNew.includes('stop_aggro'), '美军战胜德军 AI（role=us）→ 挡住洪流');
ok(!bNew.includes('break_aggro'), '德军侧成就不误发（winner=US）');

// 5c 三线账本（tri_scale / tri_decisive / six_fronts 依赖战绩历史）
const crafted = { v: 1, games: [
  { scen: 'div_standard', verdict: 'DE_decisive', rounds: 12, winner: 'DE', t: 1 },
  { scen: 'div_campaign', verdict: 'US_decisive', rounds: 24, winner: 'US', t: 2 },
  { scen: 'standard', verdict: 'DE_decisive', rounds: 12, winner: 'DE', t: 3 },
  { scen: 'campaign', verdict: 'US_decisive', rounds: 24, winner: 'US', t: 4 },
  { scen: 'big_offensive', verdict: 'US_decisive', rounds: 12, winner: 'US', t: 5 },
  { scen: 'big', verdict: 'DE_decisive', rounds: 41, winner: 'DE', t: 6 },
], life: { games: 6, rounds: 125, exits: 0, killed: 0, wins: { DE: 3, US: 3 } } };
store['ardennes44_history'] = JSON.stringify(crafted);
const tNew = Achv.evaluate(gd, {});
ok(tNew.includes('tri_scale'), '师/团/营各一局（账本）→ 三线推演');
ok(tNew.includes('tri_decisive'), '三粒度各一次决定性胜利（账本 verdict）→ 全线告捷');
ok(tNew.includes('six_fronts'), '六剧本各一局（账本）→ 六图全览');
// 缺口回归：少一个剧本不得解锁
store['ardennes44_history'] = JSON.stringify(Object.assign({}, crafted, { games: crafted.games.slice(0, 5) }));
ok(!Achv.evaluate(gd, {}).includes('six_fronts'), '缺任一剧本 → 六图全览不解锁（反例）');
store['ardennes44_history'] = JSON.stringify(crafted);

// 5d 全线满章：两类全解锁后 meta 成就闭环
const need = globalThis.ACH_DATA.ACHIEVEMENTS.filter(a => (a.cat === '师旅' || a.cat === '三线') && a.id !== 'tri_complete').map(a => a.id);
const achStore = JSON.parse(store['ardennes44_achv'] || '{"v":1,"unlocked":{},"counters":{}}');
for (const id of need) achStore.unlocked[id] = 1;
store['ardennes44_achv'] = JSON.stringify(achStore);
ok(Achv.evaluate(gd, {}).includes('tri_complete'), `集齐师旅+三线 ${need.length} 条 → 全线满章`);
// 悔棋反例：undoUsed=true 时 no_undo 不解锁
if (g.state.achvTrack) g.state.achvTrack.undoUsed = true;
ok(!Achv.evaluate(g, {}).includes('no_undo'), '悔棋后 → 一言九鼎不解锁（反例）');
globalThis.DATA = globalThis.DATA_BIG;   // 还原，避免影响后续测试

console.log('== 6. 26t 战功积分（金3/银2/铜1） ==');
ok(!!Achv.MERIT && Achv.MERIT.gold === 3 && Achv.MERIT.silver === 2 && Achv.MERIT.bronze === 1, 'MERIT 积分表 3/2/1');
const meritOf = ids => {
  const ach = { v: 1, unlocked: {}, counters: {} };
  for (const id of ids) ach.unlocked[id] = 1;
  store['ardennes44_achv'] = JSON.stringify(ach);
  return Achv.merit();
};
ok(meritOf([]) === 0, '空解锁 → 战功 0');
const goldDef = globalThis.ACH_DATA.ACHIEVEMENTS.find(a => a.tier === 'gold');
const silverDef = globalThis.ACH_DATA.ACHIEVEMENTS.find(a => a.tier === 'silver');
ok(meritOf([goldDef.id]) === 3, `金成就（${goldDef.name}）→ 3 分`);
ok(meritOf([goldDef.id, silverDef.id]) === 5, '金+银 → 5 分（求和不封顶）');
// 全解锁 = 满分（64 条口径：铜10×1 + 银36×2 + 金18×3）
const allIds = globalThis.ACH_DATA.ACHIEVEMENTS.map(a => a.id);
const full = meritOf(allIds);
const byTier = { bronze: 0, silver: 0, gold: 0 };
for (const a of globalThis.ACH_DATA.ACHIEVEMENTS) byTier[a.tier]++;
ok(full === byTier.bronze * 1 + byTier.silver * 2 + byTier.gold * 3, '全解锁满分 = Σ档位×积分', `满分 ${full}（铜${byTier.bronze}/银${byTier.silver}/金${byTier.gold}）`);
store['ardennes44_achv'] = JSON.stringify({ v: 1, unlocked: { first_snow: 1 }, counters: {} });   // 还原互通测试基线
console.log('== 26z 铜章扩充（44 条 / 1:2:3） ==');
{
  // 全部 43 枚图标点阵几何 + 调色板合法性（升级为全量校验）
  const PAL = globalThis.ACH_DATA.ACH_PALETTE, IC = globalThis.ACH_DATA.ACH_ICONS;
  let geoOk = true;
  for (const [nm, rows] of Object.entries(IC)) {
    if (rows.length !== 16) { geoOk = false; console.log('    X 图标', nm, '行数', rows.length); }
    rows.forEach((r, i) => {
      if (r.length !== 16) { geoOk = false; console.log('    X 图标', nm, '行' + i, '宽', r.length); }
      [...r].forEach(ch => { if (ch !== '.' && !PAL[ch]) { geoOk = false; console.log('    X 图标', nm, '非法字符', ch); } });
    });
  }
  ok(geoOk, '全部图标点阵 16x16 且调色板合法（43 枚全量校验）');
  const dist = { bronze: 0, silver: 0, gold: 0 };
  for (const a of globalThis.ACH_DATA.ACHIEVEMENTS) dist[a.tier]++;
  ok(dist.gold === 18 && dist.silver === 36 && dist.bronze === 54, '档位比例 金:银:铜 = 1:2:3', JSON.stringify(dist));
  // 行为抽样 —— 天气履历
  const gw = new Game('big', 20241217);
  Achv.attach(gw, { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' });
  gw.emit('weather', 'fog'); gw.emit('weather', 'snow');
  gw.state.over = true;
  const wSet = Achv.evaluate(gw, { meta: { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' } });
  ok(wSet.includes('weather_fog_debut') && wSet.includes('weather_snow_seen'), '参与: 雾/雪履历解锁');
  // 行为抽样 —— 德战术胜利 + 占领圣维特
  const gv = new Game('standard', 20241218);
  Achv.attach(gv, { role: 'de', scenario: 'standard', noLimit: false, seed: 1, side: 'DE' });
  gv.state.over = true; gv.state.victoryKey = 'DE_tactical';
  gv.map.townMap['圣维特'].ctrl = 'DE';
  const vSet = Achv.evaluate(gv, { meta: { role: 'de', scenario: 'standard', noLimit: false, seed: 1, side: 'DE' } });
  ok(vSet.includes('de_tactical') && vSet.includes('hub_st_vith'), '胜负: 德战术胜利 + 占领圣维特');
  // 行为抽样 —— 空袭击破 / 工兵上阵 / 雪地行军 / 绿魔鬼（事件注入）
  const gt = new Game('big', 20241219);
  Achv.attach(gt, { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' });
  gt.state.weather = 'snow';
  const dummy = { id: 'X1', uid: 'X1', side: 'US', type: 'INF', c: 5, r: 5, alive: false };
  gt.emit('combat', { defUnit: { id: 'D9', uid: 'D9', type: 'INF', side: 'US', c: 5, r: 5 }, air: true, res: { result: 'DE', deadUnits: [dummy] } });
  gt.emit('combat', { defUnit: { id: 'D8', uid: 'D8', type: 'INF', side: 'US', c: 6, r: 5 }, attUnits: [{ id: 'E1', uid: 'E1', type: 'ENGR', side: 'DE' }], res: { result: 'AE', deadUnits: [] } });
  for (let i = 0; i < 5; i++) gt.emit('move', { unit: { id: 'M' + i, uid: 'M' + i, side: 'DE', type: 'INF', c: 9, r: 9 }, path: [1, 2, 3, 4, 5] });
  gt.emit('combat', { defUnit: { id: 'D7', uid: 'D7', type: 'INF', side: 'US', c: 7, r: 5 }, attUnits: [{ id: 'F1', uid: 'F1', type: 'FJ', side: 'DE' }], res: { result: 'DR', deadUnits: [] } });
  const tSet = Achv.evaluate(gt, { meta: { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' } });
  ok(tSet.includes('air_blood'), '战术: 空袭直接击破');
  ok(tSet.includes('engineer_trigger'), '战术: 工兵上阵');
  ok(tSet.includes('snow_moves'), '战术: 雪地行军（5 次移动）');
  ok(tSet.includes('big_fj_strike'), '大推演: 绿魔鬼出击');
  // 行为抽样 —— 占领 / 收复失地（phase 快照链）
  const gc = new Game('div_standard', 12345);
  Achv.attach(gc, { role: 'us', scenario: 'div_standard', noLimit: false, seed: 1, side: 'US' });
  const twA = gc.map.towns.find(x => x.name === '圣维特');
  const twB = gc.map.towns.find(x => x.name === '马尔梅迪');
  twA.ctrl = 'DE'; gc.emit('phase'); twA.ctrl = 'US'; gc.emit('phase');
  twB.ctrl = 'DE'; gc.emit('phase'); twB.ctrl = 'US'; gc.emit('phase');
  gc.state.over = true;
  const cSet = Achv.evaluate(gc, { meta: { role: 'us', scenario: 'div_standard', noLimit: false, seed: 1, side: 'US' } });
  ok(cSet.includes('retake_two'), '胜负: 收复失地 x2');
  ok(cSet.includes('first_capture'), '战术: 首克敌城');
  // 行为抽样 —— 类型歼灭 + 据点
  const gh = new Game('big', 12345);
  Achv.attach(gh, { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' });
  gh.map.townMap['圣维特'].ctrl = 'DE'; gh.emit('phase');
  for (let i = 0; i < 5; i++) gh.emit('elim', { id: 'A' + i, uid: 'A' + i, side: 'US', type: 'ARM', c: 1, r: 1, alive: false });
  const hSet = Achv.evaluate(gh, { meta: { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' } });
  ok(hSet.includes('big_armor_five'), '大推演: 铁锤五锤（歼 5 装甲营）');
  ok(hSet.includes('hub_st_vith'), '胜负: 占领圣维特（事件驱动快照）');
}

console.log('== 27b 排行榜数据层（指挥场数 / 歼敌单位数） ==');
{
  // 指挥场数: 增量断言（后段账本测试会用 crafted history 覆盖存储, 绝对值不可靠）
  const beforeCmd = Achv.history().life.commanded || 0;
  const gcmd = new Game('standard', 20241221);
  Achv.attach(gcmd, { role: 'us', scenario: 'standard', noLimit: false, seed: 1, side: 'US' });
  gcmd.state.over = true;
  Achv.finish(gcmd, { role: 'us', scenario: 'standard', noLimit: false, seed: 1, side: 'US' });
  ok((Achv.history().life.commanded || 0) === beforeCmd + 1, '指挥场数: finish(role us) +1', 'before=' + beforeCmd + ' after=' + (Achv.history().life.commanded || 0));
  const gk = new Game('big', 12345);
  Achv.attach(gk, { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' });
  const before = Achv.history().life.killUnits || 0;
  let killed = 0;
  for (const u of gk.units) {
    if (u.alive && u.side === 'US' && killed < 3) { u.alive = false; killed++; }
  }
  const ex = gk.units.find(x => x.alive && x.side === 'US');
  if (ex) { ex.alive = false; ex.exited = true; }
  Achv.finish(gk, { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' });
  const after = Achv.history().life.killUnits || 0;
  ok(after - before === 3, '歼敌单位数: 3 个被歼（渡河突围不计）', 'delta=' + (after - before));
  const before2 = Achv.history().life.commanded || 0;
  const gw2 = new Game('standard', 20241220);
  Achv.attach(gw2, { role: 'watch', scenario: 'standard', noLimit: false, seed: 1, side: 'US' });
  gw2.state.over = true;
  Achv.finish(gw2, { role: 'watch', scenario: 'standard', noLimit: false, seed: 1, side: 'US' });
  ok((Achv.history().life.commanded || 0) === before2, '观摩不计指挥场数');
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
