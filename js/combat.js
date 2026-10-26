'use strict';
/* ============================================================
 * combat.js — 战斗结算: 战力比 → CRT → 伤害/撤退/推进
 * 纯逻辑, 不依赖渲染。结果附 events 供渲染层做动画。
 * ============================================================ */
globalThis.Combat = (function () {

  // 战力比 → CRT 列
  function oddsKey(ratio) {
    if (ratio >= 6) return '6:1';
    if (ratio >= 5) return '5:1';
    if (ratio >= 4) return '4:1';
    if (ratio >= 3) return '3:1';
    if (ratio >= 2) return '2:1';
    if (ratio >= 1) return '1:1';
    if (ratio >= 0.5) return '1:2';
    if (ratio >= 0.34) return '1:3';
    if (ratio >= 0.25) return '1:4';
    return null; // 弱于1:4 不允许攻击
  }

  function shiftKey(key, shift) {
    const i = DATA.ODDS_ORDER.indexOf(key);
    if (i < 0) return key;
    const j = Math.max(0, Math.min(DATA.ODDS_ORDER.length - 1, i + shift));
    return DATA.ODDS_ORDER[j];
  }

  // 攻击正面限制: 最多3个地面单位 + 2个炮兵单位(择优)
  const FRONTAGE = 3, FRONTAGE_ARTY = 2;
  function capAttack(atts, arty) {
    const a2 = (atts || []).slice()
      .sort((x, y) => (y.atk * y.org / y.maxOrg) - (x.atk * x.org / x.maxOrg))
      .slice(0, FRONTAGE);
    const y2 = (arty || []).slice().sort((x, y) => y.sup - x.sup).slice(0, FRONTAGE_ARTY);
    return { atts: a2, arty: y2 };
  }

  // 断补攻防倍率(2026-10 第九轮: 断补详细设定):
  //  - 有补给 / 空降兵(豁免) → 1
  //  - 宽限期内(unsupRounds ≤ UNSUP_GRACE, 断补前两回合) → 1, 完全不受影响
  //  - 满宽限期后(断补第 3 回合起): 步兵类(sym 'inf') ×UNSUP_INF_MOD(小幅度降低),
  //    非步兵 ×UNSUP_NONINF_MOD(降低一半)
  function supplyMod(u) {
    if (!u || u.supplied || DATA.TYPES[u.type].abn) return 1;
    if ((u.unsupRounds || 0) <= DATA.UNSUP_GRACE) return 1;
    return DATA.TYPES[u.type].sym === 'inf' ? DATA.UNSUP_INF_MOD : DATA.UNSUP_NONINF_MOD;
  }

  // 被动状态(2026-10): 由棋盘态势自动判定, 无需令牌, 不消耗 RNG 流
  //  协同作战 —— 周围一圈(6 邻格)友军 ≥ PASSIVE.coordMinFriends: 攻防小幅提升(互为犄角)
  //  困兽犹斗 —— 被围(0 友邻 且 相邻敌军 ≥ encMinEnemies) 且 士气判定通过: 攻防小幅上升
  //  无心再战 —— 被围且士气判定失败: 攻防相当幅度下降
  // 士气判定哈希(uid, 回合): 同一回合内结果稳定(预览/结算一致), 且不推进 game.rng ——
  // 若用 game.rng() 会导致"打开战力比弹窗"就改变后续掷骰序列。
  function moraleRoll(u, round) {
    let h = (Math.imul(u.uid | 0, 2654435761) ^ Math.imul(round | 0, 40503)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function passiveState(game, u) {
    const P = DATA.PASSIVE;
    let friends = 0, enemies = 0;
    for (const n of Hex.neighbors(u.c, u.r)) {
      if (!game.map.hexes.has(Hex.key(n.c, n.r))) continue;
      const f = game.unitAt(n.c, n.r);
      if (!f || !f.alive) continue;
      if (f.side === u.side) friends++;
      else enemies++;
    }
    if (friends >= P.coordMinFriends) {
      return { key: 'coord', name: '协同作战', atk: P.coordAtk, def: P.coordDef, friends, enemies };
    }
    if (friends === 0 && enemies >= P.encMinEnemies) {
      const ratio = Math.max(0, Math.min(1, u.org / u.maxOrg));
      const win = moraleRoll(u, game.state.round) < ratio;      // 建制越完整越可能背水一战
      return win
        ? { key: 'lastStand', name: '困兽犹斗', atk: P.lastStandAtk, def: P.lastStandDef, friends, enemies }
        : { key: 'broken', name: '无心再战', atk: P.brokenAtk, def: P.brokenDef, friends, enemies };
    }
    return { key: null, name: '', atk: 1, def: 1, friends, enemies };
  }

  // 汇总攻击力(含组织度、支援炮兵、被动状态)
  function attackStrength(game, units, artyUnits) {
    let sum = 0;
    for (const u of units) sum += u.atk * (u.org / u.maxOrg) * supplyMod(u) * passiveState(game, u).atk;
    if (artyUnits) for (const a of artyUnits) sum += a.sup * supplyMod(a);
    return sum;
  }

  // 防御力(含地形、断补、工事、被动状态)
  function defenseStrength(game, defUnit, attUnits) {
    let d = defUnit.def * (defUnit.org / defUnit.maxOrg);
    const hex = game.map.hexes.get(Hex.key(defUnit.c, defUnit.r));
    const terr = DATA.TERRAIN[hex.terrain];
    d *= terr.dm;
    // 城镇分级: 主城(圣维特/巴斯托涅等)防御更硬, 小镇次之
    if (hex.terrain === 'town' && hex.town) d *= (hex.town.tier >= 2 ? 1.1 : 0.85);
    // 野战工事(令牌buff, 随单位)
    if (defUnit.attach && defUnit.attach.fort) d *= 1.25;
    // 就地筑垒(2026-10-24h): 工事在格上, 任何占据者受益; 但攻方含工兵营时无视(工兵懂拆工事)
    if (game.fortHexes && game.fortHexes.has(Hex.key(defUnit.c, defUnit.r))) {
      if (!(attUnits || []).some(a => a.type === 'ENGR')) d *= DATA.TRAIT_KNOBS.HEX_FORT_MULT;
    }
    d *= supplyMod(defUnit);   // 断补: 宽限期无惩罚, 之后步兵×0.85 / 非步兵×0.5
    d *= passiveState(game, defUnit).def;   // 被动: 协同 / 困兽犹斗 / 无心再战
    return d;
  }

  // 单位是否具备反装甲火力(2026-10 装甲防护规则)
  // 装甲类(ARM/MOT/RECON) / 反装甲兵种(TD) / 炮兵(ART) / 配属了反坦克小组的步兵 —— 具备
  function hasAntiArmor(u) {
    if (!u) return false;
    const t = DATA.TYPES[u.type];
    return !!(t.armor || t.antiArmor || u.type === 'ART' || (u.attach && u.attach.at));
  }

  // 本次攻击是否为"无反装甲火力攻击装甲目标": 守方是装甲类, 且参战单位(地面+支援炮兵)全无反装甲火力
  function softVsArmor(game, attUnits, defUnit, artyUnits) {
    // 2026-10-24h: 装甲防护收窄为装甲营(ARM)专属 —— 装掷/侦察的半履带车扛不住步兵反装甲火力
    if (!defUnit || defUnit.type !== 'ARM') return false;
    const all = (attUnits || []).concat(artyUnits || []);
    if (!all.length) return false;
    return !all.some(hasAntiArmor);
  }

  // 兵种特性对\"守方本次所受伤害\"的修正(2026-10-24h): 返回 {mul, add}
  //   TD 装甲猎手: 攻方含坦克歼击营且守方为装甲类 → ×1.5
  //   VGD 乡土卫戍: 守方VGD在己方城镇格 → ×0.5; 攻方含VGD且守方距攻方控制城镇≤2格 → +1
  function traitMods(game, defUnit, attUnits) {
    const K = DATA.TRAIT_KNOBS;
    let mul = 1, add = 0;
    const atkSide = attUnits && attUnits.length ? attUnits[0].side : null;
    if (defUnit && defUnit.type === 'ARM' && atkSide && (attUnits || []).some(a => a.type === 'TD')) mul *= K.TD_VS_ARMOR_DMG;
    if (defUnit && defUnit.type === 'VGD') {
      const hex = game.hexAt(defUnit.c, defUnit.r);
      if (hex && hex.town && hex.town.ctrl === defUnit.side) mul *= K.VGD_TOWN_DEF_MOD;
    }
    if (atkSide && (attUnits || []).some(a => a.type === 'VGD') && game.map && game.map.towns) {
      for (const t of game.map.towns) {
        if (t.ctrl === atkSide && Hex.distance(t.c, t.r, defUnit.c, defUnit.r) <= K.VGD_TOWN_RING) { add += K.VGD_TOWN_DMG; break; }
      }
    }
    return { mul, add };
  }

  // 无反装甲火力 → 装甲守方受损大幅衰减(倍率+下限见 DATA)
  function scaleDefDamage(raw) {
    if (raw <= 0) return 0;
    return Math.max(DATA.SOFT_VS_ARMOR_MIN, Math.round(raw * DATA.SOFT_VS_ARMOR_DMG));
  }

  // 预览一次攻击: 返回战力比/列/修正/各结果
  function preview(game, attUnits, defUnit, artyUnits, supportExtra) {
    const capped = capAttack(attUnits, artyUnits);
    attUnits = capped.atts; artyUnits = capped.arty;
    // 炮火急袭: 参战单位携带的本阶段加成
    const fireBonus = attUnits.reduce((s, u) => s + (u.fireSupport || 0), 0);
    const atk = attackStrength(game, attUnits, artyUnits) + fireBonus + (supportExtra || 0);
    let def = Math.max(0.5, defenseStrength(game, defUnit, attUnits));
    const defTypes = DATA.TYPES[defUnit.type];
    const shifts = [];
    const defHex = game.map.hexes.get(Hex.key(defUnit.c, defUnit.r));
    // 反装甲防御: 坦克歼击营/配属反坦克小组的单位 遭纯装甲攻击时防御×1.5
    const allArmor = attUnits.length > 0 && attUnits.every(u => DATA.TYPES[u.type].armor);
    const hasAT = defTypes.antiArmor || (defUnit.attach && defUnit.attach.at);
    if (hasAT && allArmor) {
      def *= 1.5;
      shifts.push({ name: defUnit.attach && defUnit.attach.at ? '反坦克小组伏击' : '反装甲防御', v: 0 });
    }
    // 汇总攻方战力比
    const ratio = atk / def;
    let key = oddsKey(ratio);
    // 渡河攻击(从非桥格攻入河格)
    let river = false;
    for (const a of attUnits) {
      const ah = game.map.hexes.get(Hex.key(a.c, a.r));
      if (defHex.river && !ah.river && !ah.bridge && !defHex.bridge) { river = true; break; }
    }
    if (river) shifts.push({ name: '渡河攻击', v: DATA.RIVER_ODDS_SHIFT });
    // 装甲冲击: 纯坦克营群 vs 无反装甲守方(开阔地形) 升一档
    const pureTank = attUnits.length > 0 && attUnits.every(u => u.type === 'ARM');
    const openT = ['plain', 'rough', 'town'].includes(defHex.terrain);
    if (key && pureTank && !hasAT && !defTypes.armor && openT) {
      shifts.push({ name: '装甲冲击', v: DATA.ARMOR_VS_SOFT_SHIFT });
    }
    // 反坦克小组伏击: 首次纯装甲攻击额外降一档(随后消耗)
    if (key && defUnit.attach && defUnit.attach.at && allArmor) {
      shifts.push({ name: '反坦克伏击', v: -1 });
    }
    // 第1回合德军奇袭(史实: 美军猝不及防)
    if (key && game.state.round === 1 && attUnits.length && attUnits[0].side === 'DE') {
      shifts.push({ name: '奇袭', v: 1 });
    }
    for (const s of shifts) if (key) key = shiftKey(key, s.v);
    const row = key ? DATA.CRT[key] : null;
    // softArmor: 攻击方无反装甲火力 vs 装甲目标 → 结算时守方伤害大幅衰减(供 UI 提示用)
    const softArmor = softVsArmor(game, attUnits, defUnit, artyUnits);
    // passives: 本次攻击涉及的被动状态(协同/困兽犹斗/无心再战), 供战力比弹窗与战报显示
    const passives = [];
    for (const u of attUnits) {
      const ps = passiveState(game, u);
      if (ps.key) passives.push({ name: ps.name, side: u.side, unit: u.abbr || u.name, role: '攻', mult: ps.atk, forAtk: true });
    }
    const dps = passiveState(game, defUnit);
    if (dps.key) passives.push({ name: dps.name, side: defUnit.side, unit: defUnit.abbr || defUnit.name, role: '守', mult: dps.def, forAtk: false });
    return { atk: round1(atk), def: round1(def), ratio, key, shifts, row, softArmor, passives };
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  // 结算一次攻击。attUnits/artyUnits 均需已标记 moved/attacked。
  // 返回 { roll, d1, d2, key, result, deadUnits, retreats:[{unit,path}], advanceOffer, events,
  //        atkDmg, defDmg, atkDead, defDead }
  // 战损以"组织度"计：atkDmg/defDmg = 攻方/守方本回合实扣组织度合计，供结算弹窗与战报分开显示。
  function resolve(game, attUnits, defUnit, artyUnits) {
    const pv = preview(game, attUnits, defUnit, artyUnits);
    const d1 = 1 + Math.floor(game.rng() * 6);
    const d2 = 1 + Math.floor(game.rng() * 6);
    const roll = d1 + d2;
    const out = { d1, d2, roll, key: pv.key, result: '—', deadUnits: [], retreats: [], advanceOffer: null, events: [],
      atkDmg: 0, defDmg: 0, atkDead: 0, defDead: 0 };
    if (!pv.key || !pv.row) { out.result = 'NO'; out.events.push({ t: 'msg', msg: '战力比不足 1:4，无法攻击' }); return out; }
    const result = pv.row[roll - 2];
    out.result = result;
    const dm = DATA.DMG[result];
    const defHexKey = Hex.key(defUnit.c, defUnit.r);

    // 攻方伤害与撤退
    // atkDmg/defDmg = 名义伤害(供 game._cas, 保持既有口径)；atkReal/defReal = 组织度"实扣"(供弹窗与终局明细)
    let atkDmg = 0, defDmg = 0, atkReal = 0, defReal = 0;
    if (dm.atk > 0) {
      for (const a of attUnits) {
        atkReal += game.dmgOrg(a, dm.atk, 'atk');
        atkDmg += dm.atk;
        if (a.org <= 0) { out.deadUnits.push(a); out.events.push({ t: 'destroy', unit: a }); }
      }
      if (artyUnits) for (const a of artyUnits) {
        const ad = Math.min(1, dm.atk - 2);
        atkReal += game.dmgOrg(a, ad, 'atk');
        atkDmg += ad;
        if (a.org <= 0) { out.deadUnits.push(a); out.events.push({ t: 'destroy', unit: a }); }
      }
    }
    if (dm.atkRetreat) {
      for (const a of attUnits) {
        if (a.org <= 0) continue;
        const to = retreatHex(game, a, defUnit);
        if (to) { out.retreats.push({ unit: a, to }); game._setPos(a, to.c, to.r); game._occupyTown(a, to.c, to.r); }   // 24q: 撤退落点占城同规则
        else { atkReal += game.dmgOrg(a, 2, 'atk'); atkDmg += 2; if (a.org <= 0) { out.deadUnits.push(a); out.events.push({ t: 'destroy', unit: a }); } }
      }
    }

    // 守方伤害与撤退
    const vacHex = { c: defUnit.c, r: defUnit.r };
    // 装甲 vs 无反装甲火力: 守方受损大幅衰减(仍能逐退, 但几乎打不动)
    const softArmor = pv.softArmor;
    if (dm.def > 0) {
      const tm = traitMods(game, defUnit, attUnits);
      let dmg = softArmor ? scaleDefDamage(dm.def) : dm.def;
      dmg = Math.max(1, Math.round(dmg * tm.mul + tm.add));   // 兵种特性: 猎甲/卫戍(2026-10-24h)
      defReal += game.dmgOrg(defUnit, dmg, 'def');
      defDmg += dmg;
      if (defUnit.org <= 0) {
        out.deadUnits.push(defUnit);
        out.events.push({ t: 'destroy', unit: defUnit });
      } else if (dm.defRetreat) {
        const to = retreatHex(game, defUnit, null, attUnits);
        if (to) { out.retreats.push({ unit: defUnit, to }); game._setPos(defUnit, to.c, to.r); game._occupyTown(defUnit, to.c, to.r); }   // 24q: 撤退落点占城同规则
        else {
          // 无路可退: 困守损伤
          let stuck = softArmor ? scaleDefDamage(2) : 2;
          if (defUnit.type === 'VGD') { const hx = game.hexAt(defUnit.c, defUnit.r); if (hx && hx.town && hx.town.ctrl === defUnit.side) stuck = Math.max(1, Math.round(stuck * DATA.TRAIT_KNOBS.VGD_TOWN_DEF_MOD)); }
          defReal += game.dmgOrg(defUnit, stuck, 'def');
          defDmg += stuck;
          if (defUnit.org <= 0) { out.deadUnits.push(defUnit); out.events.push({ t: 'destroy', unit: defUnit }); }
          else out.events.push({ t: 'msg', msg: `${defUnit.name} 被围困，死战不退` });
        }
      }
    }
    if (attUnits.length) game._cas(attUnits[0].side, Math.round(atkDmg));
    game._cas(defUnit.side, Math.round(defDmg));

    // 攻方推进(守方格空出且守方被逐退/歼灭)
    const defGone = out.deadUnits.includes(defUnit) || defUnit.c !== vacHex.c || defUnit.r !== vacHex.r;
    if ((result === 'DR' || result === 'DE' || result === 'EX') && defGone) {
      const candidates = attUnits.filter(a => a.org > 0 && Hex.distance(a.c, a.r, vacHex.c, vacHex.r) === 1);
      if (candidates.length) {
        candidates.sort((x, y) => (DATA.TYPES[y.type].armor ? 1 : 0) - (DATA.TYPES[x.type].armor ? 1 : 0));
        out.advanceOffer = { units: candidates, hex: vacHex };
      }
    }

    // 清理阵亡
    for (const u of out.deadUnits) u.alive = false;
    // 战损拆分：取 dmgOrg 的实扣返回值（攻/守分开），并统计各自被歼灭的建制数
    out.atkDmg = Math.round(atkReal);
    out.defDmg = Math.round(defReal);
    out.defDead = out.deadUnits.indexOf(defUnit) >= 0 ? 1 : 0;
    out.atkDead = out.deadUnits.length - out.defDead;
    out.preview = pv;
    return out;
  }

  // 撤退格选择: 远离威胁方向, 不入敌占格; 入敌ZOC扣血(由调用者处理为无路可退则扣2)
  function retreatHex(game, unit, awayFrom, attackers) {
    const opts = [];
    for (const n of Hex.neighbors(unit.c, unit.r)) {
      if (!game.map.hexes.has(Hex.key(n.c, n.r))) continue;
      if (game.unitAt(n.c, n.r)) continue;
      let bad = false;
      if (awayFrom) { if (Hex.distance(n.c, n.r, awayFrom.c, awayFrom.r) <= 1) bad = true; }
      if (attackers) for (const a of attackers) if (Hex.distance(n.c, n.r, a.c, a.r) <= 1) { bad = true; break; }
      if (!bad) opts.push(n);
    }
    if (!opts.length) {
      // 放宽: 允许退入敌ZOC(但必须空格)
      for (const n of Hex.neighbors(unit.c, unit.r)) {
        if (!game.map.hexes.has(Hex.key(n.c, n.r))) continue;
        if (!game.unitAt(n.c, n.r)) opts.push(n);
      }
    }
    if (!opts.length) return null;
    opts.sort((a, b) => {
      const ta = DATA.TERRAIN[game.map.hexes.get(Hex.key(a.c, a.r)).terrain].dm;
      const tb = DATA.TERRAIN[game.map.hexes.get(Hex.key(b.c, b.r)).terrain].dm;
      return tb - ta; // 优先退入防御地形
    });
    return opts[0];
  }

  return { oddsKey, preview, resolve, retreatHex, shiftKey, capAttack, hasAntiArmor, softVsArmor, scaleDefDamage, supplyMod, passiveState, moraleRoll , traitMods };
})();
