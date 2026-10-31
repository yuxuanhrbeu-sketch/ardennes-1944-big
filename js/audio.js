'use strict';
/* ============================================================
 * audio.js — 程序化音效引擎（Web Audio 实时合成，零外部音频文件）
 *
 * 为什么全用合成：本作是"单文件、双击即玩"的静态交付（three.js 走 CDN 已是唯一外部依赖），
 * 若再引入 mp3 素材就得连带托管音频；而且史实武器音色用合成反而更可控、不涉版权。
 *
 * 音色贴合 1944 年阿登战场（写实史实约定）：
 *   行军   步兵脚步沙沙 / 履带与引擎低鸣（装甲）、侦察车更轻
 *   交火   轻武器=步枪机枪点射脉冲串；坦克炮=低频炸响+金属裂声；混编=两者叠加
 *   炮击   出膛闷响 + 数百毫秒后的远处爆炸回响（炮兵是远程火力，声音有延迟）
 *   空袭   活塞机掠过（多普勒式的频移+音量包络）+ 落弹爆炸
 *   城镇易手  教堂钟（阿登城镇多钟楼；史实上圣维特/巴斯托涅的战斗都围绕钟楼展开）
 *   阶段切换  电台莫尔斯短音 + 静电（双方靠无线电联络；德军音高更低）
 *   被歼   爆炸 + 下坠音；援军入场=车队引擎+喇叭；配属增益=机械脆响+电台应答
 *   终局   军号：德军下行定音鼓、美军上行钟声；失败为低沉持续音
 *
 * 工程纪律：
 *   1) 不引用 Game/AI/Combat，不读取也不修改游戏状态 —— 纯表现层；
 *   2) 不消耗 game.rng（本文件没有随机数生成器，只有 Math.random 用于"音色微差"，
 *      与游戏策略无关，不会改变任何对局结果）；
 *   3) 必须由用户手势后才建 AudioContext（浏览器自动播放策略）→ UI 在「开始推演」点击里 init()；
 *   4) 复音与频率受控：总音量 0.28、压缩器防削波、每类音效有最小间隔、全局同时发声上限，
 *      避免 AI 快节奏推演时几十个动作连成爆音（§13.1 的节奏 130~260ms/动作）。
 * ============================================================ */
globalThis.SFX = (function () {

  const KEY = 'ardennes44_sfx';
  const MASTER_VOL = 0.42;
  const MAX_VOICES = 12;

  let ctx = null, master = null, comp = null, ready = false;
  // 静音偏好：模块加载即从 localStorage 读取，使顶栏开关在 init() 之前也能显示正确状态
  let muted = (function () { try { return !!(globalThis.localStorage && globalThis.localStorage.getItem(KEY) === 'off'); } catch (e) { return false; } })();
  let voices = 0;
  const lastAt = Object.create(null);      // 每类音效的最小间隔控制
  const NOISE = new Map();                 // 噪声缓冲缓存（按 0.1s 取整）

  // 每类音效最小间隔（ms）——AI 阶段动作密集时的"防爆音"闸门
  const GAP = {
    move: 110, attack: 150, arty: 220, result: 150, air: 400, dice: 300, elim: 200,
    capture: 260, phase: 600, reinforce: 350, buff: 90, unsupply: 300, exit: 600,
    click: 45, page: 260, briefing: 55, dossier: 400, warning: 400, weather: 800,
    over: 1200, defeat: 1200,
  };

  function now() { return ctx ? ctx.currentTime : 0; }

  function init() {
    if (ready) { resume(); return true; }
    const _dbg = [];
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { console.error('[SFX] no AudioContext'); return false; }
      _dbg.push('AC ok');
      ctx = new AC();
      _dbg.push('ctx ok state=' + ctx.state);
      comp = ctx.createDynamicsCompressor();
      _dbg.push('comp ok');
      comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.18;
      _dbg.push('comp-set ok');
      master = ctx.createGain();
      _dbg.push('master ok');
      master.gain.value = MASTER_VOL;
      _dbg.push('master-vol ok');
      /* 27k 混响链: 干声直达 + 湿声经卷积混响——所有音效自动获得战场空间感 */
      comp.connect(master);
      try {
        const irLen = Math.floor(ctx.sampleRate * 1.2);
        const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const d = irBuf.getChannelData(ch);
          for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.6);
        }
        const conv = ctx.createConvolver();
        conv.buffer = irBuf;
        const send = ctx.createGain(); send.gain.value = 0.32;
        const wet = ctx.createGain(); wet.gain.value = 0.6;
        comp.connect(send); send.connect(conv); conv.connect(wet); wet.connect(master);
      } catch (e) { /* 混响失败不影响干声 */ }
      master.connect(ctx.destination);
      muted = globalThis.localStorage && globalThis.localStorage.getItem(KEY) === 'off';
      ready = true;
      resume();
      _dbg.push('ready=true');
      if (typeof console !== 'undefined') console.log('[SFX.init]', _dbg.join(' → '));
      return true;
    } catch (e) {
      if (typeof console !== 'undefined') console.error('[SFX.init] THROW at', _dbg.join(' → '), e.message);
      ready = false; return false;
    }
  }
  function resume() {
    try {
      if (ctx && ctx.state === 'suspended') { ctx.resume(); }
    } catch (e) { /* 忽略 */ }
  }
  /* 27k2: 每次用户交互都确保 context 处于 running——浏览器可能在任意时刻挂起 context */
  function ensureRunning() {
    try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* 忽略 */ }
  }
  function isMuted() { return muted; }
  function setMuted(m) {
    muted = !!m;
    try { if (globalThis.localStorage) globalThis.localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch (e) { /* 忽略 */ }
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, now(), 0.02);
  }
  function toggle() { setMuted(!muted); return muted; }

  /* ---------------- 合成基元 ---------------- */
  function noiseBuffer(sec) {
    const key = Math.max(1, Math.round(sec * 10));
    if (NOISE.has(key)) return NOISE.get(key);
    const n = Math.max(1, Math.floor(ctx.sampleRate * (key / 10)));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    NOISE.set(key, buf);
    return buf;
  }

  // 噪声打击：type = lowpass | bandpass | highpass
  function noiseHit(o) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(o.dur || 0.3);
    f.type = o.type || 'lowpass';
    f.frequency.value = o.freq || 800;
    if (o.q) f.Q.value = o.q;
    const t = o.t || now();
    const peak = o.gain === undefined ? 0.5 : o.gain;
    const a = o.attack === undefined ? 0.005 : o.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.3));
    if (o.sweepTo) {
      f.frequency.setValueAtTime(o.freq || 800, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t + (o.dur || 0.3));
    }
    src.connect(f); f.connect(g); g.connect(comp);
    src.start(t); src.stop(t + (o.dur || 0.3) + 0.05);
    return o.dur || 0.3;
  }

  // 单音/滑音
  function tone(o) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    const t = o.t || now(), dur = o.dur || 0.2;
    const f0 = o.f0 || 220, f1 = o.f1 === undefined ? f0 : o.f1;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const peak = o.gain === undefined ? 0.2 : o.gain;
    const a = o.attack === undefined ? 0.006 : o.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(comp);
    osc.start(t); osc.stop(t + dur + 0.05);
    return dur;
  }

  // 短促脉冲串（机枪/步枪点射、电台电键）
  function burst(o) {
    const n = o.n || 4, gap = o.gap || 0.075, t0 = o.t || now();
    for (let i = 0; i < n; i++) {
      const t = t0 + i * gap * (o.ramp ? (1 - i * 0.06) : 1);
      noiseHit({ t, dur: o.dur || 0.05, type: o.type || 'bandpass', freq: o.freq || 1600,
        q: o.q || 1.2, gain: (o.gain === undefined ? 0.4 : o.gain) * (1 - i * 0.06) });
      if (o.thump) tone({ t, f0: o.thump, f1: o.thump * 0.5, dur: 0.06, gain: 0.16, type: 'triangle' });
    }
    return n * gap + (o.dur || 0.05);
  }

  /* ---------------- 音效库 ---------------- */
  const S = {
    // 行军：步兵脚步 / 装甲引擎 / 炮兵牵引 / 侦察车
    move(o) {
      const k = (o && o.kind) || 'foot';
      if (k === 'armor') {
        tone({ type: 'sawtooth', f0: 62, f1: 44, dur: 0.42, gain: 0.16, attack: 0.05 });
        noiseHit({ dur: 0.42, type: 'lowpass', freq: 320, gain: 0.16, attack: 0.06 });
      } else if (k === 'arty') {
        tone({ type: 'sawtooth', f0: 48, f1: 38, dur: 0.5, gain: 0.13, attack: 0.08 });
      } else if (k === 'recon') {
        tone({ type: 'sawtooth', f0: 96, f1: 72, dur: 0.26, gain: 0.09, attack: 0.04 });
        noiseHit({ dur: 0.26, type: 'bandpass', freq: 520, q: 0.8, gain: 0.08 });
      } else {                                 // 步兵脚步（两拍）
        noiseHit({ dur: 0.1, type: 'bandpass', freq: 900, q: 0.9, gain: 0.16 });
        noiseHit({ t: now() + 0.13, dur: 0.1, type: 'bandpass', freq: 760, q: 0.9, gain: 0.12 });
      }
      return 0.5;
    },
    // 交火：轻武器点射 / 坦克炮 / 混编
    attack(o) {
      const k = (o && o.kind) || 'small';
      if (k === 'tank') {
        // 坦克炮: 方波低频（有泛音听得见）+ 高频碎裂 + 金属余振
        tone({ type: 'square', f0: 120, f1: 36, dur: 0.25, gain: 0.38, attack: 0.001 });
        noiseHit({ dur: 0.5, type: 'lowpass', freq: 1100, sweepTo: 130, gain: 0.42, attack: 0.002 });
        noiseHit({ dur: 0.14, type: 'highpass', freq: 3200, gain: 0.2, attack: 0.001 });
        tone({ t: now() + 0.12, type: 'triangle', f0: 880, f1: 420, dur: 0.3, gain: 0.08 });
      } else if (k === 'mixed') {
        tone({ type: 'sawtooth', f0: 110, f1: 30, dur: 0.22, gain: 0.3, attack: 0.001 });
        burst({ n: 7, gap: 0.05, freq: 1600, dur: 0.04, gain: 0.36, thump: 72 });
        noiseHit({ dur: 0.42, type: 'lowpass', freq: 950, sweepTo: 130, gain: 0.28, attack: 0.002 });
        noiseHit({ dur: 0.1, type: 'highpass', freq: 2800, gain: 0.14, attack: 0.001 });
      } else {
        // 步兵: 密集点射 + 低频脉冲
        burst({ n: 8, gap: 0.045, freq: 1900, dur: 0.036, gain: 0.38, thump: 95, ramp: true });
        noiseHit({ dur: 0.2, type: 'lowpass', freq: 500, gain: 0.14, attack: 0.01 });
      }
      return 0.7;
    },
    // 炮击（远程）：出膛 → 0.35s 后远处爆炸回响
    arty() {
      const t = now();
      // 出膛
      tone({ t, type: 'square', f0: 85, f1: 28, dur: 0.3, gain: 0.38, attack: 0.002 });
      noiseHit({ t, dur: 0.35, type: 'lowpass', freq: 500, sweepTo: 100, gain: 0.3, attack: 0.002 });
      // 弹道哨声（频率下扫）
      tone({ t: t + 0.12, type: 'sine', f0: 1600, f1: 380, dur: 0.55, gain: 0.06, attack: 0.08 });
      // 远处爆炸（双波次）
      noiseHit({ t: t + 0.42, dur: 0.7, type: 'lowpass', freq: 380, sweepTo: 80, gain: 0.3, attack: 0.003 });
      tone({ t: t + 0.42, type: 'triangle', f0: 68, f1: 22, dur: 0.7, gain: 0.24 });
      noiseHit({ t: t + 0.62, dur: 0.9, type: 'lowpass', freq: 220, sweepTo: 70, gain: 0.18, attack: 0.03 });
      return 1.6;
    },
    // 空袭：活塞机掠过 + 落弹
    air() {
      const t = now();
      noiseHit({ t, dur: 0.85, type: 'bandpass', freq: 380, sweepTo: 900, q: 0.7, gain: 0.18, attack: 0.3 });
      noiseHit({ t: t + 0.9, dur: 0.9, type: 'lowpass', freq: 700, sweepTo: 140, gain: 0.34, attack: 0.004 });
      tone({ t: t + 0.9, type: 'sine', f0: 78, f1: 30, dur: 0.45, gain: 0.26 });
      return 1.9;
    },
    // 掷骰（查 CRT）：木骰在桌面滚动
    dice() {
      const t = now();
      for (let i = 0; i < 7; i++) {
        noiseHit({ t: t + i * 0.055, dur: 0.04, type: 'bandpass',
          freq: 1200 + Math.random() * 1400, q: 1.6, gain: 0.2 - i * 0.012 });
      }
      return 0.5;
    },
    // 结算结果（2d6 → AE/AR/EX/DR/DE）
    result(o) {
      const r = o && o.result;
      const t = now();
      if (r === 'DE' || r === 'AE') {                    // 被击破/被击溃：三层爆炸（低频闷响 + 中频碎裂 + 高频碎片）
        tone({ t, type: 'square', f0: 110, f1: 28, dur: 0.4, gain: 0.36, attack: 0.001 });
        noiseHit({ t, dur: 0.5, type: 'lowpass', freq: 1000, sweepTo: 120, gain: 0.42, attack: 0.001 });
        noiseHit({ t: t + 0.04, dur: 0.12, type: 'highpass', freq: 3600, gain: 0.18, attack: 0.001 });
        tone({ t: t + 0.15, type: 'triangle', f0: 700, f1: 180, dur: 0.4, gain: 0.1 });
      } else if (r === 'DR' || r === 'AR') {             // 撤退：引擎急退声
        tone({ type: 'sawtooth', f0: 180, f1: 340, dur: 0.18, gain: 0.14, attack: 0.01 });
        tone({ t: now() + 0.14, type: 'triangle', f0: 380, f1: 140, dur: 0.22, gain: 0.12 });
      } else if (r === 'EX') {                           // 互有损伤：双声对撞
        tone({ type: 'square', f0: 85, f1: 32, dur: 0.18, gain: 0.26, attack: 0.002 });
        noiseHit({ t, dur: 0.25, type: 'lowpass', freq: 700, sweepTo: 160, gain: 0.3 });
        noiseHit({ t: t + 0.1, dur: 0.25, type: 'lowpass', freq: 550, sweepTo: 140, gain: 0.2 });
      }
      return 0.7;
    },
    // 建制被歼
    elim() {
      const t = now();
      tone({ t, type: 'sawtooth', f0: 95, f1: 22, dur: 0.35, gain: 0.34, attack: 0.002 });
      noiseHit({ t, dur: 1.1, type: 'lowpass', freq: 900, sweepTo: 80, gain: 0.36, attack: 0.003 });
      noiseHit({ t: t + 0.08, dur: 0.3, type: 'bandpass', freq: 2400, q: 3, gain: 0.14, attack: 0.001 });
      tone({ t: t + 0.2, type: 'triangle', f0: 280, f1: 60, dur: 0.8, gain: 0.14 });
      return 1.6;
    },
    // 城镇/油库易手：钟声（三部分音 + 长衰减）
    capture() {
      const t = now();
      for (let s = 0; s < 2; s++) {
        const t0 = t + s * 0.62;
        for (const [f, g] of [[523, 0.2], [1046, 0.11], [1568, 0.05]]) {
          tone({ t: t0, type: 'sine', f0: f, dur: 1.5, gain: g, attack: 0.004 });
        }
        noiseHit({ t: t0, dur: 0.09, type: 'bandpass', freq: 2400, q: 1.4, gain: 0.14 });
      }
      return 1.8;
    },
    // 阶段切换：电台莫尔斯 + 静电（DE 更低）
    phase(o) {
      const side = (o && o.side) || 'DE';
      const base = side === 'DE' ? 460 : 640;
      const t = now();
      burst({ t, n: side === 'DE' ? 3 : 4, gap: 0.12, type: 'bandpass', freq: base, q: 4, dur: 0.075, gain: 0.2 });
      noiseHit({ t, dur: 0.6, type: 'highpass', freq: 2600, gain: 0.05, attack: 0.05 });
      return 0.8;
    },
    // 援军入场：车队引擎 + 喇叭
    reinforce() {
      const t = now();
      tone({ t, type: 'sawtooth', f0: 74, f1: 58, dur: 0.9, gain: 0.12, attack: 0.15 });
      noiseHit({ t, dur: 0.9, type: 'lowpass', freq: 420, gain: 0.1, attack: 0.2 });
      tone({ t: t + 0.35, type: 'square', f0: 392, f1: 392, dur: 0.22, gain: 0.08 });
      tone({ t: t + 0.62, type: 'square', f0: 311, f1: 311, dur: 0.3, gain: 0.07 });
      return 1.3;
    },
    // 配属支援资产：机械脆响 + 电台应答
    buff() {
      const t = now();
      noiseHit({ t, dur: 0.05, type: 'bandpass', freq: 2600, q: 2, gain: 0.24 });
      noiseHit({ t: t + 0.1, dur: 0.05, type: 'bandpass', freq: 2100, q: 2, gain: 0.18 });
      tone({ t: t + 0.2, type: 'sine', f0: 880, dur: 0.09, gain: 0.1 });
      return 0.4;
    },
    // 断补警告：低沉双脉冲（不用现代电子音）
    unsupply() {
      const t = now();
      tone({ t, type: 'triangle', f0: 168, f1: 150, dur: 0.22, gain: 0.16 });
      tone({ t: t + 0.3, type: 'triangle', f0: 142, f1: 126, dur: 0.3, gain: 0.14 });
      return 0.7;
    },
    // 操作无效（超出射程等）
    warning() {
      tone({ type: 'triangle', f0: 220, f1: 200, dur: 0.16, gain: 0.12 });
      tone({ t: now() + 0.2, type: 'triangle', f0: 165, f1: 150, dur: 0.22, gain: 0.1 });
      return 0.5;
    },
    // 德军装甲冲出马斯河（达成目标）
    exit() {
      const t = now();
      tone({ t, type: 'sawtooth', f0: 130, f1: 260, dur: 1.1, gain: 0.16, attack: 0.1 });
      tone({ t: t + 0.5, type: 'sine', f0: 1046, f1: 1046, dur: 0.3, gain: 0.1 });
      noiseHit({ t, dur: 1.2, type: 'bandpass', freq: 600, sweepTo: 1600, q: 0.7, gain: 0.12, attack: 0.3 });
      return 1.5;
    },
    // 天气切换：风
    weather() {
      noiseHit({ dur: 1.4, type: 'bandpass', freq: 420, sweepTo: 300, q: 0.5, gain: 0.1, attack: 0.5 });
      return 1.5;
    },
    // 终局：军号（胜）——德军下行+定音鼓 / 美军上行+钟
    over(o) {
      const de = (o && o.winner) === 'DE';
      const t = now();
      const seq = de ? [[392, 0], [330, 0.35], [262, 0.7]] : [[262, 0], [330, 0.3], [392, 0.6], [523, 0.9]];
      for (const [f, d] of seq) {
        tone({ t: t + d, type: 'square', f0: f, f1: f, dur: 0.42, gain: 0.12, attack: 0.02 });
        tone({ t: t + d, type: 'sawtooth', f0: f * 0.5, f1: f * 0.5, dur: 0.42, gain: 0.05 });
      }
      if (de) { tone({ t: t + 1.1, type: 'sine', f0: 96, f1: 60, dur: 1.2, gain: 0.2 }); }
      else { for (const [f, g] of [[523, 0.14], [1046, 0.07]]) tone({ t: t + 1.15, type: 'sine', f0: f, dur: 2, gain: g }); }
      return 2.4;
    },
    // 失败/落幕：低沉持续音
    defeat() {
      const t = now();
      tone({ t, type: 'sine', f0: 98, f1: 88, dur: 2.2, gain: 0.16, attack: 0.3 });
      tone({ t, type: 'triangle', f0: 147, f1: 131, dur: 1.8, gain: 0.07, attack: 0.3 });
      return 2.3;
    },
    // UI 轻击 / 翻页（弹药箱扣响、纸张）
    click() { noiseHit({ dur: 0.035, type: 'bandpass', freq: 2200, q: 2, gain: 0.16 }); return 0.05; },
    page() { noiseHit({ dur: 0.11, type: 'bandpass', freq: 1400, sweepTo: 2600, q: 0.8, gain: 0.12 }); return 0.15; },
    // 开局简报：电报纸带式的打字声（逐条气泡）
    briefing() { noiseHit({ dur: 0.03, type: 'highpass', freq: 3200, gain: 0.1 }); return 0.04; },
    // 档案卡：快门
    dossier() {
      noiseHit({ dur: 0.045, type: 'bandpass', freq: 3000, q: 2.4, gain: 0.16 });
      noiseHit({ t: now() + 0.06, dur: 0.06, type: 'bandpass', freq: 1800, q: 2, gain: 0.1 });
      return 0.2;
    },
  };

  /* ---------------- 对外接口 ---------------- */
  function play(name, opts) {
    if (!ready || muted) return false;
    ensureRunning();   // 27k2: 每次播放前确保 context 未挂起
    const fn = S[name];
    if (!fn) return false;
    const gap = GAP[name] || 60;
    const t = Date.now();
    if (lastAt[name] && t - lastAt[name] < gap) return false;
    if (voices >= MAX_VOICES && name !== 'over' && name !== 'defeat') return false;
    lastAt[name] = t;
    try {
      const dur = fn(opts) || 0.3;
      voices++;
      setTimeout(() => { voices = Math.max(0, voices - 1); }, Math.max(80, dur * 1000));
      return true;
    } catch (e) { return false; }
  }

  return { init, resume, play, toggle, setMuted, isMuted, isReady: () => ready,
    /* 供测试与调试：列出全部可用音效名（不在 UI 中出现） */
    names: () => Object.keys(GAP) };
})();
