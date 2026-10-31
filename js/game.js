'use strict';
/* ============================================================
 * game.js — 回合引擎
 * 回合流程: [新回合:天气/增援(德)] → 德军阶段(补给/整补→移动/战斗)
 *         → 燃料结算 → 美军阶段(同) → 回合结束/胜负判定
 * ============================================================ */
globalThis.Game = (function () {

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  let UID = 1;

  /* ---------------- 最小二叉堆（A* / Dijkstra 的开放列表） ----------------
   * ⚠️ 性能红线（2026-10-12 实测）：开放列表**不能用 `open.sort()` 每轮重排**。
   *   152×96 图上 A* 的开放列表会长到数千项，每轮 sort 是 O(n log n)，
   *   单次 findPath 从数十毫秒劣化到 **1410ms**（旧 76×48 图仅 18ms）。
   *   二叉堆 push/pop 都是 O(log n)，实测把单次 findPath 拉回 65ms 量级。
   * 元素形态：{ k, f }，k 为 'c,r' 键。
   */
  function heapPush(h, k, f) {
    const node = { k, f };
    h.push(node);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].f <= h[i].f) break;
      const t = h[p]; h[p] = h[i]; h[i] = t; i = p;
    }
  }
  function heapPop(h) {
    const top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l].f < h[m].f) m = l;
        if (r < h.length && h[r].f < h[m].f) m = r;
        if (m === i) break;
        const t = h[m]; h[m] = h[i]; h[i] = t; i = m;
      }
    }
    return top;
  }

  // 实扣组织度统计的空值（只读，勿改）
  const ZERO_LOSS = Object.freeze({ total: 0, atk: 0, def: 0, other: 0 });
  // 被歼战力统计的空值（第十四轮）：以单位纸面 atk/def 计（独立于组织度）
  //   n     = 被歼灭建制数（不含"渡河退出"，退出是达成目标而非损失）
  //   atk/def = 被歼单位的纸面攻/防合计
  //   bn    = 其中被歼时叠有增益（主动 attach/炮火急袭 或 被动状态）的建制数
  //   batk/bdef = 上述叠增益单位的纸面攻/防合计
  //   bAct/bPas = 叠增益单位中"含主动增益"/"含被动状态"的数量（可同时计入）
  const ZERO_POW = Object.freeze({ n: 0, atk: 0, def: 0, bn: 0, batk: 0, bdef: 0, bAct: 0, bPas: 0 });

  class Game {
    constructor(scenarioId, seed, savedState, opts) {
      this.scenario = DATA.SCENARIOS[scenarioId] || DATA.SCENARIOS.standard;
      // 取消回合限制 / 歼灭模式(2026-10 第二十三轮): 独立于剧本与阵营的开关。
      // 开启后无回合上限, 双方目标是消灭对方全部建制(含尚未入场的援军); 渡河退出关闭。
      // 默认 false —— 既有剧本/基线/存档行为逐位不变。
      this.noTurnLimit = !!(opts && opts.noTurnLimit);
      this.rngSeed = (seed === undefined) ? ((Math.random() * 2 ** 31) | 0) : seed;
      this.rng = mulberry32(this.rngSeed);
      this.map = MapGen.build();
      this._ls = {};
      this._listeners = {};
      this.units = [];
      this.grid = new Map(); // 'c,r' -> unit
      this.logEntries = [];

      if (savedState) { this._load(savedState); }
      else {
        this.state = {
          round: 1, phase: 'DE', weather: 'fog', over: false, winner: null, endText: '', victoryKey: null,
          noTurnLimit: this.noTurnLimit,
          fuelDE: this.scenario.fuelDE, airUS: 0, airDE: 0, exits: 0,
          strength0: { DE: 0, US: 0 }, cas: { DE: 0, US: 0 },
          // 实扣组织度统计(第十三轮): total=累计实扣组织度, atk/def=作为进攻/防守方在战斗结算中损失,
          // other=其他损耗(断补衰减/炮击/空袭)。与 cas 的名义伤害口径并存, 见 HANDOVER §18 第 23 条。
          lossOrg: { DE: null, US: null },
          // 被歼战力统计(第十四轮): 独立于组织度, 累计被歼灭单位的纸面攻/防, 并标注其中叠增益者。
          lossPow: { DE: null, US: null },
          tokens: { DE: this._freshTokens('DE') },
          fortHexes: [],               // 就地筑垒(24h): 已筑工事格键列表
          depotMsgDone: {},
        };
      this.fortHexes = new Set(this.state.fortHexes || []);   // 24h
      this._calcWild();   // 24h: 荒野掩膜(新局)
        this._spawnOOB();
        this.state.strength0.DE = this._strength('DE');
        this.state.strength0.US = this._strength('US');
        this._rollWeather(true);
        this.log(`── 剧本《${this.scenario.name}》开局 ──`, 'sys');
        if (this.noTurnLimit) this.log('◈ 取消回合限制：无回合上限，目标为歼灭对方全部建制（含援军）', 'sys');
        this.log(`第1回合 · 1944年12月16日 · 天气:${this._weatherName()}`, 'sys');
        this._supply('DE');
        this._supply('US');
        this._fixHQDeploy();   // 24r: 指挥部开局不站非本方城镇格
        this._eventNotes();
        /* 24y 环境诊断: 平台环境差异(WebView/存储/内核)入战报, 便于远程排障 */
        try {
          let stg = '可写';
          try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); } catch (e) { stg = '不可写'; }
          const dcmp = typeof DecompressionStream === 'function' ? '支持' : '不支持';
          const thr = (window.THREE ? (window.__threeHow || '已加载') : '未加载') + (window.__threeFailed ? '(失败)' : '');
          this.log('── 环境: 存储 ' + stg + ' · 解压 ' + dcmp + ' · 引擎 ' + thr + ' ──', 'sys');
        } catch (e) { /* ignore */ }
      }
    }

    /* ---------------- 事件 ---------------- */
    /* 24r: 指挥部布防修正——gen 侧位置不可知城镇，开局若落在非本方城镇格则就近挪一格 */
    _fixHQDeploy() {
      for (const u of this.units) {
        if (!u.isHQ || !u.alive) continue;
        const h = this.hexAt(u.c, u.r);
        if (!h || !h.town || h.town.ctrl === u.side) continue;
        const cand = [];
        for (const n of Hex.neighbors(u.c, u.r)) cand.push(n);
        for (const n of Hex.neighbors(u.c, u.r)) for (const m of Hex.neighbors(n.c, n.r)) cand.push(m);
        for (const n of cand) {
          const nh = this.hexAt(n.c, n.r);
          if (!nh || this.unitAt(n.c, n.r)) continue;
          if (nh.town && nh.town.ctrl !== u.side) continue;
          this._setPos(u, n.c, n.r);
          break;
        }
      }
    }
    on(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    emit(type, data) {
      const ls = this._listeners[type];
      if (ls) for (const f of ls) f(data);
    }

    log(msg, cls) {
      const e = { msg, cls: cls || '' };
      this.logEntries.push(e);
      if (this.logEntries.length > 400) this.logEntries.shift();
      this.emit('log', e);
    }

    /* ---------------- 基础查询 ---------------- */
    unitAt(c, r) { return this.grid.get(Hex.key(c, r)) || null; }
    hexAt(c, r) { return this.map.hexes.get(Hex.key(c, r)) || null; }
    terrAt(c, r) {
      const h = this.hexAt(c, r);
      return h ? DATA.TERRAIN[h.terrain] : null;
    }
    phaseUnits() { return this.units.filter(u => u.alive && u.side === this.state.phase); }
    enemyOf(side) { return side === 'DE' ? 'US' : 'DE'; }
    _weatherName() { return { clear: '晴', fog: '雾/阴', snow: '降雪' }[this.state.weather]; }

    _spawnOOB() {
      const mk = (row, side) => {
        const [id, name, abbr, type, atk, def, mov, c, r, arrive, org, maxOrg] = row;
        if (arrive > 0) return; // 增援后续入场
        this._addUnit({ id, name, abbr, type, atk, def, mov, c, r, side, arrive: 0, org: org || 10, maxOrg });
      };
      for (const row of DATA.OOB_DE) mk(row, 'DE');
      for (const row of DATA.OOB_US) mk(row, 'US');
    }

    _addUnit(o) {
      const t = DATA.TYPES[o.type];
      // 目标格被占则就近展开
      let pos = this._freeNear(o.c, o.r, 3);
      if (!pos) pos = { c: o.c, r: o.r };
      const u = {
        uid: UID++, id: o.id, side: o.side, name: o.name, abbr: o.abbr, type: o.type,
        atk: o.atk, def: o.def, mov: o.mov, org: o.org || 10, maxOrg: o.maxOrg || 10,   // 24i: 组织度分层(旧剧本无第12字段→10)
        c: pos.c, r: pos.r, alive: true, exited: false,
        moved: false, attacked: false, fired: false,
        supplied: true, unsupRounds: 0, arrive: o.arrive || 0,
        homeR: o.homeR !== undefined ? o.homeR : o.r,
        isHQ: !!t.hq, range: o.type === 'RKT' ? DATA.TRAIT_KNOBS.RKT_RANGE : (o.type === 'ART' ? 4 : (t.range || 0)),   // 26x: ART 两军统一射程 4(0-4, 相邻可直射); 火箭炮固定射程4(24h)
        // 炮兵支援力=编制攻值(美7/德5, 见规则弹窗与 §7.5); 曾误取 TYPES.support(=1), 导致炮兵
        // 远程射击战力比恒低于 1:4 而永远"未命中"、支援友邻只加 1 点 —— 2026-10 修正
        sup: o.type === 'ART' || o.type === 'RKT' ? o.atk : (t.support || 0),
        attach: { at: false, fort: false, repl: false, aa: false },
        fireSupport: 0,
      };
      this.units.push(u);
      this.grid.set(Hex.key(u.c, u.r), u);
      this._zocDirty();          // ZOC 缓存失效（新单位入场）
      return u;
    }

    // 战损统计(以组织度损失计)
    _cas(side, amt) {
      if (amt > 0) this.state.cas[side] = (this.state.cas[side] || 0) + amt;
    }
    _lossPct(side) { return (this.state.cas[side] || 0) / this._orgPool(side); }
    // 战损率分母 = 初始在场组织度 + 全部增援满编组织度(可 >100%, 表示累计损耗强度)
    _orgPool(side) {
      let denom = this._strength0(side);
      for (const u of this.units) if (u.side === side && u.arrive > 0) denom += u.maxOrg;
      return Math.max(1, denom);
    }

    /* ---- 实扣组织度统计（第十三轮）——终局战损明细用 ---- */
    _lossSlot(side) {
      const s = this.state.lossOrg || (this.state.lossOrg = {});
      return s[side] || (s[side] = { total: 0, atk: 0, def: 0, other: 0 });
    }
    _loss(side) {
      const s = this.state.lossOrg && this.state.lossOrg[side];
      return s || ZERO_LOSS;
    }
    // 实扣战损率(与 _lossPct 的分母相同, 但分子为真实扣除量而非名义伤害)
    _lossRealPct(side) { return this._loss(side).total / this._orgPool(side); }
    _killed(side) { return this.units.filter(u => u.side === side && !u.alive && !u.exited).length; }

    /* ---- 被歼战力统计（第十四轮）——被歼灭单位的纸面攻/防合计，独立于组织度 ---- */
    _lossPowSlot(side) {
      const s = this.state.lossPow || (this.state.lossPow = {});
      return s[side] || (s[side] = { n: 0, atk: 0, def: 0, bn: 0, batk: 0, bdef: 0, bAct: 0, bPas: 0 });
    }
    _lossPow(side) {
      const s = this.state.lossPow && this.state.lossPow[side];
      return s || ZERO_POW;
    }
    // 该单位此刻是否叠有增益：主动(配属 at/fort/repl/aa 或 炮火急袭 fireSupport) / 被动(协同·困兽·无心)
    _unitBuffs(u) {
      const act = !!(u.attach && (u.attach.at || u.attach.fort || u.attach.repl || u.attach.aa)) || (u.fireSupport > 0);
      let pas = false;
      try { pas = !!(Combat && Combat.passiveState && Combat.passiveState(this, u).key); } catch (e) { pas = false; }
      return { act, pas, any: act || pas };
    }
    // 建制被歼灭时登记：纸面 atk/def 计入该方损失；若被歼时叠有增益则另记入叠增益桶。
    // 纯记账——不改任何规则数值、不消耗 RNG（passiveState 为确定性哈希判定）。
    // 注意：渡河退出(u.exited) 不计入被歼。
    noteKill(u) {
      if (!u || u.exited) return;
      /* 24r 指挥部毁灭冲击（用户规定）：总指挥部被毁→本国籍全部单位 org/攻防-4；
         集团军司令部被毁→该集团军全部单位 -3；军部被毁→该军全部单位 -2。
         扣减下限 1（不致死、归一不再减）。一次性永久扣减，之后入场的增援不受影响。 */
      if (u.isHQ && !u.hqShockDone && DATA.OOB_BIG_META && DATA.OOB_BIG_META[u.id]) {
        u.hqShockDone = true;
        const m = DATA.OOB_BIG_META[u.id];
        /* 26k: 冲击值按伤害倍率换算（师级 ×2.5 → 总部 −10，营级仍 −4） */
        const tier = Math.round((u.type === 'HQT' ? 4 : u.type === 'HQA' ? 3 : 2) * (DATA.DMG_SCALE || 1));
        const scope = this.units.filter(x => {
          if (!x.alive || x.exited) return false;
          const xm = DATA.OOB_BIG_META[x.id];
          if (!xm) return false;
          if (u.type === 'HQT') return xm.nat === m.nat;                       // 本国籍全部
          if (u.type === 'HQA') return xm.nat === m.nat && (xm.army === m.army || (m.corps && xm.corps === m.corps));   // 本集团军（美军"第1集团军"挂在 corps 字段；corps 空串不参与匹配）
          return xm.corps === m.corps && !!m.corps;                            // 本军
        });
        for (const x of scope) {
          x.org = Math.max(1, x.org - tier);
          x.atk = Math.max(1, x.atk - tier);
          x.def = Math.max(1, x.def - tier);
        }
        const who = u.type === 'HQT' ? '全军' : (u.type === 'HQA' ? '该集团军' : '该军');
        this.log(`${u.name} 被摧毁！${who}${scope.length} 支部队士气崩溃：组织度与攻防各 -${tier}（下限1）`, 'warn');
        this.emit('hqkill', u);   // 24w: 成就系统感知指挥部摧毁（只读事件）
      }
      const L = this._lossPowSlot(u.side);
      L.n++; L.atk += u.atk; L.def += u.def;
      const b = this._unitBuffs(u);
      if (b.any) {
        L.bn++; L.batk += u.atk; L.bdef += u.def;
        if (b.act) L.bAct++;
        if (b.pas) L.bPas++;
      }
    }
    // 在场单位持有增益的数量统计（终局展示用）：主动 = attach/fireSupport；被动 = 被动状态成立
    _buffHold(side) {
      let act = 0, pas = 0;
      for (const u of this.units) {
        if (!u.alive || u.exited || u.side !== side) continue;
        const b = this._unitBuffs(u);
        if (b.act) act++;
        if (b.pas) pas++;
      }
      return { act, pas };
    }
    // 扣组织度的唯一入口: 返回本次"实际"掉的血(被 0 截断), 并按角色累加实扣统计。
    // role: 'atk' 进攻时损失 / 'def' 防守时损失 / 其他(缺省) 断补·炮击·空袭等损耗。
    // 注意: 本方法只记账, 不改任何规则数值; game._cas 的名义口径保持不变。
    dmgOrg(u, amt, role) {
      if (!u || !(amt > 0)) return 0;
      const before = u.org;
      u.org = Math.max(0, before - amt);
      const real = before - u.org;
      if (real > 0) {
        const L = this._lossSlot(u.side);
        L.total += real;
        L[role === 'atk' || role === 'def' ? role : 'other'] += real;
      }
      return real;
    }

    _freeNear(c, r, maxR) {
      if (!this.unitAt(c, r) && this.hexAt(c, r)) return { c, r };
      for (let d = 1; d <= maxR; d++) {
        for (const p of Hex.range(c, r, d, this.map.cols, this.map.rows)) {
          if (!this.unitAt(p.c, p.r)) return p;
        }
      }
      return null;
    }

    _strength(side) {
      let s = 0;
      for (const u of this.units) if (u.alive && !u.exited && u.side === side) s += u.org;
      return s;
    }
    _strength0(side) { return this.state.strength0[side]; }

    /* ---------------- ZOC / 移动 ---------------- */
    // ⚠️ 性能红线（2026-10-12 实测）：ZOC 必须**按方缓存**。
    //   旧写法每次 inZOC() 都做 6 次 unitAt() + 字符串拼键；AI 一回合要调
    //   2 万次以上（planTurn 里 inZOC 400ms + unitAt 700ms 都是它），
    //   而棋盘大势在一方阶段内基本不变 → 缓存后命中 O(1)。
    //   任何移动/新增/清除单位的路径都必须调用 _zocDirty() 失效缓存。
    _zocDirty() { this._zoc = null; }
    _zocOf(side) {
      if (!this._zoc) this._zoc = {};
      if (this._zoc[side]) return this._zoc[side];
      // 某方单位位于 (c,r) 时是否处于敌军控制区 == 该格是否与敌方单位相邻
      const enemy = this.enemyOf(side);
      const set = new Set();
      for (const u of this.units) {
        if (!u.alive || u.exited || u.side !== enemy) continue;
        for (const n of Hex.neighbors(u.c, u.r)) set.add(Hex.key(n.c, n.r));
      }
      this._zoc[side] = set;
      return set;
    }
    inZOC(c, r, side) {
      return this._zocOf(side).has(Hex.key(c, r));
    }

    movEff(u) {
      let m = u.mov;
      const t = DATA.TYPES[u.type];
      if (this.state.weather === 'snow' && t.armor) m -= 1;
      if (u.side === 'DE' && this.state.fuelDE <= 0 && t.armor) m -= 3;
      if (!u.supplied && !this.supplyExempt(u) && (u.unsupRounds || 0) > DATA.UNSUP_GRACE) m = Math.ceil(m / 2);
      return Math.max(1, m);
    }

    stepCost(u, fromC, fromR, toC, toR) {
      const from = this.hexAt(fromC, fromR), to = this.hexAt(toC, toR);
      if (!to) return Infinity;
      const occ = this.unitAt(toC, toR);
      if (occ && occ !== u && occ.side !== u.side) return Infinity;   // 敌占格不可进入；友军占格可借道(不停留, 见 doMove)
      let cost = DATA.TERRAIN[to.terrain].mv;
      if (from.road && to.road) cost = (u && u.type === 'MOT') ? DATA.TRAIT_KNOBS.MOT_ROAD_COST : DATA.ROAD_COST;   // 公路疾驰(24h)
      if (to.river && !from.river && !to.bridge) cost += DATA.RIVER_EXTRA;
      return cost;
    }

    // Dijkstra 可达域(尊重ZOC停止规则)
    getReach(u) {
      const mp = this.movEff(u);
      const start = Hex.key(u.c, u.r);
      const dist = new Map([[start, 0]]);
      const prev = new Map();
      const open = [{ k: start, c: 0 }];
      while (open.length) {
        open.sort((a, b) => a.c - b.c);
        const cur = open.shift();
        if (cur.c > dist.get(cur.k)) continue;
        const p = Hex.parse(cur.k);
        // 非装甲进入敌ZOC后须停止。关键(原版33轮移植)：起点本身在敌ZOC(贴敌)不受此限——
        // 否则前线非装甲单位可达域恒0被永久钉死。findPath 一直有 cur.k !== start 守卫，此处补齐口径。
        if (cur.k !== start && this.inZOC(p.c, p.r, u.side) && !DATA.TYPES[u.type].armor) continue;
        for (const n of Hex.neighbors(p.c, p.r)) {
          if (!this.map.hexes.has(Hex.key(n.c, n.r))) continue;
          const sc = this.stepCost(u, p.c, p.r, n.c, n.r);
          if (!isFinite(sc)) continue;
          const nc = cur.c + sc;
          if (nc > mp) continue;
          const nk = Hex.key(n.c, n.r);
          if (!dist.has(nk) || nc < dist.get(nk)) {
            dist.set(nk, nc); prev.set(nk, cur.k);
            open.push({ k: nk, c: nc });
          }
        }
      }
      dist.delete(start);
      // 占用格只能借道不能停留(原版31轮移植) → 从可达域剔除; prev 保留完整链,
      // pathFromReach 仍能给出穿过友军格的路径; dist 是 UI 高亮与落点校验依据。
      for (const k of [...dist.keys()]) {
        const p = Hex.parse(k);
        if (this.unitAt(p.c, p.r)) dist.delete(k);
      }
      return { dist, prev };
    }

    pathFromReach(reach, destKey) {
      if (!reach.dist.has(destKey)) return null;
      const path = [];
      let k = destKey;
      while (k && reach.prev.has(k)) { path.unshift(Hex.parse(k)); k = reach.prev.get(k); }
      return path;
    }

    // A* 全图路径(供AI长途机动; 执行时会被MP/规则安全截断)
    // opts.avoidZOC: 非装甲避免进入敌ZOC; 友军占用格以高代价绕行(可穿过不停留)
    // opts.maxNodes: 搜索节点上限（默认 4000），超出即返回 null 让 AI 退回
    //   "可达域逼近 → 邻格兜底"——比穷搜整图更划算，也避免单次调用阻塞主线程。
    findPath(u, destC, destR, opts) {
      const avoidZOC = opts && opts.avoidZOC;
      const start = Hex.key(u.c, u.r), goal = Hex.key(destC, destR);
      if (goal === start) return [];
      // 目标格被敌占 → 永远到不了（A* 会把整图穷搜一遍才放弃），提前返回
      const goalOcc = this.unitAt(destC, destR);
      if (goalOcc && goalOcc.side !== u.side) return null;
      const maxNodes = (opts && opts.maxNodes) || 4000;
      const armor = DATA.TYPES[u.type].armor;
      const gScore = new Map([[start, 0]]);
      const prev = new Map();
      const open = [];
      heapPush(open, start, Hex.distance(u.c, u.r, destC, destR));
      const closed = new Set();
      const FRIEND_PENALTY = 6;
      let expanded = 0;
      while (open.length) {
        const cur = heapPop(open);
        if (closed.has(cur.k)) continue;
        closed.add(cur.k);
        if (cur.k === goal) {
          const path = [];
          let k = goal;
          while (k && k !== start) { path.unshift(Hex.parse(k)); k = prev.get(k); }
          return path;
        }
        if (++expanded > maxNodes) return null;      // 预算用尽：交给上层兜底
        const p = Hex.parse(cur.k);
        if (this.inZOC(p.c, p.r, u.side) && !armor && cur.k !== start) continue;
        for (const n of Hex.neighbors(p.c, p.r)) {
          const nk = Hex.key(n.c, n.r);
          if (!this.map.hexes.has(nk) || closed.has(nk)) continue;
          const occ = this.unitAt(n.c, n.r);
          if (occ && occ.side !== u.side) continue;         // 敌占格不可通过
          let sc = this._terrainStep(u, p.c, p.r, n.c, n.r);
          if (!isFinite(sc)) continue;
          if (occ) sc += FRIEND_PENALTY;                    // 友军占格: 拥堵代价
          // 敌ZOC格: 可进入(引擎将在进入时停止), 路径规划中加代价
          if (!armor && this.inZOC(n.c, n.r, u.side)) sc += (avoidZOC ? 3 : 1);
          const g = gScore.get(cur.k) + sc;
          if (!gScore.has(nk) || g < gScore.get(nk)) {
            gScore.set(nk, g); prev.set(nk, cur.k);
            heapPush(open, nk, g + Hex.distance(n.c, n.r, destC, destR));
          }
        }
      }
      return null;
    }

    // 地形步消耗(不含占用判定)
    _terrainStep(u, fromC, fromR, toC, toR) {
      const from = this.hexAt(fromC, fromR), to = this.hexAt(toC, toR);
      if (!to) return Infinity;
      let cost = DATA.TERRAIN[to.terrain].mv;
      if (from.road && to.road) cost = (u && u.type === 'MOT') ? DATA.TRAIT_KNOBS.MOT_ROAD_COST : DATA.ROAD_COST;   // 公路疾驰(24h)
      if (to.river && !from.river && !to.bridge) cost += DATA.RIVER_EXTRA;
      return cost;
    }

    _setPos(u, c, r) {
      const ok = Hex.key(u.c, u.r);
      if (this.grid.get(ok) === u) this.grid.delete(ok);
      u.c = c; u.r = r;
      this.grid.set(Hex.key(c, r), u);
      this._zocDirty();          // ZOC 缓存失效（位置变了）
    }

    doMove(u, path) {
      if (!u.alive || u.exited || u.side !== this.state.phase || u.moved) return { steps: 0 };
      this._clearPendingAdvance();
      let mp = this.movEff(u);
      const isArmor = DATA.TYPES[u.type].armor;
      // cursor=结算地形消耗用的上一格(含借道格); lastStay=最后可停留格(真正落点)。原版31轮移植。
      let cursor = { c: u.c, r: u.r };
      let lastStay = { c: u.c, r: u.r };
      const walked = [];
      for (const step of path) {
        const occ = this.unitAt(step.c, step.r);
        if (occ && occ !== u && occ.side !== u.side) break;            // 敌占格：不可进入(须攻击)
        const sc = this._terrainStep(u, cursor.c, cursor.r, step.c, step.r);
        if (!isFinite(sc) || sc > mp) break;
        if (occ) {                                                     // 友军占格：只借道不停留
          if (this.inZOC(step.c, step.r, u.side) && !isArmor) break;   // 该停处停不下→不借这步
          mp -= sc; walked.push(step); cursor = step;
          continue;
        }
        mp -= sc; walked.push(step); cursor = step; lastStay = step;
        if (this.inZOC(step.c, step.r, u.side) && !isArmor) break;      // ZOC停止
      }
      // 借道步不能当终点：切掉结尾停在友军格上的步
      while (walked.length && !(walked[walked.length - 1].c === lastStay.c && walked[walked.length - 1].r === lastStay.r)) walked.pop();
      if (!walked.length) return { steps: 0 };
      const last = lastStay;
      const fromHex = this.hexAt(u.c, u.r);
      this._setPos(u, last.c, last.r);
      u.moved = true;
      const toHex = this.hexAt(last.c, last.r);
      // 城镇控制(24q: 统一走 _occupyTown)
      this._occupyTown(u, last.c, last.r);
      // 油库
      if (u.side === 'DE') {
        for (const d of this.map.depots) {
          if (!d.captured && d.c === last.c && d.r === last.r) {
            d.captured = true;
            this.state.fuelDE += d.fuel;
            this.log(`德军夺取${d.name}！燃料 +${d.fuel}`, 'de');
          }
        }
      }
      // 德军渡河(到达马斯河一线)突破 —— 歼灭模式下关闭(否则突围部队永远无法被"歼灭")
      let exited = false;
      if (!this.noTurnLimit && u.side === 'DE' && toHex.exit && (u.type === 'ARM' || u.type === 'MOT')) {
        u.exited = true; u.alive = false;
        this._removeUnit(u);
        this.state.exits++;
        exited = true;
        this.log(`★ ${u.name} 冲出马斯河防线！(累计 ${this.state.exits})`, 'de');
      }
      this.emit('move', { unit: u, path: walked, fromHex, toHex, exited });
      this.emit('state');
      return { steps: walked.length, exited };
    }

    // grid.delete + ZOC 失效：单位死亡/退出/被歼时必须成对调用，
    // 否则 inZOC 会继续按"该处还有敌人"计算，AI 会莫名绕路（2026-10-12 缓存引入时同步加）。
    _removeUnit(u) {
      if (!u) return;
      this.grid.delete(Hex.key(u.c, u.r));
      this._zocDirty();
    }

    /* ---------------- 攻击 ---------------- */
    // 某守方的可选攻击方(不含炮兵)
    attackersFor(defUnit) {
      const side = this.state.phase;
      if (defUnit.side === side) return [];
      const out = [];
      for (const n of Hex.neighbors(defUnit.c, defUnit.r)) {
        const u = this.unitAt(n.c, n.r);
        if (u && u.side === side && u.alive && !u.attacked && u.type !== 'ART' && u.type !== 'RKT' && u.org > 0) out.push(u);
      }
      return out;
    }

    // 射程内可支援的炮兵
    artyInRange(defUnit) {
      const side = this.state.phase;
      const out = [];
      for (const u of this.units) {
        if (!u.alive || u.side !== side || u.type !== 'ART' && u.type !== 'RKT' || u.fired || u.moved) continue;
        let rng = u.range;
        if (this.state.weather === 'fog') rng -= 1;
        if (u.type === 'RKT' && this.inZOC(u.c, u.r, side)) continue; // 26x: 仅火箭炮被贴脸禁射(原规则); ART 相邻可直射/支援
        if (Hex.distance(u.c, u.r, defUnit.c, defUnit.r) <= rng) out.push(u);
      }
      return out;
    }

    previewAttack(attUnits, defUnit, artyUnits) {
      return Combat.preview(this, attUnits, defUnit, artyUnits || []);
    }

    doAttack(attUnits, defUnit, artyUnits) {
      this._clearPendingAdvance();
      if (!defUnit.alive) return null;
      const side = this.state.phase;
      if (defUnit.side === side) return null;
      attUnits = attUnits.filter(u => u.alive && u.side === side && !u.attacked && !u.exited &&
        Hex.distance(u.c, u.r, defUnit.c, defUnit.r) === 1 && u.type !== 'ART' && u.org > 0);
      if (!attUnits.length) return null;
      if (artyUnits) {
        artyUnits = artyUnits.filter(a => a.alive && a.side === side && a.type === 'ART' && !a.fired && !a.moved &&
          Hex.distance(a.c, a.r, defUnit.c, defUnit.r) <= a.range - (this.state.weather === 'fog' ? 1 : 0));
      } else artyUnits = [];
      // 攻击正面限制: 与预览一致的择优截取
      const capped = Combat.capAttack(attUnits, artyUnits);
      attUnits = capped.atts; artyUnits = capped.arty;
      for (const u of attUnits) {
        u.attacked = true;   // 原版33轮移植: 攻击与移动独立
        // 游击奔袭(2026-10-24h): 伞兵/猎兵机动过且未用过二段 → 攻击后解锁第二次机动
        if (u.type === 'FJ' && u.moved && !u.movedTwice) { u.moved = false; u.movedTwice = true; }
      }
      for (const a of artyUnits) a.fired = true;
      const res = Combat.resolve(this, attUnits, defUnit, artyUnits);
      // 清阵亡
      for (const d of res.deadUnits) {
        this._removeUnit(d);
        d.alive = false;
        this.noteKill(d);
        this.log(`${d.side === 'DE' ? '德军' : '美军'}${d.name} 被歼灭`, d.side === 'DE' ? 'us' : 'de');
      }
      // 炮火急袭: 参战单位使用后消耗
      for (const a of attUnits) if (a.fireSupport > 0) a.fireSupport = 0;
      // 反坦克小组: 守方遭纯装甲攻击时开火并消耗(战力比已在预览中降档)
      if (attUnits.length && attUnits.every(u => u.type === 'ARM') && defUnit.attach && defUnit.attach.at) {
        defUnit.attach.at = false;
        this.log(`${this._buffName('at', defUnit.side)} 开火！火箭命中，战力比已降一档`, defUnit.side === 'DE' ? 'de' : 'us');
      }
      // 撤退后城镇不再易手(控制以占领为准)
      const rtxt = { AE: '攻方被击溃', AR: '攻方败退', EX: '互有损伤', DR: '守方败退', DE: '守方被击破' };
      const lossTxt = `｜战损(组织度)：攻方 −${Math.round(res.atkDmg || 0)}${res.atkDead ? `（歼灭 ${res.atkDead} 个建制）` : ''}` +
        `，守方 −${Math.round(res.defDmg || 0)}${res.defDead ? `（歼灭 ${res.defDead} 个建制）` : ''}`;
      this.log(`${attUnits[0].side === 'DE' ? '德军' : '美军'}进攻 ${defUnit.abbr || defUnit.name} @${this._coordName(defUnit.c, defUnit.r)}：` +
        `掷出 ${res.d1}+${res.d2}=${res.roll} → ${res.result}(${rtxt[res.result] || ''})${lossTxt}`, attUnits[0].side === 'DE' ? 'de' : 'us');
      // 被动状态(2026-10): 结算时说明攻防为何偏离纸面(不消耗令牌)
      if (res.preview && res.preview.passives) {
        for (const p of res.preview.passives) {
          if (p.name === '无心再战') {
            this.log(`⚠ ${p.side === 'DE' ? '德军' : '美军'}${p.unit} 被围且军心已散（无心再战：攻防×${p.mult}）`, 'warn');
          } else if (p.name === '困兽犹斗') {
            this.log(`${p.side === 'DE' ? '德军' : '美军'}${p.unit} 被围死地，困兽犹斗（攻防×${p.mult}）`, p.side === 'DE' ? 'de' : 'us');
          }
        }
      }
      if (res.advanceOffer) this.state.pendingAdvance = res.advanceOffer;
      // 装甲目标遭无反装甲火力攻击: 说明伤害为何远低于结果表
      if (res.preview && res.preview.softArmor) {
        this.log(`⚠ 攻击方无反装甲火力 vs 装甲目标：守方受损大幅减免（×${DATA.SOFT_VS_ARMOR_DMG}，下限 ${DATA.SOFT_VS_ARMOR_MIN}），可逐退难歼灭`, 'warn');
      }
      this.emit('combat', { defUnit, attUnits, artyUnits, res });
      this.emit('state');
      return res;
    }

    doAdvance(unit) {
      const pa = this.state.pendingAdvance;
      if (!pa || !unit || !pa.units.includes(unit) || !unit.alive) return false;
      if (this.unitAt(pa.hex.c, pa.hex.r)) { this._clearPendingAdvance(); return false; }
      const from = { c: unit.c, r: unit.r };
      this._setPos(unit, pa.hex.c, pa.hex.r);
      this._occupyTown(unit, pa.hex.c, pa.hex.r);   // 24q: 攻击推进占城
      const hex = this.hexAt(pa.hex.c, pa.hex.r);
      this.state.pendingAdvance = null;
      this.emit('move', { unit, path: [pa.hex], fromHex: this.hexAt(from.c, from.r), toHex: hex, advance: true });
      this.emit('state');
      return true;
    }

    /* 24q 城镇占领规则（用户规定）：城市补给归属随占领动态翻转——
       单位进入敌方城镇格（移动终点/攻击推进/撤退落点）→ 控制权转占领方，
       该城即刻为占领方单位提供补给（_supply 立即重算占领方一侧）；
       原占有方失供在其下一阶段开始时自然结算（断补宽限 UNSUP_GRACE 缓冲）。
       夺回（任一方再次占领）同理翻回。存档随 towns 序列化。 */
    _occupyTown(u, c, r) {
      const hex = this.hexAt(c, r);
      if (!hex || !hex.town || hex.town.ctrl === u.side) return false;
      hex.town.ctrl = u.side;
      const t = this.map.towns.find(t => t.c === c && t.r === r);
      if (t) t.ctrl = u.side;
      this.log(`${u.side === 'DE' ? '德军' : '美军'}${u.name} 占领 ${hex.town.name}`, u.side === 'DE' ? 'de' : 'us');
      this._supply(u.side);   // 占领方即刻享受该城补给（对方失供在下阶段结算，避免每城两次全图 BFS）
      return true;
    }
    _clearPendingAdvance() { this.state.pendingAdvance = null; }

    // 炮兵远程射击(独立攻击)
    artyFire(artyUnit, targetUnit) {
      const isRKT = artyUnit.type === 'RKT';
      if (!artyUnit.alive || (artyUnit.type !== 'ART' && !isRKT) || artyUnit.fired || artyUnit.moved) return null;
      /* 26x: 炮兵特性修复——ART 攻击距离 0-4, 相邻敌军也可直射(贴脸不再禁射);
         RKT 仍按原规则(2-4 盲区 + 被贴脸不能开火 + 不受雾影响)。 */
      if (isRKT && this.inZOC(artyUnit.c, artyUnit.r, artyUnit.side)) return null;
      const K = DATA.TRAIT_KNOBS;
      // 覆盖齐射(2026-10-24h): 火箭炮射程固定 2-4(相邻为发射盲区), 不受雾影响(面压制不依赖精确观测)
      let rng = isRKT ? K.RKT_RANGE : (artyUnit.range - (this.state.weather === 'fog' ? 1 : 0));
      const dist = Hex.distance(artyUnit.c, artyUnit.r, targetUnit.c, targetUnit.r);
      if (isRKT && dist < K.RKT_MIN_RANGE) return null;
      if (dist > rng) return null;
      artyUnit.fired = true;
      const tgtC = targetUnit.c, tgtR = targetUnit.r;   // 24h: 锁定落点(溅射按开火时目标位置, 不随撤退漂移)
      // 远程火力: 用CRT但只结算守方伤害
      const d1 = 1 + Math.floor(this.rng() * 6), d2 = 1 + Math.floor(this.rng() * 6);
      const roll = d1 + d2;
      const pv = Combat.preview(this, [], targetUnit, [artyUnit]);
      let result = '—';
      if (pv.key) result = DATA.CRT[pv.key][roll - 2];
      const dm = DATA.DMG[result] || { def: 0 };
      const out = { d1, d2, roll, result, events: [], deadUnits: [], retreats: [] };
      if (dm.def > 0) {
        this.dmgOrg(targetUnit, dm.def, 'other');
        this._cas(targetUnit.side, dm.def);
        if (targetUnit.org <= 0) {
          targetUnit.alive = false; this._removeUnit(targetUnit);
          this.noteKill(targetUnit);
          out.deadUnits.push(targetUnit);
          this.log(`${targetUnit.side === 'DE' ? '德军' : '美军'}${targetUnit.name} 被炮火歼灭`, targetUnit.side === 'DE' ? 'us' : 'de');
        } else if (result === 'DR' || result === 'DE') {
          const to = Combat.retreatHex(this, targetUnit, null, []);
          if (to) { out.retreats.push({ unit: targetUnit, to }); this._setPos(targetUnit, to.c, to.r); }
        }
        // 覆盖齐射·溅射(2026-10-24h): 目标相邻的敌方单位受本次伤害一半(四舍五入, 至少1)
        if (isRKT && dm.def > 0) {
          const sp = Math.max(1, Math.round(dm.def * DATA.TRAIT_KNOBS.RKT_SPLASH));
          for (const nb of Hex.neighbors(tgtC, tgtR)) {
            const eu = this.unitAt(nb.c, nb.r);
            if (!eu || !eu.alive || eu.side === artyUnit.side || eu === targetUnit) continue;
            this.dmgOrg(eu, sp, 'other');
            this._cas(eu.side, sp);
            if (eu.org <= 0) { eu.alive = false; this._removeUnit(eu); this.noteKill(eu); out.deadUnits.push(eu); }
            this.log(`火箭齐射溅射: ${eu.abbr || eu.name} 受 ${sp} 点损伤`, artyUnit.side === 'DE' ? 'de' : 'us');
          }
        }
      }
      this.log(`炮兵(${artyUnit.abbr}) 轰击 ${targetUnit.abbr || targetUnit.name} @${this._coordName(targetUnit.c, targetUnit.r)}：${roll} → ${result}`, artyUnit.side === 'DE' ? 'de' : 'us');
      this.emit('combat', { defUnit: targetUnit, attUnits: [], artyUnits: [artyUnit], res: out, ranged: true });
      this.emit('state');
      return out;
    }

    // 空袭(美军=战斗轰炸机; 德军=对地攻击机, 2026-10 用户需求 + 史实底板行动)
    // side: 'US' | 'DE'; 令牌分别存于 state.airUS / state.airDE。德军不校验天气(令牌只在晴天发放,
    // 底板行动令牌更是不受天气限制——史实当日德军强行出击)。配属防空火力的目标可随机压制本次空袭。
    airStrike(targetUnit, side) {
      side = side || 'US';
      const field = side === 'US' ? 'airUS' : 'airDE';
      if (this.state[field] <= 0) return null;
      if (side === 'US' && this.state.weather !== 'clear') return null;
      if (!targetUnit.alive || targetUnit.side === side) return null;
      // 须在任意本方单位10格内
      let near = false;
      for (const u of this.units) {
        if (u.alive && u.side === side && Hex.distance(u.c, u.r, targetUnit.c, targetUnit.r) <= 10) { near = true; break; }
      }
      if (!near) return null;
      this.state[field]--;
      const hex = this.hexAt(targetUnit.c, targetUnit.r);
      const blocked = ['forest', 'mountain', 'marsh'].includes(hex.terrain);
      const atk = DATA.AIR_ATK[side][blocked ? 'cover' : 'clear'];
      const d1 = 1 + Math.floor(this.rng() * 6), d2 = 1 + Math.floor(this.rng() * 6);
      const roll = d1 + d2;
      // 直接以固定攻击力对防御(含地形; 断补惩罚按第九轮详细设定: 宽限期不受影响)
      const def = Math.max(0.5, targetUnit.def * (targetUnit.org / targetUnit.maxOrg) * DATA.TERRAIN[hex.terrain].dm *
        Combat.supplyMod(targetUnit));
      const pv = Combat.preview(this, [{ atk, org: 10, maxOrg: 10, supplied: true, c: targetUnit.c, r: targetUnit.r, type: 'ARM' }], targetUnit, []);
      let result = '—';
      if (pv.key) result = DATA.CRT[pv.key][roll - 2];
      const dm = DATA.DMG[result] || { def: 0 };
      const out = { d1, d2, roll, result, air: true, side, events: [], deadUnits: [], retreats: [] };
      // 防空火力: 随机压制本次空袭(史实: 高炮火网是德军飞行员的最大杀手)
      let dmg = dm.def > 0 ? dm.def : 0;
      if (dmg > 0 && targetUnit.attach && targetUnit.attach.aa) {
        if (this.rng() < DATA.AA_REDUCE_CHANCE) {
          dmg = Math.max(1, Math.round(dmg * DATA.AA_REDUCE_MULT));
          out.aaFired = true;
          this.log(`${targetUnit.name} 的防空火力锁定来袭机群，空袭效果被压制！（伤害减半）`, targetUnit.side === 'DE' ? 'de' : 'us');
        }
      }
      if (dmg > 0) {
        this.dmgOrg(targetUnit, dmg, 'other');
        this._cas(targetUnit.side, dmg);
        if (targetUnit.org <= 0) {
          targetUnit.alive = false; this._removeUnit(targetUnit);
          this.noteKill(targetUnit);
          out.deadUnits.push(targetUnit);
          this.log(`${targetUnit.name} 在空袭中被摧毁！`, side === 'US' ? 'us' : 'de');
        } else if (result === 'DR' || result === 'DE') {
          const to = Combat.retreatHex(this, targetUnit, null, []);
          if (to) { out.retreats.push({ unit: targetUnit, to }); this._setPos(targetUnit, to.c, to.r); }
        }
      }
      this.log(`P-47战斗轰炸机 空袭 ${targetUnit.abbr || targetUnit.name} @${this._coordName(targetUnit.c, targetUnit.r)}：${roll} → ${result}`, 'us');
      this.emit('combat', { defUnit: targetUnit, attUnits: [], artyUnits: [], res: out, ranged: true, air: true });
      this.emit('state');
      return out;
    }

    _coordName(c, r) {
      const h = this.hexAt(c, r);
      if (h && h.town) return h.town.name;
      return `(${c},${r})`;
    }

    /* ---------------- 支援资产(增益令牌) ---------------- */
    _freshTokens(side) {
      const t = {};
      for (const k in DATA.BUFFS) t[k] = DATA.BUFFS[k].per;
      return t;
    }
    _buffName(id, side) {
      const b = DATA.BUFFS[id];
      return id === 'at' ? (side === 'US' ? b.usName : b.deName) : b.name;
    }

    // 工兵营自带筑垒能力(2026-10 用户需求): 构筑野战工事时不需要本方令牌, 每单位限一次
    _engrFort(u) {
      return !!(DATA.ENGR_FORT_FREE && u && u.type === 'ENGR');
    }

    // 就地筑垒(2026-10-24h 工兵特性): 工事修在格上、不随单位走; 每工兵营冷却5回合
    canEntrench(u) {
      if (!u || !u.alive || u.exited) return { ok: false, why: '单位不存在' };
      if (u.type !== 'ENGR') return { ok: false, why: '只有工兵营能就地筑垒' };
      if (u.side !== this.state.phase) return { ok: false, why: '只能在己方阶段行动' };
      const k = Hex.key(u.c, u.r);
      if (this.fortHexes.has(k)) return { ok: false, why: '本格已有工事' };
      const cd = DATA.TRAIT_KNOBS.ENGR_ENTRENCH_CD;
      if (this.state.round - (u.entrenchRound || -99) < cd) return { ok: false, why: '冷却中（每' + cd + '回合一次, 还剩 ' + (cd - (this.state.round - (u.entrenchRound || -99))) + ' 回合）' };
      const hex = this.hexAt(u.c, u.r);
      if (!hex) return { ok: false, why: '位置无效' };
      return { ok: true };
    }
    doEntrench(u) {
      const chk = this.canEntrench(u);
      if (!chk.ok) { this.log('筑垒失败: ' + chk.why, 'warn'); return false; }
      this.fortHexes.add(Hex.key(u.c, u.r));
      u.entrenchRound = this.state.round;
      this.log(`${u.side === 'DE' ? '德军' : '美军'}${u.name} 就地筑垒（防御×${DATA.TRAIT_KNOBS.HEX_FORT_MULT}，工事留驻本格）`, u.side === 'DE' ? 'de' : 'us');
      this.emit('state');
      return true;
    }

    // 校验能否为单位赋予增益, 返回 {ok, why}
    canGrant(id, u) {
      const B = DATA.BUFFS[id];
      if (!B) return { ok: false, why: '未知增益' };
      if (id === 'fort' && u && u.type === 'ENGR') return { ok: false, why: '工兵请使用「就地筑垒」（格上工事, 每' + DATA.TRAIT_KNOBS.ENGR_ENTRENCH_CD + '回合一次）' };   // 24h
      if (!u || !u.alive || u.exited) return { ok: false, why: '单位不存在' };
      if (u.side !== this.state.phase) return { ok: false, why: '仅限当前阶段一方' };
      const free = this._engrFort(u) && id === 'fort';
      if (this.state.tokens[u.side][id] <= 0 && !free) return { ok: false, why: `${this._buffName(id, u.side)}本回合已用完` };
      const inf = ['INF', 'VGD', 'FJ', 'ABN'];
      if (id === 'at') {
        if (!inf.includes(u.type)) return { ok: false, why: '反坦克小组只能配属步兵类单位' };
        if (u.attach.at) return { ok: false, why: '该单位已配属反坦克小组' };
      } else if (id === 'med') {
        if (u.org >= u.maxOrg) return { ok: false, why: '该单位无需救护' };
      } else if (id === 'fire') {
        if (u.fireSupport > 0) return { ok: false, why: '该单位已有炮火急袭' };
      } else if (id === 'repl') {
        if (u.org < u.maxOrg) return { ok: false, why: '补充兵员只能配属满编单位' };
        if (u.attach.repl) return { ok: false, why: '该单位已接受过补充兵员' };
      } else if (id === 'fort') {
        if (u.attach.fort) return { ok: false, why: this._engrFort(u) ? '该工兵已构筑过工事' : '该单位已有野战工事' };
      } else if (id === 'aa') {
        if (u.attach.aa) return { ok: false, why: '该单位已配属防空火力' };
      }
      return { ok: true, why: '' };
    }

    grantBuff(id, u) {
      const chk = this.canGrant(id, u);
      if (!chk.ok) return chk;
      // 工兵自带筑垒不扣本方令牌
      const free = this._engrFort(u) && id === 'fort';
      if (!free) this.state.tokens[u.side][id]--;
      if (id === 'at') u.attach.at = true;
      else if (id === 'med') u.org = Math.min(u.maxOrg, u.org + 4);
      else if (id === 'fire') u.fireSupport = 4;
      else if (id === 'repl') { u.attach.repl = true; u.maxOrg += 2; u.org += 2; }
      else if (id === 'fort') u.attach.fort = true;
      else if (id === 'aa') u.attach.aa = true;
      const nm = this._buffName(id, u.side);
      if (free) this.log(`工兵 ${u.name} 就地构筑野战工事（自带能力，防御×1.25，永久）`, u.side === 'DE' ? 'de' : 'us');
      else this.log(`${nm} 配属 ${u.name}${id === 'med' ? '(组织度+4)' : id === 'repl' ? '(组织上限+2)' : ''}`, u.side === 'DE' ? 'de' : 'us');
      this.emit('buff', { unit: u, id });
      this.emit('state');
      return { ok: true, why: '' };
    }

    /* ---------------- 补给 ---------------- */
    // 补给覆盖 = **受地形/道路/河流影响的成本扩散**（不是固定半径）。
    //   数据侧：每座补给城镇有自己的 `range`（成本预算，见 data_big.js TOWNS 第 8 项），
    //          等级越高预算越大（集团军级 52 / 军级 34 / 师级 22）。
    //   地形侧：沿公路推进≈免费 → 覆盖沿公路延伸很远；森林/丘陵/山地/沼泽加价 → 收缩；
    //          渡河（非桥）额外加价。
    //   ⚠️ 性能红线（2026-10-12 实测，勿退回旧写法）：
    //   ① 队列用**下标指针**，不能用 Array.shift()（O(n)，大图上单次劣化到 286-384ms）；
    //   ② 敌占格集合**预先算一次**用 Set 查表，不在内层逐格 unitAt()；
    //   ③ **每个阶段只调用一次**（增援循环里逐营调用会让主线程冻结数十秒）。
    //
    // 单格补给推进代价（成本制，非格数制）
    supplyStepCost(fromHex, toHex) {
      if (!toHex) return Infinity;
      // 沿公路：补给纵队几乎不受地形阻碍（公路本身 1 + 轻微地形摩擦）
      if (fromHex && fromHex.road && toHex.road) {
        return 1 + (DATA.TERRAIN[toHex.terrain].mv - 1) * 0.25;
      }
      let c = DATA.TERRAIN[toHex.terrain].mv;
      if (toHex.river && (!fromHex || !fromHex.river) && !toHex.bridge) c += 2;  // 无桥渡河
      return c;
    }

    // 从单个补给源扩散（成本预算内）。返回 Map('c,r' → 累计代价)
    supplyCoverageFrom(sc) {
      const hexes = this.map.hexes;
      const from = hexes.get(Hex.key(sc.c, sc.r));
      const budget = sc.range || DATA.SUPPLY_R_TOWN;
      const cost = new Map();
      const startKey = Hex.key(sc.c, sc.r);
      cost.set(startKey, 0);
      // 成本是小整数 → 桶队列（按累计代价升序出队，比 sort/shift 都快）
      const buckets = [[{ c: sc.c, r: sc.r }]];
      let cur = 0;
      while (cur < buckets.length) {
        const b = buckets[cur];
        if (!b || !b.length) { cur++; continue; }
        const node = b.pop();
        const ck = Hex.key(node.c, node.r);
        if (cost.get(ck) < cur) continue;          // 已有更优路径
        const fromHex = hexes.get(ck);
        for (const n of Hex.neighbors(node.c, node.r)) {
          const nk = Hex.key(n.c, n.r);
          const toHex = hexes.get(nk);
          if (!toHex) continue;
          // 荒野中心(24h): 通信枢纽的机动补给线不深入无路林海/山脊(城镇网为既成事实, 不受限)
          if (sc.kind === 'sig' && this.wildSet && this.wildSet.has(nk)) continue;
          const nc = cur + this.supplyStepCost(fromHex, toHex);
          if (nc > budget) continue;
          if (cost.has(nk) && cost.get(nk) <= nc) continue;
          cost.set(nk, nc);
          const ci = Math.round(nc);
          if (!buckets[ci]) buckets[ci] = [];
          buckets[ci].push({ c: n.c, r: n.r });
        }
      }
      return cost;
    }

    // 荒野掩膜(2026-10-24h): 林芯/沼泽/山地/前8%山脊 且距最近城镇≥3 —— 与 qa/wilderness_check 同口径
    _calcWild() {
      const hexes = this.map.hexes;
      const arr = [...hexes.values()];
      const cubeOf = (c, r) => [c - ((r - (r & 1)) / 2), r];
      const elevs = arr.filter(h => h.terrain === 'rough' || h.terrain === 'mountain').map(h => h.elev).sort((a, b) => a - b);
      const ridgeThr = elevs[Math.floor(elevs.length * 0.92)] || 1;
      const towns = this.map.towns;
      const ntd = (c, r) => {
        let b = 99;
        for (const t of towns) {
          const [x0, z0] = cubeOf(c, r), [x1, z1] = cubeOf(t.c, t.r);
          const d = Math.max(Math.abs(x0 - x1), Math.abs(-x0 - z0 + x1 + z1), Math.abs(z0 - z1));
          if (d < b) b = d;
        }
        return b;
      };
      const wild = new Set();
      for (const h of arr) {
        if (h.terrain === 'town') continue;
        let kind = false;
        if (h.terrain === 'forest') {
          const [x0, z0] = cubeOf(h.c, h.r);
          let nb = 0, fo = 0;
          for (let dx = -2; dx <= 2; dx++) for (let dz = Math.max(-2, -dx - 2); dz <= Math.min(2, -dx + 2); dz++) {
            const x = x0 + dx, z = z0 + dz, rr = z, cc = x + ((rr - (rr & 1)) / 2);
            const nh = hexes.get(cc + ',' + rr);
            if (nh) { nb++; if (nh.terrain === 'forest') fo++; }
          }
          if (nb && fo / nb >= 0.75) kind = true;
        } else if (h.terrain === 'marsh' || h.terrain === 'mountain' || (h.terrain === 'rough' && h.elev >= ridgeThr)) kind = true;
        if (kind && ntd(h.c, h.r) >= 3) wild.add(Hex.key(h.c, h.r));
      }
      this.wildSet = wild;
    }

    // 兵种特性(2026-10-24h): 空降自持(ABN/FJ 永不断补) + 通信枢纽(SIG 永不断补)
    supplyExempt(u) {
      const t = DATA.TYPES[u.type];
      return !!(t.abn || u.type === 'FJ' || u.type === 'SIG');
    }

    // 该补给源当前是否有效（本方控制 + 无敌军相邻）
    _sourceUsable(sc, side) {
      if (sc.side && sc.side !== side) return false;
      const foe = this.enemyOf(side);
      for (const n of Hex.neighbors(sc.c, sc.r)) {
        const u = this.unitAt(n.c, n.r);
        if (u && u.alive && u.side === foe) return false;
      }
      return true;
    }

    /* 27f: 孤城判定——城镇周边 3 格内敌军战力(攻+防) > 己方战力 × 3 → 视为被围死,
       不再作为补给源（歼灭模式专用）。驻城残兵断补 → 组织度衰减 → 围城可速决。 */
    _townOverrun(sc, side) {
      let mine = 0, foe = 0;
      const foeSide = side === 'DE' ? 'US' : 'DE';
      for (const u of this.units) {
        if (!u.alive || u.exited) continue;
        if (Hex.distance(u.c, u.r, sc.c, sc.r) > 3) continue;
        const pow = (u.atk + u.def) * (u.org / Math.max(u.maxOrg, 1));   // 27f 修正: 有效战力（按组织度折算）——纸面战力会让残兵永远"未被围死"
        if (u.side === side) mine += pow;
        else if (u.side === foeSide) foe += pow;
      }
      return foe > mine * 3;
    }

    // 某一方的全部有效补给源（城镇 + 指挥部）
    supplySources(side) {
      if (DATA.SUPPLY_DISABLED) return [];   // 26g: 师级无补给源
      const out = [];
      /* 27f 歼灭残局孤城断供: 歼灭模式下, 被敌军重兵围死（周边 3 格敌战力 > 己方 3 倍）
         的城镇不再是补给源——残兵缩进孤城每回合满编整补, 攻击永远打不死（实测
         19 个残兵磨了 16 个回合）。常规对局不受影响（零回归风险）。 */
      const enclave = this.noTurnLimit;
      for (const t of this.map.towns) {
        if (!t.supply || t.ctrl !== side) continue;
        const sc = { c: t.c, r: t.r, name: t.name, tier: t.tier, kind: 'town', range: t.range, side: t.ctrl };
        if (enclave && this._townOverrun(sc, side)) continue;
        if (this._sourceUsable(sc, side)) out.push(sc);
      }
      for (const u of this.units) {
        if (u.alive && !u.exited && u.side === side && u.isHQ) {
          const sc = { c: u.c, r: u.r, name: u.name, tier: 2, kind: 'hq', range: DATA.SUPPLY_R_HQ * 4, side };
          /* 27f: 指挥部源同样受孤城断供约束——残局口袋靠自己的指挥部满编整补, 永远打不死 */
          if (enclave && this._townOverrun(sc, side)) continue;
          if (this._sourceUsable(sc, side)) out.push(sc);
        }
      }
      // 通信枢纽(2026-10-24h): 通信营作为机动补给源, 周围3格(成本预算6)内友军可获补给
      for (const u of this.units) {
        if (u.alive && !u.exited && u.side === side && u.type === 'SIG') {
          const sc = { c: u.c, r: u.r, name: u.name, tier: 1, kind: 'sig', range: DATA.TRAIT_KNOBS.SIG_SUPPLY_RANGE, side };
          if (this._sourceUsable(sc, side)) out.push(sc);
        }
      }
      return out;
    }

    // 展示用：某座城镇当前的补给覆盖（可指定阵营；缺省用其控制方）
    // 侧别过滤：扩散**不得穿越敌占格**，否则会出现"美军城镇给德军供血"
    // 这种假象（2026-10-12 实测：埃希特纳赫的纯距离覆盖里混进 92 个德军营）。
    // 显示层与 _supply() 用同一套规则，避免"显示得很大、实际供不到"。
    townCoverage(c, r, side) {
      if (DATA.SUPPLY_DISABLED) return null;   // 26g: 师级不展示补给覆盖
      const t = this.map.towns.find(x => x.c === c && x.r === r);
      if (!t || !t.supply) return null;
      const sd = side || t.ctrl;
      const sc = { c: t.c, r: t.r, name: t.name, tier: t.tier, kind: 'town', range: t.range, side: t.ctrl };
      const usable = this._sourceUsable(sc, sd);
      let cost = new Map();
      if (usable) {
        const blocked = new Set();
        for (const u of this.units) {
          if (u.alive && !u.exited && u.side !== sd) blocked.add(Hex.key(u.c, u.r));
        }
        for (const [k, v] of this.supplyCoverageFrom(sc)) if (!blocked.has(k)) cost.set(k, v);
      }
      return { source: sc, side: sd, usable, range: t.range || DATA.SUPPLY_R_TOWN, cost };
    }

    _supply(side) {
      /* 26g: 师级剧本取消补给机制——所有单位恒有补给（整补/断补判定全部跳过） */
      if (DATA.SUPPLY_DISABLED) {
        for (const u of this.units) {
          if (u.side === side && u.alive && !u.exited) { u.supplied = true; u.unsupRounds = 0; }
        }
        return;
      }
      const reach = new Set();
      // 敌占格集合（扩散不得穿越）
      const enemy = this.enemyOf(side);
      const blocked = new Set();
      for (const u of this.units) {
        if (u.alive && !u.exited && u.side === enemy) blocked.add(Hex.key(u.c, u.r));
      }
      // 每个补给源按自己的成本预算扩散（预算取自 t.range；缺省退回统一半径）
      for (const sc of this.supplySources(side)) {
        const cost = this.supplyCoverageFrom(sc);
        for (const k of cost.keys()) if (!blocked.has(k)) reach.add(k);
      }
      for (const u of this.units) {
        if (u.side === side && u.alive && !u.exited) {
          const now = reach.has(Hex.key(u.c, u.r));
          // 仅在状态变化时报告断补
          if (!now && u.supplied && !this.supplyExempt(u)) {
            this.log(`${u.side === 'DE' ? '德军' : '美军'}${u.name} 补给被切断！（宽限 ${DATA.UNSUP_GRACE} 回合）`, 'warn');
          }
          u.supplied = now;
        }
      }
      return reach;
    }

    /* ---------------- 回合流程 ---------------- */
    _startPhase() {
      const side = this.state.phase;
      // 刷新本方支援令牌; 上一阶段未使用的炮火急袭失效
      this.state.tokens[side] = this._freshTokens(side);
      for (const u of this.units) if (u.side === side) u.fireSupport = 0;
      this._supply(side);
      // 断补计数(第九轮): 断补在己方阶段开始时 +1 回合, 恢复补给即清零。
      // 宽限期(前 UNSUP_GRACE 回合)内无任何惩罚; 组织度损耗/移动力减半/攻防修正都按它计。
      for (const u of this.units) {
        if (!u.alive || u.exited || u.side !== side) continue;
        if (!u.supplied && !this.supplyExempt(u)) {
          const was = u.unsupRounds || 0;
          u.unsupRounds = was + 1;
          if (was === DATA.UNSUP_GRACE) {
            this.log(`${u.side === 'DE' ? '德军' : '美军'}${u.name} 断补超过宽限期，攻防开始受损`, 'warn');
          }
        } else {
          u.unsupRounds = 0;
        }
      }
      // 整补
      for (const u of this.units) {
        if (!u.alive || u.exited || u.side !== side) continue;
        const t = DATA.TYPES[u.type];
        if (u.supplied) {
          const hex = this.hexAt(u.c, u.r);
          const inTown = hex.town && hex.town.ctrl === side;
          const rec = Math.max(1, Math.round((inTown ? 3 : 2) * (DATA.RECOVER_SCALE || 1)));   // 26k: 整补同比放大
          u.org = Math.min(u.maxOrg, u.org + rec);
        } else if (!this.supplyExempt(u) && u.unsupRounds > DATA.UNSUP_GRACE) {
          // 断补组织度损耗: 宽限期(前两回合)不损耗, 第 3 回合起每阶段 -1(现行设定生效时点后移)
          this.dmgOrg(u, Math.max(1, Math.round(1 * (DATA.DMG_SCALE || 1))), 'other');   // 26k: 断补损耗同比
          this._cas(side, 1);
          if (u.org <= 0) {
            u.alive = false; this._removeUnit(u);
            this.noteKill(u);
            this.log(`${side === 'DE' ? '德军' : '美军'}${u.name} 因断补与疲惫而溃散`, 'warn');
            this.emit('elim', u);
          }
        }
        u.moved = false; u.attacked = false; u.fired = false; u.movedTwice = false;
        if (u.entrenchRound === undefined) u.entrenchRound = -99;
      }
      // 增援
      // ⚠️ 性能红线：_supply() 是"全图 BFS × 全部补给源"，必须在**整批增援
      //    入场后调用一次**，不能每入场一个营就调一次。旧写法在 152×96 图上
      //    遇到 R3 的单批 138 营时会造成主线程冻结数十秒（2026-10-12 实测）。
      let reinN = 0;
      for (const row of (side === 'DE' ? DATA.OOB_DE : DATA.OOB_US)) {
        if (row[9] === this.state.round) {
          const u = this._addUnit({ id: row[0], name: row[1], abbr: row[2], type: row[3], atk: row[4], def: row[5], mov: row[6], c: row[7], r: row[8], side, arrive: row[9], org: row[10], maxOrg: row[11] });   // 24i
          this.log(`【增援】${side === 'DE' ? '德军' : '美军'}${u.name} 进入战场！`, side === 'DE' ? 'de' : 'us');
          this.emit('reinforce', u);
          reinN++;
        }
      }
      if (reinN) this._supply(side);      // 一批增援只重算一次补给
      if (side === 'US') {
        this.state.airUS = (this.state.weather === 'clear' && this.state.round >= this.scenario.airFrom) ? 2 : 0;
        if (this.state.airUS > 0) this.log('天气晴好，美军战斗机-轰炸机联队可以出击(2次空袭)', 'us');
      } else {
        // 德军空袭(2026-10): 史实 12/16~12/23 恶劣天气德军航空兵停飞, 12/24 起才有成规模出击;
        // 1945-01-01 底板行动一次性倾巢出动(不受当天天气限制, 史实当日德军强行起飞)
        let n = (this.state.weather === 'clear' && this.state.round >= DATA.DE_AIR_FROM) ? DATA.DE_AIR_PER_CLEAR : 0;
        let boden = false;
        if (this.state.round === DATA.DE_AIR_BODENPLATTE_ROUND) { n += DATA.DE_AIR_BODENPLATTE_TOKENS; boden = true; }
        this.state.airDE = n;
        if (boden) this.log(`◈ 底板行动：德国空军倾巢出动空袭盟军机场(${DATA.DE_AIR_BODENPLATTE_TOKENS}次空袭)——这是它最后的大规模出击`, 'de');
        else if (n > 0) this.log('天气放晴，德国空军对地攻击机队可以出击(1次空袭)', 'de');
      }
      this.emit('phase');
      this.emit('state');
    }

    endPhase() {
      if (this.state.over) return;
      this._clearPendingAdvance();
      const side = this.state.phase;
      // 德军燃料结算
      if (side === 'DE') {
        let burn = 0;
        for (const u of this.units) if (u.alive && u.side === 'DE' && u.moved && u.type === 'ARM') burn++;
        this.state.fuelDE = Math.max(0, this.state.fuelDE - burn);
        if (burn > 0) this.log(`德军装甲集群消耗燃料 ${burn} 点(剩余 ${this.state.fuelDE})`, 'de');
      }
      if (this.noTurnLimit) {
        // 歼灭模式(第二十三轮): 每阶段结束都查一次——任一方全部建制(含未入场援军)归零即终局
        this._checkAnnihilation();
        if (this.state.over) { this.emit('over'); this.emit('state'); return; }
      }
      if (side === 'DE') {
        this.state.phase = 'US';
        this.log(`── 第${this.state.round}回合 · 美军阶段 ──`, 'sys');
        this._startPhase();
      } else {
        // 回合结束 → 胜负检查（歼灭模式下由上面的 _checkAnnihilation 负责，无回合上限）
        if (!this.noTurnLimit) {
          this._checkVictory();
          if (this.state.over) { this.emit('over'); this.emit('state'); return; }
        }
        this.state.round++;
        this.state.phase = 'DE';
        /* 26y 僵持保险丝（仅歼灭模式）: 连续 STALL_ROUNDS 个回合「双方存活数 + 累计伤亡」完全不变
           → 战场已无有效交战（残兵互不可及/只剩无法互攻的单位）, 按剩余建制判胜者并终局。
           这是最后一道保险: AI 猎杀逻辑（26y allOut 全军扑残敌）已消除绝大多数僵持,
           保险丝只在物理上真的打不到时兜底, 10 回合内不会有任何正常对局被它结束。 */
        if (this.noTurnLimit) {
          /* 27f 硬化: 签名只看双方存活数——炮兵/空袭的零星掉血不再重置保险丝,
             真正的"部队够不着"僵持 10 回合内必触发 */
          const sig = this._aliveCount('DE') + '|' + this._aliveCount('US');
          if (this.state._stallSig === sig) this.state._stallRounds = (this.state._stallRounds || 0) + 1;
          else { this.state._stallSig = sig; this.state._stallRounds = 0; }
          if (this.state._stallRounds >= 10) {
            const deL = this._remaining('DE'), usL = this._remaining('US');
            this.state.over = true;
            this.state.winner = deL > usL ? 'DE' : 'US';
            this.state.victoryKey = deL > usL ? 'DE_tactical' : 'US_win';
            this.state.endText = `战场陷入僵持已 ${this.state._stallRounds} 个回合（双方均无有效交战、无战损）。` +
              `按剩余建制裁定：德军剩 ${deL}，美军剩 ${usL}，` +
              (deL > usL ? '德军' : '美军') + '判定为推演胜方。';
            this.log(`◆ 僵持终止（连续 ${this.state._stallRounds} 回合零战果）——按剩余建制裁定`, 'sys');
            this.emit('over'); this.emit('state'); return;
          }
        }
        if (!this.noTurnLimit && this.state.round > this.scenario.rounds) {
          this._finalVerdict();
          this.emit('over'); this.emit('state');
          return;
        }
        this._rollWeather(false);
        this.log(`── 第${this.state.round}回合 · ${this._dateStr()} · 天气:${this._weatherName()} ──`, 'sys');
        this._eventNotes();
        this._startPhase();
      }
      this.emit('state');
      this._save();
    }

    _dateStr() {
      // 史实日历表(见 data.js DATES): 与 EVENTS 史实注记逐条对齐; 越界时退回线性推算
      const iso = DATA.DATES[this.state.round - 1];
      if (iso) { const p = iso.split('-'); return `${+p[0]}年${+p[1]}月${+p[2]}日`; }
      const d = new Date(1944, 11, 15 + this.state.round);
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }

    _rollWeather(force) {
      const table = this.state.round >= this.scenario.lateWeather ? DATA.WEATHER_PROB.late : DATA.WEATHER_PROB.early;
      const x = this.rng();
      if (x < table.clear) this.state.weather = 'clear';
      else if (x < table.clear + table.fog) this.state.weather = 'fog';
      else this.state.weather = 'snow';
      this.emit('weather', this.state.weather);
    }

    _eventNotes() {
      const note = DATA.EVENTS[this.state.round];
      if (note) this.log(`◈ 史实注记：${note}`, 'hist');
    }

    /* ---------------- 胜负 ---------------- */
    _holds(name) { const t = this.map.townMap[name]; return t && t.ctrl === 'DE'; }

    /* ---- 歼灭模式（取消回合限制，第二十三轮）---- */
    // 在场存活（含已阵亡不计、渡河退出在本模式下不存在）
    _aliveCount(side) { return this.units.filter(u => u.alive && !u.exited && u.side === side).length; }
    // 尚未入场的援军行数：按 id 判断该 OOB 行是否已经 spawn 过（units 保留阵亡者，故 id 在册即已入场）
    _pendingReinforce(side) {
      const rows = side === 'DE' ? DATA.OOB_DE : DATA.OOB_US;
      let n = 0;
      for (const row of rows) {
        if (row[9] <= 0) continue;                                   // 开局单位，不在"援军"之列
        if (!this.units.some(u => u.side === side && u.id === row[0])) n++;
      }
      return n;
    }
    // 一方"剩余建制" = 在场存活 + 尚未入场的援军；归零即被彻底歼灭
    _remaining(side) { return this._aliveCount(side) + this._pendingReinforce(side); }
    _checkAnnihilation() {
      const st = this.state;
      if (st.over) return;
      const deLeft = this._remaining('DE'), usLeft = this._remaining('US');
      if (deLeft === 0) {
        st.over = true; st.winner = 'US';
        st.endText = '歼灭战胜利！德军在阿登的全部建制——包括最后赶到的援军——已被逐一消灭，突出部再无一兵一卒。';
        st.victoryKey = 'US_annihilation';
        this.log('◆ 德军全部建制被歼灭，战役结束！', 'us');
      } else if (usLeft === 0) {
        st.over = true; st.winner = 'DE';
        st.endText = '歼灭战胜利！美军在阿登的全部建制——包括驰援的各师与独立营——已被逐一消灭，通往马斯河的道路再无阻挡。';
        st.victoryKey = 'DE_annihilation';
        this.log('◆ 美军全部建制被歼灭，战役结束！', 'de');
      }
    }

    _checkVictory() {
      const st = this.state;
      if (st.over) return;
      const holdsBoth = this._holds('圣维特') && this._holds('巴斯托涅');
      if (st.round >= 10 && holdsBoth) {
        st.over = true; st.winner = 'DE';
        st.endText = '德军决定性胜利！圣维特与巴斯托涅双双陷落，美军第12集团军群防线被拦腰斩断。';
        st.victoryKey = 'DE_decisive';
        this.log('◆ 德军夺取两大枢纽，达成决定性突破！', 'de');
        return;
      }
      if (!this.scenario.campaign && st.round > this.scenario.rounds) this._finalVerdict();
    }

    _finalVerdict() {
      const st = this.state;
      const holdsStV = this._holds('圣维特'), holdsBast = this._holds('巴斯托涅'), holdsHouf = this._holds('豪法利兹');
      const usLoss = this._lossPct('US');
      if (!this.scenario.campaign) {
        const obj = (st.exits >= 1 ? 1 : 0) + (holdsStV ? 1 : 0) + (holdsBast ? 1 : 0);
        const exitsNeed = this.scenario.exitsNeeded || DATA.EXITS_NEEDED;   // 25d: 攻势剧本可自带门槛
        if (st.exits >= exitsNeed) {
          st.over = true; st.winner = 'DE';
          st.endText = `德军决定性胜利！${st.exits}个装甲战斗群冲过马斯河，通往安特卫普的大门洞开。`;
          st.victoryKey = 'DE_decisive';
        } else if (obj >= 2) {
          st.over = true; st.winner = 'DE';
          st.endText = `德军战术胜利。${st.exits > 0 ? '一部抵达马斯河，' : ''}${holdsStV ? '圣维特' : ''}${holdsStV && holdsBast ? '与' : ''}${holdsBast ? '巴斯托涅' : ''}易手，但攻势未能发展成合围。`;
          st.victoryKey = 'DE_tactical';
        } else if (obj === 0 && usLoss < 0.25) {
          st.over = true; st.winner = 'US';
          st.endText = '美军决定性胜利！德军攻势处处受挫，未能夺取任何目标，损失惨重。';
          st.victoryKey = 'US_decisive';
        } else {
          st.over = true; st.winner = 'US';
          st.endText = '美军胜利。突出部被挡住并逐次削平，德军最后的赌注输光了。';
          st.victoryKey = 'US_win';
        }
      } else {
        const usHolds = [holdsStV, holdsBast, holdsHouf].filter(x => !x).length;
        const deHolds = 3 - usHolds;
        const deLoss = this._lossPct('DE');
        if (usHolds === 3 && deLoss >= 0.35) {
          st.over = true; st.winner = 'US';
          st.endText = '美军决定性胜利！三大枢纽全部收复，德军重兵集团遭到重创。';
          st.victoryKey = 'US_decisive';
        } else if (deHolds >= 2) {
          st.over = true; st.winner = 'DE';
          st.endText = '德军胜利。突出部得以保持，盟军反攻未能达成目标。';
          st.victoryKey = 'DE_hold';
        } else {
          st.over = true; st.winner = 'US';
          st.endText = '美军惨胜。突出部最终被削平，但德军主力得以脱身。';
          st.victoryKey = 'US_pyrrhic';
        }
      }
      this.log(`◆ 战役结束 — ${st.winner === 'DE' ? '德军' : '美军'}获胜`, 'sys');
    }

    /* ---------------- 存档 ---------------- */
    _save() {
      try {
        if (typeof localStorage === 'undefined') return;
        const data = this.serialize();
        localStorage.setItem('ardennes44_save', JSON.stringify(data));
      } catch (e) { /* ignore */ }
    }
    serialize() {
      return {
        v: 1, scenarioId: this.scenario.id, rngSeed: this.rngSeed,
        state: JSON.parse(JSON.stringify(this.state, (k, v) => k === 'pendingAdvance' ? undefined : v)),
        towns: this.map.towns.map(t => ({ n: t.name, ctrl: t.ctrl })),
        depots: this.map.depots.map(d => ({ n: d.name, cap: d.captured })),
        log: this.logEntries.slice(-60),
        units: this.units.map(u => ({
          id: u.id, uid: u.uid, c: u.c, r: u.r, org: u.org, maxOrg: u.maxOrg, alive: u.alive, exited: u.exited,
          moved: u.moved, attacked: u.attacked, fired: u.fired, supplied: u.supplied, unsup: u.unsupRounds || 0,
          movedTwice: !!u.movedTwice, entrenchRound: u.entrenchRound || 0,
          attach: { at: !!u.attach.at, fort: !!u.attach.fort, repl: !!u.attach.repl, aa: !!u.attach.aa },
        })),
      };
    }
    /* 25a 撤子: 快照/恢复（复用存档序列化, 同一局内回滚单步玩家操作） */
    snapshotJson() { return JSON.stringify(this.serialize()); }
    restoreJson(json) {
      /* 25a: _load 假定空容器(仅构造时调用); 撤子是同局中途回滚, 必须先清空
         units/grid, 否则新旧两套算子叠加、uid 撞车(曾致恢复后位置不回滚) */
      this.units = [];
      this.grid.clear();
      this._zocDirty();
      this._load(JSON.parse(json));
    }
    _load(s) {
      // 恢复状态
      this.state = Object.assign({}, s.state);
      this.state.pendingAdvance = null;
      this.fortHexes = new Set(this.state.fortHexes || []);   // 就地筑垒(24h): 数组→Set, 旧档无字段=空
      this._calcWild();   // 24h: 荒野掩膜(读档)
      // 取消回合限制开关随存档恢复（旧存档无此字段 → false，行为不变）
      if (this.state.noTurnLimit === undefined) this.state.noTurnLimit = false;
      this.noTurnLimit = !!this.state.noTurnLimit;
      for (const t of s.towns) {
        const mt = this.map.townMap[t.n];
        if (mt) { mt.ctrl = t.ctrl; const h = this.hexAt(mt.c, mt.r); if (h && h.town) h.town.ctrl = t.ctrl; }
      }
      for (const d of s.depots) {
        const md = this.map.depots.find(x => x.name === d.n);
        if (md) md.captured = d.cap;
      }
      const byId = {};
      for (const row of DATA.OOB_DE) byId[row[0] + '_DE'] = row;
      for (const row of DATA.OOB_US) byId[row[0] + '_US'] = row;
      UID = 1;
      for (const su of s.units) {
        const key = su.id + (DATA.OOB_DE.find(r => r[0] === su.id) ? '_DE' : '_US');
        const row = byId[key];
        if (!row) continue;
        const u = this._addUnit({ id: row[0], name: row[1], abbr: row[2], type: row[3], atk: row[4], def: row[5], mov: row[6], c: su.c, r: su.r, side: key.endsWith('_DE') ? 'DE' : 'US', arrive: row[9], org: su.org, maxOrg: row[11], homeR: row[8] })   // 24i;
        u.uid = su.uid; u.org = su.org; u.alive = su.alive; u.exited = su.exited;
        u.moved = su.moved; u.attacked = su.attacked; u.fired = su.fired; u.supplied = su.supplied;
        u.unsupRounds = su.unsup || 0;   // 旧存档无此字段 → 0(宽限期重新计, 可接受)
        u.movedTwice = !!su.movedTwice; u.entrenchRound = su.entrenchRound || -99;   // 24h: 游击奔袭/就地筑垒
        u.maxOrg = su.maxOrg || 10;
        u.attach = su.attach || { at: false, fort: false, repl: false };
        if (!u.alive || u.exited) { this._removeUnit(u); }
      }
      UID = Math.max(UID, ...s.units.map(u => u.uid || 0)) + 1;
      this.logEntries = s.log || [];
      this.rng = mulberry32(this.rngSeed);
      // 重掷一遍以推进随机流近似(简单处理: 不重放)
    }
  }

  return Game;
})();
