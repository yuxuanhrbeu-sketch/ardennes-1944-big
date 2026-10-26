'use strict';
/* QA 用 setup 表达式（浏览器内）：
   1) 单帧渲染成本 + rAF 帧间隔（交互流畅度）
   2) 真实推进一整回合（双方 AI 阶段，与 ui.maybeAI 同款调度），
      分别测量 planTurn 阻塞、动作执行、以及所有挂在 'state' 事件上的 UI 开销。
   由 tools/shot.js 通过 Runtime.evaluate 注入（awaitPromise）。*/
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const g = window.__game, r = window.__renderer;
  if (!g || !r) return 'no game/renderer';
  const out = {};

  /* ---- 1) 渲染成本 ---- */
  const renderMS = n => { const t0 = performance.now(); for (let i = 0; i < n; i++) r.renderer.render(r.scene, r.camera); return (performance.now() - t0) / n; };
  r.renderer.render(r.scene, r.camera);
  out.renderMs = +renderMS(12).toFixed(2);
  out.drawCalls = r.renderer.info.render.calls;
  out.triangles = r.renderer.info.render.triangles;
  out.sceneChildren = r.scene.children.length;
  out.unitsNow = g.units.filter(u => u.alive && !u.exited).length;

  /* ---- 2) rAF 帧间隔 ---- */
  const gaps = [];
  await new Promise(res => {
    let last = performance.now(), n = 0;
    const tick = () => { const now = performance.now(); gaps.push(now - last); last = now; if (++n < 120) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  gaps.sort((a, b) => a - b);
  out.rafP50 = +gaps[Math.floor(gaps.length * 0.5)].toFixed(1);
  out.rafP95 = +gaps[Math.floor(gaps.length * 0.95)].toFixed(1);
  out.rafMax = +gaps[gaps.length - 1].toFixed(1);

  /* ---- 3) 一整回合（两方 AI 阶段），含 UI state 事件真实开销 ---- */
  const find = id => g.units.find(x => x.uid === id);
  const execAction = (side, a) => {
    if (a.t === 'move') {
      const u = find(a.uid);
      if (u && u.alive && u.side === side && !u.moved) g.doMove(u, a.path);
    } else if (a.t === 'attack') {
      const t = find(a.target);
      if (!t || !t.alive) return;
      const atts = a.uids.map(find).filter(u => u && u.alive && u.side === side && !u.attacked && u.type !== 'ART' && Hex.distance(u.c, u.r, t.c, t.r) === 1);
      if (!atts.length) return;
      const arty = (a.arty || []).map(find).filter(x => x && x.alive && !x.fired && !x.moved && x.type === 'ART');
      g.doAttack(atts, t, arty);
    } else if (a.t === 'arty') {
      const u = find(a.uid), t = find(a.target);
      if (u && t && u.alive) g.artyFire(u, t);
    } else if (a.t === 'air') {
      const t = find(a.target); if (t) g.airStrike(t, side);
    }
  };
  const dynamicPass = side => {
    const built = new Set();
    const steps = [];
    for (const e of g.units.filter(x => x.alive && !x.exited && x.side !== side)) {
      const atts = g.attackersFor(e).filter(u => !built.has(u.uid) && u.fireSupport >= 0);
      if (!atts.length) continue;
      const arty = g.artyInRange(e).filter(a => !built.has(a.uid)).slice(0, 2);
      const pv = g.previewAttack(atts.slice(0, 3), e, arty);
      if (!pv.key) continue;
      for (const u of atts.slice(0, 3)) built.add(u.uid);
      for (const a of arty) built.add(a.uid);
      steps.push({ atts: atts.slice(0, 3), e, arty });
    }
    for (const s of steps) {
      if (g.state.over) break;
      const atts = s.atts.filter(u => u.alive && !u.attacked && Hex.distance(u.c, u.r, s.e.c, s.e.r) === 1);
      if (atts.length) g.doAttack(atts, s.e, s.arty.filter(a => a.alive && !a.fired));
    }
  };

  // syncUnits / refreshUnit 是增援与每次 state 里的渲染侧开销：包起来统计
  const syncProbe = { syncN: 0, syncMs: 0, syncMax: 0, refreshN: 0, refreshMs: 0, texN: 0 };
  const origSync = r.syncUnits.bind(r);
  r.syncUnits = function () { const t = performance.now(); try { return origSync.apply(r, arguments); } finally { const d = performance.now() - t; syncProbe.syncN++; syncProbe.syncMs += d; if (d > syncProbe.syncMax) syncProbe.syncMax = d; } };
  const origRefresh = r.refreshUnit.bind(r);
  r.refreshUnit = function (u) { const t = performance.now(); try { return origRefresh.apply(r, arguments); } finally { const d = performance.now() - t; syncProbe.refreshN++; syncProbe.refreshMs += d; } };
  const origTex = r.unitCounterTexture.bind(r);
  r.unitCounterTexture = function (u) { syncProbe.texN++; return origTex.apply(r, arguments); };

  const phases = [];
  for (let k = 0; k < 2 && !g.state.over; k++) {
    const side = g.state.phase;
    let stN = 0, stMs = 0, stMax = 0;
    const t0 = performance.now();
    const acts = AI.planTurn(g, side);
    const planMs = performance.now() - t0;
    const t1 = performance.now();
    const origEmit = g.emit.bind(g);
    g.emit = function (type) {
      if (type !== 'state') return origEmit.apply(g, arguments);
      const s = performance.now();
      const rv = origEmit.apply(g, arguments);
      const d = performance.now() - s; stN++; stMs += d; if (d > stMax) stMax = d;
      return rv;
    };
    for (const a of acts) { if (g.state.over) break; execAction(side, a); }
    const execMs = performance.now() - t1;
    const t2 = performance.now();
    dynamicPass(side);
    const dynMs = performance.now() - t2;
    g.emit = origEmit;
    const t3 = performance.now();
    g.endPhase();                      // 内部会 emit 'state'
    const endMs = performance.now() - t3;
    phases.push({
      side, acts: acts.length, planMs: Math.round(planMs), execMs: Math.round(execMs),
      dynMs: Math.round(dynMs), endMs: Math.round(endMs),
      stateEvents: stN, stateTotalMs: Math.round(stMs), stateMaxMs: +stMax.toFixed(1)
    });
    if (g.state.over) break;
    await sleep(50);
  }
  out.phases = phases;
  out.round = g.state.round;
  out.unitsAfter = g.units.filter(u => u.alive && !u.exited).length;
  out.renderAfterMs = +renderMS(12).toFixed(2);
  out.drawCallsAfter = r.renderer.info.render.calls;
  out.trianglesAfter = r.renderer.info.render.triangles;
  out.syncUnitsCalls = syncProbe.syncN;
  out.syncUnitsTotalMs = Math.round(syncProbe.syncMs);
  out.syncUnitsMaxMs = +syncProbe.syncMax.toFixed(1);
  out.refreshUnitCalls = syncProbe.refreshN;
  out.refreshUnitTotalMs = Math.round(syncProbe.refreshMs);
  out.counterTextureBuilds = syncProbe.texN;

  /* ---- 4) 构造峰值棋盘（全部增援入场），测峰值渲染成本 ----
     不走 _startPhase：它会触发 'phase' 事件把 UI 的 AI 调度叫起来，污染测量。
     直接按 OOB 把尚未入场的营补进棋盘，再做一次补给刷新即可。 */
  const t4 = performance.now();
  g.units.forEach(u => { u.arrive = 0; });
  g.state.round = 41;
  let added = 0;
  for (const [rows, side] of [[DATA.OOB_DE, 'DE'], [DATA.OOB_US, 'US']]) {
    for (const row of rows) {
      if (row[9] <= 0) continue;
      if (g.units.some(u => u.id === row[0] && u.side === side)) continue;
      g._addUnit({ id: row[0], name: row[1], abbr: row[2], type: row[3], atk: row[4], def: row[5], mov: row[6], c: row[7], r: row[8], side, arrive: 0, org: row[10] });
      added++;
    }
  }
  g._supply('DE'); g._supply('US');
  out.fastForwardMs = Math.round(performance.now() - t4);
  out.unitsAdded = added;
  out.roundPeak = g.state.round;
  out.unitsPeak = g.units.filter(u => u.alive && !u.exited).length;
  const syncMsPeak = (() => { const t = performance.now(); r.syncUnits(g); return performance.now() - t; })();
  out.syncUnitsPeakMs = +syncMsPeak.toFixed(1);
  out.counterTextureBuildsPeak = syncProbe.texN;
  out.renderPeakMs = +renderMS(12).toFixed(2);
  out.drawCallsPeak = r.renderer.info.render.calls;
  out.trianglesPeak = r.renderer.info.render.triangles;

  /* ---- 5) 分辨像素 / draw call 分离：同场景改画布尺寸再测 ----
     像素数变化而场景不变 → 差值即光栅化成本；剩下来的就是 CPU 侧提交成本。 */
  const sizeProbe = {};
  for (const [w, h] of [[1600, 900], [800, 450], [400, 225], [200, 112]]) {
    r.renderer.setSize(w, h);
    sizeProbe[w + 'x' + h] = +renderMS(10).toFixed(2);
  }
  r.renderer.setSize(r.container.clientWidth || 1600, r.container.clientHeight || 900);
  out.pixelsProbe = sizeProbe;

  /* ---- 6) endPhase 内部分解（补给 BFS 是主要嫌疑） ---- */
  const ep = {};
  const tS = performance.now(); for (let i = 0; i < 3; i++) { g._supply('DE'); g._supply('US'); } ep.supplyBothMs = +((performance.now() - tS) / 3).toFixed(1);
  const tP = performance.now(); g._startPhase(); ep.startPhaseMs = +(
    performance.now() - tP).toFixed(1);
  const tJ = performance.now(); const ser = g.serialize(); JSON.stringify(ser); ep.serializeMs = +(performance.now() - tJ).toFixed(1);
  ep.saveBytes = JSON.stringify(ser).length;
  out.endPhaseBreakdown = ep;

  /* ---- 7) 单回合增援强度（决定 UI syncUnits 抖动幅度） ---- */
  const waves = {};
  for (const [tag, rows] of [['DE', DATA.OOB_DE], ['US', DATA.OOB_US]]) {
    for (const row of rows) { if (row[9] > 0) waves[row[9]] = (waves[row[9]] || 0) + 1; }
  }
  const wl = Object.entries(waves).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  out.biggestWaves = wl;
  out.waveR41 = waves[41] || 0;
  out.waveCount = Object.keys(waves).length;
  return JSON.stringify(out);
})()
