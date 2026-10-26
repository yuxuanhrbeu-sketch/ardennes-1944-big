'use strict';
/* ============================================================
 * ui.js — 交互层: 选择/移动/攻击/炮击/空袭/推进 状态机 + 面板
 * ============================================================ */
globalThis.UI = (function () {

  const $ = id => document.getElementById(id);
  let game = null, renderer = null;
  let mode = 'idle';            // idle | selected | arty | air | advance
  let selected = null;
  let reach = null;
  // 点击城市时展示的补给覆盖（用于取消展示与提示）
  let townCov = null;
  let aiDE = true, aiUS = false;
  let aiBusy = false;
  let animQueue = Promise.resolve();
  let gameNo = 0;

  /* ---------------- 工具 ---------------- */
  function enqueue(fn) { animQueue = animQueue.then(fn).catch(e => console.error(e)); }

  function showBanner(big, sub, ms) {
    $('bannerBig').textContent = big;
    $('bannerSub').textContent = sub || '';
    const b = $('banner');
    b.style.opacity = 1;
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => { b.style.opacity = 0; }, ms || 1800);
  }

  function logHtml(e) {
    const div = document.createElement('div');
    div.className = e.cls || '';
    div.textContent = e.msg;
    return div;
  }

  /* ---- 战报折叠（第十五轮）：收起后只留标题栏、把地图让出来；折叠期间新战报计未读 ---- */
  let logCollapsed = (() => {
    let v = null;
    try { v = localStorage.getItem('ardennes44_logCollapsed'); } catch (e) { /* 隐私模式下不可用 */ }
    if (v !== null) return v === '1';
    // 首次访问：窄屏默认折叠(先让棋盘给地图)，用户手动切换后该选择会被记住
    try { return !!(window.matchMedia && window.matchMedia('(max-width: 860px)').matches); } catch (e) { return false; }
  })();
  let logUnread = 0;
  // 只刷新外观（类名 / 箭头 / 未读角标 / tooltip），不碰滚动位置
  function renderLogToggle() {
    $('logPanel').classList.toggle('collapsed', logCollapsed);
    const btn = $('btnLogToggle');
    btn.title = (logCollapsed ? '展开战报' : '折叠战报') + '（快捷键 L）';
    btn.setAttribute('aria-expanded', logCollapsed ? 'false' : 'true');
    const u = $('logUnread');
    const show = logCollapsed && logUnread > 0;
    u.hidden = !show;
    if (show) u.textContent = logUnread > 99 ? '99+' : String(logUnread);
  }
  function setLogCollapsed(v) {
    const was = logCollapsed;
    logCollapsed = !!v;
    if (!logCollapsed) logUnread = 0;
    try { localStorage.setItem('ardennes44_logCollapsed', logCollapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    renderLogToggle();
    // 展开时跳到最新一条；折叠期间不动滚动位置（用户回来直接看到最新战报）
    if (was && !logCollapsed) { const l = $('logList'); l.scrollTop = l.scrollHeight; }
  }
  function toggleLogPanel() { setLogCollapsed(!logCollapsed); }

  /* ---------------- 面板刷新 ---------------- */
  function refreshTop() {
    const st = game.state;
    $('tRound').textContent = st.round;
    // 取消回合限制（歼灭模式）：回合总数显示为 ∞，并给顶栏回合区加 title 说明
    const unlimited = !!game.noTurnLimit;
    $('tRounds').textContent = unlimited ? '∞' : game.scenario.rounds;
    const roundsK = $('tRounds').closest('.stat') || $('tRounds');
    roundsK.title = unlimited ? '取消回合限制 · 歼灭对方全部建制（含援军）' : '';
    $('tDate').textContent = game._dateStr();
    $('tWeather').textContent = game._weatherName();
    const tag = $('phaseTag');
    tag.textContent = st.phase === 'DE' ? '德军阶段' : '美军阶段';
    tag.className = st.phase;
    $('tFuel').textContent = st.fuelDE;
    $('fuelFill').style.width = Math.min(100, st.fuelDE / game.scenario.fuelDE * 100) + '%';
    $('tAir').textContent = st.phase === 'DE' ? (st.airDE || 0) : st.airUS;
    $('airStat').title = st.phase === 'DE'
      ? '德军空袭令牌（12/24 起晴天才发放；1945-01-01 底板行动×3）'
      : '美军空袭令牌（晴天才发放）';
    $('tExits').textContent = st.exits;
    // 支援令牌
    const tk = st.tokens && st.tokens[st.phase];
    if (tk) {
      const nm = { at: st.phase === 'US' ? '巴' : '铁', med: '救', fire: '急', repl: '补', fort: '工', aa: '空' };
      $('tTokens').textContent = Object.keys(DATA.BUFFS).map(k => `${nm[k]}${tk[k]}`).join(' ');
    }
    $('btnEnd').disabled = st.over || aiBusy;
    $('fuelStat').style.display = 'flex';
  }

  function refreshUnitPanel() {
    const p = $('unitPanel');
    if (!selected || !selected.alive) {
      p.style.display = 'none';
      document.body.classList.remove('unit-open');   // 窄屏: 面板收起后战报重新露出
      return;
    }
    document.body.classList.add('unit-open');        // 窄屏: 面板与战报都贴底时会打架, 让战报让位
    const u = selected;
    p.style.display = 'block';
    $('upName').textContent = u.name;
    const trait = (DATA.TYPE_TRAITS || {})[u.type];
    $('upType').textContent = (u.side === 'DE' ? '德军 · ' : '美军 · ') + DATA.TYPES[u.type].name +
      (u.arrive > 0 ? ' · 增援' : '') + (trait ? ' · 【' + trait.name + '】' : '');   // 24h 兵种特性
    $('upAtk').textContent = u.type === 'ART' || u.type === 'RKT' ? u.sup : u.atk;
    $('upDef').textContent = u.def;
    $('upMov').textContent = game.movEff(u);
    const frac = Math.max(0, u.org / u.maxOrg);
    const org = $('upOrg');
    org.textContent = `组织度 ${Math.round(u.org)}/${u.maxOrg}`;
    org.style.color = frac > 0.6 ? '#93d97f' : frac > 0.3 ? '#ecc84e' : '#f0796a';
    let supTxt = '✔ 补给正常';
    if (!u.supplied) {
      const n = u.unsupRounds || 0;
      if (n <= DATA.UNSUP_GRACE) supTxt = `✖ 补给中断（宽限中 ${n}/${DATA.UNSUP_GRACE} 回合，不受影响）`;
      else if (DATA.TYPES[u.type].sym === 'inf') supTxt = `✖ 补给中断（第${n}回合，攻防小幅降低·组织度损耗）`;
      else supTxt = `✖ 补给中断（第${n}回合，攻防减半·组织度损耗）`;
    }
    $('upSupply').textContent = supTxt;
    $('upSupply').style.color = u.supplied ? '#7fc46a' : '#e8907a';
    // 配属增益
    const attach = [];
    if (u.attach) {
      if (u.attach.at) attach.push(u.side === 'US' ? '巴祖卡小组' : '铁拳小组');
      if (u.attach.fort) attach.push('野战工事');
      if (u.attach.repl) attach.push('补充兵员');
      if (u.attach.aa) attach.push('防空火力');
    }
    if (u.fireSupport > 0) attach.push('炮火急袭(待用)');
    $('upAttach').textContent = attach.length ? '配属: ' + attach.join(' · ') : '';
    // 被动状态(2026-10): 由棋盘态势自动判定, 无需令牌
    const ps = Combat.passiveState(game, u);
    const psColor = ps.key === 'lastStand' ? '#e8b06a' : ps.key === 'broken' ? '#f0796a' : ps.key === 'coord' ? '#8ec7f0' : '';
    $('upPassive').textContent = ps.key
      ? `被动: ${ps.name}（攻×${ps.atk} 防×${ps.def}）` : '';
    $('upPassive').style.color = psColor;
    let extra = '';
    if (!u.moved && !aiBusy) extra += '可行动';
    else if (u.moved) extra += '已移动';
    else extra += '已行动';
    if (u.attacked) extra += ' · 已攻击';   // 原版33轮移植: 攻击与移动独立显示
    if (u.type === 'ART' || u.type === 'RKT') extra += ' · 炮兵' + (u.fired ? '已射击' : '未射击') + '(射程' + (u.range - (game.state.weather === 'fog' ? 1 : 0)) + ')';
    if (u.side === 'DE' && (u.type === 'ARM' || u.type === 'MOT')) extra += ' · 消耗燃料';
    $('upExtra').textContent = extra;
    // 按钮区
    const btns = $('upBtns');
    btns.innerHTML = '';
    const my = game.state.phase === u.side;
    if (my && !u.moved && !aiBusy && !game.state.over) {
      if ((u.type === 'ART' || u.type === 'RKT') && !u.fired) {
        const b = document.createElement('button');
        b.textContent = '炮击模式';
        b.className = mode === 'arty' ? 'active' : '';
        b.onclick = () => { SFX.play('click'); setMode(mode === 'arty' ? 'selected' : 'arty'); };
        btns.appendChild(b);
      }
      {   // 原版38轮移植: 恒真判断清理, 所有兵种都有待命(行为不变)
        const b = document.createElement('button');
        b.textContent = '待命';
        b.onclick = () => { SFX.play('click'); u.moved = true; clearSel(); refreshTop(); };
        btns.appendChild(b);
      }
    }
    const airN = u.side === 'DE' ? (game.state.airDE || 0) : game.state.airUS;
    if (airN > 0 && my && !aiBusy && (u.side === 'DE' || game.state.weather === 'clear')) {
      const b = document.createElement('button');
      b.textContent = '呼叫空袭';
      b.className = mode === 'air' ? 'active' : '';
      b.onclick = () => { SFX.play('click'); setMode(mode === 'air' ? 'selected' : 'air'); };
      btns.appendChild(b);
    }
    // 支援资产授予按钮
    if (my && !aiBusy && !game.state.over) {
      const tk = game.state.tokens[u.side];
      for (const id of Object.keys(DATA.BUFFS)) {
        const chk = game.canGrant(id, u);
        const b = document.createElement('button');
        b.style.fontSize = '11px';
        const engr = id === 'fort' && u.type === 'ENGR';
        b.textContent = engr && chk.ok
          ? '筑垒(自带)' : `${game._buffName(id, u.side)} 余${tk[id]}`;
        b.disabled = !chk.ok;
        b.title = (engr ? '工兵请改用下方「就地筑垒」（格上工事, 每' + (DATA.TRAIT_KNOBS || {}).ENGR_ENTRENCH_CD + '回合一次）\n' : '') +
          (chk.ok ? DATA.BUFFS[id].desc : chk.why);
        b.onclick = () => { SFX.play('click'); game.grantBuff(id, u); refreshUnitPanel(); };
        btns.appendChild(b);
      }
    }
    // 就地筑垒(2026-10-24h 工兵特性): 独立按钮, 每5回合冷却, 工事修在格上
    if (game && !game.state.over && selected && selected.type === 'ENGR' && selected.side === game.state.phase && !aiBusy) {
      const u2 = selected;
      const chk = game.canEntrench(u2);
      const b = document.createElement('button');
      b.style.fontSize = '11px';
      b.textContent = '就地筑垒';
      b.disabled = !chk.ok;
      b.title = (chk.ok ? '在本格修筑工事：防御×' + (DATA.TRAIT_KNOBS || {}).HEX_FORT_MULT + '，工事留在格上不随单位移动；工兵进攻工事内敌人时无视其加成' : chk.why);
      b.onclick = () => { SFX.play('click'); game.doEntrench(u2); refreshUnitPanel(); };
      btns.appendChild(b);
    }
  }

  /* ---------------- 部队档案浏览面板(2026-10-25) ---------------- */
  function showDossierArchive() {
    const box = document.getElementById('modalBox');
    if (!box) return;
    /* 未开局时 DATA 尚未切到 DATA_BIG，档案是资料库性质，主菜单也应可浏览 */
    const all = (DATA.DOSSIERS && DATA.DOSSIERS.length) ? DATA.DOSSIERS
      : ((globalThis.DATA_BIG && globalThis.DATA_BIG.DOSSIERS) || []);
    if (!all.length) {
      box.innerHTML = '<div class=\'box\'><p>暂无部队档案</p></div>';
      document.getElementById('modal').style.display = 'flex'; return;
    }
    const groups = {};
    for (const d of all) { const k = d.side; (groups[k] = groups[k] || []).push(d); }
    const sideName = { DE: '德军 Wehrmacht', US: '美军 US Army', UK: '英军 British Army' };
    let list = '';
    for (const side of ['DE', 'US', 'UK']) {
      if (!groups[side]) continue;
      list += '<div class=\'da-side\'>' + (sideName[side] || side) + '（' + groups[side].length + ' 支建制）</div>';
      list += '<table class=\'da-table\'><tr><th>建制番号</th><th>类型</th><th>开局</th></tr>';
      for (const d of groups[side]) {
        list += '<tr class=\'da-row\' data-key=\'' + d.key + '\'>' +
          '<td>' + d.name.replace(/（.*?）/g, '') + '</td>' +
          '<td>' + d.type + '</td><td>' + (d.open ? '在场' : '增援') + '</td></tr>';
      }
      list += '</table>';
    }
    box.className = 'box wide';
    box.innerHTML = '<h2>部队档案（' + all.length + ' 支建制）</h2>' + list +
      '<div style=\'text-align:center;margin-top:12px\'><button id=\"daClose\" class=\"btn\">知道了</button></div>';
    document.getElementById('modal').style.display = 'flex';
    box.querySelectorAll('.da-row').forEach(row => {
      row.onclick = () => {
        const d = all.find(x => x.key === row.dataset.key);
        if (!d) return;
        document.getElementById('modal').style.display = 'none';
        showDossierCard(d);
      };
    });
    const dc = document.getElementById('daClose');
    if (dc) dc.onclick = () => { document.getElementById('modal').style.display = 'none'; };
  }

  /* 单条档案卡（复用增援档案卡渲染，不走队列） */
  function showDossierCard(d) {
    const box = document.getElementById('modalBox');
    if (!box) return;
    box.className = 'box dossier-box';
    const sideName = d.side === 'DE' ? '德军' : d.side === 'UK' ? '英军' : '美军';
    box.innerHTML =
      '<div class=\'dossier\'><div class=\'ds-photo\'><img class=\'ds-img\' src=\'' + photoUrl(d.photo) + '\' referrerpolicy=\'no-referrer\'>' +
      '<div class=\'ds-fallback\' hidden><div class=\'ds-fb-name\'>' + d.name + '</div>' +
      '<div class=\'ds-fb-type\'>' + (d.type || '') + '</div>' +
      '<div class=\'ds-fb-note\'>档案插图 · 非真实照片</div></div></div>' +
      '<div class=\'ds-body\'><div class=\'ds-tag\'>' + sideName + ' · ' + (d.open ? '开局在场' : '增援') + ' · ' + (d.histDate || '') + '</div>' +
      '<h2>' + d.name + '</h2>' +
      '<div class=\'ds-strength\'><b>主要编成：</b>' + (d.strength || '') + '</div>' +
      '<div class=\'ds-intro\'>' + (d.intro || '') + '</div></div></div>' +
      '<div style=\'text-align:center;margin-top:12px\'><button id=\'dsClose\'>知道了</button></div>';
    document.getElementById('modal').style.display = 'flex';
    bindPhoto(box.querySelector('.ds-img'), box.querySelector('.ds-fallback'), d.photo || '');
    box.querySelector('#dsClose').onclick = () => { document.getElementById('modal').style.display = 'none'; };
  }

  function refreshHint() {
    const h = $('hintMode');
    if (aiBusy) { h.textContent = '【AI 行动中…】'; return; }
    if (mode === 'arty') h.innerHTML = '【炮击模式】点击射程内的敌军实施远程轰击';
    else if (mode === 'air') h.innerHTML = '【空袭模式】点击 10 格内的敌军单位实施空袭';
    else if (mode === 'advance') h.innerHTML = '【追击】点击高亮单位推进至空出的格，或按"结束推进"';
    else if (mode === 'selected') h.innerHTML = '点击蓝色格移动 · 点击红色格攻击 · 再次点击算子取消';
    else h.innerHTML = '';
  }

  /* ---------------- 选择与模式 ---------------- */
  function clearSel() {
    selected = null;
    reach = null;
    townCov = null;
    mode = 'idle';
    renderer.clearSelection();
    refreshUnitPanel(); refreshHint();
  }

  /* ---------------- 城市补给覆盖（点击城市查看） ----------------
   * 覆盖范围**不是固定半径**：由 game.supplyCoverageFrom() 按成本扩散得出，
   * 沿公路延伸远、穿越林/山/沼泽与渡河收缩；预算按城镇等级
   * （集团军级 52 / 军级 34 / 师级 22）。见 renderer.showSupplyCoverage()。
   */
  function showTownSupply(h) {
    const cov = game.townCoverage(h.c, h.r);
    if (!cov) return false;
    townCov = cov;
    selected = null;
    reach = null;
    const edges = renderer.showSupplyCoverage(cov);
    const tt = { 1: '师级', 2: '军级', 3: '集团军级' }[cov.source.tier] || '师级';
    const tip = $('tooltip');
    tip.innerHTML =
      `<b style="color:${cov.side === 'DE' ? '#b8c4b0' : '#a8c8e8'}">${cov.source.name}</b>` +
      ` · ${cov.side === 'DE' ? '德占' : '美占'} · ${tt}补给点` +
      `<br>补给预算 <b>${cov.range}</b>（成本制，非格数）` +
      `<br>覆盖 <b>${cov.cost.size}</b> 格 · 轮廓 <b>${edges}</b> 段` +
      (cov.usable ? '' : '<br><span style="color:#e8907a">敌方毗邻，补给源中断</span>') +
      '<br><span style="opacity:.7">轮廓随地形/公路收放：沿公路伸出、穿林过山收缩、渡河断开</span>' +
      '<br><span style="opacity:.7">再点任意处关闭</span>';
    tip.style.display = 'block';
    tip.style.left = Math.min(window.innerWidth - 300, lastMouse.x + 16) + 'px';
    tip.style.top = (lastMouse.y + 16) + 'px';
    refreshUnitPanel();
    return true;
  }

  function setMode(m) {
    mode = m;
    renderer._clearOverlay();
    if (mode === 'arty' && selected) {
      let rng = selected.range - (game.state.weather === 'fog' ? 1 : 0);
      renderer.showArtilleryRange([selected], rng);
    } else if (mode === 'selected' && selected) {
      reach = game.getReach(selected);
      renderer.showMoveRange(reach);
      highlightAttackTargets();
    }
    refreshUnitPanel(); refreshHint();
  }

  function highlightAttackTargets() {
    if (!selected || selected.side !== game.state.phase) return;
    // 可攻击目标 = 与任一可用攻击方相邻的敌军
    for (const e of game.units) {
      if (!e.alive || e.side === game.state.phase) continue;
      const atts = game.attackersFor(e);   // 原版38轮移植: 旧 filter 恒真等于不过滤
      if (atts.length) renderer._hexMark(e.c, e.r, 0xff5544, 0.35, 0.15);
    }
  }

  function selectUnit(u) {
    selected = u;
    mode = 'selected';
    SFX.play('click');                        // 选中算子：短促点按声
    renderer.selectHexRing(u.c, u.r);
    renderer._clearOverlay();
    reach = game.getReach(u);
    renderer.showMoveRange(reach);
    highlightAttackTargets();
    refreshUnitPanel(); refreshHint();
  }

  /* ---------------- 点击处理 ---------------- */
  function onHexClick(c, r) {
    if (aiBusy || !game || game.state.over) return;
    const u = game.unitAt(c, r);
    // 已有城市补给覆盖展示时：先关掉，避免与后续选择叠加
    if (townCov) {
      townCov = null;
      renderer.clearSelection();
      if ($('tooltip')) $('tooltip').style.display = 'none';
    }
    if (mode === 'advance') { handleAdvanceClick(c, r); return; }
    if (mode === 'arty') { handleArtyClick(c, r); return; }
    if (mode === 'air') { handleAirClick(c, r); return; }
    if (mode === 'selected' && selected) {
      // 攻击目标?
      if (u && u.side !== selected.side) {
        const atts = game.attackersFor(u);
        if (atts.length) { openAttackPanel(u, atts); return; }
      }
      // 移动?
      if (!u && reach && reach.dist.has(Hex.key(c, r))) {
        const path = game.pathFromReach(reach, Hex.key(c, r));
        if (path && path.length) {
          const unit = selected;
          game.doMove(unit, path);
          // 选中状态保留(可继续攻击), 刷新可达域
          reach = unit.moved ? null : game.getReach(unit);
          renderer.clearSelection();
          renderer.selectHexRing(unit.c, unit.r);
          if (reach) renderer.showMoveRange(reach);
          highlightAttackTargets();
          refreshUnitPanel();
        }
        return;
      }
      // 换选/取消
      if (u && u.side === game.state.phase && !u.moved) { selectUnit(u); return; }
      if (u && u.side === game.state.phase) { clearSel(); return; }
      // 空手点城市 → 查看该城市补给覆盖
      const hx0 = game.hexAt(c, r);
      if (!u && hx0 && hx0.town && hx0.town.supply) { showTownSupply(hx0); return; }
      clearSel();
      return;
    }
    // idle
    if (u && u.side === game.state.phase && !u.moved && !aiBusy) selectUnit(u);
    else if (u) { selected = u; mode = 'idle'; renderer.selectHexRing(u.c, u.r); refreshUnitPanel(); }
    else {
      // 无单位：城市 → 展示补给覆盖；否则清除
      const hx = game.hexAt(c, r);
      if (hx && hx.town && hx.town.supply) showTownSupply(hx);
      else clearSel();
    }
  }

  /* ---------------- 攻击面板 ---------------- */
  function openAttackPanel(defUnit, attUnits) {
    const arty = game.artyInRange(defUnit);
    renderOddsPopup(defUnit, attUnits, arty, (ok, chosenArty) => {
      if (!ok) { renderer._clearOverlay(); highlightAttackTargets(); return; }
      const res = game.doAttack(attUnits, defUnit, chosenArty);
      if (res && res.advanceOffer) enterAdvanceMode();
      if (selected && (!selected.alive || selected.moved)) {
        // 攻击后保持选中(若还活着)以便查看
        reach = null;
        renderer.clearSelection();
        renderer.selectHexRing(selected.c, selected.r);
        refreshUnitPanel();
      }
    });
  }

  function renderOddsPopup(defUnit, attUnits, artyUnits, cb) {
    const pv = game.previewAttack(attUnits, defUnit, artyUnits);
    const pop = $('oddsPopup');
    pop.style.display = 'block';
    const terr = game.hexAt(defUnit.c, defUnit.r);
    const shiftsTxt = pv.shifts.length ? pv.shifts.map(s => s.name).join('、') : '无';
    const softWarn = pv => pv.softArmor
      ? `注意 攻击方无反装甲火力 · 守方为装甲目标：受损减免至 ×${DATA.SOFT_VS_ARMOR_DMG}（下限 ${DATA.SOFT_VS_ARMOR_MIN}），可逐退难歼灭`
      : '';
    const passiveTxt = pv => {
      const ps = pv.passives || [];
      return ps.length ? ps.map(p => `${p.role}方 ${p.unit} ${p.name}×${p.mult}`).join(' · ') : '无';
    };
    pop.innerHTML = `
      <div>进攻 ${defUnit.side === 'DE' ? '德军' : '美军'}「${defUnit.name}」${terr.town ? '@' + terr.town.name : ''}</div>
      <div class="odds-big">${pv.key ? pv.key.replace(':', ' : ') : '劣势过大'}</div>
      <div class="detail">攻 ${pv.atk} vs 守 ${pv.def}（地形×${(pv.def / Math.max(0.1, defUnit.def * (defUnit.org / defUnit.maxOrg))).toFixed(1)}）· 修正: ${shiftsTxt} · 2d6 查表</div>
      <div class="detail" id="artSel"></div>
      <div class="detail" id="passiveLine" style="color:#8ec7f0">被动: ${passiveTxt(pv)}</div>
      <div class="detail" id="softWarn" style="color:#e8907a">${softWarn(pv)}</div>
      <div class="dice" id="oddsDice"></div>
      <div class="btns">
        ${artyUnits.length ? '' : ''}
        <button class="primary" id="oddsGo">${pv.key ? '开 火' : '返 回'}</button>
        <button id="oddsNo">取 消</button>
      </div>`;
    // 炮兵勾选
    const artSel = pop.querySelector('#artSel');
    const checks = [];
    if (artyUnits.length) {
      artSel.innerHTML = '炮兵支援: ' + artyUnits.map((a, i) =>
        `<label style="margin:0 8px;cursor:pointer"><input type="checkbox" checked data-i="${i}"> ${a.abbr}(+${a.sup})</label>`).join('');
      artSel.querySelectorAll('input').forEach(inp => {
        inp.onchange = () => {
          const chosen = artyUnits.filter((a, i) => artSel.querySelectorAll('input')[i].checked);
          const pv2 = game.previewAttack(attUnits, defUnit, chosen);
          pop.querySelector('.odds-big').textContent = pv2.key ? pv2.key.replace(':', ' : ') : '劣势过大';
          pop.querySelectorAll('.detail')[0].textContent = `攻 ${pv2.atk} vs 守 ${pv2.def} · 修正: ${pv2.shifts.length ? pv2.shifts.map(s => s.name).join('、') : '无'} · 2d6 查表`;
          pop.querySelector('#passiveLine').textContent = '被动: ' + passiveTxt(pv2);
          pop.querySelector('#softWarn').textContent = softWarn(pv2);
        };
      });
    }
    pop.querySelector('#oddsNo').onclick = () => { pop.style.display = 'none'; cb(false); };
    pop.querySelector('#oddsGo').onclick = () => {
      const chosen = artyUnits.filter((a, i) => !artSel.querySelectorAll('input').length || artSel.querySelectorAll('input')[i].checked);
      pop.style.display = 'none';
      cb(pv.key ? true : false, chosen);
    };
  }

  /* ---------------- 炮击 / 空袭 ---------------- */
  function handleArtyClick(c, r) {
    if (!selected || selected.type !== 'ART' && selected.type !== 'RKT') { setMode('idle'); return; }
    const t = game.unitAt(c, r);
    if (!t || t.side === selected.side) return;
    let rng = selected.range - (game.state.weather === 'fog' ? 1 : 0);
    if (Hex.distance(selected.c, selected.r, c, r) > rng) { SFX.play('warning'); showBanner('超出射程', '', 900); return; }
    game.artyFire(selected, t);
    setMode('selected');
  }

  function handleAirClick(c, r) {
    const t = game.unitAt(c, r);
    const side = game.state.phase;
    if (!t || t.side === side) return;
    game.airStrike(t, side);
    setMode('idle');
    refreshTop();
  }

  /* ---------------- 推进 ---------------- */
  function enterAdvanceMode() {
    const pa = game.state.pendingAdvance;
    if (!pa) return;
    mode = 'advance';
    renderer._clearOverlay();
    renderer._hexMark(pa.hex.c, pa.hex.r, 0xffe084, 0.5, 0.16);
    for (const u of pa.units) if (u.alive) renderer._hexMark(u.c, u.r, 0xffe084, 0.3, 0.16);
    refreshHint();
  }
  function handleAdvanceClick(c, r) {
    const pa = game.state.pendingAdvance;
    if (!pa) { exitAdvance(); return; }
    const u = game.unitAt(c, r);
    if (u && pa.units.includes(u)) {
      game.doAdvance(u);
      exitAdvance();
      refreshUnitPanel();
    } else exitAdvance();
  }
  function exitAdvance() {
    if (game) game._clearPendingAdvance();
    mode = 'idle';
    renderer._clearOverlay();
    refreshHint();
  }

  /* ---------------- 悬浮提示 ---------------- */
  function onHexHover(c, r) {
    const tip = $('tooltip');
    if (c === null || aiBusy) { tip.style.display = 'none'; return; }
    const h = game.hexAt(c, r);
    if (!h) { tip.style.display = 'none'; return; }
    const t = DATA.TERRAIN[h.terrain];
    let html = `<b>${t.name}</b> · 移动${t.mv} · 防御×${t.dm}`;
    if (h.road) html += ' · 公路';
    if (h.river) html += h.bridge ? ' · <span style="color:#d8b74a">桥梁</span>' : ' · 河流';
    if (h.town) {
      const tt = { 1: '师级', 2: '军级', 3: '集团军级' }[h.town.tier] || '师级';
      const tw = game.map.towns.find(x => x.c === h.c && x.r === h.r);
      html += `<br><b style="color:${h.town.ctrl === 'DE' ? '#b8c4b0' : '#a8c8e8'}">${h.town.ctrl === 'DE' ? '德占' : '美占'} · ${h.town.name}</b>`;
      if (h.town.supply) html += ` · ${tt}补给点（预算 ${tw ? tw.range : DATA.SUPPLY_R_TOWN}）<br><span style="opacity:.7">点击查看补给覆盖范围</span>`;
    }
    if (h.exit) html += '<br><span style="color:#d8b74a">马斯河突破线</span>';
    const u = game.unitAt(c, r);
    if (u) {
      html += `<br>─────<br>${u.side === 'DE' ? '德军' : '美军'} ${u.name}<br>攻${u.type === 'ART' || u.type === 'RKT' ? u.sup + '(支援)' : u.atk} 防${u.def} 移${u.mov} · 组织度${u.org}/${u.maxOrg}${u.supplied ? '' : ' · <span style="color:#e8907a">断补</span>'}`;
    }
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = Math.min(window.innerWidth - 280, lastMouse.x + 16) + 'px';
    tip.style.top = (lastMouse.y + 16) + 'px';
  }
  let lastMouse = { x: 0, y: 0 };
  window.addEventListener('mousemove', e => { lastMouse = { x: e.clientX, y: e.clientY }; });

  /* ---------------- 战斗特效 ---------------- */
  function bindGameEvents() {
    const g = game;
    g.on('log', e => {
      const list = $('logList');
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
      list.appendChild(logHtml(e));
      while (list.children.length > 300) list.removeChild(list.firstChild);
      if (logCollapsed) { logUnread++; renderLogToggle(); }   // 折叠中：累计未读角标
      else if (atBottom) list.scrollTop = list.scrollHeight;  // 展开中：仅在贴底时跟随，不打断用户上滚
    });
    g.on('move', d => {
      achvTick();   // 24v: 成就事件
      SFX.play('move', { kind: sfxMoveKind(d.unit) });
      enqueue(() => new Promise(res => {
        renderer.animateMove(d.unit, d.fromHex, d.path, () => {
          renderer.refreshUnit(d.unit);
          res();
        });
        setTimeout(res, 1800); // 兜底
      }));
      refreshTop();
    });
    g.on('combat', d => {
      achvTick();   // 24v: 成就事件
      sfxCombat(d);
      enqueue(() => new Promise(res => {
        const du = d.defUnit;
        const hx = renderer.hexAt(du.c, du.r) ? du.c : du.c;
        const w = renderer.hexWorld(du.c, du.r);
        const y = renderer.hexTopY(renderer.hexAt(du.c, du.r)) + 0.5;
        // 炮兵曳光
        if (d.artyUnits) for (const a of d.artyUnits) {
          const aw = renderer.hexWorld(a.c, a.r);
          renderer.tracer(new THREE.Vector3(aw.x, renderer.hexTopY(renderer.hexAt(a.c, a.r)) + 0.6, aw.z),
            new THREE.Vector3(w.x, y, w.z));
        }
        if (d.air) renderer.tracer(new THREE.Vector3(w.x, y + 30, w.z), new THREE.Vector3(w.x, y, w.z));
        if (d.res && d.res.result !== 'NO') renderer.explosion(w.x, y, w.z, d.res.result === 'DE' || d.res.result === 'AE');
        if (d.res && d.attUnits) for (const a of d.attUnits) renderer.shake(a.uid);
        renderer.shake(du.uid);
        // 掷骰 + 战损拆分展示
        if (d.res) showDice(d.res);
        setTimeout(res, aiSpeedCfg().skipMove ? 200 : 700);   // 极速档缩短交火停留(原版39轮);
      }));
      if (d.res) for (const u of d.res.deadUnits) renderer.refreshUnit(u);
      for (const u of (d.attUnits || [])) renderer.refreshUnit(u);
      renderer.refreshUnit(d.defUnit);
    });
    g.on('reinforce', u => {
      renderer.syncUnits(game);
      SFX.play('reinforce');     // 车队引擎 + 喇叭（档案卡另有快门声）
      // 同一阶段可能有多个单位先后入场(逐行 emit)——缓冲 350ms 后统一处理，
      // 命中"部队档案"的建制弹档案卡，其余仍走横幅(2026-10 第十一轮)
      reinBuf.push(u);
      if (reinTimer) clearTimeout(reinTimer);
      reinTimer = setTimeout(flushReinforce, 350);
    });
    g.on('log', e => sfxLog(e));
    g.on('elim', () => { SFX.play('elim'); achvTick(); });
    g.on('buff', () => SFX.play('buff'));
    g.on('weather', () => { renderer.setWeather(game.state.weather); SFX.play('weather'); });
    g.on('phase', () => {
      renderer.syncUnits(game);
      refreshTop();
      SFX.play('phase', { side: game.state.phase });
      if (!aiBusy) showBanner(
        game.state.phase === 'DE' ? '德军阶段' : '美军阶段',
        `第${game.state.round}回合 · ${game._dateStr()}`);
      setTimeout(() => { maybeAI(); }, 600);
    });
    g.on('over', () => { renderer.syncUnits(game); SFX.play('over', { winner: game.state.winner }); achvFinish(); showOverModal(); });
    g.on('state', () => refreshTop());
  }

  // 结算弹窗：掷骰 + 结果 + 双方战损拆分（组织度，攻/守分开计算）
  function showDice(res) {
    if (!res) return;
    const pop = $('oddsPopup');
    pop.style.display = 'block';
    const { d1, d2, result } = res;
    const rt = { AE: '攻方被击溃', AR: '攻方败退', EX: '互有损伤', DR: '守方败退', DE: '守方被击破', NO: '' }[result] || result;
    const color = { AE: '#e8907a', AR: '#e8907a', EX: '#d8b74a', DR: '#7fc46a', DE: '#7fc46a' }[result] || '#fff';
    // 战损：resolve() 已按攻/守分别累计实扣组织度，并给出各自被歼灭的建制数
    const atk = Math.round(res.atkDmg || 0), def = Math.round(res.defDmg || 0);
    const atkDead = res.atkDead || 0, defDead = res.defDead || 0;
    const cell = (label, v, dead, cls) =>
      `<div class="loss ${cls}"><span class="loss-k">${label}</span>` +
      `<span class="loss-v">组织度 −${v}</span>` +
      `<span class="loss-d">${dead ? '歼灭 ' + dead + ' 个建制' : '无建制被歼'}</span></div>`;
    const shown = result !== 'NO';
    const loss = shown
      ? `<div class="loss-wrap">${cell('攻方损失', atk, atkDead, 'atk')}${cell('守方损失', def, defDead, 'def')}</div>`
      : '';
    pop.innerHTML = `
      <div class="dice">2D6 · ${d1} + ${d2} = ${d1 + d2}</div>
      <div class="odds-big" style="color:${color}">${result} · ${rt}</div>
      ${loss}`;
    // 音效：木骰滚动 → 略延迟给出结果音（与骰面显现同步，听得出来"先掷后判"）
    SFX.play('dice');
    if (result !== 'NO') setTimeout(() => SFX.play('result', { result }), 420);
    clearTimeout(showDice._t);
    showDice._t = setTimeout(() => { pop.style.display = 'none'; }, 2400);
  }

  /* ---------------- AI 调度 ---------------- */
  /* ---------------- 史实照片加载优化(2026-10-24g) ----------------
   * 痛点: 档案/简报/胜利画面的照片是维基共享原图直链(0.2~2MB), 慢网络下数秒空白。
   * 三层优化(不动数据表, 纯表现层):
   *   ① photoUrl(): 自动换用维基缩略图 URL(宽 960px, 体积约为原图 3~5%);
   *   ② warmPhotos(): 开局界面出现后后台预热全部照片(逐张 300ms 间隔), 用到时已在缓存;
   *   ③ bindPhoto(): 加载完成前先显示程序化"档案插图"占位(立即有内容), 照片就绪后淡入;
   *      缩略图失败自动回退原图一次, 再失败维持占位插图(原有降级不变)。
   */
  /* 24m: 历史照片显示修复——默认开启, 多源链保证可见:
   *   ① vendor/photos 内嵌表(若 build 时存在 tools/fetch_photos.js 下载的照片→dataURI, 断网秒开);
   *   ② 维基缩略图(原图 3~5% 体积); ③ 原图; ④ wsrv.nl 图像代理(绕直连封锁);
   *   全部失败才回退程序化档案插图。加载期间显示"照片加载中…", 不再先闪占位图。
   *   localStorage['ardennes44_photos']='off' 可整体关闭。 */
  const PHOTOS_ON = (() => { try { return localStorage.getItem('ardennes44_photos') !== 'off'; } catch (e) { return true; } })();
  const PHOTO_EMBED = (typeof window !== 'undefined' && window.__PHOTO_EMBED) || {};

  function proxyUrl(u) {
    // wsrv.nl 公共图像代理: 目标域名被封锁时的最后一条线路(按 960px 宽转存)
    return 'https://wsrv.nl/?url=' + encodeURIComponent(u.replace(/^https:\/\//, '')) + '&w=800';
  }

  function photoUrl(u) {
    if (!u || u.includes('/thumb/')) return u;
    const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?]+)$/i.exec(u);
    if (!m) return u;
    if (!/\.(jpe?g|png|gif)$/i.test(m[3])) return u;    // tif/svg 缩略图规则不同, 不碰
    return 'https://upload.wikimedia.org/wikipedia/commons/thumb/' + m[1] + '/' + m[2] + '/' + m[3] + '/960px-' + m[3];
  }
  function bindPhoto(img, fb, originalUrl) {
    if (!img) return;
    if (!PHOTOS_ON) {   // 显式关闭: 零网络请求, 直接程序化档案插图
      img.removeAttribute('src');
      img.style.display = 'none';
      if (fb) fb.hidden = false;
      return;
    }
    /* 24m 多源链: 内嵌 → 缩略图 → 原图 → wsrv.nl 代理; 逐源降级, 全败才回退插图 */
    const chain = PHOTO_EMBED[originalUrl] ? [PHOTO_EMBED[originalUrl]]
      : [photoUrl(originalUrl), originalUrl, proxyUrl(originalUrl)].filter((x, i, a) => a.indexOf(x) === i);
    let step = 0;
    const loader = document.createElement('div');
    loader.className = 'ds-loading';
    loader.textContent = PHOTO_EMBED[originalUrl] ? '' : '照片加载中…';
    if (loader.textContent) { img.parentNode && img.parentNode.appendChild(loader); }
    const finishFail = () => { loader.remove(); img.style.display = 'none'; if (fb) fb.hidden = false; };
    img.onload = () => {
      loader.remove();
      if (fb) fb.hidden = true;
      img.style.transition = 'opacity .35s';
      requestAnimationFrame(() => { img.style.opacity = '1'; });
    };
    img.onerror = () => {
      step++;
      if (step < chain.length) { img.src = chain[step]; return; }
      finishFail();
    };
    img.decoding = 'async';
    img.style.opacity = '0';
    img.src = chain[0];
    if (img.complete && img.naturalWidth > 0) img.onload();
    return;
  }
  function warmPhotos() {
    if (!PHOTOS_ON) return;   // 24l: 照片关闭时不预热
    /* 断网(file:// 且 navigator.onLine=false)跳过: 避免无谓的失败请求刷控制台 */
    try { if (location.protocol === "file:" && navigator.onLine === false) return; } catch (e) {}
    try {
      const urls = new Set();
      for (const d of (DATA.REINFORCE_DOSSIERS || [])) if (d && d.photo) urls.add(d.photo);
      for (const k of ['DE', 'US']) { const bb = DATA.BRIEFINGS && DATA.BRIEFINGS[k]; if (bb && bb.photo) urls.add(bb.photo); }
      for (const k in (DATA.VICTORY || {})) { const v = DATA.VICTORY[k]; if (v && v.photo) urls.add(v.photo); }
      let i = 0;
      for (const u of urls) {
        setTimeout(() => {
          const im = new Image();
          im.referrerPolicy = 'no-referrer';
          im.onload = () => {}; im.onerror = () => {};
          im.src = photoUrl(u);
        }, 400 + i * 300);
        i++;
      }
    } catch (e) { /* Node/隐私模式静默 */ }
  }

  /* ---------------- AI 行动速度三档(原版39轮移植) ----------------
   * 只改表现层节奏, 不改任何规则与 AI 决策:
   *   标准 = 旧节奏(动画 1×, 间隔 110/150/220ms)
   *   快速 = 默认(动画 0.6×, 间隔 80/110/150ms)
   *   极速 = 跳过移动动画(位置直接到位)+间隔 20/30/40ms, 适合观摩整局
   * 选择写入 localStorage(ardennes44_aispeed); AI 阶段结束或交还人类时恢复 1×。
   * 大阿登适配: 580 开局算子动画积压比原版重数倍, 三档价值更大。
   */
  const AI_SPEEDS = [
    { key: 'std', label: 'AI 标准', anim: 1.0, pace: [110, 150, 220], skipMove: false },
    { key: 'fast', label: 'AI 快速', anim: 0.6, pace: [80, 110, 150], skipMove: false },
    { key: 'turbo', label: 'AI 极速', anim: 0.35, pace: [20, 30, 40], skipMove: true },
  ];
  let aiSpeed = 1;
  try {
    const v = localStorage.getItem('ardennes44_aispeed');
    if (v) { const i = AI_SPEEDS.findIndex(s2 => s2.key === v); if (i >= 0) aiSpeed = i; }
  } catch (e) { /* 隐私模式: 用默认 */ }
  function aiSpeedCfg() { return AI_SPEEDS[aiSpeed] || AI_SPEEDS[1]; }
  function renderAiSpeedBtn() {
    const b = document.getElementById('btnAISpeed');
    if (!b) return;
    b.textContent = aiSpeedCfg().label;
    b.setAttribute('aria-label', 'AI 行动速度：' + aiSpeedCfg().label + '（点击切换标准/快速/极速）');
  }

  function maybeAI() {
    if (!game || game.state.over || aiBusy || briefingOpen) return;
    const side = game.state.phase;
    const isAI = side === 'DE' ? aiDE : aiUS;
    if (!isAI) { refreshTop(); return; }
    aiBusy = true;
    window.__aiBusySince = Date.now(); window.__aiTracePush('接管 ' + side + ' R' + game.state.round);
    refreshTop(); refreshHint();
    const myGameNo = gameNo;
    // 原版33轮+39轮移植: **必须先等动画队列追平**再走下一个动作——旧写法只按 pace 放行,
    // 一次移动/交火动画 200~600ms, 引擎越跑越前, 画面最多落后引擎 5 格("隔格攻击"假象)。
    // 队列上限 900ms 只是保险: 动画已按真实时间推进且时长压缩, 正常 200~400ms 追平。
    const waitAnim = () => Promise.race([animQueue.catch(() => {}), new Promise(r => setTimeout(r, 900))]);
    const Sp = aiSpeedCfg();
    if (renderer) { renderer.animScale = Sp.anim; renderer.skipMoveAnim = Sp.skipMove; }   // AI 阶段加速(人类操作原速)
    const aiUnits = game.phaseUnits().length;
    const pace = aiUnits > 45 ? Sp.pace[0] : aiUnits > 30 ? Sp.pace[1] : Sp.pace[2];
    try {
    AI.executeTurn(game, side, (fn, ms) => {
      // 极速档: 不排动画帧, 动作连续执行(整段几百毫秒跑完, 画面最后统一刷新)
      if (Sp.skipMove) { fn(); return; }
      waitAnim().then(() => setTimeout(fn, ms));
    }, () => {
      aiBusy = false; window.__aiTracePush('完成 ' + side + ' R' + game.state.round);
      if (renderer) { renderer.animScale = 1; renderer.skipMoveAnim = false; }   // 交还人类原速
      if (myGameNo !== gameNo || !game || game.state.over) { refreshTop(); return; }
      refreshTop(); refreshHint();
      // executeTurn 已调用 endPhase; phase事件期间aiBusy为真被跳过, 这里补跑下一方
      setTimeout(() => maybeAI(), 150);
    });
    } catch (err) {
      // 24y 自愈: AI 链任何同步异常都不允许卡死整局——复位并强制推进阶段
      aiBusy = false;
      const msg = '[AI 异常已自愈] ' + String(err && (err.stack || err.message)).slice(0, 140);
      window.__errs.push(msg);
      try { game.log(msg, 'warn'); if (!game.state.over) game.endPhase(); } catch (e2) {}
      setTimeout(() => maybeAI(), 400);
    }
  }
  // 24y AI 看门狗：aiBusy 超过 45s 且局面未推进 → 强制复位并推进（防异步链静默断链）
  setInterval(() => {
    if (!game || game.state.over || !aiBusy) return;
    if (Date.now() - (window.__aiBusySince || 0) > 45000) {
      aiBusy = false;
      const msg = '[AI 看门狗] 阶段超过 45s 未推进，强制交还并推进';
      window.__errs.push(msg);
      try { game.log(msg, 'warn'); if (!game.state.over) game.endPhase(); } catch (e2) {}
      setTimeout(() => maybeAI(), 400);
    }
  }, 5000);

  /* ---------------- 模态框 ---------------- */
  /* ---------------- 兵力一览（在场双方棋子，按攻+防排序） ---------------- */
  let obSide = 'ALL';   // ALL | DE | US

  /* ---------------- 援军"部队档案"卡（2026-10 第十一轮） ---------------- */
  let reinBuf = [];              // 本阶段缓冲的入场单位
  let reinTimer = 0;
  let dossierQueue = [];         // 待展示的档案(每场每建制只弹一次)
  let dossierShown = new Set();  // 已展示过的档案 key
  let dossierOpen = false;
  /* 24p: 增援档案弹卡开关（记忆偏好）——关=入场只显示横幅提示，档案仍可在「部队档案」面板查阅 */
  let dosPop = (() => { try { return localStorage.getItem('ardennes44_dospop') !== '0'; } catch (e) { return true; } })();
  let briefingOpen = false;   // 开局指挥官简报打开中(压制 AI 调度)

  function findDossier(unit) {
    /* 24o: 营→档案三级匹配。dossiers_big.js 加载时已把逐营映射写入 META[id].dos
       （dispName→div→parent 三级命中），此处 O(1) 直取；旧存档/未映射走子串回退。 */
    const meta = (DATA.OOB_BIG_META || {})[unit.id];
    if (meta && meta.dos) {
      const byKey = (DATA.DOSSIERS || []).find(d => d.key === meta.dos);
      if (byKey) return byKey;   // 阵营已在映射层按 nat 过滤(英军营 unit.side=US 而档案 side=UK)
    }
    const list = (DATA.REINFORCE_DOSSIERS || []);
    for (const d of list) {
      if (d.side !== unit.side) continue;
      if (d.match.some(m => (unit.name || '').indexOf(m) >= 0)) return d;
    }
    return null;
  }

  // 缓冲到时：把本阶段入场单位归入档案；无档案的仍用横幅提示
  function flushReinforce() {
    reinTimer = 0;
    const units = reinBuf; reinBuf = [];
    if (!units.length || !game) return;
    const ds = [];
    for (const u of units) {
      const d = findDossier(u);
      if (d && !dossierShown.has(d.key)) { dossierShown.add(d.key); ds.push({ d, u }); }
    }
    if (!ds.length) { showBanner('增援抵达', units[units.length - 1].name, 1400); return; }
    // 有档案：横幅提示整批入场，随后依次弹档案卡（24p: 弹卡关闭时横幅即达，本批仍标记已读）
    const names = ds.map(x => x.d.name).join('、');
    showBanner('援军抵达', names, 1800);
    if (!dosPop) return;
    for (const x of ds) dossierQueue.push(x);
    if (!dossierOpen) showNextDossier();
  }

  /* ---------------- 开局指挥官简报（2026-10 第十七轮） ----------------
   * 仿对话方式：以当时指挥官身份、按史实交代局势与胜负目标（德美各一套，DATA.BRIEFINGS）。
   * 简报打开期间压制 AI 调度（briefingOpen，maybeAI 与 startGame 延时两处拦）；读完由
   * showBriefingQueue 的 finish() 统一补跑 maybeAI 并补阶段横幅。读档续局不弹简报。 */
  function briefingSides() {
    if (aiDE === aiUS) return ['DE', 'US'];   // 双人热座 / AI 观摩 → 双方都读（德军先手，德方在前）
    return aiDE ? ['US'] : ['DE'];            // aiDE 开 → 玩家指挥美军
  }
  function showBriefingQueue() {
    const q = briefingSides();
    // 24y 看门狗: 简报 90s 未走完强制复位（防平台注入/交互异常卡住 AI 调度）
    clearTimeout(window.__briefingWatchdog);
    window.__briefingWatchdog = setTimeout(() => {
      if (!briefingOpen) return;
      briefingOpen = false;
      try { game.log('[看门狗] 简报超时未关闭，已自动恢复 AI 调度', 'warn'); } catch (e) {}
      maybeAI();
    }, 90000);
    const finish = () => {
      briefingOpen = false;
      if (!game || game.state.over) return;
      maybeAI();
      showBanner(game.state.phase === 'DE' ? '德军阶段' : '美军阶段', `第${game.state.round}回合 · ${game._dateStr()}`);
    };
    const next = () => { if (!q.length) { finish(); return; } showBriefing(q.shift(), next); };
    next();
  }
  function showBriefing(side, done) {
    const B = DATA.BRIEFINGS && DATA.BRIEFINGS[side];
    if (!B) { done && done(); return; }
    briefingOpen = true;   // 压制 AI 调度（构造期 'phase' 事件的 600ms 延时 / maybeAI / 开局 800ms 延时）
    const box = $('modalBox');
    box.className = 'box briefing-box';
    // 取消回合限制（歼灭模式）：追加模式专属的局势段，并改用"歼灭"目标段与结语
    const noLimit = !!game.noTurnLimit;
    const intro = B.intro.concat((noLimit && B.introNoLimit) ? B.introNoLimit : []);
    const goalLine = (noLimit && B.goals.noLimit) || B.goals[game.scenario.id] || B.goals.standard;
    const outroLine = (noLimit && B.outroNoLimit) ? B.outroNoLimit : B.outro;
    const lines = intro.concat([goalLine, outroLine]);
    let idx = 0;
    box.innerHTML = `
      <div class="briefing">
        <div class="br-photo">
          <img class="ds-img br-img" src="${photoUrl(B.photo)}" alt="${B.photoCaption || B.name}" referrerpolicy="no-referrer">
          <div class="ds-fallback" hidden>
            <div class="ds-fb-name">${B.name}</div>
            <div class="ds-fb-type">${B.post}</div>
            <div class="ds-fb-note">档案插图 · 非真实照片</div>
          </div>
          <div class="ds-cap">${B.photoCaption || ''}</div>
        </div>
        <div class="br-body">
          <div class="br-tag">${side === 'DE' ? '德军' : '美军'} · 开局简报 · 1944.12.16${noLimit ? ' · 歼灭模式（无回合限制）' : ''}</div>
          <h1>${B.name}</h1>
          <div class="br-post">${B.post}</div>
          <div class="br-chat" id="brChat"></div>
          <div class="br-credit">${B.credit || '照片：维基共享资源'}</div>
        </div>
      </div>
      <div class="foot">
        <button id="brSkip">跳 过</button>
        <button id="brNext" class="primary">继 续</button>
      </div>`;
    const chat = box.querySelector('#brChat');
    const btn = box.querySelector('#brNext');
    const paint = () => {
      chat.innerHTML = lines.slice(0, idx + 1).map(t => `<div class="br-msg"><div class="br-bubble">${t}</div></div>`).join('');
      chat.scrollTop = chat.scrollHeight;
      btn.textContent = idx >= lines.length - 1 ? '开 始 推 演' : '继 续';
      SFX.play('briefing');                   // 电报机/纸带轻响（每段一句）
    };
    paint();
    btn.onclick = () => { if (idx < lines.length - 1) { idx++; paint(); } else closeBriefing(done); };
    box.querySelector('#brSkip').onclick = () => closeBriefing(done);
    // 肖像加载失败 → 回退到程序化"档案插图"（与援军档案同一套路）
    bindPhoto(box.querySelector('.br-img'), box.querySelector('.ds-fallback'), B.photo);   // 24g: 缩略图+占位+淡入
    $('modal').style.display = 'flex';
  }
  function closeBriefing(done) {
    $('modal').style.display = 'none';
    if (done) done();
  }

  function showNextDossier() {
    if (dossierOpen || !dossierQueue.length) return;
    const { d, u } = dossierQueue.shift();
    dossierOpen = true;
    const box = $('modalBox');
    box.className = 'box dossier-box';
    const sideName = d.side === 'DE' ? '德军' : '美军';
    const sideCls = d.side === 'DE' ? 'de' : 'us';
    const unit = u || {};
    box.innerHTML = `
      <div class="dossier">
        <div class="ds-photo">
          <img class="ds-img" src="${photoUrl(d.photo)}" alt="${d.photoCaption || d.name}" referrerpolicy="no-referrer">
          <div class="ds-fallback" hidden>
            <div class="ds-fb-name">${d.name}</div>
            <div class="ds-fb-type">${d.type || ''}</div>
            <div class="ds-fb-note">档案插图 · 非真实照片</div>
          </div>
          <div class="ds-cap">${d.photoCaption || ''}</div>
        </div>
        <div class="ds-info">
          <div class="ds-tag ${sideCls}">${sideName} · 增援抵达</div>
          <h1>${d.name}</h1>
          <div class="ds-meta">
            <span>入场：第 ${game.state.round} 回合 · ${game._dateStr()}</span>
            <span>史实：${d.histDate || ''}</span>
            ${d.type ? `<span>兵种：${d.type}</span>` : ''}
            ${unit.abbr ? `<span>算子：${unit.abbr}</span>` : ''}
          </div>
          ${d.strength ? `<div class="ds-str">主要编成：${d.strength}</div>` : ''}
          <div class="ds-intro">${d.intro}</div>
          <div class="ds-credit">照片：维基共享资源 · 公有领域（PD）｜ 加载失败时显示档案插图</div>
        </div>
      </div>
      <div class="foot">${dossierQueue.length ? '<button id="dsSkipAll" title="清空本批待弹档案，不再逐张展示">跳过全部</button>' : ''}<button class="primary" id="dsClose">知道了</button></div>`;
    // 图片加载失败 → 回退到程序化"档案照"插图
    bindPhoto(box.querySelector('.ds-img'), box.querySelector('.ds-fallback'), d.photo);   // 24g: 缩略图+占位+淡入
    SFX.play('dossier');                      // 增援档案卡：快门/落卡声
    $('modal').style.display = 'flex';
    const close = () => {
      $('modal').style.display = 'none';
      dossierOpen = false;
      if (!game || game.state.over) return;
      if (dossierQueue.length) setTimeout(showNextDossier, 250);
      else maybeAI();   // 档案卡关闭后，若轮到 AI 则继续推演
    };
    box.querySelector('#dsClose').onclick = close;
    const skipAll = box.querySelector('#dsSkipAll');   // 24p: 跳过本批剩余档案
    if (skipAll) skipAll.onclick = () => { dossierQueue = []; close(); };
  }

  function showUnitsModal() {
    if (!game) return;
    const box = $('modalBox');
    box.className = 'box wide';

    function render() {
      const all = game.units.filter(u => u.alive && !u.exited);
      const rows = all.filter(u => obSide === 'ALL' || u.side === obSide)
        .sort((a, b) => (b.atk + b.def) - (a.atk + a.def));
      const stat = side => {
        const list = all.filter(u => u.side === side);
        const a = list.reduce((s, u) => s + u.atk, 0);
        const d = list.reduce((s, u) => s + u.def, 0);
        const o = list.reduce((s, u) => s + u.org, 0);
        const mo = list.reduce((s, u) => s + u.maxOrg, 0);
        return `${list.length} 个 · 合计攻 ${a} / 防 ${d} · 组织度合计 ${Math.round(o)} / ${mo}`;
      };
      const rowHtml = u => {
        const frac = Math.max(0, u.org / u.maxOrg);
        const orgCls = frac > 0.6 ? '' : frac > 0.3 ? 'down' : 'down';
        const states = [];
        if (!u.supplied) states.push('<span class="nosup">断补</span>');
        else states.push('补给OK');
        if (u.type === 'ART' || u.type === 'RKT') states.push(u.fired ? '已射击' : '可射击');
        else if (u.moved) states.push('<span class="done">已移动</span>');
        else states.push('可机动');
        if (u.attach && u.attach.at) states.push(u.side === 'US' ? '巴祖卡' : '铁拳');
        if (u.attach && u.attach.fort) states.push('工事');
        if (u.attach && u.attach.aa) states.push('防空');
        const ps = Combat.passiveState(game, u);
        if (ps.key) states.push(ps.key === 'lastStand' ? '困兽犹斗' : ps.key === 'broken' ? '无心再战' : '协同');
        return `<tr class="row ${u.side}" data-uid="${u.uid}">
          <td class="sum">${u.atk + u.def}</td>
          <td class="nm" title="${u.name}｜${DATA.TYPES[u.type].name}｜组织度 ${u.org}/${u.maxOrg}">${u.abbr || u.name}</td>
          <td>${DATA.TYPES[u.type].name}</td>
          <td>${u.atk}</td><td>${u.def}</td>
          <td>${game.movEff(u)}</td>
          <td class="${orgCls}">${Math.round(u.org)}/${u.maxOrg}</td>
          <td class="loc">${game._coordName(u.c, u.r)}</td>
          <td>${states.join(' · ')}</td>
        </tr>`;
      };
      box.innerHTML = `
        <h1>兵力一览</h1>
        <div style="color:#9aa0a6;font-size:13px">
          第 ${game.state.round} 回合 · ${game._dateStr()} · ${game._weatherName()} ｜ 按「攻击+防御」由高到低排序，点任意一行可在地图上定位该部队
        </div>
        <div class="rules" style="margin:10px 0 0">
          <b style="color:#b8c4b0">德军</b> ${stat('DE')} ｜
          <b style="color:#a8c8e8">美军</b> ${stat('US')}
        </div>
        <div class="tabs">
          <button data-s="ALL" class="${obSide === 'ALL' ? 'sel' : ''}">全部 ${all.length}</button>
          <button data-s="DE" class="${obSide === 'DE' ? 'sel' : ''}">仅德军</button>
          <button data-s="US" class="${obSide === 'US' ? 'sel' : ''}">仅美军</button>
        </div>
        <div class="wrap-scroll">
          <table class="unitlist">
            <thead><tr>
              <th>攻+防</th><th>部队</th><th>兵种</th><th>攻</th><th>防</th><th>移动</th><th>组织度</th><th>位置</th><th>状态</th>
            </tr></thead>
            <tbody>${rows.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        <div class="foot"><button class="primary" id="mClose">关 闭</button></div>`;
      box.querySelectorAll('.tabs button').forEach(el => {
        el.onclick = () => { obSide = el.dataset.s; render(); };
      });
      box.querySelector('#mClose').onclick = () => { $('modal').style.display = 'none'; };
      box.querySelectorAll('tr.row').forEach(tr => {
        tr.onclick = () => {
          const u = game.units.find(x => x.uid === +tr.dataset.uid);
          if (!u || !u.alive) return;
          $('modal').style.display = 'none';
          const cur = renderer.cam && renderer.cam.dist;
          renderer.focusOn(u.c, u.r, Math.min(cur || 70, 70));
          if (aiBusy || game.state.over) return;
          if (u.side === game.state.phase && !u.moved) selectUnit(u);
          else { selected = u; mode = 'idle'; renderer.selectHexRing(u.c, u.r); refreshUnitPanel(); }
        };
      });
    }

    render();
    SFX.play('page');                         // 展开编成表：翻页声
    $('modal').style.display = 'flex';
  }

  function showStartModal(hasSave) {
    const box = $('modalBox');
    box.className = 'box start-box';
    let selScen = 'standard';
    box.innerHTML = `
      <div class="sd-head">
        <div class="sd-stamp">ARDENNES<br>16 DEC 1944</div>
        <div class="sd-kicker">Hex Wargame · Dec 1944 — Jan 1945</div>
        <h1>阿登 <span>1944</span></h1>
        <div class="sd-sub">突出部战役 · 团级六角兵棋推演 · 依据真实编制与地理</div>
      </div>
      <h2 class="sd-h">选择剧本<span class="sd-en">SCENARIO</span></h2>
      <div class="scen-list">
        <div class="scen sel" data-id="standard">
          <div class="sc-idx">01</div>
          <div class="sc-main">
            <div class="n">突出部（标准）<span class="sc-origin">原版</span></div>
            <div class="s">1944.12.16 — 12.27 · 12 回合</div>
            <div class="d">德军须在时间耗尽前冲出马斯河或夺取圣维特与巴斯托涅；美军且战且退，等天气放晴。在新窗口打开原版《阿登1944》完整版运行。</div>
          </div>
          <div class="sc-tick">已选</div>
        </div>
        <div class="scen" data-id="campaign">
          <div class="sc-idx">02</div>
          <div class="sc-main">
            <div class="n">阿登全战役<span class="sc-origin">原版</span></div>
            <div class="s">1944.12.16 — 1945.1.16 · 24 回合</div>
            <div class="d">两阶段战役：德军攻势 + 美军反攻，攻守易势，直到突出部被削平。在新窗口打开原版《阿登1944》完整版运行。</div>
          </div>
          <div class="sc-tick">已选</div>
        </div>
        <div class="scen" data-id="big">
          <div class="sc-idx">03</div>
          <div class="sc-main">
            <div class="n">阿登大推演（营级）</div>
            <div class="s">1944.12.16 — 1945.1.25 · 41 回合 · 1192 营</div>
            <div class="d">全建制推演：双方参战营级单位全部入场（含英军第30军与德军二梯队），师为抽象指挥，地图扩至马斯河—艾费尔纵深。</div>
          </div>
          <div class="sc-tick">已选</div>
        </div>
      </div>
      <h2 class="sd-h">你的角色<span class="sd-en">COMMAND</span></h2>
      <div class="role-grid">
        <button class="side-btn sel" data-side="us"><span class="sb-code">A</span><span><span class="sb-t">指挥美军</span><span class="sb-d">防守反击 · 迟滞待晴</span></span></button>
        <button class="side-btn" data-side="de"><span class="sb-code">B</span><span><span class="sb-t">指挥德军</span><span class="sb-d">装甲突击 · 夺要点渡河</span></span></button>
        <button class="side-btn" data-side="both"><span class="sb-code">C</span><span><span class="sb-t">双人热座</span><span class="sb-d">同机轮流指挥双方</span></span></button>
        <button class="side-btn" data-side="watch"><span class="sb-code">D</span><span><span class="sb-t">AI 对战观摩</span><span class="sb-d">双方均由 AI 推演</span></span></button>
      </div>
      <h2 class="sd-h">独立选项<span class="sd-en">OPTIONS</span></h2>
      <button type="button" class="opt-toggle" id="optNoLimit" aria-pressed="false">
        <span class="ot-box" aria-hidden="true"></span>
        <span class="ot-body">
          <span class="ot-t">取消回合限制</span>
          <span class="ot-d">无回合上限；双方目标改为<b>歼灭对方全部建制（含援军）</b>；渡河退出关闭</span>
        </span>
        <span class="ot-state">关</span>
      </button>
      <div id="selHint" class="sel-hint"><span class="sh-k">已选</span><span class="sh-v"></span></div>
      <div class="foot">
        ${hasSave ? '<button id="mResume">继续上次战局</button>' : ''}
        <button id="mStart" class="primary">开始推演</button>
      </div>`;
    const SCEN_NAMES = { standard: '突出部（标准）· 12 回合 · 原版独立运行', campaign: '阿登全战役 · 24 回合 · 原版独立运行', big: '阿登大推演（营级）· 41 回合' };
    const SIDE_NAMES = { us: '指挥美军（防守反击）', de: '指挥德军（装甲突击）', both: '双人热座（轮流）', watch: 'AI 对战观摩（双方 AI）' };
    let side = 'us';
    let noLimit = false;                                  // 取消回合限制（独立选项，第二十三轮）
    const $hint = box.querySelector('#selHint .sh-v');
    function refreshHint() {
      $hint.textContent = `${SCEN_NAMES[selScen]} · ${SIDE_NAMES[side]}${noLimit ? ' · 取消回合限制（歼灭·无上限）' : ''}`;
    }
    box.querySelectorAll('.scen').forEach(el => {
      el.onclick = () => {
        box.querySelectorAll('.scen').forEach(x => x.classList.remove('sel'));
        el.classList.add('sel');
        selScen = el.dataset.id;
        refreshHint();
      };
    });
    box.querySelectorAll('.side-btn').forEach(el => {
      el.onclick = () => {
        box.querySelectorAll('.side-btn').forEach(x => x.classList.remove('sel'));
        el.classList.add('sel');
        side = el.dataset.side;
        refreshHint();
      };
    });
    // 独立选项：取消回合限制（不并入剧本/角色，单独一个开关）
    const $opt = box.querySelector('#optNoLimit');
    $opt.onclick = () => {
      noLimit = !noLimit;
      $opt.classList.toggle('on', noLimit);
      $opt.setAttribute('aria-pressed', noLimit ? 'true' : 'false');
      $opt.querySelector('.ot-state').textContent = noLimit ? '开' : '关';
      refreshHint();
      SFX.play('click');
    };
    refreshHint();
    $('modal').style.display = 'flex';
    /* 24u: 01/02 剧本彻底继承原版——新窗口打开《阿登1944》完整成品。
       候选位置：① 本体同目录（dist 双击/http 根）② vendor/classic/（开发目录）。
       http 下先 fetch HEAD 探测防开到 404 页；file:// 无法探测则按序直接开。
       打开失败（弹窗拦截/文件缺失）才回退内置兼容模式（原数据+共享引擎）。 */
    const launchClassic = async () => {
      const cands = ['ardennes44_classic.html', 'vendor/classic/ardennes44_classic.html'];
      for (const rel of cands) {
        if (location.protocol !== 'file:') {
          try { const resp = await fetch(rel, { method: 'HEAD' }); if (!resp.ok) continue; }
          catch (e) { continue; }
        }
        const w = window.open(rel, '_blank');
        if (w) { try { w.focus(); } catch (e) {} return true; }
      }
      return false;
    };
    box.querySelector('#mStart').onclick = () => {
      SFX.init();            // 用户手势：此刻解锁 AudioContext（浏览器自动播放策略）
      if (selScen !== 'big') {
        launchClassic().then(ok => {
          if (ok) { showBanner('已打开原版', '《阿登1944》在新窗口运行 · 剧本与阵营请在其菜单中选择', 3200); return; }
          showBanner('原版打开失败', '新窗口被拦截 · 也可手动双击 dist/ardennes44_classic.html · 现改用内置兼容模式', 3400);
          startCompat();
        });
        return;
      }
      startBig();
    };
    const startBig = () => {
      achvRole = side; achvNoLimit = noLimit;      // 24v: 供 achvMeta 读取（模块级副本）
      aiDE = side === 'us' || side === 'watch';
      aiUS = side === 'de' || side === 'watch';
      $('btnAIde').classList.toggle('active', aiDE);
      $('btnAIus').classList.toggle('active', aiUS);
      $('modal').style.display = 'none';
      startGame(selScen, null, { noTurnLimit: noLimit });
      showBriefingQueue();   // 开局指挥官简报（读档不弹）
    };
    const startCompat = () => { achvRole = side; achvNoLimit = noLimit;   // 24v
      $('modal').style.display = 'none'; startGame(selScen, null, {}); showBriefingQueue(); };
    if (hasSave) box.querySelector('#mResume').onclick = () => {
      achvRole = null;                            // 24v: 读档沿用存档身份
      try {
        SFX.init();          // 同样是用户手势
        const s = JSON.parse(localStorage.getItem('ardennes44_save'));
        aiDE = false; aiUS = false;
        $('btnAIde').classList.remove('active'); $('btnAIus').classList.remove('active');
        $('modal').style.display = 'none';
        startGame(s.scenarioId, s);
      } catch (e) { alert('存档读取失败'); }
    };
  }


  /* ---------------- 成就与战绩（第三十二轮·阶段 B） ----------------
   * 分工：判定/存储全在 js/achv.js（纯逻辑、只读引擎）；这里只做表现与交互：
   *   ① 解锁卡（右上滑入，队列串行）② 勋章墙 / 最近 100 场 / 统计 三栏面板
   *   ③ 终局 AAR 追加"本局新解锁"  ④ 战绩卡 PNG 导出
   * 引擎零改动；本层只在事件回调里调用 Achv 的只读求值。
   */
  let achvQL = [], achvBusy = false, achvTimer = 0, achvLastNew = [], achvFilter = 'mine';

  /* —— 24y B站环境诊断：全局错误捕获（入战报红字 + __errs），AI 看门狗 —— */
  window.__errs = window.__errs || [];
  window.addEventListener('error', e => {
    const msg = '[运行错误] ' + (e.message || '') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || '?');
    window.__errs.push(msg);
    try { if (game && game.log) game.log(msg, 'warn'); } catch (e2) {}
  });
  window.addEventListener('unhandledrejection', e => {
    const msg = '[异步错误] ' + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 160);
    window.__errs.push(msg);
    try { if (game && game.log) game.log(msg, 'warn'); } catch (e2) {}
  });
  window.__aiTrace = window.__aiTrace || [];
  window.__aiTracePush = why => {
    window.__aiTrace.push({ t: Date.now(), why: String(why).slice(0, 80) });
    if (window.__aiTrace.length > 30) window.__aiTrace.shift();
  };
  window.__diag = () => {
    const d = {
      ua: navigator.userAgent.slice(0, 120),
      online: navigator.onLine,
      storage: (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return '可写'; } catch (e) { return '不可写: ' + e.message; } })(),
      decompress: typeof DecompressionStream === 'function' ? '支持' : '不支持',
      three: window.THREE ? (window.__threeHow || '已加载') : '未加载',
      threeFailed: window.__threeFailed || '',
      webgl: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } })(),
      errs: (window.__errs || []).slice(-8),
      aiTrace: (window.__aiTrace || []).slice(-12),
    };
    try { if (game && game.log) { game.log('── 环境诊断 ──', 'sys');
      game.log('UA: ' + d.ua, 'sys'); game.log('存储: ' + d.storage + ' · 解压: ' + d.decompress + ' · WebGL: ' + d.webgl, 'sys');
      game.log('引擎: ' + d.three + (d.threeFailed ? '（' + d.threeFailed + '）' : ''), 'sys');
      (d.errs || []).forEach(x => game.log(x, 'warn'));
      (d.aiTrace || []).forEach(x => game.log('AI[' + new Date(x.t).toLocaleTimeString() + '] ' + x.why, 'sys'));
    } } catch (e2) {}
    return d;
  };
  // 开局界面选择（showStartModal 内部是局部变量，必须在这里留一份模块级副本，
  // 否则 achvMeta 取不到 → 热座/观摩/歼灭 类成就永远不解锁、战绩身份也会记错）
  let achvRole = null, achvNoLimit = false;

  function achvMeta() {
    return {
      role: achvRole || 'de',            // 'de' | 'us' | 'hotseat' | 'watch'
      scenario: game ? game.scenario.id : 'standard',
      noLimit: achvNoLimit || !!(game && game.noTurnLimit),
      seed: game ? game.rngSeed : null,
      side: game ? game.state.phase : 'DE',
    };
  }
  // 像素点阵 → canvas（image-rendering: pixelated，零外部图片）
  function achvCanvas(iconId, px, silhouette) {
    const m = Achv.pixel(iconId, silhouette);
    const cv = document.createElement('canvas');
    if (!m) return cv;
    const n = m.length, s = Math.max(1, Math.round(px / (n + 2)));   // 24w: 四周留 1px 描边
    cv.width = (n + 2) * s; cv.height = (n + 2) * s;
    const ctx = cv.getContext('2d');
    /* 24w 立体化渲染：① 外描边 1px（暗色勾边，轮廓在任何底色上都清晰）
       ② 本体像素 ③ 底部投影 1px（半透明，物体落在墙面上） */
    const occ = (y, x) => y >= 0 && y < n && x >= 0 && x < n && !!m[y][x];
    if (!silhouette) {
      ctx.fillStyle = 'rgba(20, 24, 20, 0.92)';
      for (let y = -1; y <= n; y++) for (let x = -1; x <= n; x++) {
        if (occ(y, x)) continue;
        if (occ(y - 1, x) || occ(y + 1, x) || occ(y, x - 1) || occ(y, x + 1)
          || occ(y - 1, x - 1) || occ(y - 1, x + 1) || occ(y + 1, x - 1) || occ(y + 1, x + 1)) {
          ctx.fillRect((x + 1) * s, (y + 1) * s, s, s);
        }
      }
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = m[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect((x + 1) * s, (y + 1) * s, s, s);
      if (!silhouette && !occ(y + 1, x)) {
        ctx.fillStyle = 'rgba(10, 12, 10, 0.35)';
        ctx.fillRect((x + 1) * s, (y + 2) * s, s, Math.max(1, s * 0.5));
      }
    }
    return cv;
  }
  const TIER_CN = { bronze: '铜', silver: '银', gold: '金' };
  function achvDef(id) { return DATA.ACHIEVEMENTS.find(a => a.id === id); }
  // 各档总数与达成数（动态计算——写死 5/12/7 会在加成就时立刻过期）
  function achvTiers() {
    const un = Achv.unlockedMap();
    const t = { bronze: [0, 0], silver: [0, 0], gold: [0, 0] };
    for (const d of DATA.ACHIEVEMENTS) { const got = !!un[d.id]; t[d.tier][got ? 0 : 1]++; }
    return t;
  }
  function achvTierLine() {
    const t = achvTiers();
    const tot = k => t[k][0] + t[k][1];
    return `铜 ${t.bronze[0]}/${tot('bronze')} · 银 ${t.silver[0]}/${tot('silver')} · 金 ${t.gold[0]}/${tot('gold')}`;
  }

  function achvTick() {
    if (!game || typeof Achv === 'undefined') return;
    let fresh = [];
    try { fresh = Achv.commit(Achv.evaluate(game)); } catch (e) { console.error('成就求值失败', e); return; }
    for (const id of fresh) { achvQL.push(id); if (!achvLastNew.includes(id)) achvLastNew.push(id); }
    if (fresh.length) achvPump();
  }
  function achvPump() {
    if (achvBusy || !achvQL.length) return;
    const id = achvQL.shift(), def = achvDef(id);
    const host = $('achvToast');
    if (!def || !host) return;
    achvBusy = true;
    const card = document.createElement('div');
    card.className = 'ach-card' + (def.tier === 'gold' ? ' gold' : '');
    card.innerHTML = `<div class="ac-ic"></div><div style="flex:1"><div class="ac-kicker">成就解锁 · ACHIEVEMENT</div>
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <span class="ac-name">${def.name}</span>
        <span class="ac-en">${def.en}</span>
        <span class="ac-tier ${def.tier}">${TIER_CN[def.tier]}</span>
      </div><div class="ac-quote">${def.quote}</div></div>`;
    card.querySelector('.ac-ic').appendChild(achvCanvas(def.icon, 48, false));
    card.onclick = () => { SFX.play('click'); card.classList.remove('in'); setTimeout(() => card.remove(), 300); };
    host.appendChild(card);
    SFX.play('achv', { tier: def.tier });
    requestAnimationFrame(() => card.classList.add('in'));
    const hold = def.tier === 'gold' ? 8200 : 6200;
    achvTimer = setTimeout(() => {
      card.classList.remove('in');
      setTimeout(() => { card.remove(); achvBusy = false; achvPump(); }, 320);
    }, hold);
  }
  // 终局：结算 + 记战绩（只跑一次，Achv 里有 ended 守卫）
  // 注意：终局这一次求值同样要把新解锁计入 achvLastNew，否则 AAR 的"本局新解锁"区块会是空的
  function achvFinish() {
    if (!game || typeof Achv === 'undefined') return;
    try {
      const fresh = Achv.finish(game, achvMeta()) || [];
      for (const id of fresh) { if (!achvLastNew.includes(id)) achvLastNew.push(id); }
    } catch (e) { console.error('成就结算失败', e); }
    achvPump();
  }

  /* ---- 勋章墙 / 战绩 / 统计 面板 ---- */
  function showAchvModal(tab) {
    const box = $('modalBox');
    let cur = tab || 'wall';
    const recRows = () => {
      const all = Achv.recent(Achv.HIST_MAX);
      const mine = all.filter(r => r.role === 'de' || r.role === 'us');
      const list = achvFilter === 'mine' ? mine : all;
      if (!list.length) return `<div class="ach-empty">还没有战绩记录。打完一局（或让 AI 打完）就会记在这里。</div>`;
      const dt = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
      const ROLE = { de: '德军', us: '美军', hotseat: '热座', watch: '观战' };
      const SCEN = { standard: '突出部', campaign: '全战役' };
      return `<div class="ach-filter"><span>范围</span>
          <button data-f="mine" class="${achvFilter === 'mine' ? 'on' : ''}">我指挥的（${mine.length}）</button>
          <button data-f="all" class="${achvFilter === 'all' ? 'on' : ''}">全部（${all.length}）</button>
          <span style="margin-left:auto">最多保留最近 100 场</span></div>
        <div class="ach-rec-wrap"><table class="ach-rec"><thead><tr>
          <th>时间</th><th>剧本</th><th>身份</th><th>结果</th><th>回合</th><th>德损</th><th>美损</th><th>渡河</th><th>成就</th><th></th>
        </tr></thead><tbody>${list.map((r, i) => `<tr>
          <td>${dt(r.t)}</td><td>${SCEN[r.scen] || r.scen}${r.noLimit ? '·歼灭' : ''}</td>
          <td>${ROLE[r.role] || r.role}</td>
          <td class="${r.winner === 'DE' ? 'l' : 'w'}">${r.winner === 'DE' ? '德军胜' : r.winner === 'US' ? '美军胜' : '—'}</td>
          <td>${r.rounds}</td>
          <td>${r.loss && r.loss.DE != null ? Math.round(r.loss.DE * 100) + '%' : '—'}</td>
          <td>${r.loss && r.loss.US != null ? Math.round(r.loss.US * 100) + '%' : '—'}</td>
          <td>${r.exits || 0}</td>
          <td>${(r.achv || []).length ? '★ ' + r.achv.length : ''}</td>
          <td><button class="card-btn" data-i="${all.indexOf(r)}" title="导出这一场的战绩卡（PNG 1080×1350）">战绩卡</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    };
    const statRows = () => {
      const all = Achv.recent(Achv.HIST_MAX);
      const mine = all.filter(r => r.role === 'de' || r.role === 'us');
      const L = Achv.history().life;
      const win = s => mine.filter(r => r.winner === s).length;
      const cell = (k, v, s) => `<div class="ach-stat"><div class="as-k">${k}</div><div class="as-v">${v}</div><div class="as-s">${s || ''}</div></div>`;
      const achvP = Achv.progress();
      const SCEN = { standard: '突出部', campaign: '全战役' };
      const dates = all.map(r => r.t).sort((a, b) => a - b);
      const fmtD = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
      const longest = mine.slice().sort((a, b) => (b.rounds || 0) - (a.rounds || 0))[0];
      const worst = mine.slice().sort((a, b) => {
        const la = a.role === 'de' ? (a.loss && a.loss.DE) || 0 : (a.loss && a.loss.US) || 0;
        const lb = b.role === 'de' ? (b.loss && b.loss.DE) || 0 : (b.loss && b.loss.US) || 0;
        return lb - la;
      })[0];
      // 按剧本分组
      const byScen = {};
      for (const r of mine) {
        const k = r.scen || 'standard';
        byScen[k] = byScen[k] || { n: 0, de: 0, us: 0, rounds: 0 };
        byScen[k].n++; byScen[k].rounds += r.rounds || 0;
        if (r.winner === 'DE') byScen[k].de++; else if (r.winner === 'US') byScen[k].us++;
      }
      const scenRows = Object.keys(byScen).length
        ? Object.entries(byScen).map(([k, v]) => `<div class="lt-row" style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--hair)">
            <span style="flex:1">${SCEN[k] || k}</span>
            <span style="font-family:var(--mono)">${v.n} 局 · 德胜 ${v.de} / 美胜 ${v.us} · 平均 ${(v.rounds / v.n).toFixed(1)} 回合</span></div>`).join('')
        : '<div class="ach-empty">还没有可统计的对局</div>';
      const ownLoss = r => r.role === 'de' ? (r.loss && r.loss.DE) : (r.loss && r.loss.US);
      return `<div class="ach-stats">
        ${cell('累计推演', L.games + ' 局', '含观摩与热座')}
        ${cell('本档近 100 场', mine.length + ' 局', '我指挥的')}
        ${cell('胜率（我指挥）', mine.length ? Math.round(Math.max(win('DE'), win('US')) / mine.length * 100) + '%' : '—', `德胜 ${win('DE')} / 美胜 ${win('US')}`)}
        ${cell('成就进度', achvP.got + ' / ' + achvP.total, achvTierLine())}
        ${cell('德/美 分列胜率', mine.length ? `${Math.round(win('DE') / Math.max(1, mine.filter(r => r.role === 'de').length) * 100)}% / ${Math.round(win('US') / Math.max(1, mine.filter(r => r.role === 'us').length) * 100)}%` : '—', `指挥德军 ${mine.filter(r => r.role === 'de').length} 局 · 美军 ${mine.filter(r => r.role === 'us').length} 局`)}
        ${cell('最长一局', longest ? longest.rounds + ' 回合' : '—', longest ? `${SCEN[longest.scen] || longest.scen} · ${longest.winner === 'DE' ? '德军胜' : '美军胜'}` : '')}
        ${cell('最惨一局', worst && ownLoss(worst) != null ? Math.round(ownLoss(worst) * 100) + '%' : '—', '本方单局最高战损')}
        ${cell('累计回合', L.rounds, '所有对局相加')}
        ${cell('累计渡河装甲', L.exits, '德军冲出马斯河的单位数')}
        ${cell('累计被歼战力', Math.round(L.killed).toLocaleString('en-US'), '双方纸面攻+防合计')}
        ${cell('记录区间', dates.length ? fmtD(dates[0]) + ' → ' + fmtD(dates[dates.length - 1]) : '—', `共 ${all.length} 场留档（上限 100）`)}
        ${cell('存储占用', (() => { try { const a = localStorage.getItem('ardennes44_achv') || '', h = localStorage.getItem('ardennes44_history') || ''; return ((a.length + h.length) / 1024).toFixed(1) + ' KB'; } catch (e) { return '—'; } })(), '独立于存档')}
      </div>
      <h2 style="margin-top:16px">按剧本</h2>${scenRows}`;
    };
    const wall = () => {
      const un = Achv.unlockedMap();
      const cats = ['全部', '参与', '胜负', '战术', '史实', '大推演'];
      const list = DATA.ACHIEVEMENTS.slice().sort((a, b) => (Achv.TIER_ORDER[b.tier] - Achv.TIER_ORDER[a.tier]) || a.id.localeCompare(b.id));
      return `<div class="ach-filter">${cats.map((c, i) => `<button data-c="${c}" class="${(achvCat === c) ? 'on' : ''}">${c}</button>`).join('')}
        <span style="margin-left:auto">点任一枚看条件与来历</span></div>
        <div class="ach-wall">${list.filter(d => achvCat === '全部' || d.cat === achvCat).map(d => {
          const got = !!un[d.id];
          return `<div class="ach-tile ${d.tier} ${got ? '' : 'locked'}" data-id="${d.id}" tabindex="0" role="button"
            aria-label="${d.name}：${got ? '已解锁' : '未解锁，' + d.cat + '类'}">
            <span class="at-t" aria-hidden="true">${TIER_CN[d.tier]}</span>
            <span class="at-ic" aria-hidden="true"></span>
            <div class="at-n">${got ? d.name : '？？？'}</div>
            <div class="at-e">${got ? d.en : d.cat}</div></div>`;
        }).join('')}</div>
        <div id="achDetail" role="region" aria-label="成就详情"></div>`;
    };
    const paint = () => {
      const p = Achv.progress();
      // 24x: 三色进度条（铜/银/金 按已解锁占比堆叠）
      const unMap = Achv.unlockedMap();
      const byTier = { bronze: [0, 0], silver: [0, 0], gold: [0, 0] };
      for (const a of DATA.ACHIEVEMENTS) { byTier[a.tier][1]++; if (unMap[a.id]) byTier[a.tier][0]++; }
      const bar = ['bronze', 'silver', 'gold'].map(t => {
        const [got, total] = byTier[t]; const w = total ? (got / total * 100) : 0;
        return '<i class="b-' + t + '" style="width:' + w + '%" title="' + TIER_CN[t] + ' ' + got + '/' + total + '"></i>';
      }).join('');
      const barHtml = '<div class="ach-bar" title="按铜/银/金分层">' + bar + '</div>';
      box.className = 'box ach-box';
      box.innerHTML = `
        <div class="ach-head"><h1>战绩</h1>
          <div class="ach-prog">勋章 ${p.got} / ${p.total}<br>${achvTierLine()}${barHtml}</div></div>
        <div class="ach-tabs">
          <button data-t="wall" class="${cur === 'wall' ? 'on' : ''}">勋章墙</button>
          <button data-t="rec" class="${cur === 'rec' ? 'on' : ''}">最近 100 场</button>
          <button data-t="stat" class="${cur === 'stat' ? 'on' : ''}">统计</button>
        </div>
        <div id="achBody">${cur === 'wall' ? wall() : cur === 'rec' ? recRows() : statRows()}</div>
        <div class="ach-foot">
          <button class="primary" id="achvClose">关 闭</button>
          <button id="achvCard">导出最近一场战绩卡</button>
          <button id="achvWipe">清空战绩与成就</button>
        </div>`;
      // 图标：解锁显色，未解锁剪影
      box.querySelectorAll('.ach-tile').forEach(tile => {
        const d = achvDef(tile.dataset.id); if (!d) return;
        tile.querySelector('.at-ic').appendChild(achvCanvas(d.icon, 40, !Achv.unlockedMap()[d.id]));
      });
      // 终局 AAR 里的"本局新解锁"图标 + 跳转
      box.querySelectorAll('.an-ic[data-icon]').forEach(sp => sp.appendChild(achvCanvas(sp.dataset.icon, 36, false)));
      const anOpen = box.querySelector('#anOpen');
      if (anOpen) anOpen.onclick = () => { SFX.play('click'); showAchvModal('wall'); };
      box.querySelectorAll('.ach-tabs button').forEach(b => b.onclick = () => { SFX.play('click'); cur = b.dataset.t; paint(); });
      box.querySelectorAll('.ach-filter button[data-c]').forEach(b => b.onclick = () => { SFX.play('click'); achvCat = b.dataset.c; paint(); });
      box.querySelectorAll('.ach-filter button[data-f]').forEach(b => b.onclick = () => { SFX.play('click'); achvFilter = b.dataset.f; paint(); });
      box.querySelectorAll('.ach-tile').forEach(t => {
        const open = () => { SFX.play('click'); showAchvDetail(t.dataset.id); };
        t.onclick = open;
        t.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };   // 键盘可达
      });
      box.querySelectorAll('.card-btn').forEach(b => b.onclick = () => {
        const rec = Achv.recent(Achv.HIST_MAX)[+b.dataset.i];
        if (rec) exportRecordCard(rec);
      });
      $('achvClose').onclick = () => { SFX.play('click'); $('modal').style.display = 'none'; };
      $('achvCard').onclick = () => { const r = Achv.recent(1)[0]; if (r) exportRecordCard(r); else showBanner('还没有战绩', '先打完一局', 1600); };
      $('achvWipe').onclick = () => {
        if (!confirm('清空全部成就与战绩记录？此操作不可撤销（当前对局不受影响）。')) return;
        Achv.reset('all'); SFX.play('warning'); paint();
      };
    };
    $('modalBox').dataset.achv = '1';
    $('modal').style.display = 'flex';
    paint();
  }
  let achvCat = '全部';
  function showAchvDetail(id) {
    const d = achvDef(id); if (!d) return;
    const got = !!Achv.unlockedMap()[id];
    const host = $('achDetail'); if (!host) return;
    host.className = 'ach-detail';
    host.innerHTML = `<div class="ad-top"><span class="ad-ic"></span><div style="flex:1">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
          <span class="ac-name">${d.name}</span><span class="ac-en">${d.en}</span>
          <span class="ac-tier ${d.tier}" style="font-family:var(--mono);font-size:9px;padding:1px 5px;border:1px solid currentColor;border-radius:2px">${TIER_CN[d.tier]} · ${d.cat}</span>
        </div>
        <div class="ad-desc">${got ? '解锁条件：' : '达成条件：'}${d.desc}</div>
        ${got ? `<div class="ad-quote">${d.quote}</div>` : `<div class="ad-hint">尚未解锁 · 提示：${d.hint}</div>`}
      </div></div>`;
    host.querySelector('.ad-ic').appendChild(achvCanvas(d.icon, 64, !got));
    host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---- 战绩卡导出（1080×1350 PNG，含像素勋章） ---- */
  function exportRecordCard(rec) {
    const W = 1080, H = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#14181d'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(216,183,74,0.35)'; c.lineWidth = 3; c.strokeRect(28, 28, W - 56, H - 56);
    const SCEN = { standard: '突出部（标准）', campaign: '阿登全战役' };
    const ROLE = { de: '德军指挥官', us: '美军指挥官', hotseat: '双人热座', watch: '观战' };
    c.fillStyle = '#78808a'; c.font = '20px Consolas, monospace';
    c.fillText('ARDENNES 1944 · AFTER ACTION', 64, 96);
    c.fillStyle = '#e8e4d8'; c.font = 'bold 54px Bahnschrift, "Microsoft YaHei", sans-serif';
    c.fillText(rec.winner === 'DE' ? '德军获胜' : rec.winner === 'US' ? '美军获胜' : '未分胜负', 64, 168);
    c.fillStyle = '#c8a94a'; c.font = '26px Consolas, monospace';
    c.fillText(`${SCEN[rec.scen] || rec.scen}${rec.noLimit ? ' · 歼灭模式' : ''} · ${ROLE[rec.role] || rec.role}`, 64, 210);
    const rows = [
      ['历时回合', rec.rounds + ' 回合'],
      ['德军战损', rec.loss && rec.loss.DE != null ? Math.round(rec.loss.DE * 100) + '%' : '—'],
      ['美军战损', rec.loss && rec.loss.US != null ? Math.round(rec.loss.US * 100) + '%' : '—'],
      ['渡河装甲', (rec.exits || 0) + ' 个'],
      ['被歼战力', Math.round(((rec.killed && rec.killed.DE) || 0) + ((rec.killed && rec.killed.US) || 0)).toLocaleString('en-US')],
      ['随机种子', rec.seed != null ? String(rec.seed) : '—'],
    ];
    let y = 300;
    c.font = '32px Consolas, monospace';
    for (const [k, v] of rows) {
      c.fillStyle = '#8f968f'; c.fillText(k, 64, y);
      c.fillStyle = '#e8e4d8'; c.fillText(v, 380, y);
      c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(64, y + 22); c.lineTo(W - 64, y + 22); c.stroke();
      y += 66;
    }
    // 本局解锁的像素勋章（最多 12 枚，4 列）
    const ids = (rec.achv || []).filter(id => achvDef(id)).slice(0, 12);
    c.fillStyle = '#c8a94a'; c.font = '24px Consolas, monospace';
    c.fillText(`本局解锁 ${ids.length} 项`, 64, y + 26);
    let ax = 64, ay = y + 60;
    for (let i = 0; i < ids.length; i++) {
      const d = achvDef(ids[i]);
      const m = Achv.pixel(d.icon, false);
      const px = 96 / 16;
      for (let r = 0; r < 16; r++) for (let cc = 0; cc < 16; cc++) {
        const col = m[r][cc]; if (!col) continue;
        c.fillStyle = col;
        c.fillRect(ax + cc * px, ay + r * px, Math.ceil(px), Math.ceil(px));
      }
      c.fillStyle = '#ddd8c8'; c.font = '18px "Microsoft YaHei", sans-serif';
      c.fillText(d.name, ax, ay + 128);
      ax += 240;
      if ((i + 1) % 4 === 0) { ax = 64; ay += 168; }
    }
    c.fillStyle = '#6f766f'; c.font = '20px Consolas, monospace';
    const d0 = new Date(rec.t);
    const p = n => String(n).padStart(2, '0');
    c.fillText(`${d0.getFullYear()}-${p(d0.getMonth() + 1)}-${p(d0.getDate())} ${p(d0.getHours())}:${p(d0.getMinutes())} · 阿登 1944 兵棋推演`, 64, H - 72);
    try {
      const a = document.createElement('a');
      a.download = `ardennes44_战绩卡_${d0.getFullYear()}${p(d0.getMonth() + 1)}${p(d0.getDate())}_${p(d0.getHours())}${p(d0.getMinutes())}.png`;
      a.href = cv.toDataURL('image/png');
      a.click();
      showBanner('战绩卡已导出', 'PNG 1080×1350 · 已存到下载目录', 2200);
    } catch (e) { showBanner('导出失败', '浏览器拒绝保存（' + e.message + '）', 2400); }
  }

  function showRulesModal() {
    const box = $('modalBox');
    box.className = 'box';
    box.innerHTML = `
      <h1>规则速览</h1>
      <div class="rules">
        <b>回合</b>：每回合=1天。每方阶段内每单位可移动一次、攻击一次。德军先手。<br>
        <b>移动</b>：按地形消耗移动力（公路1/平原1/丘陵森林2/山地3）。进入敌军控制区(ZOC)必须停止，装甲部队豁免。每格限1个单位。<br>
        <b>装甲防护</b>：装甲目标（装甲营/装甲掷弹兵团/侦察营）遭<b>毫无反装甲火力</b>的一次攻击时，受损大幅减免（伤害×0.25，下限 1），结果表上的"守方被击破"也只能把它逐退而打不垮。具备反装甲火力者：装甲类、坦克歼击营、<b>炮兵</b>、配属了反坦克小组的步兵——只要有一个参战，就按正常伤害结算。<br>
        <b>战斗</b>：相邻攻击。攻防之比查CRT掷2d6：AE攻歼/AR攻退/EX互损/DR守退/DE守歼。每次进攻最多3个地面单位+2个炮兵支援（攻击正面限制）。渡河攻击降一档；纯装甲冲击步兵升一档；第1回合德军奇袭升一档。结算弹窗会按<b>攻方 / 守方</b>分开列出本次实扣的<b>组织度</b>与各自被歼灭的建制数。<br>
        <b>被动状态</b>：由棋盘态势<b>自动判定、不消耗支援令牌</b>，算进攻防时自动生效（算子面左下角、单位面板、战力比弹窗与兵力一览均有标记）。所在格周围一圈（6 个邻格）有 <b>≥2 个友军</b> → <b>协同作战</b>（攻防 ×1.10）；若陷入<b>被围</b>（周围无友军、相邻敌军 ≥3）则按军心判定——建制完整（组织度高）多为 <b>困兽犹斗</b>（攻防 ×1.15），残破（组织度低）多为 <b>无心再战</b>（攻防 ×0.60）。三者互斥。<br>
        <b>城镇</b>：主城防御×2.2，小镇×1.7。占领即翻控制权。<br>
        <b>炮兵</b>：可3-4格内远程轰击（不受反击），或支援友邻进攻（美+7/德+5）。美军射程4/德军3；雾天射程-1。<br>
        <b>支援资产</b>：每方每回合获得令牌（选中单位后在左侧面板发放，算子角标 反/工/补/急/空）：反坦克小组×2（巴祖卡/铁拳——配属步兵，反装甲防御，首次遭纯装甲攻击战力比再降一档并消耗）、野战救护所×1（恢复4点组织度）、炮火急袭×1（该单位下次攻击+4，本阶段内有效）、补充兵员×1（满编单位组织上限+2）、野战工事×1（防御×1.25）、<b>防空火力×2</b>（德：88毫米高炮群 / 美：博福斯40毫米——该单位遭空袭时 50% 概率使本次空袭伤害减半）。<b>工兵营自带筑垒能力</b>：选中工兵营点"筑垒"即可就地构筑野战工事，<b>不消耗本方令牌</b>（每单位限一次）。<br>
        <b>补给</b>：处于指挥部(半径7)或己方补给点(半径7)内。<b>城市补给随占领翻转</b>：任何单位进入敌方城镇（移动/攻击推进/撤退落点），该城控制权即转占领方并<b>立刻为占领方单位提供补给</b>；原占有方失去此补给源，其失供在下个己方阶段结算（仍有 2 回合宽限）。夺回即翻回。<b>断补有宽限期</b>：被切断后的前 2 个回合完全不受影响；第 3 回合起——步兵类（步兵/伞兵/国民掷弹兵团）攻防小幅降低（×0.85），<b>其他兵种（装甲/炮兵/工兵等）攻防减半（×0.5）</b>，同时组织度每阶段 -1、移动力减半；空降兵豁免全部损耗。恢复补给后一切立即恢复正常。<br>
        <b>组织度</b>：部队血量，攻防随比例缩水。有补给每回合+2（城镇+3），归零歼灭。<br>
        <b>指挥部</b>：每军、每集团军及美/德总指挥部各一座（组织度 军10/集团军15/总部20，攻防同步兵营），位于所辖部队后方并作为补给源。<b>被摧毁冲击</b>：军部被毁→该军全部单位组织度与攻防各-2；集团军司令部被毁→该集团军-3；总指挥部被毁→本国籍全军-4（扣减下限1，不致死、一次性，后续增援不受影响）。<br>
        <b>燃料</b>：德军全局燃料池，每参战装甲师每回合扣1。耗尽装甲-3移动。夺取斯塔沃洛/斯帕油库+燃料。<br>
        <b>天气</b>：雾=无空军炮兵-1；雪=装甲摩托化-1移动；晴=空中支援可用（12/23起常见）。<br>
        <b>空袭</b>：目标须在任意己方单位 10 格内。美军晴天每回合 2 次；<b>德军自 12/24 起晴天每回合 1 次</b>（史实：阿登最初一周大雾，双方航空兵停飞），<b>1945年1月1日"底板行动"一次性 3 次、不受天气限制</b>（史实：德军约900架倾巢空袭盟军机场，自身损失惨重）。德军单次打击力弱于美军（4/2 vs 5/3）。配属<b>防空火力</b>的单位遭空袭时有 50% 概率压制来袭，伤害减半。<br>
        <b>胜负</b>：德军——12回合内渡马斯河装甲≥6(决定性)，或夺圣维特+巴斯托涅(第10回合末即胜)，或两者夺其一+渡河即战术胜利。美军——守住即胜。全战役第13回合起美军反攻，24回合末按三枢纽归属判定。<br>
        <b>操作</b>：左键点选→蓝格移动/红格攻击；炮兵选"炮击模式"；己方空袭令牌>0 时可"呼叫空袭"；顶栏<b>兵力一览</b>可查看当前在场的双方部队（按攻击+防御之和排序），点击其中一行即在地图上定位该部队。<br>
        <b>音效</b>：行军、交火、炮击、空袭、掷骰、占领、阶段交接、增援、补给等均有对应音效；顶栏<b>音效 开/关</b>按钮可随时静音。<br>
      </div>
      <div class="changelog">
        <b>兵种特性（2026-10-24 新增）</b>
        <ul id="traitRules">
          <li><b>空降自持</b>（空降兵团/伞兵团）：永不受断补影响。</li>
          <li><b>装甲防护</b>（装甲营）：无反装甲火力的单位攻击装甲营，伤害×0.25（装甲掷弹兵/侦察营不再享有）。</li>
          <li><b>公路疾驰</b>（装甲掷弹兵/装甲步兵）：沿公路机动时移动消耗减半。</li>
          <li><b>长驱直入</b>（侦察营）：移动力为普通步兵团的三倍。</li>
          <li><b>通信枢纽</b>（通信营）：自身永不断补，并作为机动补给源向周围3格内友军提供补给。</li>
          <li><b>覆盖齐射</b>（火箭炮营）：射程2-4（相邻为发射盲区，不受雾影响）；齐射溅射——目标相邻的敌军受目标所受伤害的一半。</li>
          <li><b>就地筑垒</b>（工兵营）：每5回合可在所在格修筑工事（该格防御×1.15，工事留在格上）；工兵进攻工事内敌人时无视此加成。</li>
          <li><b>装甲猎手</b>（坦克歼击营）：攻击装甲类目标时伤害×1.5。</li>
          <li><b>气象制约</b>（炮兵营）：雾天射程-1。</li>
          <li><b>乡土卫戍</b>（国民掷弹兵团）：在己方城镇格内受击伤害减半；攻击己方城镇2格内的敌人时伤害+1。</li>
          <li><b>游击奔袭</b>（伞兵/猎兵类，预留）：机动→攻击→可再机动一次（本作德军伞兵编制归入伞降师，暂以「空降自持」呈现；若未来加入独立猎兵单位将启用）。</li>
        </ul>
      </div>
      <div class="changelog">
        <b>规则更新记录（近期重大变动）</b>
        <ul>
          <li><b>音效系统</b>（新增）：程序化合成（Web Audio，无外部音频文件）——行军（步兵/装甲/炮兵/侦察各不同音色）、交火（步枪-机枪/坦克炮/混合）、远程炮击、空袭、掷骰、战果、歼灭、占领（钟声）、阶段交接（德军/美军电台报话）、增援车队、补给、断补、冲出马斯河、天气、终局号角等；顶栏<b>音效 开/关</b>按钮可随时静音（状态记忆）。音效纯属表现层，不影响任何结算。</li>
          <li><b>被动状态</b>（新增）：协同作战 / 困兽犹斗 / 无心再战，由棋盘态势自动判定、不消耗支援令牌（详见上方"被动状态"）。</li>
          <li><b>德军空袭</b>（新增）：按史实自 12/24 起晴天每回合 1 击，<b>1945/1/1"底板行动"一次性 3 击</b>（不受天气限制）；同批新增 <b>防空火力</b> 支援资产（遭空袭时 50% 概率使伤害减半）。</li>
          <li><b>史实日历修正</b>：回合→日期改按史实锚点表（第 16 回合 = 1945-01-01），使顶栏日期、战役注记与剧本副标题一致。</li>
          <li><b>断补详细设定</b>：被切断后<b>宽限期 2 回合完全无惩罚</b>；第 3 回合起步兵攻防 ×0.85、其他兵种 ×0.5，另每回合组织度 -1、移动力减半；空降兵豁免（巴斯托涅）。</li>
          <li><b>装甲防护 + 工兵自带筑垒</b>：装甲目标遭<b>毫无反装甲火力</b>的攻击时受害 ×0.25（下限 1，仍会被逐退）；工兵营可免令牌就地构筑野战工事。</li>
          <li><b>兵力一览</b>：顶栏可查看当前在场的双方部队（按攻+防之和排序、可分阵营筛选），点击任意一行即在地图上定位。</li>
          <li><b>德军 AI 更积极</b>：集中兵力打高价值目标、从防线缺口渗透——首次能攻下要点城镇（圣维特）。</li>
          <li><b>援军部队档案</b>：主要史实增援入场时弹出档案卡——史实老照片 + 番号/编成/战史简介（照片加载失败会自动回退为档案插图）。</li>
          <li><b>结算战损拆分</b>：交火结算弹窗与战报现在<b>按攻方 / 守方分别</b>显示本次实扣的组织度、以及各方被歼灭的建制数（此前只显示掷骰与结果）。</li>
          <li><b>终局战损明细</b>：全役结束后的结算画面升级为明细表——双方的组织度损失<b>绝对值与损失率</b>、被歼建制、在场组织度，并把损失拆成<b>进攻时 / 防守时 / 其他损耗（断补·炮击·空袭）</b>三档，各带占该方总损失的百分比。</li>
          <li><b>被歼战力合计</b>：除组织度损失外，终局明细另列出<b>被歼灭单位的攻击力 / 防御力合计</b>（按纸面数值累加，独立于组织度），并单列其中<b>叠有增益</b>（主动配属 / 炮火急袭，或 被动状态）的建制数与战力和；另给出终局仍存活单位中持有<b>主动增益 / 被动状态</b>的数量。</li>
          <li><b>战报可折叠</b>：战报面板标题栏新增折叠按钮（快捷键 <b>L</b>，或直接点标题栏）——收起后只留一条标题栏、把地图让出来；折叠期间新到的战报会以<b>未读计数</b>提示，点开后自动跳到最新一条；折叠 / 展开的选择会被记住。</li>
          <li><b>终局胜利画面</b>：全役结束、一方获胜时，结算画面顶部展示<b>历史照片 + 鼓舞话语</b>——按<b>阵营</b>（德 / 美）与<b>胜利程度</b>（决定性 / 战术·胜利 / 惨胜）分别配图配文，六组各不重复；照片同样是史实公有领域老照片，加载失败时回退为档案插图。</li>
          <li><b>开局指挥官简报</b>：进入对局时以<b>当时指挥官</b>（德：莫德尔陆军元帅 / 美：布莱德雷中将）的口吻、按<b>史实</b>分几段对话交代局势与你的胜利目标，附史实肖像（德美双方都有）；可逐段阅读或跳过。双人热座与 AI 观摩会先读德方、再读美方；简报期间 AI 不会先动。</li>
        </ul>
      </div>
      <div class="foot"><button class="primary" id="mBack">返 回</button></div>`;
    SFX.play('page');                         // 展开规则手册：翻页声
    $('modal').style.display = 'flex';
    box.querySelector('#mBack').onclick = () => { $('modal').style.display = 'none'; };
  }

  function showOverModal() {
    const st = game.state;
    const win = st.winner === 'DE';
    const box = $('modalBox');
    box.className = 'box aar-box';
    /* ---- 终局战损明细（第十三轮）：组织度实扣 + 进攻/防守/其他 拆分 ---- */
    const num = n => Math.round(n || 0).toLocaleString('en-US');
    const col = { DE: '#b8c4b0', US: '#a8c8e8' };
    const row = (k, fn, cls) =>
      `<div class="lt-row${cls ? ' ' + cls : ''}"><span class="lt-k">${k}</span>` +
      `<span class="lt-v" style="color:${col.DE}">${fn('DE')}</span>` +
      `<span class="lt-v" style="color:${col.US}">${fn('US')}</span></div>`;
    const L = s => game._loss(s);
    const total = s => L(s).total;
    // 被歼战力（第十四轮）：纸面 atk/def 合计，独立于组织度
    const P = s => game._lossPow(s);
    const B = s => game._buffHold(s);
    // 终局胜利画面（第十六轮）：按 阵营 × 胜利程度 取历史照片 + 鼓舞话语
    const V = (DATA.VICTORY && DATA.VICTORY[st.victoryKey]) || (DATA.VICTORY || {})[win ? 'DE_hold' : 'US_win'] || null;
    const hero = V ? `
      <div class="vict-hero ${win ? 'de' : 'us'}">
        <div class="vh-photo">
          <img class="ds-img vh-img" src="${photoUrl(V.photo)}" alt="${V.photoCaption || V.title}" referrerpolicy="no-referrer">
          <div class="ds-fallback vh-fallback" hidden>
            <div class="ds-fb-name">${V.title}</div>
            <div class="ds-fb-type">${win ? '德军' : '美军'} · ${V.degree || ''}</div>
            <div class="ds-fb-note">档案插图 · 非真实照片</div>
          </div>
          <div class="ds-cap">${V.photoCaption || ''}</div>
        </div>
        <div class="vh-body">
          <div class="vh-degree">${win ? '德军' : '美军'} · ${V.degree || '胜利'}</div>
          <div class="vh-title">${V.title || ''}</div>
          <div class="vh-cheer">${V.cheer || ''}</div>
          <div class="vh-credit">照片：维基共享资源 · 公有领域（PD）｜ 加载失败时显示档案插图</div>
        </div>
      </div>` : '';
    // 子项：绝对值 + 占该方总损失的百分比
    const sub = (k, pick) => row(k, s => {
      const v = pick(s), t = total(s);
      return `${num(v)} <span class="lt-p">${t ? Math.round(v / t * 100) : 0}%</span>`;
    }, 'lt-sub');
    box.innerHTML = `
      <div class="ov-kicker">After Action Report · 战役总结</div>
      <h1 class="ov-result ${win ? 'de' : 'us'}">${win ? '德军获胜' : '美军获胜'}</h1>
      ${hero}
      <div class="ov-end">${st.endText}</div>
      <div class="ov-stats">
        <div class="os"><div class="os-k">历时回合</div><div class="os-v">${st.round}</div></div>
        <div class="os"><div class="os-k">渡河装甲</div><div class="os-v">${st.exits}</div></div>
        <div class="os"><div class="os-k">全役被歼</div><div class="os-v">${game._killed('DE') + game._killed('US')}</div></div>
      </div>
      <div class="lossTable">
        <div class="lt-head"><span></span><span>德军</span><span>美军</span></div>
        ${row('组织度损失（实扣）', s => num(total(s)), 'lt-hi')}
        ${row('总组织度', s => num(game._orgPool(s)))}
        ${row('损失率', s => Math.round(game._lossRealPct(s) * 100) + '%', 'lt-hi')}
        ${sub('· 进攻时损失', s => L(s).atk)}
        ${sub('· 防守时损失', s => L(s).def)}
        ${sub('· 其他损耗', s => L(s).other)}
        ${row('在场组织度', s => num(game._strength(s)))}
        <div class="lt-sec">被歼单位战力合计（独立于组织度，按纸面数值）</div>
        ${row('被歼建制', s => game._killed(s) + ' 个')}
        ${row('被歼·攻击力合计', s => num(P(s).atk), 'lt-hi')}
        ${row('被歼·防御力合计', s => num(P(s).def), 'lt-hi')}
        ${row('· 其中叠增益', s => P(s).bn + ' 个', 'lt-sub')}
        ${row('· 叠增益攻/防', s => `${num(P(s).batk)} / ${num(P(s).bdef)}`, 'lt-sub')}
        ${row('在场·持主动增益', s => B(s).act + ' 个')}
        ${row('在场·持被动状态', s => B(s).pas + ' 个')}
      </div>
      <details class="ov-note">
        <summary>数据口径说明 · NOTES</summary>
        <div class="lossNote">
        损失率 = 累计实扣组织度 ÷（初始在场组织度 + 全部增援满编组织度）。每回合整补会回复组织度，
        故该比值可超过 100%，表示全战役的<b>累计损耗强度</b>。「进攻时损失」= 以进攻方身份在战斗结算中掉的组织度，
        「防守时损失」= 以防守方身份掉的，「其他损耗」含断补衰减、远程炮击与空袭。<br>
        <b>被歼单位战力</b>按单位<b>纸面攻/防</b>累加（不随组织度打折），故与上方组织度损失相互独立、可交叉对照：
        组织度看的是"血流了多少"，战力看的是"拳头掉了多重"。「其中叠增益」= 被歼时身上带有
        <b>主动增益</b>（反坦克小组 / 野战工事 / 补充兵 / 防空火力 / 炮火急袭）或<b>被动状态</b>（协同作战 / 困兽犹斗 / 无心再战）的建制数与战力和。
        「在场·持…」统计的是终局仍存活单位中当前持有增益/被动状态的数量。渡河退出不计入被歼。
        </div>
      </details>
      ${achvLastNew.length ? `<div class="ach-new"><div class="an-k">本局新解锁 · ${achvLastNew.length} 项</div>${achvLastNew.map(id => {
        const d = achvDef(id) || { name: id, en: '', quote: '', icon: 'ribbon', tier: 'bronze' };
        return `<div class="an-row"><span class="an-ic" data-icon="${d.icon}"></span><div><div class="an-n">${d.name} <span class="ac-en">${d.en}</span></div><div class="an-q">${d.quote}</div></div></div>`;
      }).join('')}<div class="an-row" style="margin-top:10px"><button class="primary" id="anOpen" style="font-family:var(--mono);font-size:11px;padding:7px 12px;border:1px solid var(--brass);background:var(--brass);color:#12161a;border-radius:2px;cursor:pointer">查看勋章墙</button></div></div>` : ''}
      <div class="foot">
        <button id="mAgain" class="primary">再来一局</button>
      </div>`;
    $('modal').style.display = 'flex';
    // 终局历史照片加载失败 → 回退到程序化"档案插图"
    {
      const vimg = box.querySelector('.vh-img'), vfb = box.querySelector('.vh-fallback');
      if (vimg && vfb) {
        bindPhoto(vimg, vfb, V.photo);   // 24g: 缩略图+占位+淡入
      }
    }
    box.querySelector('#mAgain').onclick = () => {
      $('modal').style.display = 'none';
      showStartModal(false);
    };
  }

  /* ---------------- 开局 ---------------- */
  function startGame(scenarioId, saved, opts) {
    gameNo++;
    setTimeout(warmPhotos, 800);   // 24g: 场景数据已切换, 预热本剧本的档案照片
    animQueue = Promise.resolve();
    aiBusy = false;
    // 大推演数据切换(2026-10-11): 引擎各模块对 DATA 均为运行时查找,
    // 按剧本把 globalThis.DATA 指向大推演数据集; 读档同样按存档剧本切换。
    // 注意: DATA_BASE 仅在 data_big.js 中定义(大推演成品才有);
    // 原版成品(11 脚本)无此文件, DATA 从未被切换, 保持原指即可。
    if (scenarioId === 'big' && globalThis.DATA_BIG) globalThis.DATA = globalThis.DATA_BIG;
    else if (globalThis.DATA_BASE) globalThis.DATA = globalThis.DATA_BASE;
    // 重置援军档案状态(新开一局/读档都清空)
    reinBuf = []; if (reinTimer) { clearTimeout(reinTimer); reinTimer = 0; }
    dossierQueue = []; dossierShown = new Set(); dossierOpen = false;
    game = new Game(scenarioId, undefined, saved, opts);
    window.__game = game;
    // 24v: 成就与战绩挂载（读档时 achvRole 为 null → 沿用存档里的 achvTrack.meta）
    achvLastNew = [];
    if (typeof Achv !== 'undefined') {
      try { Achv.attach(game, achvRole ? achvMeta() : null); } catch (e) { console.error('成就挂载失败', e); }
    }
    renderer.buildWorld(game.map, game);
    renderer.syncUnits(game);
    renderer.setWeather(game.state.weather);
    // 开局取景: 以双方开局算子重心为中心(前线的密集区), 而不是地图几何中心——扩图后西侧马斯河一线开局是空的
    {
      const us0 = game.units.filter(u => u.alive && !u.arrive);
      const cx = us0.reduce((s, u) => s + u.c, 0) / Math.max(1, us0.length);
      const cz = us0.reduce((s, u) => s + u.r, 0) / Math.max(1, us0.length);
      // 窄屏: 仍以开局重心取景, 但视距按屏幕高度折算(竖屏 844px / 横屏 390px 差一倍多,
      // 固定视距会让横屏算子缩到十几像素点不中); ⤢ 按钮可随时切到全图
      renderer.focusOn(Math.round(cx), Math.round(cz));
      if (window.matchMedia && window.matchMedia('(max-width: 860px)').matches) renderer.setDistForScale(14);
      else renderer.focusOn(Math.round(cx), Math.round(cz), Math.round(game.map.cols * 1.95));
    }
    $('logList').innerHTML = '';
    for (const e of game.logEntries) $('logList').appendChild(logHtml(e));
    logUnread = 0; renderLogToggle();   // 新开一局/读档：未读清零，沿用玩家上次的折叠选择
    bindGameEvents._bound = false;
    // 重新绑定事件(新game实例)
    bindGameEvents2();
    refreshTop(); refreshUnitPanel();
    showBanner(game.scenario.name, game.noTurnLimit ? `歼灭模式 · 无回合限制 · ${game.scenario.sub}` : game.scenario.sub, 2200);
    setTimeout(() => {
      if (!game || game.state.over || briefingOpen) return;
      maybeAI();
      showBanner(game.state.phase === 'DE' ? '德军阶段' : '美军阶段', `第${game.state.round}回合 · ${game._dateStr()}`);
    }, 800);
  }

  let boundGame = null;
  function bindGameEvents2() {
    if (boundGame === game) return;
    boundGame = game;
    bindGameEvents();
  }

  /* ---------------- 初始化 ---------------- */
  function init(rendererRef) {
    renderer = rendererRef;
    renderer.onHexClick = onHexClick;
    renderer.onHexHover = onHexHover;
    $('btnEnd').onclick = () => { if (!aiBusy && game && !game.state.over) { exitAdvance(); game.endPhase(); } };
    $('btnAIde').onclick = () => { SFX.play('click'); aiDE = !aiDE; $('btnAIde').classList.toggle('active', aiDE); maybeAI(); };
    $('btnAIus').onclick = () => { SFX.play('click'); aiUS = !aiUS; $('btnAIus').classList.toggle('active', aiUS); maybeAI(); };
    $('btnOOB').onclick = showUnitsModal;
    const bd = document.getElementById('btnDossiers');
    if (bd) bd.onclick = () => { SFX.play('page'); showDossierArchive(); };
    // 24p: 增援档案弹卡开关（记忆偏好）；运行中关闭=清空待弹队列并收起当前卡
    const bp = document.getElementById('btnDosPop');
    if (bp) bp.onclick = () => {
      dosPop = !dosPop;
      try { localStorage.setItem('ardennes44_dospop', dosPop ? '1' : '0'); } catch (e) { /* ignore */ }
      renderDosPopBtn(); SFX.play('click');
      if (!dosPop && dossierOpen) { dossierQueue = []; $('modal').style.display = 'none'; dossierOpen = false; maybeAI(); }
    };
    renderDosPopBtn();
    const _ba = document.getElementById('btnAchv');
    if (_ba) _ba.onclick = () => { SFX.play('click'); showAchvModal('wall'); };   // 24v 战绩
    $('btnRules').onclick = showRulesModal;
    $('btnRestart').onclick = () => { SFX.play('click'); showStartModal(!!localStorage.getItem('ardennes44_save')); };
    $('btnLogToggle').onclick = () => { SFX.play('click'); toggleLogPanel(); };
    // 音效开关（2026-10 第二十二轮）：状态写入 localStorage，关闭时按钮变暗且文字改为「音效 关」
    $('btnSfx').onclick = () => { SFX.init(); const m = SFX.toggle(); renderSfxBtn(); if (!m) SFX.play('click'); };
    renderSfxBtn();
    // AI 速度三档(原版39轮移植): 点击循环切换, 记忆偏好
    const _bs = document.getElementById('btnAISpeed');
    if (_bs) _bs.onclick = () => { aiSpeed = (aiSpeed + 1) % AI_SPEEDS.length; try { localStorage.setItem('ardennes44_aispeed', aiSpeedCfg().key); } catch (e) {} renderAiSpeedBtn(); SFX.play('click'); };
    renderAiSpeedBtn();
    /* 24g: 后台预热全部史实照片(档案/简报/胜利), 用到时已在缓存 */
    setTimeout(warmPhotos, 2000);
    /* ---- 窄屏菜单（第二十九轮）：顶栏按钮收入 #topBtns 下拉，由 ☰ 开合 ---- */
    {
      const bar = $('topbar'), menu = $('btnMenu'), box = $('topBtns');
      const close = () => bar.classList.remove('open');
      if (menu && box) {
        menu.onclick = e => { e.stopPropagation(); SFX.play('click'); bar.classList.toggle('open'); };
        box.addEventListener('click', e => { if (e.target.tagName === 'BUTTON') close(); });
        renderer.renderer.domElement.addEventListener('pointerdown', close);
        window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
      }
      // 相机控制条：触屏没有滚轮，＋/－/全图 三个按钮是缩放功能的兜底入口
      const ctl = [['btnZoomIn', 0.82], ['btnZoomOut', 1.22]];
      for (const [id, f] of ctl) { const b = $(id); if (b) b.onclick = () => { SFX.play('click'); renderer.zoomBy(f); }; }
      if ($('btnFit')) $('btnFit').onclick = () => { SFX.play('click'); renderer.fitView(); };
    }
    // 快捷键 L：折叠 / 展开战报（相机平移用 w/a/s/d，互不冲突）
    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); toggleLogPanel(); }
    });
    renderLogToggle();
    refreshHint();
  }

  /* ---------------- 音效（2026-10 第二十二轮） ----------------
   * SFX 是纯表现层（见 js/audio.js 头部注释）：不读游戏状态、不消耗 game.rng。
   * 这里只做"游戏事件 → 音效名"的映射；全部调用都容错（SFX 内部 try/catch，未 init 时是空操作）。
   */
  function renderSfxBtn() {
    const b = $('btnSfx');
    if (!b) return;
    const m = SFX.isMuted();
    b.textContent = m ? '音效 关' : '音效 开';
    b.classList.toggle('off', m);
    b.setAttribute('aria-pressed', m ? 'false' : 'true');
  }
  function renderDosPopBtn() {   // 24p: 与音效开关同一形态（关=变暗+文字「档案卡 关」）
    const b = document.getElementById('btnDosPop');
    if (!b) return;
    b.textContent = dosPop ? '档案卡 开' : '档案卡 关';
    b.classList.toggle('off', !dosPop);
    b.setAttribute('aria-pressed', dosPop ? 'true' : 'false');
  }
  function sfxMoveKind(u) {
    if (!u) return 'foot';
    if (DATA.TYPES[u.type].armor) return 'armor';
    if (u.type === 'ART' || u.type === 'RKT') return 'arty';
    if (u.type === 'RECON') return 'recon';
    return 'foot';
  }
  // 交火音色：按参战兵种选（纯装甲/混合/纯步兵），空袭与远程炮击各有专属音
  function sfxCombat(d) {
    if (d.air) { SFX.play('air'); return; }
    if (d.ranged && !(d.attUnits && d.attUnits.length)) { SFX.play('arty'); return; }
    const atts = d.attUnits || [];
    const hasArmor = atts.some(u => DATA.TYPES[u.type].armor);
    const hasFoot = atts.some(u => !DATA.TYPES[u.type].armor);
    SFX.play('attack', { kind: hasArmor && hasFoot ? 'mixed' : hasArmor ? 'tank' : 'small' });
    if (d.artyUnits && d.artyUnits.length) SFX.play('arty');   // 支援炮兵：远处炮声叠加
  }
  // 战报文案 → 音效（占领城镇/夺油库/冲出马斯河/断补）
  function sfxLog(e) {
    const t = (e && e.text) || '';
    if (t.indexOf('占领') >= 0) SFX.play('capture');
    else if (t.indexOf('夺取') >= 0) SFX.play('capture');
    else if (t.indexOf('冲出马斯河') >= 0) SFX.play('exit');
    else if (t.indexOf('断补') >= 0) SFX.play('unsupply');
  }

  function hasSave() {
    try { return !!localStorage.getItem('ardennes44_save'); } catch (e) { return false; }
  }

  return { init, showStartModal, hasSave };
})();
