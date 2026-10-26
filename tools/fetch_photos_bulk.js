'use strict';
/* ============================================================
 * tools/fetch_photos_bulk.js — 档案批量配图（24t，2026-10-25）
 * 走本机 clash 代理(127.0.0.1:7890)调用 Wikimedia Commons API：
 *   搜索 → 取首个文件 → imageinfo 拿原图URL+640px缩略 → 下载缩略图
 * → vendor/photos/bulk/；manifest_bulk.json 记录 {原图URL: 文件名}。
 * 运行时 bindPhoto 按档案 photo(=原图URL) 字面命中内嵌表。
 * 用法: node tools/fetch_photos_bulk.js [起始序号]
 * 重跑安全：已下载的键跳过。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'vendor', 'photos', 'bulk');
const MF = path.join(OUT, 'manifest_bulk.json');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* key → commons 搜索词（部队全名 + 时期限定，宁缺勿错） */
const TARGETS = [
  // —— 德军师/旅 ——
  { key: 'de_3pgd', q: '3. Panzergrenadier-Division' },
  { key: 'de_9pzd', q: '9. Panzer-Division' },
  { key: 'de_116pzd', q: '116. Panzer-Division' },
  { key: 'de_2pzd', q: '2. Panzer-Division Ardennes' },
  { key: 'de_panzerlehr', q: 'Panzer-Lehr-Division' },
  { key: 'de_26vgd', q: '26. Volks-Grenadier-Division' },
  { key: 'de_18vgd', q: '18. Volks-Grenadier-Division' },
  { key: 'de_62vgd', q: '62. Volks-Grenadier-Division' },
  { key: 'de_560vgd', q: '560. Volks-Grenadier-Division' },
  { key: 'de_9vgd', q: '9. Volks-Grenadier-Division' },
  { key: 'de_167vgd', q: '167. Volks-Grenadier-Division' },
  { key: 'de_277vgd', q: '277. Volks-Grenadier-Division' },
  { key: 'de_246vgd', q: '246. Volks-Grenadier-Division' },
  { key: 'de_272vgd', q: '272. Volks-Grenadier-Division' },
  { key: 'de_326vgd', q: '326. Volks-Grenadier-Division' },
  { key: 'de_15pgd', q: '15. Panzergrenadier-Division' },
  { key: 'de_212vgd', q: '212. Volks-Grenadier-Division' },
  { key: 'de_276vgd', q: '276. Volks-Grenadier-Division' },
  { key: 'de_340vgd', q: '340. Volks-Grenadier-Division' },
  { key: 'de_352vgd', q: '352. Volks-Grenadier-Division' },
  { key: 'de_79vgd', q: '79. Volks-Grenadier-Division' },
  { key: 'de_3fj', q: '3. Fallschirmjäger-Division' },
  { key: 'de_5fj', q: '5. Fallschirmjäger-Division' },
  { key: 'de_fgb', q: 'Führer-Grenadier-Brigade' },
  // —— 德军司令部（指挥官肖像） ——
  { key: 'hq2_q002', q: 'Sepp Dietrich portrait' },
  { key: 'hq2_q003', q: 'Hasso von Manteuffel portrait' },
  { key: 'hq2_q004', q: 'Erich Brandenberger' },
  { key: 'hq2_q005', q: 'Hermann Priess SS' },
  { key: 'hq2_q006', q: 'Willi Bittrich' },
  { key: 'hq2_q009', q: 'Heinrich von Lüttwitz' },
  { key: 'hq2_q010', q: 'Walter Krüger SS general' },
  { key: 'hq2_q011', q: 'Walter Lucht' },
  { key: 'hq2_q013', q: 'Baptist Kniess' },
  // —— 美军师 ——
  { key: 'us_2ad', q: '2nd Armored Division Belgium 1944' },
  { key: 'us_9arml', q: '9th Armored Division 1945 Belgium' },
  { key: 'us_11ad', q: '11th Armored Division 1945' },
  { key: 'us_6ad', q: '6th Armored Division 1944' },
  { key: 'us_28id', q: '28th Infantry Division Luxembourg 1944' },
  { key: 'us_35id', q: '35th Infantry Division 1945' },
  { key: 'us_26id', q: '26th Infantry Division 1945' },
  { key: 'us_90id', q: '90th Infantry Division 1944' },
  { key: 'us_80id', q: '80th Infantry Division Luxembourg' },
  { key: 'us_5id', q: '5th Infantry Division Germany 1945' },
  { key: 'us_4id', q: '4th Infantry Division Belgium 1944' },
  { key: 'us_87id', q: '87th Infantry Division 1945' },
  { key: 'us_106id', q: '106th Infantry Division Schnee Eifel' },
  { key: 'us_99id', q: '99th Infantry Division 1944' },
  { key: 'us_75id', q: '75th Infantry Division 1945' },
  { key: 'us_9id', q: '9th Infantry Division Ardennes' },
  { key: 'us_83id', q: '83rd Infantry Division 1944' },
  { key: 'us_84id', q: '84th Infantry Division 1945' },
  // —— 美军司令部肖像 ——
  { key: 'hq2_v002', q: 'Courtney Hodges general' },
  { key: 'hq2_v003', q: 'George S. Patton portrait' },
  { key: 'hq2_v004', q: 'Matthew Ridgway 1944' },
  { key: 'hq2_v005', q: 'Leonard Gerow' },
  { key: 'hq2_v006', q: 'J. Lawton Collins general' },
  { key: 'hq2_v007', q: 'Troy Middleton' },
  { key: 'hq2_v008', q: 'Manton Eddy' },
  { key: 'hq2_v009', q: 'John Millikin general' },
  { key: 'hq2_v010', q: 'Bernard Montgomery portrait' },
  { key: 'hq2_v011', q: 'Brian Horrocks' },
];

const PROXY = 'http://127.0.0.1:7890';
const curl = (url, out) => execSync(
  `curl -s -m 25 -x ${PROXY} -A "ArdennesWargame/1.0 (offline wargame photo fetch)" -o "${out}" "${url.replace(/"/g, '')}"`,
  { timeout: 30000 });

const manifest = fs.existsSync(MF) ? JSON.parse(fs.readFileSync(MF, 'utf8')) : {};

const start = parseInt(process.argv[2] || '0', 10);
let okN = 0, skipN = 0, failN = 0;
for (let i = start; i < TARGETS.length; i++) {
  const t = TARGETS[i];
  if (manifest['@' + t.key]) { skipN++; continue; }
  try {
    // 1) 搜索文件
    const search = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(t.q + ' filetype:bitmap')}&srnamespace=6&srlimit=5&format=json`;
    const sPath = path.join(OUT, `_s${i}.json`);
    curl(search, sPath);
    const sj = JSON.parse(fs.readFileSync(sPath, 'utf8'));
    const hits = (sj.query && sj.query.search) || [];
    if (!hits.length) { console.log(`[${i}] ✗ 无结果 ${t.key} (${t.q})`); failN++; continue; }
    // 依次尝试前 3 个结果，找可下载的 JPEG
    let done = false;
    for (const h of hits.slice(0, 3)) {
      const title = h.title;
      if (!/\.(jpe?g)$/i.test(title)) continue;
      if (/map|plan|diagram|logo|flag|insignia|patch/i.test(title)) continue;
      const info = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size&iiurlwidth=640&format=json`;
      const iPath = path.join(OUT, `_i${i}.json`);
      curl(info, iPath);
      const ij = JSON.parse(fs.readFileSync(iPath, 'utf8'));
      const page = Object.values(ij.query.pages)[0];
      const ii = page && page.imageinfo && page.imageinfo[0];
      if (!ii || ii.width < 500) continue;
      const dl = ii.thumburl || ii.url;
      const file = `b${String(i).padStart(2, '0')}_${title.replace(/^File:/, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)}.jpg`;
      const fp = path.join(OUT, file);
      curl(dl, fp);
      const head = fs.readFileSync(fp).slice(0, 3);
      if (head[0] !== 0xFF || head[1] !== 0xD8) { fs.unlinkSync(fp); continue; }   // JPEG 魔数校验
      manifest['@' + t.key] = { file, title, url: ii.url };
      okN++;
      console.log(`[${i}] ✔ ${t.key} ← ${title.replace(/^File:/, '').slice(0, 60)}`);
      done = true;
      break;
    }
    if (!done) { console.log(`[${i}] ✗ 前3结果均不可用 ${t.key}`); failN++; }
  } catch (e) {
    failN++;
    console.log(`[${i}] ✗ 异常 ${t.key}: ${String(e.message).slice(0, 80)}`);
  }
  fs.writeFileSync(MF, JSON.stringify(manifest, null, 1));
  execSync('sleep 0.4');   // 限速防 429
}
fs.writeFileSync(MF, JSON.stringify(manifest, null, 1));
console.log(`\n完成: 成功 ${okN} / 跳过 ${skipN} / 失败 ${failN}（manifest_bulk.json ${Object.keys(manifest).length} 项）`);
