#!/usr/bin/env node
'use strict';
/* ============================================================
 * tools/serve.js —— 零依赖本地静态服务器（开发 / 自测用）
 *
 *   npm start              → http://127.0.0.1:8423/
 *   node tools/serve.js 9000
 *
 * 用途：无头截图（tools/shot.js）与手动调试都需要一个 http 源；
 *       dist/ 成品是单文件，双击 file:// 也能跑，本服务器不是必须的。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8423);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.normalize(path.join(ROOT, urlPath));
  // 目录穿越防护
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('403'); return; }
  if (urlPath === '/' || urlPath === '') {
    res.writeHead(302, { Location: '/dist/ardennes44_big.html' }).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('本地服务已启动: http://127.0.0.1:' + PORT + '/');
  console.log('  成品: http://127.0.0.1:' + PORT + '/dist/ardennes44_big.html');
  console.log('  （dist/ 未构建时先跑 npm run build）');
});
