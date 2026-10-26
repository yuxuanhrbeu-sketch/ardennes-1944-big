/* QA setup：北肩近景（埃尔森博恩—蒙绍段，检查算子间距与地形） */
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
  await s(500);
  const g = window.__game, r = window.__renderer;
  r.focusOn(64, 22, 105);              // 北肩：蒙绍—埃尔森博恩—比特根巴赫
  r.renderer.render(r.scene, r.camera);
  await s(600);
  r.renderer.render(r.scene, r.camera);
  return JSON.stringify({ zoom: '64,22 d=105', units: g.units.filter(u => u.alive && !u.exited).length });
})()
