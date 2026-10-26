'use strict';
/* ============================================================
 * ai.js — 双方启发式 AI
 * 德军: 装甲沿走廊突破(圣维特→乌尔特河→马斯河), 集中优势火力攻坚
 * 美军: 城镇据守、受压迟滞后撤、预备队驰援、晴天空袭; 第二阶段反攻
 * 模式: plan(静态计划) → execute(逐步执行+动态补刀)
 * ============================================================ */
globalThis.AI = (function () {

  const T = DATA.TYPES;

  // 美军要点城镇（守备优先级名单）：任务目标层 usObjective 的唯一依据，
  // 避免名单各写一份而漂移（旧代码在 aiSpendTokens 里还有一份硬编码副本，已删）。
  // 德军侧对应 SIDE_CFG.DE.keyTowns（第二十八轮统一行为层后的对称结构）。
  const US_KEY_TOWNS = ['圣维特', '巴斯托涅', '克莱沃', '维尔茨', '豪法利兹', '斯塔沃洛', '马尔梅迪', '马尔什'];

  function armor(u) { return T[u.type].armor; }

  /* ============================================================
   * 态势 / 被动特性评估（2026-10 第二十一轮新增）
   * ------------------------------------------------------------
   * 被动状态由 Combat.passiveState 统一判定（与战斗结算同一套逻辑 → 预览/结算天然一致）：
   *   协同作战  邻接友军 ≥ PASSIVE.coordMinFriends(2)                → 攻防 ×1.10
   *   困兽犹斗  被围(0 友邻) 且 邻敌 ≥ encMinEnemies(3) 且士气判定过 → 攻防 ×1.15
   *   无心再战  被围但士气判定没过                                  → 攻防 ×0.60
   * AI"主动经营被动"的两个抓手：
   *   ① 机动落点评分含"邻接友军数"（吃到协同）与"落点是否会被围"（0 友邻 + 邻敌≥3 是陷阱）；
   *   ② 选靶时优先打被动对敌方不利的目标（无心再战 ×0.60 / 已过宽限期的断补 → 一推就散）。
   * ⚠️ passiveState 只读棋盘态势、不消耗 game.rng（见 combat.js 的 moraleRoll 注释），
   *    因此可以在规划阶段反复调用而不会改变后续掷骰序列。
   * ============================================================ */
  function passiveOf(game, u) { return Combat.passiveState(game, u); }

  // 单位"假如站在 (c,r)"时的邻接友军 / 敌军数（不改动任何状态）
  function friendsAt(game, u, c, r) {
    let n = 0;
    for (const p of Hex.neighbors(c, r)) {
      const f = game.unitAt(p.c, p.r);
      if (f && f.alive && f !== u && f.side === u.side) n++;
    }
    return n;
  }
  function enemiesAt(game, u, c, r) {
    let n = 0;
    for (const p of Hex.neighbors(c, r)) {
      const f = game.unitAt(p.c, p.r);
      if (f && f.alive && f.side !== u.side) n++;
    }
    return n;
  }

  // 目标"软度"（德军选靶用）：敌方被动/断补状态越糟越好打
  function targetSoftness(game, e) {
    const ps = passiveOf(game, e);
    let s = 0;
    if (ps.key === 'broken') s += 0.8;                                  // 无心再战 ×0.60：一推就散
    if (ps.key === 'coord') s -= 0.25;                                  // 协同 ×1.10：硬骨头
    if ((e.unsupRounds || 0) > (DATA.UNSUP_GRACE || 0)) s += 0.5;      // 断补已过宽限期：攻防打折
    return s;
  }

  /* ============================================================
   * 单位价值与期望交换（2026-10 第二十五轮: "用低价值部队歼灭敌人高价值部队"）
   * ------------------------------------------------------------
   * unitValue: 单位"账面价值" —— 战力(atk+def)为基线, 装甲/反装甲/炮兵溢价, 残破线性贬值。
   *   美军步兵团 ≈ 0.8~0.9, 德军装甲营 ≈ 2.0~2.3 —— 用步兵团换掉装甲营就是大赚。
   * attackWorth: 一次攻击的期望交换收益 = 守方期望价值损失 − 攻方期望价值损失 × LOSS_AVERSION。
   *   期望伤害直接查本次 preview 的 CRT 行(11 个骰值等概率), 与结算同一张表 → 评估天然一致。
   *   ⚠️ 引擎口径: resolve 对"传入的攻方名单全体"结算伤害(每个单位全额挨 dm.atk),
   *      而 preview 只按攻击正面(3 地面 + 2 炮兵)计战力 —— 所以组队必须在 ≤3+2 内做,
   *      超编的单位白白挨打。softArmor(无反装甲火力打装甲 → 守方伤害×0.25)在这里自动
   *      压低 worth, "没巴祖卡就别咬坦克"不再需要任何特判。
   * ============================================================ */
  function unitValue(u) {
    const t = T[u.type];
    let v = (u.atk + u.def) / 10;
    if (t.armor) v *= 1.5;
    else if (t.antiArmor) v *= 1.3;
    else if (u.type === 'ART') v *= 1.4;
    return v * (0.3 + 0.7 * u.org / u.maxOrg);
  }

  // CRT 行的期望组织度伤害(每个参战单位全额挨打, 11 个骰值等概率)
  function crtExpect(row) {
    let a = 0, d = 0;
    for (const r of row) { a += DATA.DMG[r].atk; d += DATA.DMG[r].def; }
    return { atk: a / row.length, def: d / row.length };
  }

  const LOSS_AVERSION = 1.15;   // 攻方损失厌恶: 防御方反冲击留 15% 安全边际
  function attackWorth(game, atts, e, arty, pv) {
    if (!pv || !pv.row) return -1;
    const ex = crtExpect(pv.row);
    let atkLoss = 0;
    for (const a of atts) atkLoss += unitValue(a) * Math.min(ex.atk, a.org) / Math.max(a.maxOrg, 1);
    if (arty && arty.length) {
      let pHit = 0;                                    // 炮兵挨打 = min(1, dm.atk−2): 仅 AE(7)/EX(3) 达标
      for (const r of pv.row) if (DATA.DMG[r].atk >= 3) pHit++;
      const p = pHit / pv.row.length;
      for (const a of arty) atkLoss += unitValue(a) * p / Math.max(a.maxOrg, 1);
    }
    let dLoss = Math.min(ex.def, e.org);
    if (pv.softArmor) dLoss = Math.max(DATA.SOFT_VS_ARMOR_MIN, dLoss * DATA.SOFT_VS_ARMOR_DMG);
    return unitValue(e) * dLoss / Math.max(e.maxOrg, 1) - atkLoss * LOSS_AVERSION;
  }

  // 美军攻击组队(第二十五轮): 便宜高效的单位先顶(每点战力的价值成本升序), 再做前缀扫描
  //   挑期望交换最好的规模 —— 1 个够就不带 2 个, 2 个够就不带 3 个(少暴露一个是一个)。
  //   炮兵取射程内战力最高的 2 门(攻击正面上限): 炮兵几乎不挨打, 且参战即消除 softArmor,
  //   是"步兵围猎装甲"的火力基石。opts.excludeFire: 急袭令牌选靶时排除已带 fireSupport 的单位。
  function attackGroup(game, e, planned, opts) {
    let pool = game.attackersFor(e)
      .filter(u => !planned.has(u.uid) && !(opts && opts.excludeFire && u.fireSupport > 0));
    // maxForce（第二十七轮·血战）：不求交换比、求最大拳头 —— 直接上最强 3 地面 + 2 炮兵
    if (opts && opts.maxForce) {
      pool = pool.sort((a, b) => b.atk * (b.org / b.maxOrg) - a.atk * (a.org / a.maxOrg));
    } else {
      pool = pool.sort((a, b) => unitValue(a) / (a.atk * (a.org / a.maxOrg) + 0.1) -
        unitValue(b) / (b.atk * (b.org / b.maxOrg) + 0.1));
    }
    if (!pool.length) return null;
    const arty = game.artyInRange(e).filter(a => !planned.has(a.uid))
      .sort((a, b) => b.sup - a.sup).slice(0, 2);
    if (opts && opts.maxForce) {
      const atts = pool.slice(0, 3);
      const pv = game.previewAttack(atts, e, arty);
      if (!pv.key) return null;
      return { atts, arty, pv, w: attackWorth(game, atts, e, arty, pv) };
    }
    let best = null;
    for (let k = 1; k <= Math.min(3, pool.length); k++) {   // 攻击正面 FRONTAGE=3
      const atts = pool.slice(0, k);
      const pv = game.previewAttack(atts, e, arty);
      if (!pv.key) continue;
      const w = attackWorth(game, atts, e, arty, pv) - k * 0.02;  // 期望同分时倾向少用兵
      if (w > (best ? best.w : -1e9)) best = { atts, arty, pv, w };
    }
    return best;
  }

  // 攻击后的推进人选（第二十五轮）: 美军"便宜单位顶线" —— 推进进德军空格的是最便宜的单位,
  //   装甲营等高价值单位留在原地继续防; 德军维持引擎默认(装甲优先, 扩大突破)。
  function pickAdvancer(side, offer) {
    const alive = offer.units.filter(u => u.alive);
    if (!alive.length) return null;
    if (side === 'US') alive.sort((a, b) => unitValue(a) - unitValue(b));
    return alive[0];
  }

  // 防御阵地评分（美军发扬防御力优势用）：地形加成 + 己控城镇 + 协同 − 被围风险
  function defPositionScore(game, u, c, r) {
    const h = game.hexAt(c, r);
    if (!h) return -99;
    let s = DATA.TERRAIN[h.terrain].dm * 3;
    if (h.town) s += (h.town.tier >= 2 ? 1.8 : 0.9) + (h.town.ctrl === u.side ? 1.0 : 0);
    if (u.attach && u.attach.fort) s += 1.2;                            // 已筑工事: 走了就白丢 ×1.25, 留守加分
    const fr = friendsAt(game, u, c, r), en = enemiesAt(game, u, c, r);
    s += Math.min(fr, DATA.PASSIVE.coordMinFriends) * 0.8;              // 协同：≥2 友邻即满收益
    if (fr === 0 && en >= DATA.PASSIVE.encMinEnemies) s -= 4.0;         // 被围陷阱（可能"无心再战"）
    else if (fr === 0 && en >= 2) s -= 1.0;
    if (en > 3) s -= 0.8 * (en - 3);                                    // 邻敌过多：侧翼全露
    return s;
  }

  // 路径安全截断（第二十一轮）：引擎的 doMove 不检查占用（§19 坑 1 的同格冲突根源，
  //   getReach / findPath 都允许"经过"已有单位格），所以 AI 自己保证规划出的路径在
  //   被占用格之前停下；此外还要避开"本次计划里已被其他单位预定"的落点（两份计划撞同一格）。
  let reserved = null;   // 本次 planTurn 内已被预定的落点（Hex.key 集合），planTurn 首尾重置
  function safePath(game, path, side) {
    if (!path || !path.length) return null;
    const out = [];
    // 原版31轮移植: 与引擎借道口径统一——友军占格可穿过不停留, 敌占格到此为止;
    // 本回合已被预定的落点不借道也不停留; 收尾把停在友军格上的尾步切掉。
    for (const p of path) {
      const occ = game.unitAt(p.c, p.r);
      if (occ && occ.side !== side) break;
      if (reserved && reserved.has(Hex.key(p.c, p.r))) break;
      out.push(p);
    }
    while (out.length && game.unitAt(out[out.length - 1].c, out[out.length - 1].r)) out.pop();
    return out.length ? out : null;
  }

  // 登记一次移动：截断 → 预定落点 → 记录动作。返回是否成功（调用方据此决定 continue）
  function planMove(game, acts, planned, u, path) {
    const p = safePath(game, path, u.side);
    if (!p) return false;
    const last = p[p.length - 1];
    if (reserved) reserved.add(Hex.key(last.c, last.r));
    planned.add(u.uid);
    acts.push({ t: 'move', uid: u.uid, path: p });
    return true;
  }

  function nearestEnemyDist(game, c, r, side) {
    let d = 1e9;
    for (const e of game.units) {
      if (!e.alive || e.exited || e.side === side) continue;
      const dd = Hex.distance(c, r, e.c, e.r);
      if (dd < d) d = dd;
    }
    return d;
  }

  /* ============================================================
   * 血战姿态（2026-10 第二十七轮："两军不顾一切互相进攻，即使一方远远处于下风"）
   * ------------------------------------------------------------
   * 背景：歼灭模式（无回合限制）残局曾出现"诡异相持"——美军只剩几个单位龟缩时，
   *   德军走廊目标已全部占领/残敌远离走廊 → 走廊聚焦跳过逻辑让德军永不攻击、
   *   机动又只朝城镇走 → 双方长期原地不动（双方均无计划动作）。本节从机制上消灭相持：
   *   ① berserk：歼灭模式全程血战；standard/campaign 中任一方存活 ≤ BERSERK_LEFT 也触发；
   *   ② convergeOn：向指定敌军收拢（直达 → 可达域严格逼近 → 邻格逼近 三级兜底），
   *      取代旧"nd<=5 才散开"的小半径兜底 —— 够不着就走近，不再出现原地不动的单位；
   *   ③ 血战下攻击不再看走廊聚焦/战力比阈值/softArmor 惩罚：能打就打（引擎下限 1:4）。
   * ============================================================ */
  const BERSERK_LEFT = 8;   // 任一方在场存活 ≤ 8 即进入血战姿态（歼灭模式无条件血战）

  function aliveCount(game, side) {
    let n = 0;
    for (const u of game.units) if (u.alive && !u.exited && u.side === side) n++;
    return n;
  }

  function berserk(game) {
    if (game.state.noTurnLimit) return true;
    return aliveCount(game, 'DE') <= BERSERK_LEFT || aliveCount(game, 'US') <= BERSERK_LEFT;
  }

  function nearestEnemy(game, u, side) {
    let best = null, bd = 1e9;
    for (const e of game.units) {
      if (!e.alive || e.exited || e.side === side) continue;
      const d = Hex.distance(u.c, u.r, e.c, e.r);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /* ---------- 通用位移引擎（第二十八轮重写） ----------
   * ⚠️ 性能教训（实测，务必别改回去）：findPath(A*) 打向"被占用的目标格"会穷搜整张地图，
   *    单次均值 25.6ms —— planTurn 从 110ms 劣化到 1.4s 的全部原因都在这里；
   *    而 getReach（完整 Dijkstra）只要 0.27ms/次，还能直接给出"本回合可达域里离目标
   *    最近的那个格"（单回合推进效果与 A* 等价）。因此位移一律"先可达域、后 A*"，
   *    并且绝不把 A* 打到占用格上（改为打向目标周围的空位）。
   */
  let pathBudget = null;          // 每回合允许的 A* 次数（性能护栏），planTurn 首尾重置
  // ⚠️ 性能红线（2026-10-12 地图重制后实测）：A* 预算必须压到个位数。
  //   152×96 图上单次 findPath 均 ~380ms（旧 76×48 图仅 18ms），30 次就是 11 秒；
  //   而 getReach（单回合可达域）只要 ~6ms，且"本回合走到目标附近最优格"与
  //   A* 的推进效果等价（长路径本来也会被 MP/ZOC 截断）。所以位移一律
  //   **先可达域、后 A***，A* 只留给"可达域找不到落点"的兜底场景。
  const PATH_BUDGET = 8;

  function tryPath(game, acts, planned, u, c, r) {
    if (!game.map.hexes.has(Hex.key(c, r))) return false;
    if (game.unitAt(c, r)) return false;                       // 占用目标：不 A*（避免全图穷搜）
    if (pathBudget && pathBudget.n <= 0) return false;
    if (pathBudget) pathBudget.n--;
    return planMove(game, acts, planned, u, game.findPath(u, c, r, { avoidZOC: !armor(u) }));
  }

  // 目标周围的空位（目标格被占 / 需要包抄贴合时使用）：近者优先，同距离看地形
  function slotsAround(game, u, c, r) {
    return Hex.neighbors(c, r)
      .filter(p => game.map.hexes.has(Hex.key(p.c, p.r)) && !game.unitAt(p.c, p.r) &&
        !(reserved && reserved.has(Hex.key(p.c, p.r))))
      .sort((a, b) => Hex.distance(u.c, u.r, a.c, a.r) - Hex.distance(u.c, u.r, b.c, b.r) ||
        defPositionScore(game, u, b.c, b.r) - defPositionScore(game, u, a.c, a.r));
  }

  // 可达域逼近（主力位移手段）：先只接受"严格更近"，没有再退到"不更远但协同/地形更好"
  function reachApproach(game, acts, planned, u, tgt) {
    const reach = game.getReach(u);
    const curD = Hex.distance(u.c, u.r, tgt.c, tgt.r);
    let strictK = null, strictS = 1e9, eqK = null, eqS = -1e9;
    for (const k of reach.dist.keys()) {
      const p = Hex.parse(k);
      if (game.unitAt(p.c, p.r)) continue;                     // 不停在已占用格（§19 坑 1）
      if (reserved && reserved.has(k)) continue;               // 不撞本回合预定落点
      const d = Hex.distance(p.c, p.r, tgt.c, tgt.r);
      if (d > curD) continue;                                  // 不接受变远
      let s = d * 3;
      for (const n of Hex.neighbors(p.c, p.r)) {
        const f = game.unitAt(n.c, n.r);
        if (f && f.side !== u.side) s += f.def + 2;
      }
      const fr = friendsAt(game, u, p.c, p.r), en = enemiesAt(game, u, p.c, p.r);
      s -= Math.min(fr, DATA.PASSIVE.coordMinFriends) * 0.45;                 // 协同：邻接友军
      s -= defPositionScore(game, u, p.c, p.r) * 0.15;                        // 防御地形偏好（美军经验）
      if (fr === 0 && en >= DATA.PASSIVE.encMinEnemies) s += 6;               // 别把自己送进包围圈
      if (d < curD) { if (s < strictS) { strictS = s; strictK = k; } }
      else {
        const es = s * -1 + d * 3;
        if (es > eqS) { eqS = es; eqK = k; }
      }
    }
    const k = strictK || eqK;
    return k ? planMove(game, acts, planned, u, game.pathFromReach(reach, k)) : false;
  }

  // 邻格兜底（最后一道）：严格更近优先；没有则"不更远但协同更好"，保证能动就有动作
  function stepClosest(game, acts, planned, u, tgt) {
    const curD = Hex.distance(u.c, u.r, tgt.c, tgt.r);
    let best = null, bd = 1e9, bestEq = null, bes = -1e9;
    for (const n of Hex.neighbors(u.c, u.r)) {
      const k = Hex.key(n.c, n.r);
      if (!game.map.hexes.has(k) || game.unitAt(n.c, n.r)) continue;
      if (reserved && reserved.has(k)) continue;
      const d = Hex.distance(n.c, n.r, tgt.c, tgt.r);
      if (d < curD) { if (d < bd) { bd = d; best = n; } }
      else if (d === curD) {
        const s = Math.min(friendsAt(game, u, n.c, n.r), DATA.PASSIVE.coordMinFriends) * 1.2 -
          enemiesAt(game, u, n.c, n.r) * 0.5;
        if (s > bes) { bes = s; bestEq = n; }
      }
    }
    const pick = best || bestEq;
    return pick ? planMove(game, acts, planned, u, [pick]) : false;
  }

  // 统一接近流程（2026-10-12 按新图性能重排）：
  //   可达域逼近 → 目标格/周边空位 A*（预算内）→ 邻格兜底
  //   顺序调整理由：旧序先对"周边空位"跑 2 次 A*，在 152×96 图上每次 ~380ms，
  //   而绝大多数情况"可达域逼近"已能给出好落点；把目标格 A* 提前、周边空位
  //   只试 1 个，能把每回合 A* 次数从 ~30 降到个位数（见 PATH_BUDGET 注释）。
  function convergeOn(game, acts, planned, u, tgt) {
    if (!tgt) return false;
    if (reachApproach(game, acts, planned, u, tgt)) return true;
    if (tryPath(game, acts, planned, u, tgt.c, tgt.r)) return true;
    const slots = slotsAround(game, u, tgt.c, tgt.r);
    if (slots.length && tryPath(game, acts, planned, u, slots[0].c, slots[0].r)) return true;
    return stepClosest(game, acts, planned, u, tgt);
  }

  /* ============================================================
   * 统一行为层（2026-10 第二十八轮）：两军共用同一套交战流水线
   * ------------------------------------------------------------
   * 德军与美军"怎么打、怎么走、怎么配属"完全一致；唯一差异收敛到下方的任务目标层
   * （SIDE_CFG / objectiveFor）：
   *     DE 目标 = 走廊要点 → 马斯河渡河口（standard/campaign 既定作战目标）
   *     US 目标 = 已失/被围要点优先 → 最近的己方控制要点（campaign R13+ 切反攻枢纽）
   *     berserk = 歼灭模式全程 / 任一方 ≤8 存活 → 目标层失效，双方都扑"最近残敌"
   * 流水线（双方同序、同门槛）：planAir → planAttacks → planManeuver → planArty，
   *   移动后再跑一次同标准的 dynamicAttackPass 补刀。
   * 对峙的结构性排除：planManeuver 第 ③ 步是"无条件接敌兜底"——任何既没排到攻击、
   *   也无法朝任务目标推进的地面单位，只要地图上还有敌人，就必须向它逼近（走进一格
   *   也算）；只有"被地形/合围物理封死"才允许不动。这是本节唯一不可绕过的钉子。
   * ============================================================ */
  const ENGAGE_RADIUS = 6;   // 通用接敌半径：6 格内有敌人 → 先与该敌接触（双方同一标准）
  const ART_FOLLOW_D = 4;    // 炮兵无射击目标时，向最近本方前线单位跟进的距离阈值

  const SIDE_CFG = {
    DE: {
      foe: 'US',
      keyTowns: ['圣维特', '巴斯托涅', '马尔什', '迪南', '纳慕尔', '斯塔沃洛', '马尔梅迪',
        '克莱沃', '维尔茨', '豪法利兹', '埃希特纳赫', '维尔萨姆', '埃滕布罗克', '日韦'],
      target: (game, u) => germanTarget(game, u)
    },
    US: {
      foe: 'DE',
      keyTowns: US_KEY_TOWNS,
      target: (game, u) => usObjective(game, u)
    }
  };

  /* ---------- 通用态势评估（双方同一把尺） ---------- */
  // 威胁值：相邻敌军攻击力之和 —— 缓冲排序 / 工事发放 / 是否受压，全部走这一个入口
  function threatAt(game, u) {
    let th = 0;
    for (const n of Hex.neighbors(u.c, u.r)) {
      const e = game.unitAt(n.c, n.r);
      if (e && e.side !== u.side) th += e.atk * (e.org / e.maxOrg) + 1;
    }
    return th;
  }
  function keyTownsOf(side) { return SIDE_CFG[side] ? SIDE_CFG[side].keyTowns : []; }
  function foeSide(side) { return SIDE_CFG[side] ? SIDE_CFG[side].foe : (side === 'DE' ? 'US' : 'DE'); }

  function inKeyTown(game, u) {
    const h = game.hexAt(u.c, u.r);
    const list = keyTownsOf(u.side);
    return !!(h.town && h.town.ctrl === u.side && list.includes(h.town.name));
  }
  function inDefTerrain(game, u) {
    const h = game.hexAt(u.c, u.r);
    return !!(h.town || h.terrain === 'forest' || h.terrain === 'mountain');
  }
  function contact(game, u) { return enemiesAt(game, u, u.c, u.r) > 0; }
  // 已就位的要点守军：它的任务是守住这座要点，不参与外出接敌（标准/全战役下）
  function posted(game, u) { return inKeyTown(game, u); }

  function objectiveFor(game, u) {
    const cfg = SIDE_CFG[u.side];
    return cfg ? cfg.target(game, u) : null;
  }

  /* ---------- 任务目标层（唯一差异） ---------- */
  // 德军走廊目标（第二十轮定稿，原样保留）
  function germanTarget(game, u) {
    const rd = game.state.round;
    const homeR = u.homeR !== undefined ? u.homeR : u.r;
    let names;
    if (rd >= 8) {
      names = ['迪南', '日韦', '纳慕尔', '巴斯托涅', '马尔什'];       // 后期: 直扑马斯河
    } else if (homeR <= 9) {
      names = rd <= 3 ? ['圣维特', '斯塔沃洛', '马尔梅迪'] : ['斯塔沃洛', '马尔梅迪', '维尔萨姆', '圣维特'];
    } else if (homeR <= 17) {
      names = rd <= 3 ? ['圣维特', '克莱沃'] : ['克莱沃', '豪法利兹', '维尔茨', '巴斯托涅'];
    } else {
      names = rd <= 3 ? ['克莱沃', '维尔茨', '埃希特纳赫'] : ['维尔茨', '巴斯托涅', '埃滕布罗克'];
    }
    names = names.filter(n => game.map.townMap[n] && game.map.townMap[n].ctrl !== 'DE');
    if (!names.length) names = ['迪南', '日韦', '纳慕尔'];
    // ⚠️ A/B 实测(2026-10 第二轮): 目标分流做多路并进的三个变体全部否决(西进回退 3~5 列、
    //    要点夺取率下降)。"最近未占目标"是最优解；多路并进的入口是缺口机动。
    let best = null, bestS = 1e9;
    for (const n of names) {
      const t = game.map.townMap[n];
      const d = Hex.distance(u.c, u.r, t.c, t.r);
      if (d < bestS) { bestS = d; best = t; }
    }
    return best;
  }

  // 美军任务目标（第二十八轮：取代旧 usHotspot / planUSOffensive 的目标选择部分）
  function usObjective(game, u) {
    const names = keyTownsOf('US');
    // ① campaign 第二阶段（R13+）：目标是仍被德军占据的反攻枢纽
    if (game.scenario.campaign && game.state.round > 12) {
      let t = null, bd = 1e9;
      for (const n of DATA.US_OFFENSIVE_TARGETS) {
        const x = game.map.townMap[n];
        if (!x || x.ctrl !== 'DE') continue;
        const d = Hex.distance(u.c, u.r, x.c, x.r);
        if (d < bd) { bd = d; t = x; }
      }
      if (t) return t;
    }
    // ② 已失守的要点优先 —— 收复
    for (const n of names) { const t = game.map.townMap[n]; if (t && t.ctrl === 'DE') return t; }
    // ③ 正被围攻的己方要点 —— 紧急驰援
    for (const n of names) {
      const t = game.map.townMap[n];
      if (!t || t.ctrl !== 'US') continue;
      const guard = game.unitAt(t.c, t.r);
      if (guard && guard.side === 'US' && enemiesAt(game, guard, t.c, t.r) >= 2) return t;
    }
    // ④ 最近的己方控制要点 —— 常规守备/迟滞线
    let best = null, bd = 1e9;
    for (const n of names) {
      const t = game.map.townMap[n];
      if (!t || t.ctrl === 'DE') continue;
      const d = Hex.distance(u.c, u.r, t.c, t.r);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) return best;
    // ⑤ 兜底：最近的己方控制城镇
    for (const t of game.map.towns) {
      if (t.ctrl !== 'US') continue;
      const d = Hex.distance(u.c, u.r, t.c, t.r);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /* ---------- 机动：接敌目标选择与缺口机动（双方同一套） ---------- */
  // 交战目标选择：近 / 孤立 / 昂贵三者权衡（吸收旧 usHotspot 的"围猎孤立高价值目标"思想，
  //   第二十八轮推广到双方）—— berserk 下退化为"最近残敌"，保证一定有人去咬最后几个建制
  function engageTarget(game, u) {
    let best = null, bs = -1e9;
    for (const e of game.units) {
      if (!e.alive || e.exited || e.side === u.side) continue;
      const d = Hex.distance(u.c, u.r, e.c, e.r);
      if (d > ENGAGE_RADIUS + 4) continue;
      const iso = friendsAt(game, e, e.c, e.r) <= 1 ? 1.3 : 1;
      const s = unitValue(e) * iso / (d + 1);
      if (s > bs) { bs = s; best = e; }
    }
    return best || nearestEnemy(game, u, u.side);
  }

  /* ---------- ① 空袭（双方同一打分：兵种权重 × 打击力 × 地形遮蔽 × 组织比 × 孤立加成） ---------- */
  function planAir(game, side, acts) {
    const left = side === 'DE' ? game.state.airDE : game.state.airUS;
    if (!(left > 0)) return;
    const cands = [];
    for (const e of game.units) {
      if (!e.alive || e.exited || e.side === side) continue;
      const t = game.hexAt(e.c, e.r).terrain;
      const cover = (t === 'forest' || t === 'mountain' || t === 'marsh') ? 0.4 : 1;
      const w = armor(e) ? 3 : e.type === 'ART' ? 2 : 1;
      const iso = friendsAt(game, e, e.c, e.r) <= 1 ? 1.3 : 1;
      cands.push({ u: e, s: w * e.atk * cover * (e.org / e.maxOrg) * iso });
    }
    cands.sort((a, b) => b.s - a.s);
    for (let i = 0; i < Math.min(left, cands.length); i++) acts.push({ t: 'air', target: cands[i].u.uid });
  }

  /* ---------- ② 静态攻击（合并原 planUS 步骤 3 与 germanAttackCandidates） ----------
   * 非血战：有效期望 > -0.05 且 ratio ≥ 1.2 —— 双方同一条线，不再分阵营两套门槛。
   *   有效期望 = 期望交换 + 态势加成（孤立 +0.3 / 无心再战 +0.4 / 被我军围住 +0.2）。
   * 血战：pv.key 存在即出手（引擎下限 1:4），maxForce 组队（最强 3 地面 + 2 炮兵）。
   * 排序：期望守方价值损失优先 + 交换收益 + 目标位于本方任务方向上的加成（双方同一把尺）。
   */
  function planAttacks(game, side, acts, planned, allOut) {
    const cands = [];
    for (const e of game.units) {
      if (!e.alive || e.exited || e.side === side) continue;
      const g = attackGroup(game, e, planned, allOut ? { maxForce: true } : undefined);
      if (!g || !g.pv.key) continue;
      let score, passGate;
      if (allOut) {
        score = crtExpect(g.pv.row).def * unitValue(e) + g.w;
        passGate = true;
      } else {
        const dfr = friendsAt(game, e, e.c, e.r);
        const ps = passiveOf(game, e);
        const sur = enemiesAt(game, e, e.c, e.r);
        const wEff = g.w + (dfr <= 1 ? 0.3 : 0) + (ps.key === 'broken' ? 0.4 : 0) + (sur >= 2 ? 0.2 : 0);
        score = crtExpect(g.pv.row).def * unitValue(e) + g.w * 2;
        passGate = wEff > -0.05 && g.pv.ratio >= 1.2;
      }
      if (!passGate) continue;
      const obj = objectiveFor(game, g.atts[0]);
      const dObj = obj ? Hex.distance(e.c, e.r, obj.c, obj.r) : 99;
      score += dObj <= 3 ? 0.6 : dObj <= 6 ? 0.2 : 0;
      cands.push({ e, g, score });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) {
      const atts = c.g.atts.filter(x => !planned.has(x.uid));
      if (!atts.length) continue;
      const arty = c.g.arty.filter(x => !planned.has(x.uid));
      for (const a of atts) planned.add(a.uid);
      for (const a of arty) planned.add(a.uid);
      acts.push({ t: 'attack', uids: atts.map(x => x.uid), target: c.e.uid, arty: arty.map(x => x.uid) });
    }
  }

  /* ---------- ③ 机动（合并原 planGerman 步骤 3 / planUS 步骤 1~2b / planUSBerserk 步骤 ②）
   *   ① 接敌：6 格内有敌人（或血战姿态）且不是已就位的要点守军 → 向最优交战目标收拢；
   *   ② 目标：向本方任务目标推进（被封锁则缺口机动）；
   *   ③ 无条件接敌兜底：只要地图上还有敌人就必须逼近 —— 结构性排除对峙。
   */
  function planManeuver(game, side, acts, planned, allOut) {
    const my = game.units.filter(u => u.alive && !u.exited && u.side === side && u.arrive <= game.state.round);
    const movers = my.filter(u => !planned.has(u.uid) && u.type !== 'ART' && u.type !== 'HQ')
      .sort((a, b) => (armor(b) ? 1 : 0) - (armor(a) ? 1 : 0) || b.mov - a.mov);
    // 性能护栏见 tryPath/reachApproach：A* 每回合限 PATH_BUDGET 次且不打占用格；
    //   getReach（0.27ms/次）是主力位移手段，不再需要额外预算。
    for (const u of movers) {
      if (planned.has(u.uid)) continue;
      const stayPosted = posted(game, u) && !allOut;
      const foe = allOut ? nearestEnemy(game, u, side) : engageTarget(game, u);
      if (foe) {
        const near = allOut || Hex.distance(u.c, u.r, foe.c, foe.r) <= ENGAGE_RADIUS;
        if (near && !stayPosted && convergeOn(game, acts, planned, u, foe)) continue;
      }
      const obj = objectiveFor(game, u);
      if (obj && !(u.c === obj.c && u.r === obj.r)) {
        if (tryPath(game, acts, planned, u, obj.c, obj.r)) continue;      // 目标格本身是空的：直接 A*
        if (convergeOn(game, acts, planned, u, obj)) continue;            // 被占/绕行：可达域逼近 + 周边空位
      }
      // ③ 钉子：以上都没成，只要还有敌人就无条件逼近（走进一格也算）——不留任何"无事可做"的分支
      if (foe && !stayPosted) convergeOn(game, acts, planned, u, foe);
    }
  }

  /* ---------- ④ 炮兵（合并两份：压制"正贴着我方部队"的敌人优先；无目标则向最近本方前线跟进） ---------- */
  function planArty(game, side, acts, planned) {
    const my = game.units.filter(u => u.alive && !u.exited && u.side === side);
    for (const a of my) {
      if (a.type !== 'ART' || planned.has(a.uid)) continue;
      if (game.inZOC(a.c, a.r, side)) continue;                    // 被贴脸不能射击
      const rng = a.range - (game.state.weather === 'fog' ? 1 : 0);
      let best = null, score = -1;
      for (const e of game.units) {
        if (!e.alive || e.exited || e.side === side) continue;
        if (Hex.distance(a.c, a.r, e.c, e.r) > rng) continue;
        const pressing = enemiesAt(game, e, e.c, e.r) >= 2 ? 1.2 : 0;   // 正贴着我方部队打
        const s = (armor(e) ? 3 : 1) + (e.type === 'ART' ? 0.3 : 0) + e.org / 10 + pressing +
          Math.max(0, 1 - e.org / 10) * 1.5;                            // 残破者优先（一击可灭）
        if (s > score) { score = s; best = e; }
      }
      if (best) { planned.add(a.uid); acts.push({ t: 'arty', uid: a.uid, target: best.uid }); continue; }
      let anchor = null, ad = 1e9;
      for (const f of my) {
        if (f.type === 'ART' || f.type === 'HQ' || !f.alive) continue;
        const d = Hex.distance(a.c, a.r, f.c, f.r);
        if (d > ART_FOLLOW_D && d < ad) { ad = d; anchor = f; }
      }
      // 跟进：走通用位移引擎（锚点是友军单位所在格 = 占用格，绝不能直接 A*，见位移引擎注释）
      if (anchor) convergeOn(game, acts, planned, a, anchor);
    }
  }

  /* ---------- 计划流水线（双方唯一入口） ---------- */
  function planSide(game, side, acts, planned) {
    const allOut = berserk(game);
    planAir(game, side, acts);                     // ① 空袭（不占用己方单位的行动）
    planAttacks(game, side, acts, planned, allOut); // ② 静态攻击
    planManeuver(game, side, acts, planned, allOut); // ③ 机动 / 接敌 / 兜底
    planArty(game, side, acts, planned);            // ④ 炮兵（放在最后：此时目标位置已定）
  }

  /* ---------------- 支援资产使用（第二十一轮重写：按阵营分工 + 按需要排序发放） ----------------
   * 令牌每回合就这么多（工事1 / 救护1 / 急袭1 / 补充1 / 反坦克2 / 防空2），所以不能再
   * "按单位表顺序先到先得"——先按"谁最需要"排序，再一个一个发。
   * 阵营分工：
   *   德军（进攻方）—— 工事给已夺要点守军与前线装甲；救护/补充给正在攻坚的部队；
   *                    急袭给"即将进行的那次最值钱的攻击"的攻方；防空给装甲（美军空袭只打德军装甲）。
   *   美军（防御方）—— 工事铺满"防御地形 + 已接敌"的守军（防御 ×1.25 是防御力优势的放大器）；
   *                    反坦克小组优先给面对德军装甲的步兵；防空兼顾炮兵（德军空袭第二目标）；
   *                    救护/补充给被围攻的守军；急袭留给有把握的反击，没有就不浪费。
   */
  /* ---------------- 支援资产使用（2026-10 第二十八轮：统一"按需发放"，双方同一套规则） ----------------
   * 令牌每回合就这么点（工事1 / 救护1 / 急袭1 / 补充1 / 反坦克2 / 防空2），先按"谁最需要"排序再发。
   * 统一排序键 needKey = 守备紧迫度×10 + 已接敌 5 + 相邻敌军威胁值（双方同基准，不再分阵营两套偏好）。
   * 第二十八轮把原先的阵营差异全部取消：进攻方与防御方拿到同样的增益逻辑，
   *   —— 左右行为差异只保留"任务目标层"（SIDE_CFG/objectiveFor），见本节上方说明。
   */
  function aiSpendTokens(game, side) {
    // 护栏: tokens.US 只在美军阶段建立（踩坑 5），旧存档/异常调用时缺字段不能让 AI 崩
    const tk = game.state.tokens[side] || (game.state.tokens[side] = { fort: 0, at: 0, med: 0, fire: 0, repl: 0, aa: 0 });
    const my = () => game.units.filter(u => u.alive && !u.exited && u.side === side);
    // 守备紧迫度（第二十五轮提出，第二十八轮推广到双方）：要点守备 > 被围攻
    const keyUrgency = u => (inKeyTown(game, u) ? 2 : 0) + (enemiesAt(game, u, u.c, u.r) >= 2 ? 1 : 0);
    const needKey = u => keyUrgency(u) * 10 + (contact(game, u) ? 5 : 0) + threatAt(game, u);
    const nearEnemyArmor = (u, rad) => {
      for (const p of Hex.range(u.c, u.r, rad, game.map.cols, game.map.rows)) {
        const e = game.unitAt(p.c, p.r);
        if (e && e.side !== side && T[e.type].armor) return true;
      }
      return false;
    };
    // ① 野战工事（防御 ×1.25）：发给"要点 / 防御地形 / 已接敌"的单位，威胁最高者优先
    const fortCands = my()
      .filter(u => !u.attach.fort && u.type !== 'ART' && u.type !== 'HQ' && u.type !== 'RECON')
      .filter(u => inKeyTown(game, u) || inDefTerrain(game, u) || contact(game, u))
      .sort((a, b) => needKey(b) - needKey(a));
    for (const u of fortCands) {
      if (tk.fort <= 0) break;
      game.grantBuff('fort', u);
    }
    // ② 工兵自带筑垒: 不消耗令牌, 每个工兵营各一次
    for (const u of my()) {
      if (u.type !== 'ENGR' || u.attach.fort) continue;
      game.grantBuff('fort', u);
    }
    // ③ 防空火力（遭空袭 50% 压制、伤害减半）：装甲 / 炮兵 / 要点与接敌部队
    const aaCands = my()
      .filter(u => !u.attach.aa && u.type !== 'HQ')
      .filter(u => armor(u) || u.type === 'ART' || keyUrgency(u) > 0)
      .sort((a, b) => needKey(b) - needKey(a));
    for (const u of aaCands) {
      if (tk.aa <= 0) break;
      game.grantBuff('aa', u);
    }
    // ④ 野战救护所（+4 组织度）：最需要续命者（紧迫度 → 接敌 → 组织度最低）
    if (tk.med > 0) {
      const cands = my()
        .filter(u => u.org < u.maxOrg && u.supplied && u.type !== 'HQ')
        .sort((a, b) => needKey(b) - needKey(a) || a.org - b.org);
      if (cands.length && cands[0].org <= 6) game.grantBuff('med', cands[0]);
    }
    // ⑤ 补充兵员（满编 +2 组织上限）：紧迫度最高的满编单位
    if (tk.repl > 0) {
      const cands = my()
        .filter(u => u.org === u.maxOrg && !u.attach.repl && u.type !== 'HQ')
        .sort((a, b) => needKey(b) - needKey(a) || b.def - a.def);
      if (cands.length) game.grantBuff('repl', cands[0]);
    }
    // ⑥ 反坦克小组（防御 ×1.5 且遭纯装甲攻击再降一档）：给面对敌方装甲的步兵
    let atLeft = 2;
    const atCands = my()
      .filter(u => !u.attach.at && ['INF', 'VGD', 'FJ', 'ABN'].includes(u.type))
      .filter(u => nearEnemyArmor(u, 3) || inKeyTown(game, u) || (inDefTerrain(game, u) && contact(game, u)))
      .sort((a, b) => needKey(b) - needKey(a) || b.def - a.def);
    for (const u of atCands) {
      if (atLeft <= 0 || tk.at <= 0) break;
      if (game.grantBuff('at', u).ok) atLeft--;
    }
    // ⑦ 炮火急袭（该单位下一次攻击 +4）：双方都用同一把"期望交换"尺子挑最划算的那次围歼
    if (tk.fire > 0) {
      let bestPick = null, bestVal = -1e9;
      for (const e of game.units) {
        if (!e.alive || e.exited || e.side === side) continue;
        const g = attackGroup(game, e, new Set(), { excludeFire: true });
        if (!g || !g.pv.key) continue;
        const val = g.w + crtExpect(g.pv.row).def * unitValue(e) +
          (armor(e) ? 0.5 : 0) + (game.hexAt(e.c, e.r).town ? 0.4 : 0);
        if (val > bestVal) { bestVal = val; bestPick = g.atts[0]; }
      }
      if (bestPick && game.grantBuff('fire', bestPick).ok) { /* 已发放 */ }
    }
  }
  /* ---------------- 计划总入口 ---------------- */
  function planTurn(game, side) {
    aiSpendTokens(game, side);
    const acts = [];
    const planned = new Set();
    reserved = new Set();     // 本回合已被预定的落点（防止两份计划撞同一格 → 同格冲突）
    pathBudget = { n: PATH_BUDGET };   // 本回合允许的 A* 次数（性能护栏，见 tryPath）
    try {
      planSide(game, side, acts, planned);   // 第二十八轮：两侧共用同一条流水线
    } finally {
      reserved = null;
      pathBudget = null;
    }
    // 注意: 结束阶段由 executeTurn 收尾负责, 计划中不再包含 end 动作
    return acts;
  }

  /* ---------------- 执行 ---------------- */
  function executeTurn(game, side, schedule, done) {
    const acts = planTurn(game, side);
    let i = 0;
    const delay = 30;   // 原版39轮移植: 动作间隔 60→30ms
    let throws24y = 0;   // 24y 自愈计数
    function next() {
      try {
        if (game.state.over) { done(); return; }
        if (i >= acts.length) {
          // 动态补刀: 移动后再评估一轮攻击
          dynamicAttackPass(game, side, schedule, () => { if (!game.state.over) game.endPhase(); done(); });
          return;
        }
        const a = acts[i++];
        execAction(game, side, a);
        schedule(next, delay);
      } catch (err) {
        // 24y 自愈: 单步异常不中断整条链——跳过该动作继续, 连续错误则收尾
        try {
          throws24y++;
          if (throws24y <= 3) schedule(next, delay);
          else { if (!game.state.over) game.endPhase(); done(); }
        } catch (e2) { try { if (!game.state.over) game.endPhase(); } catch (e3) {} done(); }
      }
    }
    schedule(next, delay);
  }

  function execAction(game, side, a) {
    if (a.t === 'move') {
      const u = game.units.find(x => x.uid === a.uid);
      if (u && u.alive && u.side === side && !u.moved) game.doMove(u, a.path);
    } else if (a.t === 'attack') {
      const target = game.units.find(x => x.uid === a.target && x.alive);
      if (!target) return;
      const atts = a.uids.map(id => game.units.find(x => x.uid === id))
        .filter(u => u && u.alive && u.side === side && !u.attacked && u.type !== 'ART' &&
          Hex.distance(u.c, u.r, target.c, target.r) === 1);
      if (!atts.length) return;
      const arty = (a.arty || []).map(id => game.units.find(x => x.uid === id))
        .filter(x => x && x.alive && !x.fired && !x.moved && x.type === 'ART');
      const res = game.doAttack(atts, target, arty);
      if (res && res.advanceOffer) {
        const cand = pickAdvancer(side, res.advanceOffer);
        if (cand) game.doAdvance(cand);
      }
    } else if (a.t === 'arty') {
      const u = game.units.find(x => x.uid === a.uid);
      const t = game.units.find(x => x.uid === a.target && x.alive);
      if (u && t && u.alive) game.artyFire(u, t);
    } else if (a.t === 'air') {
      const t = game.units.find(x => x.uid === a.target && x.alive);
      if (t) game.airStrike(t, side);
    } else if (a.t === 'end') {
      game.endPhase();
    }
  }

  function dynamicAttackPass(game, side, schedule, done) {
    const steps = [];
    const built = new Set();
    const allOut = berserk(game);   // 血战姿态下补刀不看任何阈值
    for (const e of game.units.filter(x => x.alive && !x.exited && x.side !== side)) {
      // 第二十八轮：动态补刀与静态攻击完全同标准（同一组队器 + 同一套门槛）。
      //   非血战：有效期望 > -0.05 且 ratio ≥ 1.2（态势加成：孤立+0.3 / 无心再战+0.4 / 被围+0.2）；
      //   血战：maxForce 组队、pv.key 存在即出手。移动后出现的临时战机（贴上孤立的敌人等）
      //   按同一把尺子处理，双方不再有两套补刀逻辑。
      const g = attackGroup(game, e, built, allOut ? { maxForce: true } : undefined);
      if (!g || !g.pv.key) continue;
      if (!allOut) {
        const dfr = friendsAt(game, e, e.c, e.r);
        const surrounded = enemiesAt(game, e, e.c, e.r);
        const ps = Combat.passiveState(game, e);
        const wEff = g.w + (dfr <= 1 ? 0.3 : 0) + (ps.key === 'broken' ? 0.4 : 0) + (surrounded >= 2 ? 0.2 : 0);
        if (wEff <= -0.05 || g.pv.ratio < 1.2) continue;
      }
      for (const u of g.atts) built.add(u.uid);
      for (const u of g.arty) built.add(u.uid);
      steps.push({ atts: g.atts, e, arty: g.arty });
    }
    let i = 0;
    (function step() {
      if (i >= steps.length || game.state.over) { done(); return; }
      const s = steps[i++];
      const atts = s.atts.filter(u => u.alive && !u.attacked && Hex.distance(u.c, u.r, s.e.c, s.e.r) === 1);
      if (atts.length) {
        const res = game.doAttack(atts, s.e, s.arty.filter(a => a.alive && !a.fired));
        if (res && res.advanceOffer) {
          const cand = pickAdvancer(side, res.advanceOffer);
          if (cand) game.doAdvance(cand);
        }
      }
      schedule(step, 60);
    })();
  }

  return { planTurn, executeTurn };
})();
