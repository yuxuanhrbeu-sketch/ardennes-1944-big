'use strict';
/* 下载阶段（24t）：SELECTION 为人工审定映射（key → File 标题）。
 * imageinfo → 640px 缩略 → JPEG 校验 → manifest_bulk.json（键 '@'+key，值含原图URL）。 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'vendor', 'photos', 'bulk');
const PROXY = 'http://127.0.0.1:7890';
const sleep = ms => execSync(`sleep ${ms / 1000}`);
const curl = (url, out) => execSync(`curl -s -m 30 -x ${PROXY} -A "ArdennesWargame/1.0" -o "${out}" "${url}"`, { timeout: 35000 });

const SELECTION = {
  de_9pzd: 'Duitse Panzerkampfwagen IV, Ausführung D, van 9. Panzerdivision tijdens de opmars in Nederland',
  de_116pzd: 'Hoeve Mottet in Marenne na doorgang van 116 Panzer Divisie 1945 Ardennenoffensief.jpg',
  de_panzerlehr: 'Bundesarchiv Bild 101I-738-0273-01A, Villers-Bocage, zerstörter Panzer IV.jpg',

  hq2_q004: 'File:LTG Brandenberger surrender Luger.jpg',
  hq2_q005: 'Bundesarchiv Bild 101III-Adendorf-122-28, Hermann Prieß.jpg',
  hq2_q006: 'Bundesarchiv Bild Wilhelm Bittrich.jpg',
  hq2_q011: 'Bundesarchiv Bild 101I-236-1029-30A, Russland, Walther Lucht.jpg',
  hq2_q013: 'Baptist Knieß.jpg',
  us_2ad: 'File:Tanks and self-propeeled guns of the US 2d armored Division.jpg',
  us_9arml: 'SC 411804 - Members of the 9th Armored Division, 3rd U.S. Army looking at a sign about the Battle of the Bulge.jpg',
  us_11ad: '2346957 Tanks of the 11th Armored Division, Third U.S. Army, advance along the Autobahn near Frankfurt, Germany...jpg',
  us_28id: 'Photograph of Infantrymen Passing through Witte, Luxemburg - NARA - 6928082.jpg',
  us_90id: 'Artillerymen of a cannon company of the U.S. Army’s 90th Infantry Division fire an M3 105mm howitzer.jpg',
  us_5id: 'Soldiers of the U.S. 5th Infantry Division in the ruins of Bitburg, Germany, 28 February 1945.jpg',
  us_4id: 'SC 329944 - Troops of the 12th Inf. Regt., 4th Inf. Div. crossing from France into Belgium.jpg',
  us_87id: 'Engineers of the 87th Division fery a tank across the Moselle.jpg',
  us_99id: '99th Infantry Division Moving Through Wirtzfeld.jpg',
  us_75id: 'SC 329979 - U.S. Army infantrymen of the 75th Infantry Division pass through Arbrefontaine.jpg',
  us_84id: 'SC 201528 - Members of a weapons platoon of the 84th Infantry "Railsplitter" Division try out their .45 caliber submachine guns.jpg',
  hq2_v003: 'George S. Patton 06.jpg',
  hq2_v004: 'Major-General Ridgway and Major-General Gavin.jpg',
  hq2_v005: 'Leonard T. Gerow.jpg',
  hq2_v006: 'Joseph Lawton Collins.jpg',
  hq2_v007: 'Troy Houston Middleton 1944.jpg',
  hq2_v008: 'Manton Sprague Eddy.jpg',
  hq2_v009: 'John Millikin (U.S. Army major general).jpg',
  hq2_v010: 'Bernard Law Montgomery, 1st Viscount of Alamein.jpg',
  hq2_v011: 'Horrocks portrait.jpg',
  hq2_q002: 'Sepp Dietrich',
  hq2_q003: 'Hasso von Manteuffel',
};

/* search_results.json 里找真实完整标题 */
const sr = JSON.parse(fs.readFileSync(path.join(OUT, 'search_results.json'), 'utf8'));
const realTitle = key => {
  const wantRaw = SELECTION[key];
  const want = wantRaw.toLowerCase();
  const pool = wantRaw.startsWith('File:') ? [wantRaw] : (sr[key] || []);
  let hit = pool.find(t => t.toLowerCase() === want.toLowerCase()) || pool.find(t => t.toLowerCase() === 'file:' + want.toLowerCase())
    || pool.find(t => t.toLowerCase().replace(/\.\.\.jpg$/, '.jpg').includes(want.replace(/\.\.\.jpg$/, '')))
    || pool.find(t => t.toLowerCase().includes(want.slice(0, 40)));
  return hit || null;
};

const MF = path.join(OUT, 'manifest_bulk.json');
const manifest = fs.existsSync(MF) ? JSON.parse(fs.readFileSync(MF, 'utf8')) : {};
let okN = 0, failN = 0;
for (const [key, want] of Object.entries(SELECTION)) {
  if (manifest['@' + key]) { continue; }
  let title = null;
  if (/^(Sepp Dietrich|Hasso von Manteuffel)$/.test(want)) {
    // 补搜
    try {
      const p = path.join(OUT, '_sx.json');
      curl(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(want + ' filetype:bitmap')}&srnamespace=6&srlimit=4&format=json`, p);
      const sj = JSON.parse(fs.readFileSync(p, 'utf8'));
      const hit = ((sj.query && sj.query.search) || []).map(h => h.title).find(t => /Dietrich|Manteuffel/i.test(t));
      if (hit) { title = hit; sleep(2500); }
    } catch (e) { /* ignore */ }
    if (!title) { console.log('✗ 补搜无果', key); failN++; continue; }
  } else {
    title = realTitle(key);
    if (!title) { console.log('✗ 标题未匹配', key, '←', want.slice(0, 50)); failN++; continue; }
  }
  try {
    const p = path.join(OUT, '_i.json');
    curl(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size&iiurlwidth=640&format=json`, p);
    const ij = JSON.parse(fs.readFileSync(p, 'utf8'));
    const page = Object.values(ij.query.pages)[0];
    const ii = page && page.imageinfo && page.imageinfo[0];
    if (!ii || ii.width < 250) { console.log('✗ 尺寸不足', key); failN++; continue; }
    const file = 'b' + key.replace(/[^a-z0-9]/gi, '') + '.jpg';
    const fp = path.join(OUT, file);
    curl(ii.thumburl || ii.url, fp);
    const head = fs.readFileSync(fp).slice(0, 3);
    if (head[0] !== 0xFF || head[1] !== 0xD8) { fs.unlinkSync(fp); console.log('✗ 非JPEG', key); failN++; continue; }
    manifest['@' + key] = { file, title, url: ii.url };
    okN++;
    console.log('✔', key, '←', title.replace(/^File:/, '').slice(0, 58));
  } catch (e) { console.log('✗ 异常', key, String(e.message).slice(0, 60)); failN++; }
  fs.writeFileSync(MF, JSON.stringify(manifest, null, 1));
  sleep(2500);
}
fs.writeFileSync(MF, JSON.stringify(manifest, null, 1));
console.log(`\n下载完成: 本批成功 ${okN} / 失败 ${failN} · manifest 合计 ${Object.keys(manifest).length}`);
