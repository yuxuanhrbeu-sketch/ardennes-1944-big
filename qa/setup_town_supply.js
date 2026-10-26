/* QA setup：点击一座补给城市，展示其补给覆盖范围并核验。
   用来目视确认覆盖**不是圆** —— 沿公路延伸远、穿林过山收缩。 */
(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { if (document.querySelector('.scen[data-id=big]')) break; await s(250); }
  const c = document.querySelector('.scen[data-id=big]'); if (c) c.click();
  await s(600);
  for (let i = 0; i < 80; i++) { const b = document.getElementById('mStart'); if (b && !b.disabled) { b.click(); break; } await s(250); }
  await s(4000);
  for (let k = 0; k < 6; k++) {
    const btn = [...document.querySelectorAll('button')].find(b => /跳过|继续/.test(b.textContent || ''));
    if (!btn) break; btn.click(); await s(900);
  }
  const modal = document.getElementById('modal'); if (modal) modal.style.display = 'none';
  const log = document.querySelector('.log, #log, .warlog, #warlog'); if (log) log.style.display = 'none';
  await s(500);
  const g = window.__game, r = window.__renderer;

  // 直接走 UI 的点击路径：模拟点击城市格 → showTownSupply
  const TARGET = [46, 48];      // 巴斯托涅（tier2，形状居中便于观察；改这里可看别的城市）
  const hx = g.hexAt(TARGET[0], TARGET[1]);
  if (!hx || !hx.town) return JSON.stringify({ err: 'no town at ' + TARGET });
  const cov = g.townCoverage(TARGET[0], TARGET[1]);
  r.focusOn(TARGET[0], TARGET[1], 135);
  const n = r.showSupplyCoverage(cov);
  r.renderer.render(r.scene, r.camera);
  await s(700);
  r.renderer.render(r.scene, r.camera);

  // 统计覆盖的"形状"：最大/最小方向延伸（若接近相等说明还是圆的）
  let maxD = 0, minD = 1e9, cnt = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  const reachD = dirs.map(() => 0);
  for (const k of cov.cost.keys()) {
    const p = Hex.parse(k); cnt++;
    const d = Hex.distance(TARGET[0], TARGET[1], p.c, p.r);
    if (d > maxD) maxD = d;
    dirs.forEach((dv, i) => {
      const ang = Math.atan2(p.r - TARGET[1], p.c - TARGET[0]);
      const ta = Math.atan2(dv[1], dv[0]);
      let da = Math.abs(ang - ta); if (da > Math.PI) da = 2 * Math.PI - da;
      if (da < 0.5 && d > reachD[i]) reachD[i] = d;
    });
  }
  return JSON.stringify({
    town: hx.town.name, tier: hx.town.tier, side: hx.town.ctrl,
    range: cov.range, covered: n, maxDist: maxD, dirReach: reachD,
    ratio: (Math.max(...reachD) / Math.max(1, Math.min(...reachD.filter(x => x > 0)))).toFixed(2)
  });
})()
