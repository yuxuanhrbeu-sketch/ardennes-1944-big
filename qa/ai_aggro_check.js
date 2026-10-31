'use strict';
/* 26m 验证：进攻型 AI 的动作覆盖率与推进效果 */
global.window = global;
const fs = require('fs');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'div', 'mapgen.js', 'combat.js', 'game.js', 'ai.js']) {
  const p = f === 'div' ? 'data_div_oob.js' : f === 'div2' ? 'data_div.js' : f;
  if (p === 'data_div_oob.js') { eval(fs.readFileSync('D:/ardennes-big/js/data_div_oob.js', 'utf8')); eval(fs.readFileSync('D:/ardennes-big/js/data_div.js', 'utf8')); continue; }
  eval(fs.readFileSync('D:/ardennes-big/js/' + p, 'utf8'));
}
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✔ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

function audit(scen, rounds) {
  globalThis.DATA = scen === 'div_standard' ? globalThis.DATA_DIV : globalThis.DATA_BIG;
  const g = new Game(scen, 12345);
  const log = [];
  for (let rd = 0; rd < rounds; rd++) {
    for (const side of ['DE', 'US']) {
      if (g.state.over) break;
      g.state.phase = side;
      const combatants = g.units.filter(u => u.alive && !u.exited && u.side === side && u.type !== 'HQ');
      const artillery = combatants.filter(u => u.type === 'ART' || u.type === 'RKT');
      const ground = combatants.filter(u => u.type !== 'ART' && u.type !== 'RKT');
      const acts = AI.planTurn(g, side);
      const acted = new Set();
      let atk = 0, mv = 0, arty = 0;
      for (const a of acts) {
        if (a.t === 'attack') { atk++; for (const id of a.uids) acted.add(id); for (const id of (a.arty || [])) acted.add(id); }
        else if (a.t === 'move') { mv++; acted.add(a.uid); }
        else if (a.t === 'arty') { arty++; acted.add(a.uid); }
      }
      // 执行（推进局面，供下一回合统计）
      for (const a of acts) {
        if (a.t === 'attack') {
          const def = g.units.find(x => x.uid === a.target);
          const arr = a.uids.map(id => g.units.find(x => x.uid === id)).filter(Boolean);
          if (def && def.alive && arr.length) { try { g.doAttack(arr, def, (a.arty || []).map(id => g.units.find(x => x.uid === id)).filter(Boolean)); } catch (e) {} }
        } else if (a.t === 'move') {
          const u = g.units.find(x => x.uid === a.uid);
          if (u && u.alive) { try { g.doMove(u, a.path); } catch (e) {} }
        } else if (a.t === 'arty') {
          const u = g.units.find(x => x.uid === a.uid), t = g.units.find(x => x.uid === a.target);
          if (u && t && t.alive) { try { g.artyFire(u, t); } catch (e) {} }
        }
      }
      const groundActed = ground.filter(u => acted.has(u.uid)).length;
      const artyActed = artillery.filter(u => acted.has(u.uid)).length;
      log.push({ rd, side, ground: ground.length, groundActed, artillery: artillery.length, artyActed, atk, mv });
      g._startPhase ? null : null;
    }
    g.state.round++;
    for (const s2 of ['DE', 'US']) { g.state.phase = s2; try { g._startPhase(); } catch (e) {} }
    if (g.state.over) break;
  }
  return log;
}

console.log('== 师级（div_standard）3 回合动作覆盖 ==');
{
  const log = audit('div_standard', 3);
  for (const L of log) {
    const rate = L.ground ? (L.groundActed / L.ground * 100).toFixed(0) : '—';
    console.log(`  R${L.rd} ${L.side}: 地面 ${L.groundActed}/${L.ground} (${rate}%) · 炮兵 ${L.artyActed}/${L.artillery} · 攻击 ${L.atk} · 移动 ${L.mv}`);
  }
  const groundRate = log.filter(l => l.ground > 0).map(l => l.groundActed / l.ground);
  const avg = groundRate.reduce((a, b) => a + b, 0) / groundRate.length;
  ok(avg >= 0.9, '地面单位动作覆盖率 ≥ 90%', (avg * 100).toFixed(0) + '%');
  ok(log.reduce((a, l) => a + l.atk, 0) > 0, 'AI 主动发起攻击', log.reduce((a, l) => a + l.atk, 0) + ' 次');
}

console.log('== 营级（big）2 回合动作覆盖 ==');
{
  const log = audit('big', 2);
  for (const L of log) {
    const rate = L.ground ? (L.groundActed / L.ground * 100).toFixed(0) : '—';
    console.log(`  R${L.rd} ${L.side}: 地面 ${L.groundActed}/${L.ground} (${rate}%) · 炮兵 ${L.artyActed}/${L.artillery} · 攻击 ${L.atk} · 移动 ${L.mv}`);
  }
  const groundRate = log.filter(l => l.ground > 0).map(l => l.groundActed / l.ground);
  if (groundRate.length) {
    const avg = groundRate.reduce((a, b) => a + b, 0) / groundRate.length;
    ok(avg >= 0.85, '营级地面单位动作覆盖率 ≥ 85%', (avg * 100).toFixed(0) + '%');
  }
}

console.log('== 26w 新行为断言 ==');
/* 中局状态构造: 真实推进 N 回合(执行含动态补刀的完整 executeTurn 同款动作)。
   R1 双方尚未接战(大图德美仅 1 个邻接对), 攻击/空袭/去重断言必须在中局做。 */
function midGame26w(scen, seed, rounds) {
  globalThis.DATA = scen === 'div_standard' ? globalThis.DATA_DIV : globalThis.DATA_BIG;
  const g = new Game(scen, seed);
  for (let rd = 0; rd < rounds; rd++) {
    for (const side of ['DE', 'US']) {
      if (g.state.over) break;
      g.state.phase = side;
      try { g._startPhase(); } catch (e) {}
      const acts = AI.planTurn(g, side);
      for (const a of acts) {
        try {
          if (a.t === 'attack') {
            const def = g.units.find(x => x.uid === a.target && x.alive);
            const arr = a.uids.map(id => g.units.find(x => x.uid === id)).filter(u => u && u.alive);
            const arty = (a.arty || []).map(id => g.units.find(x => x.uid === id)).filter(Boolean);
            if (def && arr.length) g.doAttack(arr, def, arty);
          } else if (a.t === 'move') {
            const u = g.units.find(x => x.uid === a.uid);
            if (u && u.alive) g.doMove(u, a.path);
          } else if (a.t === 'arty') {
            const u = g.units.find(x => x.uid === a.uid), t = g.units.find(x => x.uid === a.target);
            if (u && t && t.alive) g.artyFire(u, t);
          } else if (a.t === 'air') {
            const t = g.units.find(x => x.uid === a.target && x.alive);
            if (t) g.airStrike(t, side);
          }
        } catch (e) {}
      }
    }
    g.state.round++;
    for (const s2 of ['DE', 'US']) { g.state.phase = s2; try { g._startPhase(); } catch (e) {} }
    if (g.state.over) break;
  }
  return g;
}
{
  const g = midGame26w('big_offensive', 12345, 2);
  g.state.phase = 'DE';
  try { g._startPhase(); } catch (e) {}
  // (1) 执行序重排: 空袭 → 炮兵 → 突击 → 机动（稳定排序, 类型内顺序不变）
  const acts = AI.planTurn(g, 'DE');
  const hist = {};
  for (const a of acts) hist[a.t] = (hist[a.t] || 0) + 1;
  const ord = t => t === 'air' ? 0 : t === 'arty' ? 1 : t === 'attack' ? 2 : 3;
  let sorted = true;
  for (let i = 1; i < acts.length; i++) if (ord(acts[i].t) < ord(acts[i - 1].t)) { sorted = false; break; }
  ok(sorted, '执行序重排: 空袭→炮兵→突击→机动', JSON.stringify(hist));
  // (2) 空袭联动: 空袭目标应落在已排定的突击目标里（有空袭且突击非空时）
  const airT = acts.filter(a => a.t === 'air').map(a => a.target);
  const atkT = new Set(acts.filter(a => a.t === 'attack').map(a => a.target));
  ok(airT.length === 0 || atkT.size === 0 || airT.some(x => atkT.has(x)),
    '空袭联动: 空袭目标与突击目标重合', `air=${airT.length} atk目标=${atkT.size}`);
  // (3) 目标去重: 单个敌军同回合被收拢数 ≤3（convergeMaxSeen 为 planTurn 内峰值记账）
  ok(AI.__test.convergeMax() <= 6, '目标去重: 单敌同回合收敛数 ≤6（27h 按档位放开, 原 3）', 'max=' + AI.__test.convergeMax());
  // (3b) 主攻方向: 中局应选出 1-2 条主攻轴, 且都是"未被本方控制的任务要点"
  //      （必须在此处读——后面的多中局扫描会用其他对局覆盖模块级 schwerpunkt）
  {
    const sp = AI.__test.schwerpunktNow();
    ok(sp.length >= 1 && sp.length <= 2, '主攻方向已选出（1-2 条轴）', JSON.stringify(sp));
    ok(sp.every(n => { const t = g.map.townMap[n]; return t && t.ctrl !== 'DE'; }), '主攻轴均为未控制的任务要点');
    // 主攻轴门槛放宽差分: relaxed 放行而正常门槛拒绝（ratio∈[0.3,0.6) 样本）
    let difFound = 0, difOk = 0;
    for (const e of g.units) {
      if (!e.alive || e.exited || e.side !== 'DE') continue;
      if (!AI.__test.nearSchwerpunkt(g, 'DE', e)) continue;
      const grp = AI.__test.attackGroup(g, e, new Set(), undefined);
      if (!grp || !grp.pv.key || grp.pv.ratio === undefined) continue;
      if (grp.pv.ratio >= 0.3 && grp.pv.ratio < 0.6) {
        difFound++;
        if (AI.__test.attackGate(g, grp, e, false, true) && !AI.__test.attackGate(g, grp, e, false, false)) difOk++;
      }
    }
    ok(difFound === 0 || difOk === difFound, '主攻轴门槛放宽差分成立', `${difOk}/${difFound} 样本`);
  }
  // (4) 门槛统一: 多个中局里扫真实接战样本, ratio∈[0.6,1.2) 的目标 attackGate 应放行——
  //     26w 前补刀门槛是旧 1.2, 会拒打(玩家反馈"贴了不打"); 同步 AGGRO 后必须放行。
  let gateFound = 0, gatePass = 0;
  for (const [sd, rds] of [[12345, 2], [19441216, 2], [20241216, 3]]) {
    const gm = sd === 12345 ? g : midGame26w('big_offensive', sd, rds);
    for (const e of gm.units) {
      if (!e.alive || e.exited) continue;
      const atkSide = e.side === 'DE' ? 'US' : 'DE';
      globalThis.DATA = globalThis.DATA_BIG;   // midGame26w 已设, 保险
      const grp = AI.__test.attackGroup(gm, e, new Set(), undefined);
      if (!grp || !grp.pv.key || grp.pv.ratio === undefined) continue;
      void atkSide;
      if (grp.pv.ratio >= 0.6 && grp.pv.ratio < 1.2) {
        gateFound++;
        if (AI.__test.attackGate(gm, grp, e, false)) gatePass++;
      }
    }
  }
  ok(gateFound === 0 || gatePass === gateFound,
    '补刀门槛与主攻统一: ratio∈[0.6,1.2) 放行', `${gatePass}/${gateFound} 样本`);
  // (5) 守备巩固: 美军要点守军(圣维特/巴斯托涅一线)走"留守"口径
  let garSample = 0, garHold = 0;
  for (const u of g.units) {
    if (!u.alive || u.exited || u.side !== 'US' || u.type === 'HQ') continue;
    if (AI.__test.garrisonStays(g, u)) { garSample++; if (contact26w(g, u)) garHold++; }
  }
  function contact26w(g, u) {
    for (const n of Hex.neighbors(u.c, u.r)) { const e = g.unitAt(n.c, n.r); if (e && e.side !== u.side) return true; }
    return false;
  }
  ok(garSample > 0, '存在走"守备留守"口径的要点守军', garSample + ' 个（其中受威胁 ' + garHold + '）');
  // (6) 留守口径纯逻辑: 后方(敌远于10格)要点守军不留守、随 26m 强制前进
  let rearPosted = 0, rearMove = 0;
  for (const u of g.units) {
    if (!u.alive || u.exited || u.side !== 'US' || u.type === 'HQ') continue;
    const h = g.hexAt(u.c, u.r);
    if (!h.town || h.town.ctrl !== 'US') continue;
    let dmin = 1e9;
    for (const e of g.units) if (e.alive && e.side === 'DE') dmin = Math.min(dmin, Hex.distance(u.c, u.r, e.c, e.r));
    if (dmin > 10) { rearPosted++; if (!AI.__test.garrisonStays(g, u)) rearMove++; }
  }
  ok(rearPosted === 0 || rearMove === rearPosted, '后方要点守军不留守（随 26m 强制前进）', `${rearMove}/${rearPosted}`);

  /* == 26x 棋力层/节奏层 == */
  // (9) 指挥部安全移动: HQ 的 move 动作只允许发生在"敌距该 HQ > 6"时（跟进保守性）
  let hqMoves = 0, hqSafe = 0;
  for (const a of acts.filter(x => x.t === 'move')) {
    const u = g.units.find(x => x.uid === a.uid);
    if (!u || !(DATA.TYPES[u.type] && DATA.TYPES[u.type].hq)) continue;
    hqMoves++;
    let dmin = 1e9;
    for (const e of g.units) if (e.alive && e.side !== u.side) dmin = Math.min(dmin, Hex.distance(u.c, u.r, e.c, e.r));
    if (dmin > 6) hqSafe++;
  }
  ok(hqMoves === 0 || hqSafe === hqMoves, '指挥部仅在敌距>6时移动（跟进保守性）', `${hqSafe}/${hqMoves}`);
  // (10) 中局炮兵开火存在（ART 相邻直射 / RKT 直射规则生效后仍正常）
  ok(acts.filter(a => a.t === 'arty').length > 0 || acts.filter(a => a.t === 'attack').length === 0,
    '中局炮兵有开火计划', acts.filter(a => a.t === 'arty').length + ' 门');
  // (11) 后期波段(planTurn @R9)不抛错——germanTarget/pickSchwerpunkt 的马斯河边缘镇
  //      邻格 hexAt 会返回 null（26x 实测踩坑: 读 h.town 未判空 → 自愈吞异常 → AI 晚期半瘫）
  globalThis.DATA = globalThis.DATA_BIG;
  const g9 = new Game('big', 12345);
  g9.state.round = 9; g9.state.phase = 'DE';
  let lateErr = null;
  try { AI.planTurn(g9, 'DE'); } catch (e) { lateErr = e; }
  ok(!lateErr, '后期波段(R9)计划不抛错（马斯河边缘镇邻格判空）', lateErr && lateErr.message);

  /* == 26y 残局僵持回归 == */
  // (12) usDefenseLine 不得抛错（26x 踩坑: const s 却被 += 桥梁加成 → TypeError,
  //      整阶段 planTurn 崩掉, 美军残局整阶段停摆 —— 玩家反馈"60 vs 130 僵持无法结束"的真凶）
  const gd = new Game('big', 20241216);
  const usAll = gd.units.filter(u => u.alive && u.side === 'US');
  let dlErr = null, dlNonEmpty = 0;
  try {
    for (const u of usAll.slice(0, 40)) { const r = AI.__test.usDefenseLine(gd, u); if (r) dlNonEmpty++; }
  } catch (e) { dlErr = e; }
  ok(!dlErr, 'usDefenseLine 不抛错（const 赋值回归）', dlErr && dlErr.message);
  // (13) 歼灭模式(noTurnLimit)全军猎杀: 3 回合后"各部队到最近敌军的平均距离"下降
  const distToFoe = (gg, u) => {
    let bd = 1e9;
    for (const e of gg.units) if (e.alive && !e.exited && e.side !== u.side) bd = Math.min(bd, Hex.distance(u.c, u.r, e.c, e.r));
    return bd;
  };
  const sumDist = gg => {
    let s = 0, n = 0;
    for (const u of gg.units) { if (!u.alive || u.exited) continue; s += distToFoe(gg, u); n++; }
    return s / Math.max(n, 1);
  };
  const ga = new Game('big_offensive', 12345);
  ga.noTurnLimit = true; ga.state.noTurnLimit = true;
  const d0 = sumDist(ga);
  for (let r = 0; r < 3 && !ga.state.over; r++) {
    for (const side of ['DE', 'US']) { if (ga.state.over) break; ga.state.phase = side; AI.executeTurn(ga, side, fn => fn(), () => {}); }
  }
  const d1 = sumDist(ga);
  ok(d1 < d0, '歼灭模式猎杀: 平均接敌距离下降', d0.toFixed(1) + ' → ' + d1.toFixed(1));
  // (14) 僵持保险丝: 双方零交战连续 ≥10 回合 → 按剩余建制判胜者并终局（歼灭模式专属）
  //      注: 每次 endPhase 只推进一个阶段; 增援入场(R1~R12)会改变签名字段, 故需跑足够多阶段
  const gs = new Game('div_standard', 12345);
  gs.noTurnLimit = true; gs.state.noTurnLimit = true;
  for (let i = 0; i < 90 && !gs.state.over; i++) gs.endPhase();
  ok(gs.state.over && /僵持/.test(gs.state.endText || ''), '僵持保险丝: 零战果连续回合后按剩余建制终局',
    gs.state.endText ? gs.state.endText.slice(0, 30) : '(未触发 @R' + gs.state.round + ')');
  // (15) 正常模式(有回合上限)不得触发保险丝
  const gn = new Game('standard', 12345);
  gn.noTurnLimit = false; gn.state.noTurnLimit = false;
  for (let i = 0; i < 8; i++) { if (gn.state.over) break; gn.endPhase(); }
  ok(!gn.state.over || !/僵持/.test(gn.state.endText || ''), '正常模式不触发僵持保险丝');
}

console.log('== 27d 总攻机制（finalPush） ==');
{
  // finalPush 判定: 剩余回合 ≤2 触发
  const gf = new Game('standard', 12345);
  gf.state.round = 11;   // 12 回合制, 剩 1
  ok(AI.__test.finalPushOf(gf) === true, '总攻判定: 剩余回合 ≤2 触发', 'R' + gf.state.round);
  gf.state.round = 5;
  ok(AI.__test.finalPushOf(gf) === false, '总攻判定: 中期不触发', 'R' + gf.state.round);
  // 总攻阶段: 无接触的要点守军也加入进攻（留守判定收紧, ned≤10 条款停用）
  const gp = new Game('standard', 12345);
  gp.state.round = 11; gp.state.phase = 'US';
  let rearTotal = 0, rearHold = 0;
  for (const u of gp.units) {
    if (!u.alive || u.exited || u.side !== 'US' || u.type === 'HQ') continue;
    const h = gp.hexAt(u.c, u.r);
    if (!h.town || h.town.ctrl !== 'US') continue;
    let dmin = 1e9;
    for (const e of gp.units) if (e.alive && e.side === 'DE') dmin = Math.min(dmin, Hex.distance(u.c, u.r, e.c, e.r));
    if (dmin > 6) { rearTotal++; if (!AI.__test.garrisonStays(gp, u)) rearHold++; }
  }
  ok(rearTotal === 0 || rearHold === rearTotal, '总攻阶段: 无接触守军不留守（ned≤10 条款停用）', rearHold + '/' + rearTotal);
  // 攻击门槛: 总攻期 finalPush 全局生效（ratio∈[0.3,0.6) 样本不传 relaxed 也应放行）
  let gFound = 0, gPass = 0;
  for (const e of gp.units) {
    if (!e.alive || e.exited || e.side !== 'US') continue;
    const grp = AI.__test.attackGroup(gp, e, new Set(), undefined);
    if (!grp || !grp.pv.key || grp.pv.ratio === undefined) continue;
    if (grp.pv.ratio >= 0.3 && grp.pv.ratio < 0.6) {
      gFound++;
      if (AI.__test.attackGate(gp, grp, e, false, false)) gPass++;
    }
  }
  ok(gFound === 0 || gPass === gFound, '总攻门槛: ratio∈[0.3,0.6) 放行（finalPush 全局生效）', gPass + '/' + gFound);
}

console.log('== 27e AGGRO 玩家可调（进攻强度四档） ==');
{
  const presets = AI.aggroPresets();
  ok(Object.keys(presets).length >= 4 && !!presets.attack && presets.attack.attackRatio === 0.6,
    '预设表 ≥4 档且默认进攻档 = 26m 原值', JSON.stringify(Object.keys(presets)));
  ok(AI.aggroKey() === 'attack', '默认档 = 进攻');
  // 固守档: ratio∈[0.6,1.4) 的中段样本应被拒（默认档放行）
  const gq = new Game('big', 12345);
  Achv.attach(gq, { role: 'de', scenario: 'big', noLimit: false, seed: 1, side: 'DE' });
  let midFound = 0, defendRej = 0, frenzyAcc = 0;
  for (const e of gq.units) {
    if (!e.alive || e.exited || e.side !== 'US') continue;
    const grp = AI.__test.attackGroup(gq, e, new Set(), undefined);
    if (!grp || !grp.pv.key || grp.pv.ratio === undefined) continue;
    if (grp.pv.ratio >= 0.6 && grp.pv.ratio < 0.9) {
      midFound++;
      AI.setAggroPreset('defend');
      const rej = AI.__test.attackGate(gq, grp, e, false, false);
      AI.setAggroPreset('frenzy');
      const acc = AI.__test.attackGate(gq, grp, e, false, false);
      if (!rej && acc) { defendRej++; frenzyAcc++; }
      AI.setAggroPreset('attack');   // 还原默认, 不影响后续测试
    }
  }
  ok(midFound === 0 || (defendRej === midFound && frenzyAcc === midFound),
    '档位差分: 中段样本 固守拒/狂暴攻', defendRej + '/' + midFound);
  // 切换生效（持久化由 ui 层负责: localStorage['ardennes44_aggro'], node 端不验）
  AI.setAggroPreset('frenzy');
  ok(AI.aggroKey() === 'frenzy' && presets.frenzy.attackRatio === 0.3, '切换档位生效（狂暴）');
  AI.setAggroPreset('attack');
  ok(AI.aggroKey() === 'attack', '还原默认进攻档');
}

console.log('== 27g 攻击正面（frontage 可调） ==');
{
  // 档位联动: 进攻档正面 5 / 狂暴档 8 / 固守档 3
  AI.setAggroPreset('attack');
  ok(Combat.getFrontage() === 5, '正面宽度: 进攻档 = 5', Combat.getFrontage());
  AI.setAggroPreset('frenzy');
  ok(Combat.getFrontage() === 8, '正面宽度: 狂暴档 = 8', Combat.getFrontage());
  AI.setAggroPreset('defend');
  ok(Combat.getFrontage() === 3, '正面宽度: 固守档 = 3', Combat.getFrontage());
  // attackGroup 组队规模随正面: 找一个邻接攻方 ≥5 的守方样本
  AI.setAggroPreset('frenzy');
  const gf = new Game('big', 12345);
  gf.state.phase = 'DE';
  let sample = null;
  for (const e of gf.units) {
    if (!e.alive || e.exited || e.side !== 'US') continue;
    const grp = AI.__test.attackGroup(gf, e, new Set(), { maxForce: true });
    if (grp && grp.atts.length >= 5) { sample = grp; break; }
  }
  ok(sample === null || sample.atts.length <= 8, 'attackGroup 组队 ≤ 正面宽度（狂暴 8）', sample && sample.atts.length);
  AI.setAggroPreset('attack');   // 还原默认
  ok(Combat.getFrontage() === 5, '还原默认进攻档（正面 5）');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
