'use strict';
// 构建单文件HTML: 把 js/*.js 内联进 index.html → dist/ardennes44_big.html
// 《大阿登推演》独立成品 —— 与 D:\ardennes44 原版项目完全分离，互不影响。
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = __dirname;

// 3D 引擎内联(原版35/36轮移植): vendor/three.min.js 以 gzip+base64 内联,
// 运行期 DecompressionStream 解压后以经典脚本执行 → 单文件成品断网可玩。
// 大阿登不做平台 1MB 硬限(原版有), 内联后约 1.2MB, 双击即玩优先。
const THREE_TAG = '<script src="vendor/three.min.js"><' + '/script>';
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!html.includes(THREE_TAG)) throw new Error('index.html 缺少 vendor three 标签');
{
  const raw = fs.readFileSync(path.join(root, 'vendor', 'three.min.js'));
  const gz = zlib.gzipSync(raw, { level: 9 });
  const b64 = gz.toString('base64');
  const LOADER = [
    '<script id="threeGz" type="text/plain">' + b64 + '</' + 'script>',
    '<script>',
    '/* 单文件版引擎装载(原版36轮移植): gzip+base64 内联 → DecompressionStream 解压 → 经典脚本执行。',
    '   不用 ES module: file:// 下 import 会被 CORS 挡。不支持 DecompressionStream 时回退 CDN 并明说。 */',
    '(function () {',
    '  const bootMsg = (msg, isError, hint) => {',
    '    const el = document.getElementById("bootStatus"); if (!el) return;',
    '    el.hidden = !msg; if (!msg) return;',
    '    el.classList.toggle("error", !!isError);',
    '    const m = document.getElementById("bsMsg"), h = document.getElementById("bsHint");',
    '    if (m) m.innerHTML = (isError ? "" : \'<span class="spinner"></span>\') + msg;',
    '    if (h) h.textContent = hint || "";',
    '  };',
    '  const after = () => { window.__threeHow = "内联 gzip（离线）"; window.dispatchEvent(new Event("three-ready")); };',
    '  async function fromInline() {',
    '    const el = document.getElementById("threeGz");',
    '    if (!el) throw new Error("缺内联引擎");',
    '    const bin = atob(el.textContent.trim());',
    '    const bytes = new Uint8Array(bin.length);',
    '    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);',
    '    const ds = new DecompressionStream("gzip");',
    '    const text = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();',
    '    const sc = document.createElement("script");',
    '    sc.textContent = text;',
    '    document.head.appendChild(sc);',
    '    if (!window.THREE) throw new Error("解压后未能建立 window.THREE");',
    '  }',
    '  (async () => {',
    '    try { await fromInline(); after(); return; } catch (e) { console.warn("[boot] 内联引擎失败", e && e.message); }',
    '    bootMsg("正在尝试备用线路…", false, "内联引擎解压失败，回退 CDN");',
    '    const CDN_LIST = [',
    '      "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js",',
    '      "https://registry.npmmirror.com/three/0.160.0/files/build/three.module.min.js",',
    '      "https://lib.baomitu.com/three.js/0.160.0/three.module.min.js",',
    '    ];',
    '    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);',
    '    for (let i = 0; i < CDN_LIST.length; i++) {',
    '      try {',
    '        const mod = await withTimeout(import(CDN_LIST[i]), 6000);',
    '        if (mod && mod.Scene) { window.THREE = mod; window.__threeHow = "CDN " + CDN_LIST[i].split("/")[2]; window.dispatchEvent(new Event("three-ready")); return; }',
    '      } catch (e) { console.warn("[boot] CDN 失败", CDN_LIST[i], e && e.message); }',
    '    }',
    '    window.__threeFailed = "内联引擎与 " + CDN_LIST.length + " 条备用线路都失败";',
    '    window.dispatchEvent(new Event("three-failed"));',
    '  })();',
    '})();',
    '</' + 'script>',
  ].join('\n');
  html = html.replace(THREE_TAG, LOADER);
}
const scripts = ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'data_div_oob.js', 'data_div.js', 'dossiers_big_de1.js', 'dossiers_big_de2.js', 'dossiers_big_de3.js', 'dossiers_big_de4.js', 'dossiers_big_de5.js', 'dossiers_big_us1.js', 'dossiers_big_us2.js', 'dossiers_big_us3.js', 'dossiers_big_us4.js', 'dossiers_big_uk.js', 'dossiers_big_uk2.js', 'dossiers_big.js', 'mapgen.js', 'combat.js', 'game.js', 'ai.js', 'render.js', 'audio.js', 'ui.js', 'intro.js', 'main.js'];
/* 24m: 历史照片内嵌——vendor/photos/manifest.json 存在时(tools/fetch_photos.js 下载),
   把照片以 base64 dataURI 注入 window.__PHOTO_EMBED, ui 优先取内嵌(断网秒开)。 */
let photoEmbed = '';
{
  const mf = path.join(root, 'vendor', 'photos', 'manifest.json');
  try {
    const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const parts = [];
    let total = 0;
    for (const [url, file] of Object.entries(man)) {
      try {
        const buf = fs.readFileSync(path.join(root, 'vendor', 'photos', file));
        total += buf.length;
        parts.push(JSON.stringify(url) + ': ' + JSON.stringify('data:image/jpeg;base64,' + buf.toString('base64')));
      } catch (e) { console.warn('照片缺失, 跳过内嵌:', file); }
    }
    if (parts.length) {
      photoEmbed = '<script>window.__PHOTO_EMBED = {' + parts.join(', ') + '};</script>';
      console.log('已内嵌历史照片', parts.length, '张, 共', (total / 1024).toFixed(0) + 'KB');
    }
  } catch (e) { /* 无 manifest: 走运行时多源链 */ }
}
if (photoEmbed) html = html.replace('<script id="threeGz"', photoEmbed + '<script id="threeGz"');   // 24m: 内嵌照片表插在引擎装载器前(此时 vendor 标签已被替换)

for (const f of scripts) {
  const tag = `<script src="js/${f}"></script>`;
  if (!html.includes(tag)) throw new Error('找不到脚本标签: ' + tag);
  let code = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  if (code.includes('</script>')) throw new Error(f + ' 含有 </script>, 需转义');
  html = html.replace(tag, '<script>\n' + code + '\n</script>');
}
// 独立成品标题
html = html.replace('<title>阿登1944 · 突出部战役兵棋推演</title>',
  '<title>大阿登推演 · 营级战役兵棋（1944.12.16 – 1945.1.25）</title>');

const outDir = path.join(root, 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
const out = path.join(outDir, 'ardennes44_big.html');
fs.writeFileSync(out, html);
/* 24u: 原版本体随包分发——01/02 剧本在新窗口打开的《阿登1944》完整成品
   （vendor/classic 是从 D:\ardennes44\dist 拷入的只读快照，不回写原版） */
try {
  const classic = fs.readFileSync(path.join(root, 'vendor', 'classic', 'ardennes44_classic.html'));
  fs.writeFileSync(path.join(outDir, 'ardennes44_classic.html'), classic);
  console.log('已同步原版成品: dist/ardennes44_classic.html', (classic.length / 1024).toFixed(0) + 'KB');
} catch (e) { console.warn('⚠ 缺 vendor/classic/ardennes44_classic.html — 01/02 将回退内置兼容模式'); }
/* ⚠️ 必须用 UTF-8 **字节数**报体积：html.length 是 UTF-16 码元数，
   中文内容下会比真实文件小 ~30%（曾把 970KB 报成 746KB，误导过排查）。 */
const bytes = Buffer.byteLength(html, 'utf8');
console.log('已生成:', out, (bytes / 1024).toFixed(0) + 'KB (' + bytes + ' B)');
