'use strict';
/* 搜索阶段（24t）：只为审定拉标题，不下载。429→60s 冷却。sleep 2.5s/项。 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'vendor', 'photos', 'bulk');
const PROXY = 'http://127.0.0.1:7890';

/* 与 fetch_photos_bulk.js 相同清单（单源维护：直接读它的 TARGETS） */
const bulk = fs.readFileSync(path.join(ROOT, 'tools', 'fetch_photos_bulk.js'), 'utf8');
const TARGETS = [...bulk.matchAll(/key: '([^']+)', q: '([^']+)'/g)].map(m => ({ key: m[1], q: m[2] }));

const RES = path.join(OUT, 'search_results.json');
const res = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, 'utf8')) : {};
const curl = (url, out) => execSync(`curl -s -m 25 -x ${PROXY} -A "ArdennesWargame/1.0" -o "${out}" "${url}"`, { timeout: 30000 });
const sleep = ms => execSync(`sleep ${ms / 1000}`);

const start = parseInt(process.argv[2] || '0', 10);
for (let i = start; i < TARGETS.length; i++) {
  const t = TARGETS[i];
  if (res[t.key]) { continue; }
  const search = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(t.q + ' filetype:bitmap')}&srnamespace=6&srlimit=6&format=json`;
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    const p = path.join(OUT, `_s.json`);
    curl(search, p);
    const body = fs.readFileSync(p, 'utf8');
    if (/^You are|^{"error"/.test(body.trim()) || /too many/i.test(body)) {
      console.log(`[${i}] 429 限流, 冷却 60s...`);
      sleep(60000); continue;
    }
    try {
      const sj = JSON.parse(body);
      res[t.key] = ((sj.query && sj.query.search) || []).map(h => h.title);
      ok = true;
      console.log(`[${i}] ${t.key}: ${res[t.key].length} 条`);
    } catch (e) { console.log(`[${i}] 解析失败, 冷却 30s`); sleep(30000); }
  }
  fs.writeFileSync(RES, JSON.stringify(res, null, 1));
  sleep(2500);
}
console.log('搜索完成,', Object.keys(res).length, '/', TARGETS.length);
