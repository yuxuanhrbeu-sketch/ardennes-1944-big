'use strict';
/* 经 GitHub Git Data API 推送提交(绕开 Watt 反代对 git push 大上传的断连)
   blobs(stdin 传 base64) → tree(base_tree=远端HEAD) → commit → ref 更新 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

const REPO = 'yuxuanhrbeu-sketch/ardennes-1944-big';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ghJson = (route, payload, method) => {
  const args = ['api', route, '--input', '-', '--jq', '.'];
  if (method) args.push('-X', method);   // 有 --input 时 gh 默认 POST, 读调用需显式 GET
  const r = spawnSync('gh', args,
    { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false });
  if (r.status !== 0) throw new Error('gh api ' + route + ' → ' + (r.stderr || r.stdout || '').slice(0, 300));
  return JSON.parse(r.stdout);
};

(async () => {
  // 1) 远端基线
  const head = ghJson(`repos/${REPO}/commits/main`, {}, 'GET');
  const baseCommit = head.sha, baseTree = head.commit.tree.sha;
  console.log('远端基线:', baseCommit.slice(0, 7), '| tree', baseTree.slice(0, 8));

  // 2) 变更清单(本地暂存区)
  const status = execSync('git status --porcelain', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const entries = [];
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    const st = line.slice(0, 2).trim(), path = line.slice(3).trim().replace(/"/g, '');
    if (path.startsWith('dist/')) continue;
    entries.push({ st: st || 'M', path });
  }
  console.log(`变更 ${entries.length} 项 (写=${entries.filter(e => e.st !== 'D').length}, 删=${entries.filter(e => e.st === 'D').length})`);

  // 3) 逐文件建 blob
  const tree = [];
  let i = 0;
  for (const e of entries) {
    i++;
    if (e.st === 'D') { tree.push({ path: e.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const ls = execSync(`git ls-files -s "${e.path}"`, { encoding: 'utf8' }).trim();
    const mode = ls ? ls.slice(0, 6) : '100644';
    const blob = ghJson(`repos/${REPO}/git/blobs`, { content: fs.readFileSync(e.path).toString('base64'), encoding: 'base64' });
    tree.push({ path: e.path, mode, type: 'blob', sha: blob.sha });
    if (i % 10 === 0) console.log(`  blob ${i}/${entries.length}: ${e.path}`);
    await sleep(100);
  }
  console.log('blob 全部完成');

  // 4) tree → commit → ref
  const newTree = ghJson(`repos/${REPO}/git/trees`, { base_tree: baseTree, tree });
  console.log('新 tree:', newTree.sha.slice(0, 8));
  const msg = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).replace(/\r/g, '');
  const commit = ghJson(`repos/${REPO}/git/commits`, { message: msg, tree: newTree.sha, parents: [baseCommit] });
  console.log('新 commit:', commit.sha.slice(0, 8));
  const ref = ghJson(`repos/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: false });
  console.log('✓ main →', ref.object.sha.slice(0, 8));
})().catch(e => { console.error('FAIL:', (e.message || e).toString().slice(0, 400)); process.exit(1); });
