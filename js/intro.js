'use strict';
/* ============================================================
 * intro.js — 开场动画（第二十四轮）
 * 打开程序 → 开局选择界面出现之前，自动播放一段约 6.8 秒的
 * 二维 canvas 动画，视觉贴合第二十轮确立的制图风格（深板岩底、
 * 发丝线六角坐标网、黄铜强调、等宽注记、直角钢印）。
 *
 * 三幕：
 *   ① 六角坐标网自中心逐环淡入 + 一次自上而下的黄铜扫描线；
 *   ② 1944-12-16 德军三路进攻箭头（第6装甲集团军/第5装甲集团军/
 *      第7集团军）自东向西推进，浮现圣维特/巴斯托涅/列日三个地名；
 *   ③ 地图压暗，主标题「阿登 1944」+ kicker + 钢印淡入，整体淡出。
 *
 * 纯表现层铁律：不引用 three/UI/引擎对象、不读对局状态、不消耗
 * 引擎随机数流（粒子微差用模块内局部 LCG）。点击/任意键可跳过；
 * prefers-reduced-motion 时直接不播。动画结束若三维引擎尚未就绪，
 * 留一行等宽提示（不阻塞 boot）。
 * ============================================================ */
(function () {
  const DUR = 6800;                       // 总时长 ms（用户要求 5-10 秒）
  const BG = '#0b0e12';                   // 与页面底色一致
  const INK = '#e8e4d8';                  // 主文字（与顶栏一致）
  const BRASS = '#c8a94a';                // 黄铜强调（--brass）
  const HAIR = 'rgba(255,255,255,0.055)'; // 发丝线（近 --hair）
  const MONO = 'Consolas, "Cascadia Mono", monospace';
  const DISP = 'Bahnschrift, "DIN Alternate", "Arial Narrow", "Microsoft YaHei", sans-serif';

  // —— 模块内局部可复现随机（仅粒子微差，与引擎随机流无关）——
  let seed = 20241216;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // —— 三路进攻箭头（归一化坐标，东→西；史实：12/16 三集团军一线展开）——
  const ARROWS = [
    { name: '第6装甲集团军', pts: [[0.885, 0.170], [0.715, 0.235], [0.535, 0.205], [0.345, 0.138]], t0: 1400 },
    { name: '第5装甲集团军', pts: [[0.905, 0.520], [0.720, 0.548], [0.585, 0.545], [0.470, 0.562], [0.360, 0.498]], t0: 1400 },
    { name: '第7集团军',   pts: [[0.875, 0.795], [0.715, 0.845], [0.590, 0.825], [0.520, 0.900]], t0: 2000 }
  ];
  const ARROW_DUR = 2200;
  const TOWNS = [
    { name: '列 日',  xy: [0.315, 0.122], t0: 3600 },
    { name: '圣维特', xy: [0.578, 0.592], t0: 3900 },
    { name: '巴斯托涅', xy: [0.452, 0.622], t0: 4200 }
  ];

  // —— 工具 ——
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  // 二次缓入缓出：起步比三次曲线快（三次曲线前 20% 几乎不动，箭头会"隐形"）
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const fade = (t, a, b) => clamp01((t - a) / (b - a));

  // —— 状态 ——
  let canvas = null, ctx = null, raf = 0, t0 = 0, finished = false, flushed = false;
  let W = 0, H = 0, dpr = 1;
  let hexes = [], snow = [], arrowPix = [], townPix = [];
  const queue = [];

  // —— 几何预计算（窗口尺寸变化时重建）——
  function rebuild() {
    W = window.innerWidth; H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 六角坐标网（pointy-top，与棋盘同向）：只存屏幕附近的格心与环序
    hexes = [];
    const R = 26, hw = Math.sqrt(3) * R, hh = 1.5 * R, cx = W / 2, cy = H / 2;
    const N = Math.ceil(Math.max(W, H) / hw) + 4;
    for (let q = -N; q <= N; q++) {
      for (let r = -N; r <= N; r++) {
        const x = cx + hw * (q + r / 2), y = cy + hh * r;
        if (x < -hw || x > W + hw || y < -hh || y > H + hh) continue;
        hexes.push({ x, y, ring: (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 });
      }
    }
    // 雪（首帧位置随机铺满，缓慢下落）
    if (!snow.length) {
      for (let i = 0; i < 70; i++) snow.push({
        x: rnd() * W, y: rnd() * H, r: 0.7 + rnd() * 1.1,
        vy: 14 + rnd() * 22, ph: rnd() * Math.PI * 2, a: 0.20 + rnd() * 0.25
      });
    }
    // 箭头/地名像素坐标
    arrowPix = ARROWS.map(a => ({ name: a.name, t0: a.t0, pts: a.pts.map(p => ({ x: p[0] * W, y: p[1] * H })) }));
    townPix = TOWNS.map(t => ({ name: t.name, x: t.xy[0] * W, y: t.xy[1] * H, t0: t.t0 }));
  }

  function hexPath(x, y, R) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i + 30);
      const px = x + R * Math.cos(a), py = y + R * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // 军用地图式渐细箭头：沿折线按进度采样，宽度尾粗头细，尖端三角随行
  function drawArrow(a, t) {
    const prog = easeInOut(fade(t, a.t0, a.t0 + ARROW_DUR));
    if (prog <= 0) return;
    const pts = a.pts;
    const segs = [];
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      segs.push(d); L += d;
    }
    let target = prog * L;
    if (target < 3) return;
    const samples = [];
    let consumed = 0; // 已画出的绝对长度（从尾 0 → 头 L），宽度渐变据此取值
    for (let i = 0; i < segs.length && target > 0; i++) {
      const A = pts[i], B = pts[i + 1];
      const step = Math.min(segs[i], target);
      const n = Math.max(1, Math.ceil(step / 6));
      for (let k = 1; k <= n; k++) {
        const d = segs[i] * k / n;
        if (d > step) break;
        samples.push({ x: A.x + (B.x - A.x) * d / segs[i], y: A.y + (B.y - A.y) * d / segs[i], d: consumed + d });
      }
      consumed += step;
      target -= step;
    }
    if (samples.length < 2) return;
    const done = prog >= 1;
    const headLen = 17, headW = 8.5;
    const left = [], right = [];
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const q = samples[Math.min(i + 1, samples.length - 1)], o = samples[Math.max(i - 1, 0)];
      let dx = q.x - o.x, dy = q.y - o.y;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const fr = p.d / L;
      const w = (i === samples.length - 1 && !done) ? 2.2 : (6.2 - 4.0 * fr);
      left.push({ x: p.x - dy * w, y: p.y + dx * w });
      right.push({ x: p.x + dy * w, y: p.y - dx * w });
    }
    const tip = samples[samples.length - 1];
    const prv = samples[samples.length - 2];
    let dx = tip.x - prv.x, dy = tip.y - prv.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const hl = headLen * clamp01((samples.length * 6) / 46); // 起步时小尖
    // 箭身
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (const p of left) ctx.lineTo(p.x, p.y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(200,169,74,0.82)';
    ctx.fill();
    // 尖
    ctx.beginPath();
    ctx.moveTo(tip.x + dx * hl, tip.y + dy * hl);
    ctx.lineTo(tip.x - dy * headW * (hl / headLen), tip.y + dx * headW * (hl / headLen));
    ctx.lineTo(tip.x + dy * headW * (hl / headLen), tip.y - dx * headW * (hl / headLen));
    ctx.closePath();
    ctx.fill();
    // 尾端竖线（地图箭头起笔）
    const s0 = samples[0];
    let tx = -dy, ty = dx;
    ctx.strokeStyle = 'rgba(200,169,74,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(s0.x - tx * 6, s0.y - ty * 6);
    ctx.lineTo(s0.x + tx * 6, s0.y + ty * 6);
    ctx.stroke();
    // 番号注记（箭头画完后浮现，起点旁）
    const la = fade(t, a.t0 + ARROW_DUR + 100, a.t0 + ARROW_DUR + 500);
    if (la > 0) {
      ctx.globalAlpha = la * 0.62;
      ctx.fillStyle = INK;
      ctx.font = '11px ' + MONO;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(a.name, s0.x - 14, s0.y + 2);
      ctx.globalAlpha = 1;
    }
  }

  function drawTitle(t) {
    const lineA = easeOut(fade(t, 4600, 5250));
    const titleA = fade(t, 4900, 5800);
    const stampA = fade(t, 5250, 5950);
    if (titleA <= 0 && lineA <= 0) return;
    const cx = W / 2, cy = H * 0.44;
    // 压暗后的地图之上：kicker / 主标题 / 黄铜线 / 钢印
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (lineA > 0) {
      ctx.globalAlpha = lineA * 0.55;
      ctx.fillStyle = INK;
      try { ctx.letterSpacing = '4px'; } catch (e) { /* 旧引擎忽略 */ }
      ctx.font = '11px ' + MONO;
      ctx.fillText('HEX WARGAME · DEC 1944 — JAN 1945', cx, cy - 54);
      try { ctx.letterSpacing = '0px'; } catch (e) { /* 同上 */ }
    }
    if (titleA > 0) {
      ctx.globalAlpha = titleA;
      ctx.fillStyle = INK;
      ctx.font = '600 52px ' + DISP;
      ctx.fillText('阿登 1944', cx, cy + 4 + (1 - titleA) * 8);
    }
    // 黄铜横线自中心向两侧展开
    const lw = 340 * lineA;
    if (lw > 1) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = BRASS;
      ctx.fillRect(cx - lw / 2, cy + 40, lw, 1.5);
    }
    if (stampA > 0) {
      ctx.globalAlpha = stampA * 0.8;
      ctx.strokeStyle = 'rgba(200,169,74,0.65)';
      ctx.lineWidth = 1;
      const bw = 218, bh = 26;
      ctx.strokeRect(cx - bw / 2, cy + 58, bw, bh);
      ctx.fillStyle = 'rgba(200,169,74,0.9)';
      ctx.font = '12px ' + MONO;
      try { ctx.letterSpacing = '2px'; } catch (e) { /* 忽略 */ }
      ctx.fillText('ARDENNES / 16 DEC 1944', cx, cy + 58 + bh / 2 + 1);
      try { ctx.letterSpacing = '0px'; } catch (e) { /* 忽略 */ }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const t = now - t0;
    if (finished) return;
    // 背景
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    // ① 六角坐标网：自中心逐环淡入
    for (const h of hexes) {
      const a = fade(t, 150 + h.ring * 42, 640 + h.ring * 42);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      hexPath(h.x, h.y, 25.2);
      ctx.strokeStyle = HAIR;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // ① 自上而下的一次黄铜扫描（极淡，像图纸受光）
    const sw = fade(t, 500, 1500);
    if (sw > 0 && sw < 1) {
      const y = sw * H;
      const g = ctx.createLinearGradient(0, y - 90, 0, y + 90);
      g.addColorStop(0, 'rgba(200,169,74,0)');
      g.addColorStop(0.5, 'rgba(200,169,74,0.07)');
      g.addColorStop(1, 'rgba(200,169,74,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 90, W, 180);
    }
    // 雪（贯穿全程）
    const snowA = fade(t, 700, 1600);
    if (snowA > 0) {
      for (const f of snow) {
        f.y += f.vy / 60; f.x += Math.sin((t / 1400) + f.ph) * 0.18;
        if (f.y > H + 4) { f.y = -4; f.x = rnd() * W; }
        ctx.globalAlpha = f.a * snowA;
        ctx.fillStyle = '#dfe6ee';
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // ② 三路进攻箭头 + 番号
    for (const a of arrowPix) drawArrow(a, t);
    // ② 地名点
    for (const tp of townPix) {
      const a = fade(t, tp.t0, tp.t0 + 420);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(200,169,74,0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tp.x - 2.5, tp.y - 2.5, 5, 5);
      ctx.fillStyle = 'rgba(232,228,216,0.72)';
      ctx.font = '11px ' + MONO;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(tp.name, tp.x + 9, tp.y);
      ctx.globalAlpha = 1;
    }
    // ③ 地图压暗（为标题让光）
    const dim = fade(t, 4700, 5500) * 0.52;
    if (dim > 0) { ctx.fillStyle = 'rgba(11,14,18,' + dim + ')'; ctx.fillRect(0, 0, W, H); }
    drawTitle(t);
    // 跳过提示
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = INK;
    ctx.font = '11px ' + MONO;
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('点击任意处跳过 ›', W - 18, H - 16);
    ctx.globalAlpha = 1;
    // 结束：整体淡出
    if (t >= DUR) { finish(false); return; }
    const out = fade(t, 6200, DUR);
    if (out > 0) { ctx.fillStyle = 'rgba(11,14,18,' + out + ')'; ctx.fillRect(0, 0, W, H); }
    raf = requestAnimationFrame(frame);
  }

  function showWait() {
    if (document.getElementById('introWait')) return;
    const d = document.createElement('div');
    d.id = 'introWait';
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:26px;text-align:center;z-index:55;' +
      'font:12px ' + MONO + ';color:rgba(232,228,216,0.62);letter-spacing:1px;pointer-events:none';
    d.textContent = '正在加载三维引擎（three.js 经 CDN 加载，需联网）…… 若长时间停留，请检查网络后刷新';
    document.body.appendChild(d);
  }

  function finish(skipped) {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    const end = () => {
      try { canvas.remove(); } catch (e) { /* 已移除 */ }
      if (!window.THREE) showWait();
      flushed = true;
      const fns = queue.splice(0);
      for (const fn of fns) { try { fn(); } catch (e) { /* 回调异常不阻断 */ } }
    };
    if (skipped) {
      canvas.style.transition = 'opacity .25s linear';
      canvas.style.opacity = '0';
      setTimeout(end, 270);
    } else end();
  }

  // —— 对外 API（main.js 门控用）——
  globalThis.INTRO = {
    DUR,
    whenDone(fn) { if (flushed) { try { fn(); } catch (e) { /* 忽略 */ } } else queue.push(fn); },
    isPlaying() { return !finished; },
    skip() { finish(true); },
    clearWait() { const d = document.getElementById('introWait'); if (d) d.remove(); },
    // 测试钩子：把时间轴平移到指定时刻（无头核验定格用，不影响正常播放）
    _seek(ms) { if (!finished && canvas) t0 = performance.now() - ms; }
  };

  // —— 启动 ——
  function start() {
    // 用户系统要求减少动态效果 → 不播
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { finished = true; flushed = true; return; } } catch (e) { /* 忽略 */ }
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:60;background:' + BG;
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    rebuild();
    const skip = () => finish(true);
    canvas.addEventListener('click', skip);
    canvas.addEventListener('touchstart', skip, { passive: true });
    window.addEventListener('keydown', skip, { once: false });
    window.addEventListener('resize', rebuild);
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
