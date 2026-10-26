'use strict';
/* ============================================================================
 * achv.js — 成就系统 + 历史战绩（第三十二轮）
 * ----------------------------------------------------------------------------
 * 纪律（conformance 有静态断言把关）：
 *   · 只读引擎：不调用 doMove / doAttack / artyFire / airStrike / grantBuff /
 *     attach / endPhase / _setPos 等任何改动型 API；
 *   · 不碰随机流：源码不出现 game.rng / Math.random；
 *   · 纯逻辑：不引用 document / window / THREE，可在 Node 里直接 eval 测试；
 *   · 只通过 game.on(...) 订阅事件 + 读 game.state/game.units/game.map 判定。
 *
 * 存储：ardennes44_achv（已解锁 + 计数）、ardennes44_history（最近 100 场 + 终身账）
 *       —— 与 ardennes44_save 解耦：那份存档与 OOB 版本绑定，成就/战绩必须独立。
 * 每局跟踪器挂在 game.state.achvTrack：随 serialize() 一起进存档，
 *       因此中途读档不会丢失"从未失守""连续断补"这类过程型进度。
 * ========================================================================== */
globalThis.Achv = (function () {
  const KEY_ACHV = 'ardennes44_achv';
  const KEY_HIST = 'ardennes44_history';
  const V = 1;
  const HIST_MAX = 100;

  const TIER_ORDER = { bronze: 0, silver: 1, gold: 2 };
  const HUBS = ['圣维特', '巴斯托涅', '豪法利兹'];
  const BASTOGNE = '巴斯托涅';
  const RIDGE_TOWNS = ['洛斯海姆', '马尔梅迪'];   // 埃尔森博恩岭：北翼两镇

  /* ---------------- 存储 ---------------- */
  function read(key) {
    try {
      const ls = globalThis.localStorage;
      if (!ls) return null;
      const s = ls.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function write(key, val) {
    try {
      const ls = globalThis.localStorage;
      if (!ls) return false;
      ls.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) { return false; }
  }
  function blankAchv() { return { v: V, unlocked: {}, counters: {} }; }
  function blankHist() {
    return {
      v: V, games: [],
      life: { games: 0, rounds: 0, exits: 0, killed: 0, wins: { DE: 0, US: 0 } },
    };
  }
  function stateAchv() { const a = read(KEY_ACHV); return a && a.v === V ? a : blankAchv(); }
  function stateHist() { const h = read(KEY_HIST); return h && h.v === V ? h : blankHist(); }

  /* ---------------- 本局跟踪器 ---------------- */
  function newTrack(meta) {
    return {
      meta: meta || { role: 'de', scenario: 'standard', noLimit: false, seed: null, side: 'DE' },
      townCtrl: null,        // 上次快照：城镇名 -> 控制方
      hubsDE: {},            // 曾被德军占领过的枢纽
      ridgeLost: {},         // 埃尔森伯恩两镇是否被德军占过
      round1Towns: [],       // 第 1 回合被德军占领的城镇
      usTownsRecaptured: {}, // campaign：第 13~16 回合被美军收复的枢纽
      deInPhase: [],         // 本阶段打出 DE 的单位 id（去重）
      maxDeInPhase: 0,
      airHits: {},           // 回合 -> { 目标key: true }（空袭命中）
      bastogneUnsupPhases: 0,// 巴斯托涅守军断补的阶段数
      bastogneHeldR8: false, // 第 8 回合开始时巴斯托涅仍在美军手中
      unsupEnemyMax: 0,      // 敌方单位最大连续断补阶段数
      unsupStreak: {},       // 单位 id -> 连续断补阶段数
      engrTownStreak: {},    // 工兵 id -> 城镇格连续驻守阶段数
      bridgeHold: {},        // 桥格 key -> 美军连续驻守阶段数
      buffsUsed: {},         // 本局用过的支援资产
      peiperWest: false,
      reconMax: 0,           // 侦察营单回合最大移动格数
      abnBastogneUnsup: 0,   // 空降兵在断补状态下守巴斯托涅的阶段数
      lastKm: false,         // 德军装甲是否推进到 c ≤ 12（塞勒方向）
      ended: false,
      // —— 24w 大推演成就 ——
      hqKilled: {},          // 被摧毁的指挥部层级（'HQK'|'HQA'|'HQT' -> true）
      ukSeen: false,         // 英军部队行动过（move/combat）
      meuseReach: false,     // 德军部队进抵马斯河一线（c ≤ EXIT_C+1）
      unsupSelfMax: 0,       // 任一单位最大连续断补阶段数（不分敌我）
      ironRain: false,       // 单次火箭炮齐射歼灭 ≥3 营
      roundKills: {},        // 回合 -> 该回合双方合计被歼营数
      bastogneGateStreak: 0, // 101 师在巴斯托涅连续驻守阶段数
    };
  }
  function track(game, meta) {
    const st = game.state;
    if (!st.achvTrack || !st.achvTrack.meta) st.achvTrack = newTrack(meta || (st.achvTrack && st.achvTrack.meta));
    return st.achvTrack;
  }

  /* ---------------- 事件 → 跟踪器 ---------------- */
  function snapTowns(game, t) {
    const cur = {};
    for (const town of game.map.towns) cur[town.name] = town.ctrl;
    if (!t.townCtrl) { t.townCtrl = cur; return; }
    const round = game.state.round;
    for (const name of Object.keys(cur)) {
      const was = t.townCtrl[name], now = cur[name];
      if (!was || was === now) continue;
      if (now === 'DE') {
        if (HUBS.includes(name)) t.hubsDE[name] = round;
        if (RIDGE_TOWNS.includes(name)) t.ridgeLost[name] = round;
        if (round === 1 && was === 'US') t.round1Towns.push(name);
      } else if (now === 'US' && round >= 13 && round <= 16 && HUBS.includes(name)) {
        t.usTownsRecaptured[name] = round;
      }
    }
    t.townCtrl = cur;
  }

  // 阶段推进：断补连击、守桥/工兵驻守、北翼与巴斯托涅的态势快照
  function onPhase(game, t) {
    const st = game.state;
    const b = game.map.townMap[BASTOGNE];
    if (b && st.round === 8 && b.ctrl === 'US') t.bastogneHeldR8 = true;
    // 断补连击（按单位记；敌方取最大值 → 合围）
    for (const u of game.units) {
      if (!u.alive || u.exited) continue;
      const k = u.uid;
      if (u.supplied === false) {
        t.unsupStreak[k] = (t.unsupStreak[k] || 0) + 1;
        if (u.side !== st.phase && t.unsupStreak[k] > t.unsupEnemyMax) t.unsupEnemyMax = t.unsupStreak[k];
      } else {
        t.unsupStreak[k] = 0;
      }
    }
    // 巴斯托涅守军断补（城镇格或其邻格有断补的美军守军）
    if (b && b.ctrl === 'US') {
      const near = game.units.some(u => u.alive && !u.exited && u.side === 'US' && u.supplied === false
        && Hex.distance(u.c, u.r, b.c, b.r) <= 1);
      if (near) t.bastogneUnsupPhases++;
    }
    // 工兵驻守城镇 / 美军守桥
    for (const u of game.units) {
      if (!u.alive || u.exited) continue;
      const k = u.uid, hex = game.hexAt(u.c, u.r);
      if (!hex) continue;
      if (u.type === 'ENGR') t.engrTownStreak[k] = hex.town ? (t.engrTownStreak[k] || 0) + 1 : 0;
      if (u.side === 'US' && hex.bridge) {
        const bk = Hex.key(u.c, u.r);
        t.bridgeHold[bk] = (t.bridgeHold[bk] || 0) + 1;
      }
    }
    // 空降死守：空降兵团在断补状态下守巴斯托涅（城镇格或其邻格）
    if (b && b.ctrl === 'US') {
      const abnNear = game.units.some(u => u.alive && !u.exited && u.side === 'US' && u.type === 'ABN'
        && u.supplied === false && Hex.distance(u.c, u.r, b.c, b.r) <= 1);
      if (abnNear) t.abnBastogneUnsup++;
    }
    snapTowns(game, t);
  }

  function onCombat(game, t, ev) {
    const st = game.state;
    // 引擎真实载荷：emit('combat', { defUnit, attUnits, artyUnits, res })，其中 res 是 Combat.resolve 的
    // **返回对象**（结果串在 res.result、战列码在 res.key）。这里做一次归一化，
    // 同时也接受 res 直接是结果串（测试/未来重构用）——两种形状都吃得下。
    const raw = ev.res;
    const res = (raw && typeof raw === 'object') ? raw.result : raw;
    const rv = (raw && typeof raw === 'object') ? raw : {};
    const def = ev.defUnit, atts = ev.attUnits || [], artys = ev.artyUnits || [];
    const defHex = def && game.hexAt(def.c, def.r);
    // 空袭：只登记"本回合打过这个格"，供空地协同判定
    if (ev.air) {
      if (def) { t.airHits[st.round] = t.airHits[st.round] || {}; t.airHits[st.round][Hex.key(def.c, def.r)] = true; }
      return;
    }
    // 炮兵远程射击（无地面攻击方）
    if (ev.ranged && !atts.length) {
      if (res === 'DE') t._timeOnTarget = true;
      return;
    }
    const attHex = atts[0] && game.hexAt(atts[0].c, atts[0].r);
    const allArm = atts.length > 0 && atts.every(a => a.type === 'ARM');   // 与引擎 §战斗 的"装甲冲击"同口径
    const soft = def && !DATA.TYPES[def.type].antiArmor;
    // 以弱胜强：rv.key 是 Combat.resolve 带出的战列码（1:4…6:1）。
    // 用数值解析而非 ODDS_ORDER 下标——下标方向依赖数组顺序，是易错写法。
    if (res === 'DE' && rv.key) {
      const r = oddsRatio(rv.key);
      if (r != null && r <= 0.5) t._againstOdds = true;      // 1:2 或更差
    }
    if (res === 'DE' || res === 'AE') {
      for (const a of atts) if (!t.deInPhase.includes(a.uid)) t.deInPhase.push(a.uid);
      t.maxDeInPhase = Math.max(t.maxDeInPhase, t.deInPhase.length);
      if (t.deInPhase.length >= 3) t._threeInDay = true;
    }
    if (res === 'DE') {
      // 装甲楔子：纯装甲 + 开阔地 + 守方无任何反装甲火力（与引擎升档条件一致）
      if (allArm && soft && defHex && defHex.terrain === 'plain') t._panzerkeil = true;
      // 强渡：从非河格打河格守军
      if (defHex && defHex.river && attHex && !attHex.river) t._crossing = true;
      // 炮火准备：两个炮兵营同时支援一次地面攻击
      if (artys.length >= 2 && artys.every(a => a.type === 'ART')) t._artyTwo = true;
      // 铁拳：守方配属反坦克小组、遭纯装甲攻击、且守住了（未被歼灭）
      if (def && def.attach && def.attach.at && allArm && def.alive) t._panzerfaust = true;
      // 空地协同：本回合空袭过同一目标，且地面攻击将其击破
      if (def && t.airHits[st.round] && t.airHits[st.round][Hex.key(def.c, def.r)]) t._cabRank = true;
    }
  }

  function onBuff(game, t, ev) {
    const id = ev && ev.id;
    if (id) t.buffsUsed[id] = true;
  }

  function onMove(game, t, ev) {
    const u = ev && ev.unit;
    if (!u) return;
    // 侦察的价值：侦察营单回合移动 ≥8 格
    if (u.type === 'RECON' && ev.path && ev.path.length > t.reconMax) t.reconMax = ev.path.length;
    // 24w: 大推演马斯河线（EXIT_C=5, 覆盖迪南/那慕尔渡口）+ 英军参战
    if (g.scenario.id === 'big' && u.c <= ((DATA.EXIT_C || 5) + 1)) t.meuseReach = true;
    {
      const M = DATA.OOB_BIG_META && DATA.OOB_BIG_META[u.id];
      if (M && M.nat === 'UK') t.ukSeen = true;
    }
    if (u.side !== 'DE') return;
    // 最后的几公里：德军装甲/摩托化推进到 c ≤ 12（塞勒方向）
    if (u.c <= 12 && (u.type === 'ARM' || u.type === 'MOT')) t.lastKm = true;
    // 派佩尔的驰骋：派佩尔装甲营推进到乌尔特河以西（RIVERS 是 {河名: [[c,r]…]}）
    if (/派佩尔/.test(u.name || '') && westOfOurthe(u.c, u.r)) t.peiperWest = true;
  }

  // 战列码 → 数值比值（'1:2' → 0.5；'6:1' → 6）；无法解析返回 null
  function oddsRatio(key) {
    const m = /^(\d+)\s*:\s*(\d+)$/.exec(key || '');
    return m ? (+m[1]) / (+m[2]) : null;
  }

  // 乌尔特河以西：同行 ±2 取该河最西列，单位在其以西即算过河
  function westOfOurthe(c, r) {
    const pts = (DATA.RIVERS && DATA.RIVERS.ourthe) || [];
    let minC = Infinity;
    for (const p of pts) if (Math.abs(p[1] - r) <= 2) minC = Math.min(minC, p[0]);
    return isFinite(minC) && c < minC;
  }

  /* ---------------- 判定表（键 = 成就 id） ---------------- */
  const CHECKS = {
    first_snow: (g, t) => g.state.over === true,
    long_winter: (g, t) => g.state.over === true && g.scenario.campaign && g.state.round >= g.scenario.rounds,
    two_commanders: (g, t) => g.state.over === true && t.meta.role === 'hotseat',
    observer: (g, t) => g.state.over === true && t.meta.role === 'watch',
    annihilation: (g, t) => g.state.over === true && !!t.meta.noLimit,
    wacht_am_rhein: (g) => g.state.victoryKey === 'DE_decisive' && !g.scenario.campaign,
    to_the_meuse: (g) => (g.state.exits || 0) >= 1,
    both_hubs: (g, t) => !!t.hubsDE['圣维特'] && !!t.hubsDE['巴斯托涅'],
    nuts: (g, t) => {
      const b = g.map.townMap[BASTOGNE];
      if (!b || b.ctrl !== 'US') return false;
      return t.bastogneHeldR8 && t.bastogneUnsupPhases >= 2;
    },
    shoulder_to_shoulder: (g, t) => g.state.over === true && g.state.victoryKey === 'US_decisive' && g.scenario.campaign,
    decisive_defense: (g) => g.state.over === true && g.state.victoryKey === 'US_decisive' && !g.scenario.campaign,
    panzerkeil: (g, t) => !!t._panzerkeil,
    crossing_our: (g, t) => !!t._crossing,
    panzerfaust: (g, t) => !!t._panzerfaust,
    artillery_prep: (g, t) => !!t._artyTwo,
    cab_rank: (g, t) => !!t._cabRank,
    kessel: (g, t) => t.unsupEnemyMax >= 3,
    engineers_hold: (g, t) => Object.values(t.engrTownStreak).some(v => v >= 3),
    peipers_ride: (g, t) => !!t.peiperWest,
    trois_ponts: (g, t) => Object.values(t.bridgeHold).some(v => v >= 3),
    herbstnebel: (g, t) => t.round1Towns.length >= 2,
    elsenborn_ridge: (g, t) => g.state.over === true && g.state.victoryKey === 'US_decisive'
      && !g.scenario.campaign && RIDGE_TOWNS.every(n => !t.ridgeLost[n]),
    christmas_counter: (g, t) => Object.keys(t.usTownsRecaptured).length >= 1,
    ribbon_rack: (g, t, ctx) => {
      const others = DATA.ACHIEVEMENTS.filter(a => a.id !== 'ribbon_rack');
      return others.every(a => ctx.unlocked[a.id] || CHECKS[a.id](g, t, ctx));
    },
    /* —— 阶段 C 长尾 —— */
    time_on_target: (g, t) => !!t._timeOnTarget,
    recon_value: (g, t) => t.reconMax >= 8,
    fuel_discipline: (g) => {
      const st = g.state;
      if (!(st.fuelDE > 0 && (st.exits || 0) >= 1)) return false;
      return (g.map.depots || []).every(d => !d.captured);       // 没靠缴获油库
    },
    against_odds: (g, t) => !!t._againstOdds,
    three_in_day: (g, t) => !!t._threeInDay,
    supply_wizard: (g, t) => ['at', 'med', 'fire', 'repl', 'fort'].every(k => t.buffsUsed[k]),
    airborne_hold: (g, t) => t.abnBastogneUnsup >= 3,
    pyrrhic_victory: (g) => {
      if (!g.state.over || g.state.winner !== 'US') return false;
      try { return g._lossPct('US') >= 0.4; } catch (e) { return false; }
    },
    last_kilometers: (g, t) => !!t.lastKm && !!g.scenario.campaign,
    // 以下四条依赖终身账：life 在 Achv.finish 里 pushHistory 之后才含本局，故由 finish 的第二轮求值解锁
    ten_offensives: () => stateHist().life.games >= 10,
    veteran_bulge: () => stateHist().life.games >= 25,
    /* —— 24w 大推演专属 13 条 —— */
    big_field: (g) => g.state.over === true && g.scenario.id === 'big',
    big_veteran: () => stateHist().games.filter(r => r.scen === 'big').length >= 3,
    britannia: (g, t) => t.ukSeen === true,
    hq_hunter: (g, t) => !!t.hqKilled.HQK,
    decapitation: (g, t) => !!t.hqKilled.HQA,
    checkmate: (g, t) => !!t.hqKilled.HQT,
    hundred_guns: (g, t) => Object.keys(t.roundKills).some(k => t.roundKills[k] >= 10),
    full_division: (g) => {
      // 终局：按师分组（big 专属），任一师 ≥10 营且全部存活（必须打完）
      if (g.state.over !== true) return false;
      const M = DATA.OOB_BIG_META;
      if (!M) return false;
      const divs = {};
      for (const u of g.units) {
        const m = M[u.id];
        if (!m || m.div === '司令部') continue;
        (divs[m.div] = divs[m.div] || { total: 0, alive: 0 });
        divs[m.div].total++;
        if (u.alive && !u.exited) divs[m.div].alive++;
      }
      return Object.values(divs).some(d => d.total >= 10 && d.alive === d.total);
    },
    meuse_shadow: (g, t) => t.meuseReach === true,
    winter_lone: (g, t) => t.unsupSelfMax >= 10,
    iron_rain: (g, t) => t.ironRain === true,
    bastogne_gate: (g, t) => t.bastogneGateStreak >= 12,
    ardennes_1944: (g, t, ctx) => {
      const others = DATA.ACHIEVEMENTS.filter(a => a.cat === '大推演' && a.id !== 'ardennes_1944');
      return others.every(a => ctx.unlocked[a.id] || CHECKS[a.id](g, t, ctx));
    },
    a_thousand: () => stateHist().life.killed >= 1000,
    twenty_crossings: () => stateHist().life.exits >= 20,
  };

  /* ---------------- 求值 / 提交 ---------------- */
  // 返回本次新满足的成就 id（不写盘；已解锁的不再返回）
  function evaluate(game, opt) {
    const t = track(game, opt && opt.meta);
    const a = stateAchv();
    const ctx = { unlocked: a.unlocked };
    const out = [];
    for (const def of DATA.ACHIEVEMENTS) {
      if (a.unlocked[def.id]) continue;
      const fn = CHECKS[def.id];
      if (!fn) continue;
      let ok = false;
      try { ok = !!fn(game, t, ctx); } catch (e) { ok = false; }
      if (ok) out.push(def.id);
    }
    return out;
  }

  // 写盘并返回真正"新解锁"的 id（用于弹卡；重复调用不会重复返回）
  function commit(ids) {
    const a = stateAchv();
    const fresh = [];
    const now = Date.now();
    for (const id of ids || []) {
      if (!DATA.ACHIEVEMENTS.some(x => x.id === id) || a.unlocked[id]) continue;
      a.unlocked[id] = now; fresh.push(id);
    }
    if (fresh.length) write(KEY_ACHV, a);
    return fresh;
  }

  /* ---------------- 战绩记录（最近 100 场 + 终身账） ---------------- */
  function recordOf(game, meta, newly) {
    const st = game.state;
    const lp = s => { try { return Math.round(game._lossPct(s) * 1000) / 1000; } catch (e) { return null; } };
    const killed = { DE: 0, US: 0 };                          // 只读：按方记"被歼战力"（纸面攻+防）
    for (const side of ['DE', 'US']) {
      try {
        const slot = game._lossPowSlot(side);
        if (slot) killed[side] = (slot.atk || 0) + (slot.def || 0);
      } catch (e) { /* ignore */ }
    }
    return {
      t: Date.now(),
      scen: game.scenario.id,
      role: (meta && meta.role) || 'de',
      side: st.phase === 'US' ? 'DE' : 'US',   // 玩家阵营（热座/观摩另算）
      noLimit: !!(meta && meta.noLimit),
      seed: (meta && meta.seed) != null ? meta.seed : null,
      winner: st.winner || null,
      verdict: st.victoryKey || null,
      rounds: st.round,
      loss: { DE: lp('DE'), US: lp('US') },
      exits: st.exits || 0,
      killed,
      achv: newly || [],
    };
  }

  function pushHistory(rec) {
    const h = stateHist();
    h.games.push(rec);
    while (h.games.length > HIST_MAX) h.games.shift();   // 环形：只留最近 100 场
    const L = h.life;
    L.games++;
    L.rounds += rec.rounds || 0;
    L.exits += rec.exits || 0;
    L.killed += (rec.killed && (rec.killed.DE || 0) + (rec.killed.US || 0)) || 0;
    if (rec.winner === 'DE' || rec.winner === 'US') L.wins[rec.winner]++;
    write(KEY_HIST, h);
    return h;
  }

  /* ---------------- 对局挂载 ---------------- */
  const attached = new WeakSet();
  function attach(game, meta) {
    if (attached.has(game)) return track(game, meta);
    attached.add(game);
    const t = track(game, meta);
    if (meta) t.meta = Object.assign({}, t.meta, meta);
    snapTowns(game, t);        // 首帧快照：避免把开局态势当成"占领"
    game.on('combat', ev => onCombat(game, t, ev));
    game.on('move', ev => onMove(game, t, ev));
    game.on('phase', () => onPhase(game, t));
    game.on('buff', ev => onBuff(game, t, ev));
    // 24w: 指挥部摧毁（game.js 24r 冲击时 emit）+ 回合歼灭计数 + 英军参战
    game.on('hqkill', u => {
      if (!u) return;
      t.hqKilled[u.type] = true;
    });
    game.on('elim', u => {
      const st = game.state;
      t.roundKills[st.round] = (t.roundKills[st.round] || 0) + 1;
      const M = DATA.OOB_BIG_META && DATA.OOB_BIG_META[u.id];
      if (M && M.nat === 'UK') t.ukSeen = true;
    });
    return t;
  }

  // 终局：结算成就 + 写战绩
  // 时序要点：依赖终身账的四条（十次攻势/突出部老兵/千点血债/二十次渡河）必须等 pushHistory
  // 之后才能看到"本局这一份"，所以在记完战绩后**再求值一轮**，并把结果一并回写进本局记录。
  function finish(game, meta) {
    const t = track(game, meta);
    if (meta) t.meta = Object.assign({}, t.meta, meta);
    const newly = commit(evaluate(game, { meta }));
    if (!t.ended) {
      t.ended = true;
      const rec = recordOf(game, t.meta, newly);
      pushHistory(rec);
      const late = commit(evaluate(game, { meta }));
      for (const id of late) if (!newly.includes(id)) newly.push(id);
      if (late.length) {
        const h = stateHist();
        const last = h.games[h.games.length - 1];
        if (last && last.t === rec.t) { last.achv = newly; write(KEY_HIST, h); }
      }
    }
    return newly;
  }

  /* ---------------- 对外查询（面板用） ---------------- */
  function all() { return DATA.ACHIEVEMENTS.map(a => Object.assign({}, a)); }
  function unlockedMap() { return Object.assign({}, stateAchv().unlocked); }
  function progress() {
    const a = stateAchv();
    const byTier = { bronze: [0, 0], silver: [0, 0], gold: [0, 0] };
    for (const def of DATA.ACHIEVEMENTS) {
      const got = !!a.unlocked[def.id];
      byTier[def.tier][got ? 0 : 1]++;
    }
    const total = DATA.ACHIEVEMENTS.length;
    const got = Object.keys(a.unlocked).filter(id => DATA.ACHIEVEMENTS.some(x => x.id === id)).length;
    return { got, total, byTier, unlocked: a.unlocked };
  }
  function history() { return stateHist(); }
  function recent(n) { const g = stateHist().games; return g.slice(Math.max(0, g.length - (n || HIST_MAX))).reverse(); }
  function stats(filter) {
    const h = stateHist();
    const games = h.games.filter(filter || (() => true));
    const wins = games.filter(g => g.winner === 'US' || g.winner === 'DE').length;
    return {
      life: h.life, recent: games.length,
      recentWins: wins,
      avgRounds: games.length ? Math.round(games.reduce((s, g) => s + (g.rounds || 0), 0) / games.length * 10) / 10 : 0,
    };
  }
  function reset(kind) {
    if (kind === 'achv' || kind === 'all') write(KEY_ACHV, blankAchv());
    if (kind === 'history' || kind === 'all') write(KEY_HIST, blankHist());
  }

  return {
    V, HIST_MAX, TIER_ORDER,
    attach, evaluate, commit, finish, track,
    all, unlockedMap, progress, history, recent, stats, reset,
    palette: () => DATA.ACH_PALETTE,
    icons: () => DATA.ACH_ICONS,
    // 像素点阵 → 颜色矩阵（纯函数，渲染交给 ui.js；剪影模式用于未解锁）
    pixel: (iconId, silhouette) => {
      const rows = DATA.ACH_ICONS[iconId];
      if (!rows) return null;
      const pal = DATA.ACH_PALETTE;
      return rows.map(row => [...row].map(ch => {
        if (silhouette) return ch === '.' ? null : (ch === 'k' ? 'rgba(60,66,60,0.55)' : 'rgba(96,104,96,0.35)');
        return pal[ch] || null;
      }));
    },
  };
})();
