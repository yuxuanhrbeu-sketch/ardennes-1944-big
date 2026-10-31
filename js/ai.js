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
    const frontage = AGGRO.frontage || 5;   // 27g
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
      const atts = pool.slice(0, frontage);
      const pv = game.previewAttack(atts, e, arty);
      if (!pv.key) return null;
      return { atts, arty, pv, w: attackWorth(game, atts, e, arty, pv) };
    }
    let best = null;
    for (let k = 1; k <= Math.min(frontage, pool.length); k++) {   // 27g: 正面宽度随档位（原 3）
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
  let convergeCnt = null;   // 26w P1: 本回合各敌军已被几个单位收拢（uid→n），planTurn 首尾重置
  let huntCap = 3;          // 27f 清剿阶段收敛帽（歼灭残局解除上限, planSide 重算）
  let convergeMaxSeen = 0;  // 26w P1: 本回合单敌最大收敛数（planTurn 清空后仍可读, QA 断言用）
  let lineTake = null;      // 26w P2: 美军防线配额记账（锚点key→已派人数）, planTurn 首尾重置
  let objCnt = null;        // 26w P2: 本回合各城镇已被几个同方单位选为目标（德军目标软分流）
  let schwerpunkt = null;   // 26x 棋力层: 主攻方向（Set<城镇名>，大图 2 轴/师团单轴）, planSide 重算
  let myCentroid = null;    // 26x 棋力层: 本方战斗部队质心（侧翼槽位/HQ 跟进判据用）
  let finalPush = false;    // 27d 总攻: 每局最后 2 个回合——攻击门槛全局放宽、据点守军无接触即加入进攻
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
      /* 26w P1 流向成本: 落点紧邻本回合其他单位已预定的落点 → 拥堵惩罚——
         大部队沿同一走廊压上时自动散开, 不再在走廊口挤成一团。 */
      if (reserved) {
        for (const n of Hex.neighbors(p.c, p.r)) if (reserved.has(Hex.key(n.c, n.r))) s += 1.2;
      }
      const fr = friendsAt(game, u, p.c, p.r), en = enemiesAt(game, u, p.c, p.r);
      s -= Math.min(fr, DATA.PASSIVE.coordMinFriends) * 0.45;                 // 协同：邻接友军
      s -= defPositionScore(game, u, p.c, p.r) * 0.15;                        // 防御地形偏好（美军经验）
      if (fr === 0 && en >= DATA.PASSIVE.encMinEnemies) s += 6;               // 别把自己送进包围圈
      /* 26x 侧翼槽位: 打敌军目标时, 装甲单位优先落到"目标身后"（比目标更远离本方质心）
         的格子——除贴脸互殴外多一层断退路/断补给的倾向（合围的轻量版）。 */
      if (tgt.side !== undefined && tgt.side !== u.side && armor(u) && myCentroid) {
        if (Hex.distance(p.c, p.r, myCentroid.c, myCentroid.r) >
            Hex.distance(tgt.c, tgt.r, myCentroid.c, myCentroid.r) + 1) s -= 2;
      }
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
 * 流水线（双方同序、同门槛；26x 计划序=攻击→空袭→机动→炮兵, 执行序=空袭→炮火→突击→机动）：
 *   planAttacks → planAir → planManeuver → planArty, 逐类稳定重排后执行,
 *   移动前后各跑一轮 dynamicAttackPass 补刀（同一 attackGate 门槛）。
   * 对峙的结构性排除：planManeuver 第 ③ 步是"无条件接敌兜底"——任何既没排到攻击、
   *   也无法朝任务目标推进的地面单位，只要地图上还有敌人，就必须向它逼近（走进一格
   *   也算）；只有"被地形/合围物理封死"才允许不动。这是本节唯一不可绕过的钉子。
   * ============================================================ */
  /* 26m 进攻型 AI 参数（六个战役共用；想调"凶猛程度"只动这里） */
  /* 27e: AGGRO 四档预设（玩家可在 AI 指挥面板切换, 持久化到 localStorage）。
     默认档 = 进攻（26m 原值）。holdRadius = 要点守军留守半径（26w 巩固例外, 27d 收紧到 6）。 */
  const AGGRO_PRESETS = {
    defend:   { label: '固守', attackRatio: 1.4, attackWorth: 0.0,  engageRadius: 6,  forceAdvance: false, holdRadius: 12, frontage: 3, convergeCap: 2 },
    measured: { label: '稳健', attackRatio: 1.0, attackWorth: -0.3, engageRadius: 8,  forceAdvance: true,  holdRadius: 10, frontage: 4, convergeCap: 4 },
    attack:   { label: '进攻', attackRatio: 0.6, attackWorth: -0.8, engageRadius: 12, forceAdvance: true,  holdRadius: 6,  frontage: 5, convergeCap: 6 },
    frenzy:   { label: '狂暴', attackRatio: 0.3, attackWorth: -1.5, engageRadius: 16, forceAdvance: true,  holdRadius: 3,  frontage: 8, convergeCap: 999, extraWaves: 3 },
  };
  const AGGRO = {
    attackRatio: 0.6,     // 非血战的最低战力比（原 1.2——现在 1:2 也强攻）
    attackWorth: -0.8,    // 期望交换的门槛（原 -0.05——亏损也打）
    neverHold: true,      // 26m 语义保留：true = 守备留守半径收紧（27e 起由 holdRadius 表达）
    forceAdvance: true,   // 兜底：没走成任何路径的单位，必须向最近敌人再逼近
    artyFollow: 2,        // 炮兵跟进距离（原 4；27e 起实际由 ART_FOLLOW_D 常量表达，字段留档）
    engageRadius: 12,     // 接敌半径（原 6——更远就开始收拢）
    holdRadius: 6,        // 27e: 要点守军留守半径（固守档 12 / 进攻档 6）
    frontage: 5,          // 27g: 攻击正面（每次攻击计入战力并承伤的单位数）
    convergeCap: 6,       // 27h: 单目标最大收敛数（原硬编码 3——薄战线成因: 多出的单位被推去别处）
    extraWaves: 2,        // 27h: 同一目标的追加攻击波次（集火补刀）
  };
  let aggroKey = 'attack';   // 当前档位（面板选择, 持久化到 localStorage['ardennes44_aggro']）
  function setAggroPreset(key) {
    const p = AGGRO_PRESETS[key];
    if (!p) return false;
    aggroKey = key;
    AGGRO.attackRatio = p.attackRatio;
    AGGRO.attackWorth = p.attackWorth;
    AGGRO.engageRadius = p.engageRadius;
    AGGRO.forceAdvance = p.forceAdvance;
    AGGRO.neverHold = key !== 'defend';
    AGGRO.holdRadius = p.holdRadius;
    AGGRO.convergeCap = p.convergeCap || 6;                                                    // 27h
    AGGRO.extraWaves = key === 'defend' ? 0 : key === 'measured' ? 1 : key === 'attack' ? 2 : 3;   // 27h/27i: 集火波次

    if (typeof Combat !== 'undefined' && Combat.setFrontage) Combat.setFrontage(p.frontage);   // 27g: 攻击正面随档位
    return true;
  }
  const ENGAGE_RADIUS = 6;   // 通用接敌半径：6 格内有敌人 → 先与该敌接触（双方同一标准）
  const ART_FOLLOW_D = 2;   // 26m: 炮兵压上（原 4）    // 炮兵无射击目标时，向最近本方前线单位跟进的距离阈值

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

  /* ---------- 26x 棋力层: 主攻方向（Schwerpunkt） ----------
   * 每回合从任务目标清单里按"距本方兵力质心 − 守军强度 + 战果惯性"评出主攻轴
   * （220×96 大图 2 条 / 师·团单条）。主攻轴上的攻击门槛放宽（worth −0.4 / ratio 减半）、
   * 炮兵目标加成——集中拳头砸一点, 其余方向维持 26m 侵略性但不再处处平均用力。 */
  function pickSchwerpunkt(game, side) {
    const cands = [];
    for (const n of keyTownsOf(side)) {
      const t = game.map.townMap[n];
      if (t && t.ctrl !== side) cands.push(t);
    }
    const cs = game.units.filter(u => u.alive && !u.exited && u.side === side &&
      !(T[u.type] && T[u.type].hq) && u.arrive <= game.state.round);
    if (!cands.length || !cs.length) { schwerpunkt = new Set(); myCentroid = null; return; }
    let cx = 0, cy = 0;
    for (const u of cs) { cx += u.c; cy += u.r; }
    myCentroid = { c: Math.round(cx / cs.length), r: Math.round(cy / cs.length) };
    const nAxis = game.map.cols >= 100 ? 2 : 1;
    const scored = cands.map(t => {
      let s = -Hex.distance(myCentroid.c, myCentroid.r, t.c, t.r) * 0.5;
      const gar = game.unitAt(t.c, t.r);
      if (gar && gar.side !== side) s -= Math.min(6, gar.def / 30);
      for (const nb of Hex.neighbors(t.c, t.r)) {
        const h = game.hexAt(nb.c, nb.r);
        if (h && h.town && h.town.ctrl === side && keyTownsOf(side).includes(h.town.name)) s += 2;
      }
      return { name: t.name, s };
    }).sort((a, b) => b.s - a.s);
    schwerpunkt = new Set(scored.slice(0, nAxis).map(x => x.name));
  }
  function nearSchwerpunkt(game, side, e) {
    if (!schwerpunkt || !schwerpunkt.size) return false;
    for (const n of schwerpunkt) {
      const t = game.map.townMap[n];
      if (t && Hex.distance(e.c, e.r, t.c, t.r) <= 2) return true;
    }
    return false;
  }

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
    //    要点夺取率下降)。"最近未占目标"的骨架保留；26w P2 只做同清单内的加权选近——
    //    战果惯性（相邻要点已夺 → 走廊连贯 −1.5）与守军惩罚（镇内守军强度, 重兵据点绕行, 最多 +4）,
    //    波段清单与"单目标"语义不变, 不触碰否决结论。
    let best = null, bestS = 1e9;
    for (const n of names) {
      const t = game.map.townMap[n];
      let s = Hex.distance(u.c, u.r, t.c, t.r);
      for (const nb of Hex.neighbors(t.c, t.r)) {
        const h = game.hexAt(nb.c, nb.r);
        if (h && h.town && h.town.ctrl === 'DE' && keyTownsOf('DE').includes(h.town.name)) s -= 1.5;
      }
      const gar = game.unitAt(t.c, t.r);
      if (gar && gar.side !== 'DE') s += Math.min(4, gar.def / 40 + (gar.org / gar.maxOrg) * 2);
      /* 26w P2 目标软分流: 本回合已有 n 个友军把该镇选为目标 → +0.8n——
         大兵团沿"最近镇"挤独木桥时自动向其他走廊镇摊开(市场机制多路并进,
         与第二轮否决的"硬分轴"不同: 清单/单目标语义不变, 只调选择概率)。 */
      if (objCnt) s += (objCnt.get(n) || 0) * 0.8;
      if (s < bestS) { bestS = s; best = t; }
    }
    if (best && objCnt) objCnt.set(best.name, (objCnt.get(best.name) || 0) + 1);
    return best;
  }

  // 美军任务目标（第二十八轮：取代旧 usHotspot / planUSOffensive 的目标选择部分）
  /* 26w P2 防线构建: usDefenseLine——敌逼近锚点(≤6, 约两回合行程)且锚点已有人守时, 无事可做的
     美军前出到锚点与最近敌连线上距锚 2~4 格的可防御空格（defPositionScore 高者优先+距离折价,
     避开已预定落点与过挤位）。每锚防线配额 6 个单位——配额外走 ④ 兜底回城镇/后方,
     防止"人球吸附"(实测: 圣维特周边曾被吸走 55 个单位, 巴斯托涅 91 个)。 */
  function usDefenseLine(game, u) {
    let anchor = null, ad = 1e9;
    for (const n of keyTownsOf('US')) {
      const t = game.map.townMap[n];
      if (!t || t.ctrl === 'DE') continue;
      const d = Hex.distance(u.c, u.r, t.c, t.r);
      if (d < ad) { ad = d; anchor = t; }
    }
    if (!anchor) return null;
    const foe = nearestEnemy(game, u, 'US');
    if (!foe) return null;
    const dFoe = Hex.distance(anchor.c, anchor.r, foe.c, foe.r);
    if (dFoe > 6) return null;                        // 敌尚远: 不预铺, 维持机动
    const aKey = Hex.key(anchor.c, anchor.r);
    if ((lineTake && lineTake.get(aKey) || 0) >= 6) return null;   // 该锚防线已满编
    const guard = game.unitAt(anchor.c, anchor.r);
    if (!guard || guard.side !== 'US') return anchor; // 锚点无人守且敌已逼近: 我去守
    let best = null, bs = -1e9;
    for (let dc = -4; dc <= 4; dc++) for (let dr = -4; dr <= 4; dr++) {
      const c = anchor.c + dc, r = anchor.r + dr;
      if (!game.map.hexes.has(Hex.key(c, r))) continue;
      const dA = Hex.distance(anchor.c, anchor.r, c, r);
      if (dA < 2 || dA > 4) continue;
      if (Hex.distance(c, r, foe.c, foe.r) >= dFoe) continue;   // 必须比锚点更贴敌（前出）
      if (game.unitAt(c, r)) continue;
      if (reserved && reserved.has(Hex.key(c, r))) continue;
      let crowd = 0;
      if (reserved) for (const n of Hex.neighbors(c, r)) if (reserved.has(Hex.key(n.c, n.r))) crowd++;
      if (crowd >= 2) continue;                        // 已是拥堵位
      let s = defPositionScore(game, u, c, r) - Hex.distance(u.c, u.r, c, r) * 0.3;   // 26x 修: 原 const → 下面桥梁加分抛 TypeError
      if (game.map.bridges && game.map.bridges.has(Hex.key(c, r))) s += 1.0;   // 26x: 桥梁封锁位加成
      if (s > bs) { bs = s; best = { c, r }; }
    }
    if (best && lineTake) lineTake.set(aKey, (lineTake.get(aKey) || 0) + 1);
    return best;
  }

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
    // ③.5 (26w P2 防线构建): 锚点安全有人守 → 前出防御位
    const dLine = usDefenseLine(game, u);
    if (dLine) return dLine;
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
      /* 26w P1 目标去重: 已有 n 个友军向该敌收拢 → 分数 ÷(1+0.9n)，≥3 个不再加码——
         兵力自动摊到不同敌军，不再 5 个单位全扑同一个。 */
      const loaded = (convergeCnt && convergeCnt.get(e.uid)) || 0;
      if (loaded >= AGGRO.convergeCap) continue;
      /* 26w P2 追击: 残破（组织 <40%）与断补敌 ×1.35——击退后咬住残敌 */
      const pursuit = (e.org / e.maxOrg < 0.4 || (e.unsupRounds || 0) > 0) ? 1.35 : 1;
      const s = unitValue(e) * iso * pursuit / ((d + 1) * (1 + loaded * 0.5));   // 27h: 堆叠惩罚 0.9→0.5（重兵集团）
      if (s > bs) { bs = s; best = e; }
    }
    return best || nearestEnemy(game, u, u.side);
  }

  /* 26w P1: 收拢到敌军并登记（engageTarget 去重计数的人口）。只统计"以敌军为目标"的收拢。
     硬帽 3: 已有 3 个友军收拢同一敌 → 拒收(调用方落到 reachApproach/stepClosest 等不计数
     的逼近路径, 单位仍前进但不堆叠)。③④ 兜底的裸 nearestEnemy 也绕不开这道帽。 */
  function convergeEnemy(game, acts, planned, u, foe) {
    if (!convergeCnt) return false;
    {
      const cap = huntCap > 100 ? 999 : Math.max(huntCap, AGGRO.convergeCap || 6);
      if ((convergeCnt.get(foe.uid) || 0) >= cap) return false;
    }
    if (!convergeOn(game, acts, planned, u, foe)) return false;
    const nv = (convergeCnt.get(foe.uid) || 0) + 1;
    convergeCnt.set(foe.uid, nv);
    if (nv > convergeMaxSeen) convergeMaxSeen = nv;
    return true;
  }

  /* ---------- ① 空袭（双方同一打分：兵种权重 × 打击力 × 地形遮蔽 × 组织比 × 孤立加成）
   *  26w P0: 与本回合已排定的地面突击目标联动（×1.6）——空袭+炮火+突击三重聚焦高价值目标,
   *  而不是各自为战。突击目标集合由 planAttacks 先行返回（计划序: 攻击→空袭; 执行序仍是空袭最先）。 */
  function planAir(game, side, acts, assaultTargets) {
    const left = side === 'DE' ? game.state.airDE : game.state.airUS;
    if (!(left > 0)) return;
    /* 26x 节奏层: 雨雾天无空军（引擎对美军直接拒绝）——提前不规划, 不浪费动作位 */
    if (side === 'US' && game.state.weather !== 'clear') return;
    const cands = [];
    for (const e of game.units) {
      if (!e.alive || e.exited || e.side === side) continue;
      const t = game.hexAt(e.c, e.r).terrain;
      const cover = (t === 'forest' || t === 'mountain' || t === 'marsh') ? 0.4 : 1;
      const w = armor(e) ? 3 : e.type === 'ART' ? 2 : 1;
      const iso = friendsAt(game, e, e.c, e.r) <= 1 ? 1.3 : 1;
      const s = w * e.atk * cover * (e.org / e.maxOrg) * iso *
        (assaultTargets && assaultTargets.has(e.uid) ? 1.6 : 1);
      cands.push({ u: e, s });
    }
    cands.sort((a, b) => b.s - a.s);
    for (let i = 0; i < Math.min(left, cands.length); i++) acts.push({ t: 'air', target: cands[i].u.uid });
  }

  /* ---------- ② 静态攻击（合并原 planUS 步骤 3 与 germanAttackCandidates） ----------
   * 非血战：门槛走 attackGate（26m AGGRO——26w 起静态主攻与两轮动态补刀共用同一把尺）。
   *   有效期望 = 期望交换 + 态势加成（孤立 +0.3 / 无心再战 +0.4 / 被我军围住 +0.2）。
   * 血战：pv.key 存在即出手（引擎下限 1:4），maxForce 组队（最强 3 地面 + 2 炮兵）。
   * 排序：期望守方价值损失优先 + 交换收益 + 目标位于本方任务方向上的加成（双方同一把尺）。
   * 返回：本回合已排定的突击目标集合（26w P0 空袭联动用）。
   */
  function planAttacks(game, side, acts, planned, allOut) {
    const cands = [];
    const assaultTargets = new Set();
    for (const e of game.units) {
      if (!e.alive || e.exited || e.side === side) continue;
      const g = attackGroup(game, e, planned, allOut ? { maxForce: true } : undefined);
      const relaxed = nearSchwerpunkt(game, side, e);   // 26x: 主攻轴放宽
      if (!attackGate(game, g, e, allOut, relaxed)) continue;
      const dfr = friendsAt(game, e, e.c, e.r);
      const ps = passiveOf(game, e);
      const sur = enemiesAt(game, e, e.c, e.r);
      const wEff = g.w + (dfr <= 1 ? 0.3 : 0) + (ps.key === 'broken' ? 0.4 : 0) + (sur >= 2 ? 0.2 : 0);
      const score = crtExpect(g.pv.row).def * unitValue(e) + g.w * (allOut ? 1 : 2) +
        (relaxed ? 0.5 : 0) + (finalPush ? 0.4 : 0) +
        (() => { const obj = objectiveFor(game, g.atts[0]); const dObj = obj ? Hex.distance(e.c, e.r, obj.c, obj.r) : 99; return dObj <= 3 ? 0.6 : dObj <= 6 ? 0.2 : 0; })();
      cands.push({ e, g, score, wEff });
    }
    if (typeof globalThis.__attackDebug === 'object') {
      globalThis.__attackDebug.cands = cands.length;
      globalThis.__attackDebug.adjacent = 0;
      for (const e of game.units) {
        if (!e.alive || e.exited || e.side === side) continue;
        const n = game.attackersFor(e).length;
        if (n > 0) globalThis.__attackDebug.adjacent++;
      }
      globalThis.__attackDebug.ratios = cands.slice(0, 10).map(c => +c.g.pv.ratio.toFixed(2));
    }
    cands.sort((a, b) => b.score - a.score);
    /* 27h: 集火补刀——同一目标在一回合内可发起第二/第三波攻击（打不死就继续上）。
       旧实现每个目标只排一次, 30 次攻击散在 30 个目标上、每处只削 6 点组织度,
       守军 10~19 点组织度永远死不了 = 玩家反馈"攻击烈度极低"。 */
    const extraWaves = AGGRO.extraWaves || 2;
    for (const c of cands) {
      let wave = 0;
      while (wave <= extraWaves) {
        const g = wave === 0 ? c.g : attackGroup(game, c.e, planned, allOut ? { maxForce: true } : undefined);
        if (!g) break;
        if (wave > 0) {
          if (!g.pv || !g.pv.key) break;
          if (!attackGate(game, g, c.e, allOut, finalPush || nearSchwerpunkt(game, side, c.e))) break;
        }
        const atts = g.atts.filter(x => !planned.has(x.uid));
        if (!atts.length) break;
        const arty = g.arty.filter(x => !planned.has(x.uid));
        for (const a of atts) planned.add(a.uid);
        for (const a of arty) planned.add(a.uid);
        assaultTargets.add(c.e.uid);
        acts.push({ t: 'attack', uids: atts.map(x => x.uid), target: c.e.uid, arty: arty.map(x => x.uid) });
        // 一击就能歼灭（期望伤害 ≥ 守军现存组织度）→ 不再浪费兵力补刀
        if (wave === 0 && crtExpect(g.pv.row).def >= c.e.org) break;
        wave++;
      }
    }
    return assaultTargets;
  }

  /* ---------- 26w P0: 攻击门槛统一出口 ----------
   * 静态主攻（planAttacks）与两轮动态补刀（机动前第二波 / 机动后补刀）共用同一把尺。
   * 26m 把门槛降到 attackRatio 0.6 / attackWorth -0.8，但 dynamicAttackPass 的补刀当时
   * 仍沿用旧 -0.05 / 1.2 → 单位贴上弱敌却不攻击。此函数消灭双标。
   * 26x: relaxed=主攻轴上——worth 再放宽 0.4 / ratio 减半, 集中拳头。 */
  /* —— 27i 重兵集团（狂暴档编组行军）——
   * 部队按当前位置 k-means 聚成 K 个集群（K = 单位数/80, 上限 4）, 每集群目标 = 集群
   * 质心最近的敌军。机动层: 未接敌单位整群向集群目标压进（自然抱团成实心方阵）,
   * 已接敌单位原地开火（攻击由静态/动态波次覆盖）。 */
  let formations = null;   // [{members:[uid], c, r, target:{c,r}}], planSide 重算
  function computeFormations(game, side) {
    const units = game.units.filter(u => u.alive && !u.exited && u.side === side && u.arrive <= game.state.round
      && u.type !== 'ART' && u.type !== 'RKT' && !(T[u.type] && T[u.type].hq));
    if (units.length < 8) { formations = null; return; }
    const K = Math.max(2, Math.min(4, Math.round(units.length / 80)));
    const centers = [{ c: units[0].c, r: units[0].r }];
    while (centers.length < K) {
      let best = null, bd = -1;
      for (const u of units) {
        let dmin = 1e9;
        for (const c of centers) dmin = Math.min(dmin, Hex.distance(u.c, u.r, c.c, c.r));
        if (dmin > bd) { bd = dmin; best = u; }
      }
      if (!best || bd <= 0) break;
      centers.push({ c: best.c, r: best.r });
    }
    const assign = units.map(() => 0);
    for (let iter = 0; iter < 2; iter++) {
      units.forEach((u, i) => {
        let bi = 0, bd = 1e9;
        centers.forEach((c, ci) => { const d = Hex.distance(u.c, u.r, c.c, c.r); if (d < bd) { bd = d; bi = ci; } });
        assign[i] = bi;
      });
      centers.forEach((c, ci) => {
        const mem = units.filter((_, i) => assign[i] === ci);
        if (mem.length) {
          c.c = Math.round(mem.reduce((s2, u) => s2 + u.c, 0) / mem.length);
          c.r = Math.round(mem.reduce((s2, u) => s2 + u.r, 0) / mem.length);
        }
      });
    }
    formations = centers.map((c, ci) => {
      const mem = units.filter((_, i) => assign[i] === ci);
      let tgt = null, bd = 1e9;
      for (const e of game.units) {
        if (!e.alive || e.exited || e.side === side) continue;
        const d = Hex.distance(c.c, c.r, e.c, e.r);
        if (d < bd) { bd = d; tgt = { c: e.c, r: e.r }; }
      }
      return { members: mem.map(u => u.uid), c: c.c, r: c.r, target: tgt };
    }).filter(f => f.members.length && f.target);
  }
  function formationOf(uid) {
    if (!formations) return null;
    return formations.find(f => f.members.includes(uid)) || null;
  }

  function attackGate(game, g, e, allOut, relaxed) {
    if (!g || !g.pv.key) return false;
    if (allOut) return true;                       // 血战: 能打就打(引擎下限 1:4)
    /* 27d: 总攻阶段(relaxed || finalPush)——worth 再放宽 0.4 / ratio 减半, 收官不留对峙 */
    const relax = relaxed || finalPush;
    const dfr = friendsAt(game, e, e.c, e.r);
    const ps = passiveOf(game, e);
    const sur = enemiesAt(game, e, e.c, e.r);
    const wEff = g.w + (dfr <= 1 ? 0.3 : 0) + (ps.key === 'broken' ? 0.4 : 0) + (sur >= 2 ? 0.2 : 0);
    return wEff > AGGRO.attackWorth - (relax ? 0.4 : 0) &&
      g.pv.ratio >= AGGRO.attackRatio * (relax ? 0.5 : 1);
  }

  /* ---------- ③ 机动（合并原 planGerman 步骤 3 / planUS 步骤 1~2b / planUSBerserk 步骤 ②）
   *   ① 接敌：6 格内有敌人（或血战姿态）且不是已就位的要点守军 → 向最优交战目标收拢；
   *   ② 目标：向本方任务目标推进（被封锁则缺口机动）；
   *   ③ 无条件接敌兜底：只要地图上还有敌人就必须逼近 —— 结构性排除对峙。
   */
  function planManeuver(game, side, acts, planned, allOut) {
    const my = game.units.filter(u => u.alive && !u.exited && u.side === side && u.arrive <= game.state.round);
    /* 26x: 机动名单排除全部指挥部（t.hq——此前只排除字面 'HQ', 大图 HQK/HQA/HQT 其实一直
       随军冲锋）与 RKT（炮兵层负责开火/撤离/跟进, 不参与步兵机动）。 */
    const movers = my.filter(u => !planned.has(u.uid) && u.type !== 'ART' && u.type !== 'RKT' &&
      !(T[u.type] && T[u.type].hq))
      .sort((a, b) => (armor(b) ? 1 : 0) - (armor(a) ? 1 : 0) || b.mov - a.mov);
    // 性能护栏见 tryPath/reachApproach：A* 每回合限 PATH_BUDGET 次且不打占用格；
    //   getReach（0.27ms/次）是主力位移手段，不再需要额外预算。
    for (const u of movers) {
      if (planned.has(u.uid)) continue;
      /* 26w P2 巩固例外 + 27d 收紧: 要点守军留守 = 被贴脸/受威胁/（敌在前线 6 格内且非总攻）——
         总攻阶段(最后 2 回合)无接触的守军一律加入进攻; 中段留守半径 10→6（后方守军归队,
         前沿真受威胁的照守）——回应用户"AI 移动很少"。 */
      const ned = nearestEnemyDist(game, u.c, u.r, side);
      const stayPosted = !allOut && posted(game, u) &&
        (contact(game, u) || threatAt(game, u) > 0 || (ned <= AGGRO.holdRadius && !finalPush));
      /* 26x 拒止撤退（置于守备判定之后——要点守军不撤, 只撤野战被切断单位） */
      if (!allOut && !stayPosted && u.supplied === false && contact(game, u)) {
        const anchor = retreatAnchor(game, u);
        if (anchor && convergeOn(game, acts, planned, u, anchor)) continue;
      }
      /* 26x 增援梯队化: 本回合刚入场且离敌尚远 → 跟随本方最前线友军沿轴线推进,
         不各自直插目标把路网堵死。 */
      if (!allOut && u.arrive >= game.state.round && ned > 10) {
        const front = frontAnchor(game, side, u);
        if (front && convergeOn(game, acts, planned, u, front)) continue;
      }
      const foe = allOut ? nearestEnemy(game, u, side) : engageTarget(game, u);
      /* 26y 歼灭猎杀: 血战/歼灭模式（allOut）下全军直接扑最近残敌——
         不经过任务目标层。旧路径在歼灭模式仍朝城镇集结: 残局双方各守一堆城镇、
         彼此相距 30+ 格, 全场零接触 → 永不终局（玩家反馈"60 vs 130 僵持、游戏无法结束"）。
         收敛顺序: 登记收拢(去重帽) → 可达域逼近 → 邻格逼近, 三级都不绕过。 */
      if (allOut && foe) {
        if (convergeEnemy(game, acts, planned, u, foe)) continue;
        if (reachApproach(game, acts, planned, u, foe)) continue;
        if (stepClosest(game, acts, planned, u, foe)) continue;
        continue;                                  // 扑不上去也不回头守城（守城对歼灭战无意义）
      }
      if (foe) {
        const near = Hex.distance(u.c, u.r, foe.c, foe.r) <= AGGRO.engageRadius;   // 26m
        if (near && !stayPosted && convergeEnemy(game, acts, planned, u, foe)) continue;
      }
      if (!stayPosted) {
        /* 27j: 后方部队向接触点集中（重兵集团核心）——
           远离敌人的单位不再各奔目标, 而是向最近的正在交战的友军靠拢。
           用户指令: "只有更多的算子到达前线而不是停留在后方才能提高击杀效率"。 */
        if (ned > AGGRO.engageRadius) {
          let bestContact = null, bc = 1e9;
          for (const f of my) {
            if (f === u || !f.alive || f.exited || f.type === 'ART' || f.type === 'RKT') continue;
            if (!(T[f.type] && T[f.type].hq) === false) continue;
            let fAdj = false;
            for (const n of Hex.neighbors(f.c, f.r)) {
              const e = game.unitAt(n.c, n.r);
              if (e && e.side !== side) { fAdj = true; break; }
            }
            if (!fAdj) continue;
            const d = Hex.distance(u.c, u.r, f.c, f.r);
            if (d > 2 && d < bc) { bc = d; bestContact = f; }
          }
          if (bestContact && convergeOn(game, acts, planned, u, bestContact)) continue;
        }
        const obj = objectiveFor(game, u);
        if (obj && !(u.c === obj.c && u.r === obj.r)) {
          if (tryPath(game, acts, planned, u, obj.c, obj.r)) continue;      // 目标格本身是空的：直接 A*
          if (convergeOn(game, acts, planned, u, obj)) continue;            // 被占/绕行：可达域逼近 + 周边空位
        }
        /* ③ 钉子：以上都没成，只要还有敌人就无条件逼近（走进一格也算）——不留任何"无事可做"的分支 */
        if (foe && convergeEnemy(game, acts, planned, u, foe)) continue;
        /* ④ 26m 强制前进：仍无动作 → 朝目标/最近敌人再逼近（含已被占格周边），务必每回合移动 */
        if (AGGRO.forceAdvance) {
          const tgt = foe || objectiveFor(game, u) || nearestEnemy(game, u, side);
          if (tgt) {
            const toFoe = tgt.side !== undefined && tgt.side !== side;      // 26w: 以敌为目标才计去重
            if (toFoe ? convergeEnemy(game, acts, planned, u, tgt) : convergeOn(game, acts, planned, u, tgt)) continue;
            if (reachApproach(game, acts, planned, u, tgt)) continue;
            if (stepClosest(game, acts, planned, u, tgt)) continue;
          }
        }
      }
    }
    /* 26x HQ 跟进: 安静时向本方战斗部队质心每回合挪 1 格, 让补给覆盖随战线前进;
       敌在 6 格内绝不移动（指挥部毁灭冲击是全游戏最重机制, 移动必须保守）。 */
    const hqFollow = game.map.cols >= 100 ? 14 : game.map.cols >= 50 ? 8 : 5;
    for (const h of my) {
      const ht = T[h.type];
      if (!ht || !ht.hq || planned.has(h.uid)) continue;
      if (nearestEnemyDist(game, h.c, h.r, side) <= 6) continue;
      if (!myCentroid) break;
      if (Hex.distance(h.c, h.r, myCentroid.c, myCentroid.r) <= hqFollow) continue;
      stepClosest(game, acts, planned, h, myCentroid);
    }
  }

  /* 26x: 拒止撤退的收拢锚——最近的本方控制要点 */
  function retreatAnchor(game, u) {
    let best = null, bd = 1e9;
    for (const n of keyTownsOf(u.side)) {
      const t = game.map.townMap[n];
      if (!t || t.ctrl !== u.side) continue;
      const d = Hex.distance(u.c, u.r, t.c, t.r);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /* 26x: 增援梯队的跟随锚——本方最前线友军（离敌最近, 同距取离自己近的） */
  function frontAnchor(game, side, u) {
    let best = null, bs = -1e9;
    for (const f of game.units) {
      if (!f.alive || f.exited || f.side !== side || f === u) continue;
      const ft = T[f.type];
      if ((ft && ft.hq) || f.type === 'ART' || f.type === 'RKT') continue;
      const s = -nearestEnemyDist(game, f.c, f.r, side) * 2 - Hex.distance(u.c, u.r, f.c, f.r) * 0.3;
      if (s > bs) { bs = s; best = f; }
    }
    return best;
  }

  /* ---------- ④ 炮兵（26x 重写：
   *   ART 0-4 相邻可直射（被贴脸不再禁射, 直接轰最有价值的射程内目标）;
   *   RKT 原规则（2-4 盲区 + 被贴脸禁射 → 先撤退脱离再战）;
   *   反炮兵加权（敌炮/火箭炮 +1.0）; 主攻方向周边目标 +0.8;
   *   无目标时向本方最前线跟进（ART_FOLLOW_D）。 ---------- */
  function planArty(game, side, acts, planned, allOut) {
    const my = game.units.filter(u => u.alive && !u.exited && u.side === side);
    for (const a of my) {
      if ((a.type !== 'ART' && a.type !== 'RKT') || planned.has(a.uid)) continue;
      const isRKT = a.type === 'RKT';
      const inZoc = game.inZOC(a.c, a.r, side);
      if (inZoc && isRKT) { artyRetreat(game, acts, planned, a); continue; }   // RKT 被贴脸: 撤离
      const rng = (isRKT ? DATA.TRAIT_KNOBS.RKT_RANGE : a.range) -
        (!isRKT && game.state.weather === 'fog' ? 1 : 0);
      let best = null, score = -1;
      for (const e of game.units) {
        if (!e.alive || e.exited || e.side === side) continue;
        const d = Hex.distance(a.c, a.r, e.c, e.r);
        if (d > rng || (isRKT && d < DATA.TRAIT_KNOBS.RKT_MIN_RANGE)) continue;
        const pressing = enemiesAt(game, e, e.c, e.r) >= 2 ? 1.2 : 0;   // 正贴着我方部队打
        const sp = nearSchwerpunkt(game, side, e) ? 0.8 : 0;            // 26x: 主攻方向加成
        const s = (armor(e) ? 3 : 1) + (e.type === 'ART' || e.type === 'RKT' ? 1.0 : 0) + e.org / 10 + pressing + sp +
          Math.max(0, 1 - e.org / 10) * 1.5;                            // 残破者优先（一击可灭）; 26x 反炮兵 0.3→1.0
        if (s > score) { score = s; best = e; }
      }
      if (best) { planned.add(a.uid); acts.push({ t: 'arty', uid: a.uid, target: best.uid }); continue; }
      let anchor = null, ad = 1e9;
      for (const f of my) {
        const ft = T[f.type];
        if (!f.alive || (ft && ft.hq) || f.type === 'ART' || f.type === 'RKT') continue;
        const d = Hex.distance(a.c, a.r, f.c, f.r);
        if (d > ART_FOLLOW_D && d < ad) { ad = d; anchor = f; }
      }
      // 跟进：走通用位移引擎（锚点是友军单位所在格 = 占用格，绝不能直接 A*，见位移引擎注释）
      if (anchor && !allOut) { convergeOn(game, acts, planned, a, anchor); continue; }
      /* 26y 残局保险: 歼灭模式、或本方已无地面友军可跟随（只剩炮兵/指挥部）——
         自行向最近敌军前压, 否则炮兵在残局永久僵死（玩家反馈的僵持成因之一）。 */
      const foeA = nearestEnemy(game, a, side);
      if (foeA) {
        if (reachApproach(game, acts, planned, a, foeA)) continue;
        if (stepClosest(game, acts, planned, a, foeA)) continue;
      }
    }
  }

  /* 26x: RKT 被贴脸的撤离——撤到"0 邻敌"格（防御地形+离敌远优先）; 无路可撤则原地挨打 */
  function artyRetreat(game, acts, planned, a) {
    let best = null, bs = -1e9;
    for (const n of Hex.neighbors(a.c, a.r)) {
      const k = Hex.key(n.c, n.r);
      if (!game.map.hexes.has(k) || game.unitAt(n.c, n.r)) continue;
      if (reserved && reserved.has(k)) continue;
      let en = 0;
      for (const q of Hex.neighbors(n.c, n.r)) { const e = game.unitAt(q.c, q.r); if (e && e.side !== a.side) en++; }
      if (en > 0) continue;
      const s = defPositionScore(game, a, n.c, n.r) + nearestEnemyDist(game, n.c, n.r, a.side) * 0.5;
      if (s > bs) { bs = s; best = n; }
    }
    if (best) planMove(game, acts, planned, a, [best]);
  }

  /* ---------- 计划流水线（双方唯一入口） ---------- */
  function planSide(game, side, acts, planned) {
    const allOut = berserk(game);
    /* 27d 总攻: 每局最后 2 个回合——攻击门槛全局放宽、守军无接触即加入进攻,
       消灭"后期对峙"（歼灭模式的对峙已由 26y 猎杀分支+保险丝解决, 这里覆盖常规局收官阶段） */
    finalPush = !game.state.noTurnLimit && (game.scenario.rounds - game.state.round) <= 2;
    /* 27f 清剿阶段: 歼灭/血战且敌军残存 ≤20 → 收敛帽解除（全员围殴残敌, 不再 3 个排队） */
    huntCap = allOut && aliveCount(game, foeSide(side)) <= 20 ? 999 : 3;
    if (AGGRO.formations) computeFormations(game, side); else formations = null;   // 27i: 编组计算
    pickSchwerpunkt(game, side);                                   // 26x: 主攻方向 + 本方质心
    const assaultTargets = planAttacks(game, side, acts, planned, allOut); // ② 静态攻击（先算——空袭联动用）
    planAir(game, side, acts, assaultTargets);                     // ① 空袭（优先打将遭突击的目标）
    planManeuver(game, side, acts, planned, allOut);               // ③ 机动 / 接敌 / 兜底
    planArty(game, side, acts, planned, allOut);                   // ④ 炮兵（最后计划：planned 已定）
    /* 26w P0: 执行序重排（稳定排序，计划序不变）——空袭 → 炮火准备 → 突击 → 机动。
       旧序炮兵执行在突击之后, 炮火准备永远支援不到本回合的地面攻击（只能给下回合）;
       空袭与炮兵先行还让突击面对的是已被削弱的守军（实际交换比优于规划值, 方向正确）。 */
    const ord = t => t === 'air' ? 0 : t === 'arty' ? 1 : t === 'attack' ? 2 : 3;
    acts.sort((a, b) => ord(a.t) - ord(b.t));
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
    convergeCnt = new Map();  // 26w P1: 各敌军已被收拢数（engageTarget 去重用）
    convergeMaxSeen = 0;
    lineTake = new Map();     // 26w P2: 美军防线配额
    objCnt = new Map();       // 26w P2: 德军目标软分流计数
    pathBudget = { n: PATH_BUDGET };   // 本回合允许的 A* 次数（性能护栏，见 tryPath）
    try {
      planSide(game, side, acts, planned);   // 第二十八轮：两侧共用同一条流水线
    } finally {
      reserved = null;
      convergeCnt = null;
      lineTake = null;
      objCnt = null;
      pathBudget = null;
    }
    // 注意: 结束阶段由 executeTurn 收尾负责, 计划中不再包含 end 动作
    return acts;
  }

  /* ---------------- 执行 ---------------- */
  /* 26w P1: 两段执行——空袭/炮火/突击（第一波）→ 机动前补刀（第二波集火残敌）→ 机动 → 机动后补刀。
     第一波打残的敌人由尚未动手的生力军补枪; 机动后原 dynamicAttackPass 继续兜临时战机。
     门槛两波共用 attackGate（26w P0 已同步 AGGRO）。 */
  function executeTurn(game, side, schedule, done, opts) {
    const acts = planTurn(game, side);
    /* 26y: 把本阶段动作总数回报给调用方（ui 据此决定是否进入"大批量免动画"通道——
       605 个算子逐个等动画, 单阶段会超过 45s, 看门狗反复打断, 歼灭战永远打不完）。 */
    if (opts && typeof opts.onPlan === 'function') { try { opts.onPlan(acts.length); } catch (e) { /* 调用方异常不影响推演 */ } }
    const pre = [], moves = [];
    for (const a of acts) (a.t === 'move' ? moves : pre).push(a);
    let i = 0, list = pre, preWaveDone = false;
    const delay = 30;   // 原版39轮移植: 动作间隔 60→30ms
    let throws24y = 0;   // 24y 自愈计数
    function next() {
      try {
        if (game.state.over) { done(); return; }
        if (i >= list.length) {
          if (!preWaveDone) {
            preWaveDone = true; i = 0; list = moves;
            dynamicAttackPass(game, side, schedule, () => schedule(next, 0), true);   // 第二波: 补枪
            return;
          }
          // 动态补刀: 移动后再评估一轮攻击
          dynamicAttackPass(game, side, schedule, () => { if (!game.state.over) game.endPhase(); done(); });
          return;
        }
        const a = list[i++];
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

  function dynamicAttackPass(game, side, schedule, done, mopUp) {
    const steps = [];
    const built = new Set();
    const allOut = berserk(game);   // 血战姿态下补刀不看任何阈值
    for (const e of game.units.filter(x => x.alive && !x.exited && x.side !== side)) {
      // 第二十八轮：动态补刀与静态攻击完全同标准（同一组队器 + 同一套门槛）。
      //   26w P0: 门槛统一走 attackGate（AGGRO）——此前这里仍用旧 -0.05/1.2,
      //   移动后贴上的弱敌不打（双标, 玩家反馈"贴了不打"）。血战：maxForce 组队、能打就打。
      //   26w P1: 机动前第二波(mopUp)只"补枪"——期望伤害 ≥ 守军现存组织 80% (基本可歼灭)
      //   才出手; 否则在师级高攻防量级下会退化成对残敌的全面强攻(实测美军损耗 +38pp)。
      const g = attackGroup(game, e, built, allOut ? { maxForce: true } : undefined);
      if (!attackGate(game, g, e, allOut, nearSchwerpunkt(game, side, e))) continue;
      if (mopUp && !allOut) {
        const ex = crtExpect(g.pv.row);
        if (ex.def < e.org * 0.8) continue;
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

  return {
    planTurn, executeTurn,
    /* 27e: 进攻强度档位（AI 指挥面板调用；__test 内另有同款供 QA） */
    setAggroPreset,
    aggroPresets: () => AGGRO_PRESETS,
    aggroKey: () => aggroKey,
    /* 26w: QA 观测口（qa/ai_aggro_check 用；游戏运行时不读） */
    __test: {
      attackGate,
      attackGroup,
      engageTarget,
      usDefenseLine,
      finalPushOf: (g) => !g.state.noTurnLimit && (g.scenario.rounds - g.state.round) <= 2,
      formationsNow() { return formations ? formations.map(f => ({ n: f.members.length, c: f.c, r: f.r, hasT: !!f.target })) : []; },
      schwerpunktNow() { return schwerpunkt ? [...schwerpunkt] : []; },
      setAggroPreset,
      aggroPresets: () => AGGRO_PRESETS,
      aggroKey: () => aggroKey,
      nearSchwerpunkt,
      garrisonStays(game, u) {   // 与 planManeuver 同口径的守备留守判定（27d: 含总攻收紧）
        const ned = nearestEnemyDist(game, u.c, u.r, u.side);
        const fp = !game.state.noTurnLimit && (game.scenario.rounds - game.state.round) <= 2;
        return !berserk(game) && posted(game, u) &&
          (contact(game, u) || threatAt(game, u) > 0 || (ned <= AGGRO.holdRadius && !fp));
      },
      convergeMax() { return convergeMaxSeen; },
    },
  };
})();
