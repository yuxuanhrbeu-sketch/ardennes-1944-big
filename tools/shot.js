'use strict';
/* ============================================================
 * tools/shot.js — 无头 Chrome/Edge 截图工具(美术/UI 视觉核验用)
 *
 * 用途: 在没有人工点浏览器的情况下, 把真实渲染结果抓成 PNG, 供
 *       视觉检查(配色/层次/算子可读性)或存档对比图。纯 QA 工具,
 *       不参与构建, 不会被 build.js 内联进 dist。
 *
 * 前置:
 *   1) 起开发服务器:  cd D:\ardennes44 && python -m http.server 8423
 *      (若只是验成品, 可跳过服务器, 直接 APP_URL 指到 dist 的 file:// 路径)
 *   2) 起无头浏览器(WebGL 走软件渲染, 必须带 --enable-unsafe-swiftshader):
 *      "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 *        --headless=new --disable-gpu --enable-unsafe-swiftshader --use-angle=swiftshader ^
 *        --hide-scrollbars --mute-audio --no-first-run --no-default-browser-check ^
 *        --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome_ardennes ^
 *        --window-size=1600,900 http://127.0.0.1:8423/
 *
 * 用法:
 *   node tools/shot.js <输出.png> ["setup表达式"] [等待ms] [宽] [高]
 *
 * 环境变量:
 *   RELOAD=1    先禁用缓存并重新导航(改完 js 必用, 否则抓到浏览器缓存里的旧代码)
 *   APP_URL=... 覆盖导航地址(默认 http://127.0.0.1:8423/);
 *              验成品单文件: APP_URL=file:///D:/ardennes44/dist/ardennes44.html
 *   CDP_PORT    调试端口(默认 9222; 同时开 Chrome 与 Edge 时给 Edge 换端口)
 *   SHOW_LOGS=1 打印全部控制台日志
 *
 * 例(开局全图):
 *   node tools/shot.js shots\board.png "document.querySelector('#mStart').click()" 8000 1600 900
 * 例(定焦 + 锁定晴天, 便于配色比对):
 *   node tools/shot.js shots\detail.png "document.querySelector('#mStart').click(); setTimeout(()=>{const g=window.__game,r=window.__renderer; g.state.weather='clear'; r.setWeather('clear'); r.focusOn(21,22,40);},1500)" 9000 1600 900
 *
 * 说明:
 *   - UI 只导出 {init, showStartModal, hasSave}, 所以"开始推演"必须点 #mStart 按钮。
 *   - 无头模式下 rAF 可能被节流, 脚本在截图前会强制 render 一帧。
 *   - 输出会打印 three 就绪状态、三角形数、场景对象数、单位数、控制台错误。
 *   - 注意: 不要用 PowerShell 的 Get-Content/Set-Content 回写本文件(会把 UTF-8 中文注释写坏)。
 * ============================================================ */
const fs = require('fs');
const out = process.argv[2];
// setup 表达式可通过 SETUP_FILE 指向文件（长表达式用命令行传会被 shell 剥引号）
const setup = process.env.SETUP_FILE ? fs.readFileSync(process.env.SETUP_FILE, 'utf8') : (process.argv[3] || '');
const waitMs = +(process.argv[4] || 4000);
const W = +(process.argv[5] || 1600), H = +(process.argv[6] || 900);
const PORT = +(process.env.CDP_PORT || 9222);
const APP = process.env.APP_URL || 'http://127.0.0.1:8423/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let list = null;
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.some(t => t.type === 'page')) break;
    } catch (e) { /* 端口未就绪 */ }
    await sleep(500);
  }
  if (!list) throw new Error('连不上 CDP 端口 ' + PORT + '(无头浏览器没起来?)');
  const page = list.find(t => t.type === 'page' && t.url.includes('ardennes44')) || list.find(t => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled')
      logs.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('EXCEPTION: ' + (d.exception?.description || d.text || '').slice(0, 400));
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败'))); });
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200);
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  const ov = await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  if (ov.error) console.log('设备尺寸覆盖失败:', JSON.stringify(ov.error));
  await sleep(300);
  console.log('viewport:', await evalJs('window.innerWidth + "x" + window.innerHeight + " dpr=" + window.devicePixelRatio'));

  if (process.env.RELOAD) {
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.navigate', { url: APP.startsWith('file:') ? APP : APP + (APP.includes('?') ? '&' : '?') + 't=' + Date.now() });
    console.log('已导航到应用(禁用缓存):', APP);
    await sleep(4000);
  }

  let ready = false;
  for (let i = 0; i < 80; i++) { ready = await evalJs('!!(window.THREE && window.__renderer)'); if (ready === true) break; await sleep(500); }
  console.log('three+renderer ready:', ready);
  if (!ready) console.log('诊断:', await evalJs('document.body.innerText.slice(0,400)'));

  if (setup) { console.log('setup ->', await evalJs(setup)); await sleep(600); }
  await sleep(waitMs);
  console.log('触发 resize 后 canvas:', await evalJs('window.dispatchEvent(new Event("resize")); [window.__renderer.renderer.domElement.width, window.__renderer.renderer.domElement.height].join("x")'));
  await sleep(800);

  const forced = await evalJs('(()=>{const r=window.__renderer;if(!r||!r.renderer||!r.scene||!r.camera)return "no-renderer";r.renderer.render(r.scene,r.camera);return r.renderer.info.render.triangles;})()');
  console.log('强制渲染 triangles:', forced);
  const diag = await evalJs(`(()=>{const r=window.__renderer,g=window.__game;return {
    canvas: document.querySelectorAll('canvas').length,
    cw: r.renderer.domElement.width, ch: r.renderer.domElement.height,
    sceneChildren: r.scene.children.length,
    units: g ? g.units.filter(u=>u.alive&&!u.exited).length : null,
    round: g ? g.state.round : null, phase: g ? g.state.phase : null,
    modalOpen: getComputedStyle(document.getElementById('modal')).display
  };})()`);
  console.log('diagnostics:', JSON.stringify(diag));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const data = shot.result?.data;
  if (!data) { console.log('截图失败:', JSON.stringify(shot).slice(0, 300)); process.exit(2); }
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('saved:', out, fs.statSync(out).size, 'bytes');
  const bad = logs.filter(l => /EXCEPTION|console.error/.test(l));
  console.log('console 错误:', bad.length ? '\n  ' + bad.join('\n  ') : '无');
  if (process.env.SHOW_LOGS) console.log('全部日志:\n  ' + logs.join('\n  '));
  ws.close();
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
