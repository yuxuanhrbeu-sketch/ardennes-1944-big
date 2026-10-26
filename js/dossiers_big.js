'use strict';
/* ============================================================
 * dossiers_big.js — 全员部队档案挂载（2026-10-25）
 * 汇合六个分片并挂载到 DATA_BIG.DOSSIERS（97 建制，每支增援与开局建制一条）。
 * 同时覆写 REINFORCE_DOSSIERS 供增援弹卡系统使用（match[] 按单位名子串命中，
 * 与旧弹卡系统兼容；开局建制通过「部队档案」浏览面板查阅，不弹卡）。
 * 双态加载：node require 分片 module.exports；浏览器 <script> 直载分片推入
 * globalThis.__DOSSIER_SHARDS，此处汇合。QA 亦可 require 本文件取得全表。
 * ============================================================ */
(function () {
  const hasRequire = typeof require === 'function';
  const all = hasRequire
    ? [].concat(require('./dossiers_big_de1.js'), require('./dossiers_big_de2.js'),
        require('./dossiers_big_de3.js'), require('./dossiers_big_de4.js'),
        require('./dossiers_big_de5.js'),
        require('./dossiers_big_us1.js'), require('./dossiers_big_us2.js'),
        require('./dossiers_big_us3.js'), require('./dossiers_big_us4.js'),
        require('./dossiers_big_uk.js'), require('./dossiers_big_uk2.js'))
    : (globalThis.__DOSSIER_SHARDS || []).slice();

  // 挂载到 DATA_BIG（data_big.js 已返回对象，此处追加字段）
  const DB = globalThis.DATA_BIG;
  DB.DOSSIERS = all;

  /* —— 营→档案 映射（24o）：先按 nat 过滤候选档案阵营（DE nat→DE，US/UK nat→US），
     再按 dispName精确相等 → dispName子串 → META.div → META.parent 四级命中，
     结果写入 OOB_BIG_META[id].dos，UI 侧 O(1) 直取；未命中保持 undefined。 —— */
  (function buildDosMap() {
    const meta = DB.OOB_BIG_META || {};
    const names = {};
    for (const r of (DB.OOB_DE || [])) names[r[0]] = r[1];
    for (const r of (DB.OOB_US || [])) names[r[0]] = r[1];
    for (const [id, m] of Object.entries(meta)) {
      const nm = names[id] || '';
      const natSide = (m.nat || 'DE') === 'DE' ? 'DE' : (m.nat || '') === 'UK' ? 'UK' : 'US';
      const cand = all.filter(d => d.side === natSide);
      const hitIn = pred => { for (const d of cand) if (d.match.some(pred)) return d.key; return null; };
      const hit = hitIn(k => nm && nm === k)
        || hitIn(k => nm && nm.indexOf(k) >= 0)
        || hitIn(k => (m.div || '').indexOf(k) >= 0)
        || hitIn(k => (m.parent || '').indexOf(k) >= 0);
      if (hit) m.dos = hit;
    }
  })();

  // 覆写 REINFORCE_DOSSIERS 为非 open 子集（供增援弹卡系统）
  DB.REINFORCE_DOSSIERS = all.filter(d => !d.open).map(d => ({
    key: d.key, side: d.side, type: d.type, match: d.match,
    name: d.name, strength: d.strength, histDate: d.histDate,
    photo: d.photo || '', photoCaption: d.name, intro: d.intro,
  }));
  // 开局在场建制（供档案浏览面板）
  DB.DOSSIERS_OPEN = all.filter(d => d.open);
  if (typeof console !== 'undefined' && !hasRequire) {
    console.log('全员部队档案:', all.length, '条（开局', DB.DOSSIERS_OPEN.length, '/ 增援', DB.REINFORCE_DOSSIERS.length, '）');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = all;
})();
