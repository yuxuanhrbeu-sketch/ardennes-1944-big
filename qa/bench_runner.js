'use strict';
/* ============================================================
 * qa/bench_runner.js — 无头浏览器性能实测（Phase 2 风险评估）
 *   · 打开成品页 → 开局（点剧本卡 + 开始推演）
 *   · 注入 qa/bench_expr.js 的表达式并取回 JSON 结果
 *   · 顺带截图存证
 * 只读工具：不改项目文件、不写 dist。
 * 用法: node qa/bench_runner.js <out.png> [等待ms]
 * 需要: 已起 http.server 8423 与带 CDP 的无头 Chrome(9222)
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'render_bench.png');
const WAIT = +(process.argv[3] || 25000);
const PORT = +(process.env.CDP_PORT || 9222);
const APP = process.env.APP_URL || 'http://127.0.0.1:8423/dist/ardennes44_big.html';
const EXPR = fs.readFileSync(path.join(__dirname, 'bench_expr.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.some(t => t.type === 'page')) break; } catch (e) { }
    await sleep(500);
  }
  if (!list) throw new Error('连不上 CDP 端口 ' + PORT);
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('WS 失败'))); });
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr, awaitP) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: !!awaitP, returnByValue: true });
    if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 300);
    return r.result?.result?.value;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: APP + (APP.includes('?') ? '&' : '?') + 't=' + Date.now() });
  console.log('导航:', APP);

  let ready = false;
  for (let i = 0; i < 90; i++) { ready = await evalJs('!!(window.THREE && window.__renderer && window.UI)'); if (ready === true) break; await sleep(500); }
  console.log('引擎就绪:', ready);
  if (!ready) { console.log('页面文本:', await evalJs('document.body.innerText.slice(0,300)')); throw new Error('引擎未就绪'); }

  // 开局：等剧本卡出现 → 选 big → 开始推演
  const startExpr = `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<80;i++){if(document.querySelector('.scen[data-id=big]'))break;await sleep(250);}
    const card=document.querySelector('.scen[data-id=big]'); if(!card) return 'no big card';
    card.click(); await sleep(600);
    for(let i=0;i<80;i++){const b=document.getElementById('mStart'); if(b&&!b.disabled){b.click();return 'started';} await sleep(250);}
    return 'no start btn';})()`;
  console.log('开局:', await evalJs(startExpr, true));
  await sleep(3000);

  const st = await evalJs('(()=>{const g=window.__game;if(!g)return "no game";return JSON.stringify({scen:g.scenario.id,round:g.state.round,phase:g.state.phase,units:g.units.filter(u=>u.alive&&!u.exited).length,modal:getComputedStyle(document.getElementById("modal")).display});})()');
  console.log('开局状态:', st);
  const stj = typeof st === 'string' && st.startsWith('{') ? JSON.parse(st) : null;
  if (!stj || stj.scen !== 'big') throw new Error('未进入 big 剧本');

  console.log('注入基准表达式（含一整个真实回合）…');
  const res = await evalJs(EXPR, true);
  console.log('\n== 浏览器实测结果 ==');
  if (typeof res === 'string') {
    try { console.log(JSON.stringify(JSON.parse(res), null, 2)); } catch (e) { console.log(res); }
  } else console.log(res);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) { fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64')); console.log('\n截图:', OUT, fs.statSync(OUT).size, 'bytes'); }
  const bad = logs.filter(l => /EXCEPTION|console.error/.test(l));
  console.log('控制台错误:', bad.length ? '\n  ' + bad.join('\n  ') : '无');
  ws.close();
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
