'use strict';
/* 把 three.js 的 ES module 构建转成**经典脚本**（window.THREE = {...}）。
 * 为什么需要：拆成多文件后必须能从 file:// 双击直接玩，而 file:// 下 ES module 会被 CORS 挡掉
 * （HANDOVER §19 坑 16：fetch 能通 ≠ import 能通）；经典 <script src> 不受此限。
 * 转换是机械的：three.module.min.js 尾部只有一条 `export{a as B,...};`，且全文零 import。
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'vendor', 'three.module.min.js'), 'utf8');

const at = src.lastIndexOf('export{');
if (at < 0) throw new Error('未找到尾部 export{');
const end = src.indexOf('};', at);
if (end < 0) throw new Error('未找到 export 语句结尾');
const list = src.slice(at + 'export{'.length, end);
const body = src.slice(0, at);

// "local as Exported" → "Exported:local"；"Name" → "Name:Name"
const pairs = list.split(',').map(s => s.trim()).filter(Boolean).map(one => {
  const m = /^(\S+)\s+as\s+(\S+)$/.exec(one);
  return m ? `${m[2]}:${m[1]}` : `${one}:${one}`;
});
const names = pairs.map(p => p.split(':')[0]);
for (const need of ['Scene', 'WebGLRenderer', 'PerspectiveCamera']) {
  if (!names.includes(need)) throw new Error('导出表异常：缺 ' + need);
}

const banner = `/* three.js r160 (minified ES module) → 经典脚本封装
 * 本文件由 tools/mk_three_classic.js 自动生成，请勿手改（升级 three 时替换 vendor/three.module.min.js 后重跑）。
 * 转换只做两件事：① 尾部唯一的 \`export{...};\` 改写成 IIFE 的 \`return{...};\`；② 外层包 window.THREE = (...)()。
 * 目的：让它能被普通 <script src="vendor/three.min.js"> 加载 —— file:// 双击可用（ES module 会被 CORS 挡掉）。
 * 原始文件：vendor/three.module.min.js（MIT，license 注释见其文首）。 */
(function () {
const __three = (function () {
`;
const footer = `
return{${pairs.join(',')}};
})();
window.THREE = __three;
})();
`;
const final = banner + body + footer;
fs.writeFileSync(path.join(root, 'vendor', 'three.min.js'), final);
const size = fs.statSync(path.join(root, 'vendor', 'three.min.js')).size;
console.log(`已生成 vendor/three.min.js：${(size / 1024).toFixed(0)}KB，导出 ${pairs.length} 个名字`);
console.log('抽样：' + ['Scene', 'WebGLRenderer', 'PerspectiveCamera', 'InstancedMesh', 'CanvasTexture', 'Raycaster', 'Fog', 'Color']
  .map(n => n + (names.includes(n) ? '✔' : '✘')).join(' '));
