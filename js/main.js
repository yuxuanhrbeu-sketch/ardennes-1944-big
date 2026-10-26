'use strict';
/* ============================================================
 * main.js — 启动装配
 * ============================================================ */
(function () {
  let booted = false;
  // 启动状态条(原版35轮移植): msg 为空则隐藏; isError=true 显示失败态(露出重试按钮)
  function bootStatus(msg, isError, hint) {
    const el = document.getElementById('bootStatus');
    if (!el) return;
    if (!msg) { el.hidden = true; el.classList.remove('error'); return; }
    el.hidden = false; el.classList.toggle('error', !!isError);
    const mm = document.getElementById('bsMsg'), hh = document.getElementById('bsHint');
    if (mm) mm.innerHTML = (isError ? '' : '<span class="spinner"></span>') + msg;
    if (hh) hh.textContent = hint || '';
  }
  function boot() {
    if (booted) return;
    booted = true;
    bootStatus('');
    const container = document.getElementById('scene');
    const renderer = new Renderer3D(container);
    window.__renderer = renderer; // 调试/测试用
    UI.init(renderer);
    // 开场动画（第二十四轮）：播放完毕（或被跳过）后再亮出开局界面
    if (window.INTRO) INTRO.whenDone(() => { INTRO.clearWait(); UI.showStartModal(UI.hasSave()); });
    else UI.showStartModal(UI.hasSave());
  }

  function failed() {
    bootStatus('3D 引擎加载失败', true,
      (window.__threeFailed ? window.__threeFailed + ' · ' : '') +
      '这是联网加载 three.js 失败（常见于网络受限/代理环境）。可直接重试；若反复失败，请使用已内联引擎的离线版 dist/ardennes44_big.html。');
  }
  if (document.readyState === 'complete') {
    if (window.THREE) boot(); else window.addEventListener('three-ready', boot, { once: true });
  } else {
    window.addEventListener('load', () => {
      if (window.THREE) boot();
      else window.addEventListener('three-ready', boot, { once: true });
    });
  }
  window.addEventListener('three-failed', failed);
  // 引擎迟迟不来也要有反馈: 超过 4 秒把状态条摆出来
  setTimeout(() => {
    if (!booted && !window.THREE) {
      bootStatus('正在加载 3D 引擎…', false,
        '首次打开需要下载 three.js（约 670KB）；若长时间无响应，多半是网络无法访问 CDN。');
    }
  }, 4000);
  document.addEventListener('DOMContentLoaded', () => {
    const r = document.getElementById('bsRetry'), l = document.getElementById('bsReload');
    if (r) r.onclick = () => { bootStatus('正在重试…'); location.reload(); };
    if (l) l.onclick = () => location.reload();
  });
})();
