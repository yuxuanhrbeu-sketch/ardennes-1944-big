/* QA setup：阿登高原近景（检查密林—开阔高地—河谷结构是否符合史实） */
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
  r.focusOn(56, 40, 120);              // 阿登高原核心：马尔什—巴斯托涅—圣维特
  r.renderer.render(r.scene, r.camera);
  await s(700);
  r.renderer.render(r.scene, r.camera);
  return JSON.stringify({ zoom: '56,40 d=120', units: g.units.filter(u => u.alive && !u.exited).length });
})()
