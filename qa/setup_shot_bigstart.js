/* shot.js setup: 断网开局 big 剧本(双AI观摩) → 验证 580 算子进场 */
(function () {
  function q(sel) { return document.querySelector(sel); }
  function wait(cond, ms) {
    const t0 = Date.now();
    return new Promise(res => {
      const iv = setInterval(() => {
        let ok = false; try { ok = cond(); } catch (e) {}
        if (ok || Date.now() - t0 > (ms || 8000)) { clearInterval(iv); res(ok); }
      }, 150);
    });
  }
  return wait(() => q('.scen[data-id="big"]'), 9000).then(okScen => {
    if (!okScen) return 'no-scen-card';
    q('.scen[data-id="big"]').click();
    return wait(() => q('#mStart'), 4000).then(okBtn => {
      if (!okBtn) return 'no-start-btn';
      const roles = document.querySelectorAll('#modal .side-btn');
      if (roles && roles[3]) roles[3].click();
      q('#mStart').click();
      /* 逐份简报: 点 #brSkip 直跳; 共两份(德/美) */
      return wait(() => q('#brSkip'), 12000).then(() => new Promise(res => {
        let n = 0;
        const iv = setInterval(() => {
          const sk = q('#brSkip');
          if (sk) { sk.click(); n++; }
          if (!q('.briefing') || n >= 4) { clearInterval(iv); setTimeout(() => res('started n=' + n), 3000); }
        }, 700);
      }));
    });
  });
})()
