/* QA setup：开 big 剧本 → 关闭模态 → 整图取景 + 近景两拍，并回报关键诊断。
   由 shot.js 通过 SETUP_FILE 注入。*/
(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { if (document.querySelector('.scen[data-id=big]')) break; await s(250); }
  const c = document.querySelector('.scen[data-id=big]');
  if (c) c.click();
  await s(600);
  for (let i = 0; i < 80; i++) { const b = document.getElementById('mStart'); if (b && !b.disabled) { b.click(); break; } await s(250); }
  await s(4000);
  const g = window.__game, r = window.__renderer;
  // 跳过双方指挥官简报（否则模态挡住棋盘）
  for (let k = 0; k < 6; k++) {
    const btn = [...document.querySelectorAll('button')].find(b => /跳过|继续/.test(b.textContent || ''));
    if (!btn) break;
    btn.click(); await s(900);
  }
  // 若仍有模态，直接隐藏（QA 取景用）
  const modal = document.getElementById('modal');
  if (modal) modal.style.display = 'none';
  await s(500);
  // 把战报面板也收掉，露出完整棋盘
  const log = document.querySelector('.log, #log, .warlog, #warlog');
  if (log) log.style.display = 'none';
  for (const sel of ['#logPanel', '.right-panel', '#sidePanel', '.panel-right']) {
    const e = document.querySelector(sel); if (e) e.style.display = 'none';
  }
  await s(300);
  const diag = {
    scen: g.scenario.id, round: g.state.round,
    map: g.map.cols + 'x' + g.map.rows,
    units: g.units.filter(u => u.alive && !u.exited).length,
    towns: g.map.towns.length,
    playerSide: (window.UI && UI.state) ? undefined : undefined,
  };
  r.fitView();
  if (process.env && false) { /* noop */ }
  const ZOOM = (typeof __ZOOM__ !== 'undefined') ? __ZOOM__ : null;
  if (ZOOM) { r.focusOn(ZOOM[0], ZOOM[1], ZOOM[2]); }
  r.renderer.render(r.scene, r.camera);
  diag.fitDist = Math.round(r.cam.dist * 10) / 10;
  diag.camMax = 'CAM_MAX_DIST 在 render.js 内';
  const st = window.__stick;
  return JSON.stringify(diag);
})()
