#!/usr/bin/env node
'use strict';
/* ============================================================
 * tools/fetch_photos.js — 历史照片一次性下载（2026-10-24m）
 *
 * 为什么需要：慢速/受限网络下维基共享图源经常拉不动，档案卡/简报/胜利画面的
 * 史实照片看不到。本脚本在【有网环境】跑一次，把全部照片（960px 缩略图优先，
 * 失败回退原图，再回退 wsrv.nl 代理）下载到 vendor/photos/，并写 manifest.json；
 * 之后 node build.js 会自动把照片以 base64 内嵌进 dist —— 断网也秒开。
 *
 * 用法：  node tools/fetch_photos.js          （在能访问外网的机器/时段运行）
 * 之后：  node build.js                       （dist 内嵌照片，约 +1~2MB）
 * 清除：  删除 vendor/photos 目录即回到运行时多源链。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const root = path.join(__dirname, '..');

/* 与 ui.js warmPhotos 同源的照片清单 */
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js']) {
  eval(fs.readFileSync(path.join(root, 'js', f), 'utf8'));
}
globalThis.DATA = globalThis.DATA_BIG || globalThis.DATA;
const D = globalThis.DATA;
const urls = new Set();
for (const d of (D.REINFORCE_DOSSIERS || [])) if (d && d.photo) urls.add(d.photo);
for (const k of ['DE', 'US']) { const b = D.BRIEFINGS && D.BRIEFINGS[k]; if (b && b.photo) urls.add(b.photo); }
for (const k in (D.VICTORY || {})) { const v = D.VICTORY[k]; if (v && v.photo) urls.add(v.photo); }

function thumbOf(u) {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?]+)$/i.exec(u);
  if (!m || !/\.(jpe?g|png)$/i.test(m[3])) return null;
  return 'https://upload.wikimedia.org/wikipedia/commons/thumb/' + m[1] + '/' + m[2] + '/' + m[3] + '/960px-' + m[3];
}
function proxyOf(u) { return 'https://wsrv.nl/?url=' + encodeURIComponent(u.replace(/^https:\/\//, '')) + '&w=800'; }

function get(url, redirects) {
  return new Promise((resolve, reject) => {
    if ((redirects || 0) > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'ardennes-big-photo-fetch/1.0' }, timeout: 20000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        const loc = new URL(res.headers.location, url).href;
        return resolve(get(loc, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  const dir = path.join(root, 'vendor', 'photos');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {};
  let okN = 0, failN = 0;
  for (const u of urls) {
    const name = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12) + '.jpg';
    const chain = [thumbOf(u), u, proxyOf(u)].filter(Boolean);
    let buf = null, src = '';
    for (const c of chain) {
      try { buf = await get(c); if (buf && buf.length > 1000 && buf[0] === 0xFF) { src = c; break; } } catch (e) { /* 下一源 */ }
    }
    if (!buf) { console.log('  ✘ ' + u.slice(60, 100) + ' — 全部源失败'); failN++; continue; }
    fs.writeFileSync(path.join(dir, name), buf);
    manifest[u] = name;
    okN++;
    console.log('  ✔ ' + name + ' (' + (buf.length / 1024).toFixed(0) + 'KB, ' + (src === thumbOf(u) ? 'thumb' : src === u ? '原图' : 'proxy') + ')');
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
  console.log('\n完成: ' + okN + ' 成功 / ' + failN + ' 失败 → vendor/photos/manifest.json');
  console.log('下一步: node build.js 把照片内嵌进 dist（断网即可见）。');
  process.exit(failN ? 2 : 0);
})();
