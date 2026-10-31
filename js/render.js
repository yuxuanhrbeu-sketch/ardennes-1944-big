'use strict';
/* ============================================================
 * render.js — three.js 渲染层
 * 冬季阿登: 六角棱柱地形 + 云杉林 + 城镇 + 河流道路桥 + NATO算子
 * 职责: 场景构建 / 拾取 / 相机 / 覆盖层(移动域/攻击/炮击) / 动画特效
 * ============================================================ */
globalThis.Renderer3D = (function () {

  // 六角格外接圆半径（世界单位）。算子面固定 2.15 宽（见 spawnUnit），
  // 所以 SIZE 必须 ≥ 算子宽/2，否则算子会压到邻格上。
  // 2026-10-12 地图重制（152×96）：旧图 76×48 用 SIZE=2 刚好满屏，
  // 新图 4 倍格数 → SIZE 降到 1.3，整张棋盘才装得下（相机视距上限同步提高）。
  const SIZE = 1.3;
  const CAM_MAX_DIST = 340;             // 相机视距上限（整图取景；随地图尺寸）
  const BOARD_Y = 0;                    // 平面图: 棋盘统一高度
  const COL = { DE: 0x4a4f45, US: 0x3d5568 };

  function rnd(seed) { // 确定性的伪随机(每格一致)
    let a = seed | 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  class Renderer {
    constructor(container) {
      this.container = container;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x39424b);
      this.scene.fog = new THREE.Fog(0x39424b, 320, 760);
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      // 触屏设备 devicePixelRatio 常到 3, 满棋盘 120+ 算子会明显掉帧, 按指针类型压到 1.5
      const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
      container.appendChild(this.renderer.domElement);

      // 平面图光照: 均匀天光 + 轻微方向光给算子立体感(总强度≈1.1, 避免底色过曝发白)
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8f959c, 0.74));
      const dir = new THREE.DirectionalLight(0xfff6e8, 0.40);
      dir.position.set(-40, 80, 30);
      this.scene.add(dir);

      // 相机控制状态(平面图: 固定垂直俯视, 仅平移缩放)
      this.cam = { tx: 0, tz: 40, yaw: 0, pitch: 1.52, dist: 95 };
      this._bindControls();
      this._clock = new THREE.Clock();
      this._anims = [];
      this.animScale = 1;        // 原版39轮移植: AI 阶段由 UI 调低加速动画, 人类操作保持 1
      this.skipMoveAnim = false;  // 极速档: 不播移动缓动直接落位(纯表现层)
      this._effects = [];
      this._unitMeshes = new Map();
      this._hlMat = new THREE.LineBasicMaterial({ color: 0xd8c48a, transparent: true, opacity: 0.3, depthWrite: false });
      /* 26c: 指挥部金框（常亮, 提示该单位重要） */
      this._hqMat = new THREE.LineBasicMaterial({ color: 0xffe680, transparent: true, opacity: 1.0, depthWrite: false, blending: THREE.AdditiveBlending });   // 26c2: 加色混合=发光感
      /* 26c3: 光晕/粗边带共享材质（呼吸由主循环统一驱动） */
      this._hqGlowMat = new THREE.MeshBasicMaterial({ map: this._hqGlowTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      this._hqBandMat = new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.highlightSide = null;   // 25c: 人类操作阶段阵营(DE/US), 由 ui 维护; null=不高亮   // uid -> group

      /* 26c3: 指挥部光晕纹理（径向渐变, 懒生成一次） */
      this._hqGlowTex = (() => {
        const c = document.createElement('canvas'); c.width = 128; c.height = 128;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255, 226, 140, 0.85)');
        grad.addColorStop(0.55, 'rgba(255, 210, 100, 0.38)');
        grad.addColorStop(1, 'rgba(255, 200, 80, 0)');
        g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c); return t;
      })();
      this._overlay = [];             // 覆盖层网格池
      this._pathDots = [];
      this._snow = null;
      this._raycaster = new THREE.Raycaster();
      /* 27j: Raycaster 对 Line/Points 的拾取阈值默认 1 个世界单位——单位描边
         (呼吸金框/HQ 常亮框, LineSegments, 且 Raycaster 不跳过 invisible) 会把
         可拾取体积外扩约半格, 密集战线上点击空蓝格时射线擦中邻格描边、
         被算子优先拾取截胡 → 移动被吞("有时能动有时不能动"的根因)。 */
      this._raycaster.params.Line.threshold = 0.01;
      this._raycaster.params.Points.threshold = 0.01;
      this._pointer = new THREE.Vector2();
      this.onHexClick = null;
      this.onHexHover = null;
      this._hoverKey = null;
      window.addEventListener('resize', () => this._resize());
      this._resize();
      this._loop();
    }

    /* ---------------- 地图构建 ---------------- */
    /* ---------------- 地图美术工具 ---------------- */
    hexTopY(h) { return BOARD_Y; }
    hexWorld(c, r) { return { x: Hex.worldX(c, r, SIZE), z: Hex.worldZ(r, SIZE) }; }

    // 与地形棱柱完全同形同朝向的六角平面(用于地表图案贴花), y 由调用方给
    _hexPlaneGeometry(radius, y) {
      const pos = [0, y, 0], uv = [0.5, 0.5], idx = [];
      const R = radius;
      for (let a = 0; a < 6; a++) {
        const ang = Math.PI / 2 + a * Math.PI / 3;
        pos.push(R * Math.cos(ang), y, R * Math.sin(ang));
        uv.push(0.5 + 0.5 * Math.cos(ang), 0.5 + 0.5 * Math.sin(ang));
      }
      for (let a = 0; a < 6; a++) idx.push(0, 1 + a, 1 + ((a + 1) % 6));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    // 地表图案贴花纹理: 一次性生成, 供 InstancedMesh 复用
    _decalTexture(kind) {
      if (this._decalTex && this._decalTex[kind]) return this._decalTex[kind];
      this._decalTex = this._decalTex || {};
      const S = 128;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const ctx = cv.getContext('2d');
      const spruce = (x, y, s, col) => {               // 云杉: 三角+短干
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s * 0.62, y + s * 0.55);
        ctx.lineTo(x - s * 0.62, y + s * 0.55);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(x - s * 0.09, y + s * 0.5, s * 0.18, s * 0.34);
      };
      if (kind === 'forest') {
        spruce(42, 44, 21, '#2c4327'); spruce(84, 38, 18, '#33502c');
        spruce(62, 82, 23, '#2a4025'); spruce(98, 78, 16, '#38562f');
        spruce(24, 86, 17, '#33502c');
      } else if (kind === 'mountain') {                 // 山脊折线
        ctx.strokeStyle = '#584f45'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
        for (const [ox, oy, w, h] of [[0, 96, 44, 40], [40, 92, 52, 48], [88, 98, 36, 34]]) {
          ctx.beginPath();
          ctx.moveTo(ox, oy); ctx.lineTo(ox + w / 2, oy - h); ctx.lineTo(ox + w, oy);
          ctx.stroke();
        }
      } else if (kind === 'marsh') {                    // 沼泽: 短横线
        ctx.strokeStyle = '#3d5c50'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const y = 30 + i * 12, w = 26 + (i % 3) * 12, x = 22 + ((i * 17) % 34);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
        }
      } else {                                          // rough: 细点(草坡质感)
        ctx.fillStyle = '#6d6141';
        for (let i = 0; i < 26; i++) {
          const x = 16 + ((i * 37) % 96), y = 18 + ((i * 53) % 92);
          ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this._decalTex[kind] = tex;
      return tex;
    }

    // 一批格子的地表贴花层(同材质, 一次 draw call)
    _decalLayer(keys, kind, y, opts) {
      const o = opts || {};
      const geo = this._hexPlaneGeometry(SIZE * (o.inset || 0.94), y);
      const mat = new THREE.MeshBasicMaterial({
        map: this._decalTexture(kind), transparent: true, alphaTest: 0.25,
        opacity: o.opacity == null ? 0.55 : o.opacity, depthWrite: false, side: THREE.DoubleSide,
      });
      const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, keys.length));
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const sc = new THREE.Vector3();
      let i = 0;
      for (const k of keys) {
        const h = this.map.hexes.get(k);
        if (!h) continue;
        const w = this.hexWorld(h.c, h.r);
        const r1 = rnd(h.c * 73856093 ^ h.r * 19349663);
        const rot = r1() * Math.PI * 2;
        const s = (0.88 + r1() * 0.26) * (o.scale || 1);
        q.setFromAxisAngle(up, rot);
        sc.set(s, 1, s);
        m4.compose(new THREE.Vector3(w.x, y, w.z), q, sc);
        inst.setMatrixAt(i++, m4);
      }
      inst.count = i;
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
      return inst;
    }

    // 折线 → 平滑缎带几何(河/路共用): 沿实际六角链走, 圆角化拐折
    _ribbonGeometry(pts, width, y, tension) {
      const v3 = pts.map(p => new THREE.Vector3(p.x, y, p.z));
      const curve = new THREE.CatmullRomCurve3(v3, false, 'catmullrom', tension == null ? 0.5 : tension);
      const n = Math.max(16, Math.min(900, pts.length * 10));
      const samples = curve.getPoints(n);
      const pos = [], uv = [], idx = [];
      const half = width / 2;
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const nx = -dz, nz = dx;
        pos.push(p.x + nx * half, y, p.z + nz * half, p.x - nx * half, y, p.z - nz * half);
        uv.push(0, i / samples.length, 1, i / samples.length);
      }
      for (let i = 0; i < samples.length - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    // 一组地理折线(河/路) → 世界坐标六角链(按地图边界切成若干段)
    _geoRuns(polylines) {
      const runs = [];
      for (const pts of polylines) {
        let run = [];
        for (let i = 0; i < pts.length - 1; i++) {
          for (const p of Hex.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) {
            if (!this.map.hexes.has(Hex.key(p.c, p.r))) { if (run.length > 1) runs.push(run); run = []; continue; }
            const w = this.hexWorld(p.c, p.r);
            const last = run[run.length - 1];
            if (!last || last.x !== w.x || last.z !== w.z) run.push(w);
          }
        }
        if (run.length > 1) runs.push(run);
      }
      return runs;
    }

    // 缎带层: 同色多段合并为一个 Mesh 数组
    _ribbonLayer(runs, width, y, color, opacity, tension) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: opacity != null && opacity < 1, opacity: opacity == null ? 1 : opacity,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const grp = new THREE.Group();
      for (const run of runs) {
        if (run.length < 2) continue;
        grp.add(new THREE.Mesh(this._ribbonGeometry(run, width, y, tension), mat));
      }
      this.scene.add(grp);
      return grp;
    }

    buildWorld(map, game) {
      this.map = map;
      this.game = game;
      /* 26p: 先回收上一次的批渲染网格（重建世界时不能留在场景里） */
      if (this._instBox) {
        this.scene.remove(this._instBox); this.scene.remove(this._instShadow);
        this._instBox.geometry.dispose(); this._instBox.material.dispose();
        this._instShadow.geometry.dispose(); this._instShadow.material.dispose();
      }
      this._instBox = null; this._instShadow = null; this._instFree = []; this._instNext = 0;
      // 清空旧场景(保留灯光)
      for (const obj of [...this.scene.children]) {
        if (obj.isDirectionalLight || obj.isHemisphereLight) continue;
        this.scene.remove(obj);
      }
      this._unitMeshes.clear();
      const cols = map.cols, rows = map.rows;

      // —— 平面六角地形(颜色区分地形, 无缝蜂窝对齐) ——
      // CylinderGeometry 默认顶点位于±Z(南北尖), 恰为 pointy-top, 与 odd-r 世界坐标吻合, 不可再旋转
      const hexGeo = new THREE.CylinderGeometry(SIZE * 1.004, SIZE * 1.004, 0.1, 6, 1);
      hexGeo.translate(0, -0.05, 0);          // 底 y=-0.1, 顶 y=0
      const hexMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const inst = new THREE.InstancedMesh(hexGeo, hexMat, cols * rows);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const snowMix = 0.055;
      let i = 0;
      for (const [k, h] of map.hexes) {
        const w = this.hexWorld(h.c, h.r);
        m4.compose(new THREE.Vector3(w.x, BOARD_Y, w.z), q, new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(i, m4);
        // 平面制图配色: 地形色 + 每格微差(破塑料感) + 高程晕渲(平地也能看出起伏)
        const base = new THREE.Color(DATA.TERRAIN[h.terrain].col);
        const r1 = rnd(h.c * 73856093 ^ h.r * 19349663)();
        const jitter = (r1 - 0.5) * 0.032;
        const relief = (h.elev - 0.45) * 0.075;
        base.offsetHSL(0, h.terrain === 'forest' ? 0.06 : 0.02, jitter + relief);
        base.lerp(new THREE.Color(0xdfe8f2), snowMix);            // 冬季冷调
        if (h.river) base.lerp(new THREE.Color(0x4d86b8), 0.14);   // 河格淡青(主体水面走缎带层)
        if (h.road && !h.town) base.lerp(new THREE.Color(0x8a7b5e), 0.12);
        inst.setColorAt(i, base);
        i++;
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.scene.add(inst);
      this._hexMesh = inst;

      // —— 地表图案贴花: 云杉林 / 山脊 / 沼泽水纹 / 丘陵草点(平面贴花, 不遮挡算子) ——
      {
        const keysOf = t => {
          const out = [];
          for (const [k, h] of map.hexes) if (h.terrain === t && !h.river && !h.road && !h.town) out.push(k);
          return out;
        };
        this._decalLayer(keysOf('rough'), 'rough', BOARD_Y + 0.030, { opacity: 0.34 });
        this._decalLayer(keysOf('marsh'), 'marsh', BOARD_Y + 0.032, { opacity: 0.52, scale: 1.0 });
        this._decalLayer(keysOf('mountain'), 'mountain', BOARD_Y + 0.034, { opacity: 0.65, scale: 1.0 });
        this._decalLayer(keysOf('forest'), 'forest', BOARD_Y + 0.036, { opacity: 0.62, scale: 0.95 });
      }

      // —— 六格描边(细暗线, 强化棋盘感) ——
      {
        const pts = [];
        const R = SIZE * 1.004;
        for (const [, h] of map.hexes) {
          const w = this.hexWorld(h.c, h.r);
          for (let a = 0; a < 6; a++) {
            const a1 = Math.PI / 2 + a * Math.PI / 3, a2 = a1 + Math.PI / 3;
            pts.push(w.x + R * Math.cos(a1), BOARD_Y + 0.06, w.z + R * Math.sin(a1));
            pts.push(w.x + R * Math.cos(a2), BOARD_Y + 0.06, w.z + R * Math.sin(a2));
          }
        }
        const og = new THREE.BufferGeometry();
        og.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const lines = new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: 0x2f3527, transparent: true, opacity: 0.33 }));
        this.scene.add(lines);
        // 同一条网格再叠一层浅色微光: 让密林/深色地形上的六角边界也读得出来(浮雕感)
        const lines2 = new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.11 }));
        lines2.position.y = -0.004;
        this.scene.add(lines2);
      }

      // —— 图廓(地图纸边框): 让棋盘像一张完成的作战地图 ——
      {
        const pad = SIZE * 1.5;
        const x0 = -pad, x1 = SIZE * Math.sqrt(3) * cols + pad;
        const z0 = -pad, z1 = SIZE * 1.5 * rows + pad;
        const w = x1 - x0, d = z1 - z0, t = 1.0;
        const frameMat = new THREE.MeshBasicMaterial({ color: 0x2b3139 });
        const mk = (sx, sz, px, pz) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.14, sz), frameMat);
          m.position.set(px, BOARD_Y + 0.02, pz);
          this.scene.add(m);
        };
        mk(w + t * 2, t, (x0 + x1) / 2, z0 - t / 2);
        mk(w + t * 2, t, (x0 + x1) / 2, z1 + t / 2);
        mk(t, d, x0 - t / 2, (z0 + z1) / 2);
        mk(t, d, x1 + t / 2, (z0 + z1) / 2);
      }

      // —— 河流: 沿实际河格链的平滑缎带(浅色河床 + 深色主流), 取代旧的分段方块 ——
      {
        const runs = this._geoRuns(Object.keys(DATA.RIVERS).map(n => DATA.RIVERS[n]));
        this._ribbonLayer(runs, 0.66, BOARD_Y + 0.100, 0x4a7ba6, 0.95);   // 河岸深色边
        this._ribbonLayer(runs, 0.50, BOARD_Y + 0.106, 0x9dc3dd, 1.0);    // 水面浅色
      }

      // —— 公路: 深色路基 + 浅色路面(双色缎带, 转折用低张力保持公路的直) ——
      {
        const runs = this._geoRuns(Object.keys(DATA.ROADS).map(n => DATA.ROADS[n]));
        this._ribbonLayer(runs, 0.56, BOARD_Y + 0.130, 0x54452f, 1.0, 0.12);    // 路基
        this._ribbonLayer(runs, 0.24, BOARD_Y + 0.136, 0xc4ac7e, 1.0, 0.12);    // 路面
      }

      // —— 桥梁(跨越河流的道路格: 深色桥体 + 浅色桥面, 长轴顺道路方向) ——
      {
        const keys = [...map.bridges];
        const bridgeGeo = new THREE.BoxGeometry(SIZE * 1.56, 0.05, 0.9);
        const deckGeo = new THREE.BoxGeometry(SIZE * 1.5, 0.05, 0.4);
        const bridgeInst = new THREE.InstancedMesh(bridgeGeo, new THREE.MeshBasicMaterial({ color: 0x443421 }), Math.max(1, keys.length));
        const deckInst = new THREE.InstancedMesh(deckGeo, new THREE.MeshBasicMaterial({ color: 0xc8ae7f }), Math.max(1, keys.length));
        let bi = 0;
        for (const k of keys) {
          const h = map.hexes.get(k);
          const w = this.hexWorld(h.c, h.r);
          let dir = 0;
          for (const n of Hex.neighbors(h.c, h.r)) {
            const nh = map.hexes.get(Hex.key(n.c, n.r));
            if (nh && nh.road && !nh.river) { const nw = this.hexWorld(n.c, n.r); dir = Math.atan2(nw.x - w.x, nw.z - w.z); break; }
          }
          const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, dir, 0));
          m4.compose(new THREE.Vector3(w.x, BOARD_Y + 0.165, w.z), rot, new THREE.Vector3(1, 1, 1));
          bridgeInst.setMatrixAt(bi, m4);
          m4.compose(new THREE.Vector3(w.x, BOARD_Y + 0.176, w.z), rot, new THREE.Vector3(1, 1, 1));
          deckInst.setMatrixAt(bi, m4);
          bi++;
        }
        bridgeInst.count = deckInst.count = bi;
        this.scene.add(bridgeInst);
        this.scene.add(deckInst);
      }

      // —— 城镇: 六角基座 + 街区色块 + 地名标签(不遮挡算子) ——
      const townGeo = new THREE.BoxGeometry(1.3, 0.12, 1.3);
      const townMat = new THREE.MeshLambertMaterial({ color: 0xe2dbc6 });
      const townN = map.towns.length;
      const townInst = new THREE.InstancedMesh(townGeo, townMat, townN);
      const townBase = new THREE.InstancedMesh(
        this._hexPlaneGeometry(SIZE * 0.72, BOARD_Y + 0.088),
        new THREE.MeshBasicMaterial({ color: 0x7a7160, side: THREE.DoubleSide, depthWrite: false }), townN);
      let ti2 = 0;
      this._townLabels = [];
      for (const t of map.towns) {
        const h = map.hexes.get(Hex.key(t.c, t.r));
        const w = this.hexWorld(t.c, t.r);
        const s = t.tier >= 2 ? 1.25 : 1;
        m4.compose(new THREE.Vector3(w.x, BOARD_Y + 0.2, w.z), q, new THREE.Vector3(s, 1, s));
        townInst.setMatrixAt(ti2, m4);
        m4.compose(new THREE.Vector3(w.x, BOARD_Y, w.z), q, new THREE.Vector3(t.tier >= 2 ? 1.06 : 1, 1, t.tier >= 2 ? 1.06 : 1));
        townBase.setMatrixAt(ti2, m4);
        ti2++;
        this._townLabels.push(this._makeLabel(t.name, w.x, BOARD_Y + 1.5, w.z, t.tier >= 2 ? 1.0 : 0.85));
        this.scene.add(this._townLabels[this._townLabels.length - 1]);
      }
      this.scene.add(townBase);
      this.scene.add(townInst);

      // —— 突破线(马斯河一线: 金色虚线标) ——
      const exitMat = new THREE.MeshBasicMaterial({ color: 0xd8b74a });
      const exitInst = new THREE.InstancedMesh(new THREE.BoxGeometry(SIZE * 1.2, 0.06, 0.18), exitMat, Math.ceil(rows / 2) + 4);
      let ei = 0;
      for (let r = 1; r < rows; r += 2) {
        const h = map.hexes.get(Hex.key(1, r));
        if (!h) continue;
        const w = this.hexWorld(1, r);
        m4.compose(new THREE.Vector3(w.x, BOARD_Y + 0.16, w.z), q, new THREE.Vector3(1, 1, 1));
        exitInst.setMatrixAt(ei++, m4);
      }
      exitInst.count = ei;
      this.scene.add(exitInst);

      // 更新雪与雾
      this._initSnow();
      this.setWeather(this.game ? this.game.state.weather : 'fog');
      // 相机可移动范围(随地图)
      this._bounds = { minX: -14, maxX: SIZE * Math.sqrt(3) * cols + 14, minZ: -14, maxZ: SIZE * 1.5 * rows + 14 };
      this._updateCamera();
    }

    _makeLabel(text, x, y, z, scale) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.font = `bold ${Math.round(36)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // 半透明铭牌底 + 描边字: 在密林/丘陵底色上也能读清(平面制图标签规范)
      const tw = Math.min(236, ctx.measureText(text).width + 30);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(128 - tw / 2, 9, tw, 46, 10); else ctx.rect(128 - tw / 2, 9, tw, 46);
      ctx.fillStyle = 'rgba(22,26,23,0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(242,234,214,0.30)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 7;
      ctx.strokeText(text, 128, 33);
      ctx.fillStyle = '#f8f1de';
      ctx.fillText(text, 128, 33);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sp = new THREE.Sprite(mat);
      sp.position.set(x, y, z);
      sp.scale.set(6.2 * scale, 1.55 * scale, 1);
      sp.renderOrder = 5;
      return sp;
    }

    /* ---------------- 算子面纹理 ---------------- */
    unitCounterTexture(u) {
      const cv = document.createElement('canvas');
      // 26p: 220→176（绘图坐标仍按 220 设计，等比缩放）——605 个算子的贴图显存降约 36%，
      // 开局上传卡顿明显减轻；算子面在屏幕上的实际像素远小于 176，肉眼无差。
      const S = 176, K = S / 220;
      cv.width = S; cv.height = S;
      const ctx = cv.getContext('2d');
      ctx.scale(K, K);
      const de = u.side === 'DE';
      const bg = de ? '#565c4c' : '#33547a';
      const edge = de ? '#20241c' : '#16283c';
      // 底
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 220, 220);
      ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 204, 204);
      ctx.strokeStyle = edge; ctx.lineWidth = 3; ctx.strokeRect(14, 14, 192, 192);
      // NATO 兵种符号
      const sym = DATA.TYPES[u.type].sym;
      ctx.strokeStyle = '#f0ead8'; ctx.fillStyle = '#f0ead8'; ctx.lineWidth = 6;
      const sx = 40, sy = 48, sw = 140, sh = 92;
      ctx.strokeRect(sx, sy, sw, sh);
      if (sym === 'inf') { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sw, sy + sh); ctx.moveTo(sx + sw, sy); ctx.lineTo(sx, sy + sh); ctx.stroke(); }
      else if (sym === 'armor') { ctx.beginPath(); ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2 - 8, sh / 2 - 8, 0, 0, Math.PI * 2); ctx.stroke(); }
      else if (sym === 'mech') { ctx.beginPath(); ctx.moveTo(sx, sy + sh); ctx.lineTo(sx + sw, sy); ctx.stroke(); ctx.beginPath(); ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2 - 8, sh / 2 - 8, 0, 0, Math.PI * 2); ctx.stroke(); }
      else if (sym === 'recon') { ctx.beginPath(); ctx.moveTo(sx + sw / 2, sy); ctx.lineTo(sx + sw / 2, sy + sh); ctx.stroke(); }
      else if (sym === 'arty') { ctx.beginPath(); ctx.arc(sx + sw / 2, sy + sh / 2, 9, 0, Math.PI * 2); ctx.fill(); }
      else if (sym === 'td') { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sw, sy + sh); ctx.stroke(); ctx.beginPath(); ctx.arc(sx + sw / 2, sy + sh / 2, 9, 0, Math.PI * 2); ctx.fill(); }
      else if (sym === 'hq') { ctx.beginPath(); ctx.moveTo(sx + sw / 2, sy); ctx.lineTo(sx + sw / 2, sy + sh); ctx.moveTo(sx + sw / 2, sy); ctx.lineTo(sx + sw / 2 + 34, sy + 16); ctx.lineTo(sx + sw / 2, sy + 32); ctx.fill(); }
      else if (sym === 'abn') { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sw / 2, sy + sh); ctx.lineTo(sx + sw, sy); ctx.stroke(); }
      else if (sym === 'eng') {   // 工兵: 桥梁跨架符号(NATO 工兵)
        ctx.beginPath();
        ctx.moveTo(sx + 14, sy + sh - 18); ctx.lineTo(sx + 14, sy + sh / 2);
        ctx.lineTo(sx + sw - 14, sy + sh / 2); ctx.lineTo(sx + sw - 14, sy + sh - 18);
        ctx.moveTo(sx + 14, sy + sh / 2 + 10); ctx.lineTo(sx + sw - 14, sy + sh / 2 + 10);
        ctx.stroke();
      }
      // 部队缩写
      ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f6f1e2';
      ctx.fillText(u.abbr.slice(0, 6), 110, 168, 196);
      // 攻防移
      ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('攻' + u.atk, 18, 36);
      ctx.textAlign = 'center';
      ctx.fillText('防' + u.def, 110, 36);
      ctx.textAlign = 'right';
      ctx.fillText('移' + u.mov, 202, 36);
      // 增益角标: 反(反坦克小组) 工(野战工事) 补(补充兵员) 急(炮火急袭) 空(防空火力)
      ctx.font = 'bold 19px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const marks = [];
      if (u.attach && u.attach.at) marks.push('反');
      if (u.attach && u.attach.fort) marks.push('工');
      if (u.attach && u.attach.repl) marks.push('补');
      if (u.fireSupport > 0) marks.push('急');
      if (u.attach && u.attach.aa) marks.push('空');
      marks.forEach((m, i) => { ctx.fillStyle = '#ffd766'; ctx.fillText(m, 146 + i * 21, 17); });
      // 被动状态标记(2026-10): 左下角, 与左上角标错开(角标行最多 5 个字已接近右边界)
      if (Combat && Combat.passiveState && this.game) {
        const ps = Combat.passiveState(this.game, u);
        if (ps.key) {
          ctx.font = 'bold 17px "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillStyle = ps.key === 'lastStand' ? '#e8b06a' : ps.key === 'broken' ? '#f0796a' : '#8ec7f0';
          ctx.fillText(ps.key === 'lastStand' ? '困兽' : ps.key === 'broken' ? '厌战' : '协同', 14, 200);
        }
      }
      // 组织度(具体数字, 与攻防移同风格)
      const frac = Math.max(0, u.org / u.maxOrg);
      ctx.font = 'bold 29px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = frac > 0.6 ? '#93d97f' : frac > 0.3 ? '#ecc84e' : '#f0796a';
      ctx.fillText('组织 ' + u.org, 110, 203, 190);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    /* —— 26p 算子底座/落影批渲染 —— */
    _instBox = null;
    _instShadow = null;
    _instFree = [];
    _instNext = 0;
    _instCap = 1600;
    _tmpM4 = null;

    _initInst() {
      const cap = this._instCap;
      const boxGeo = new THREE.BoxGeometry(2.15, 0.55, 2.15);
      const boxMat = new THREE.MeshLambertMaterial({ color: 0xffffff });   // 颜色走 instanceColor
      const shGeo = new THREE.CircleGeometry(1.28, 6);
      shGeo.rotateX(-Math.PI / 2);
      const shMat = new THREE.MeshBasicMaterial({ color: 0x10140f, transparent: true, opacity: 0.3, depthWrite: false });
      this._instBox = new THREE.InstancedMesh(boxGeo, boxMat, cap);
      this._instShadow = new THREE.InstancedMesh(shGeo, shMat, cap);
      this._instBox.frustumCulled = false;
      this._instShadow.frustumCulled = false;
      this._tmpM4 = this._tmpM4 || new THREE.Matrix4();
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      const white = new THREE.Color(0xffffff);
      for (let i = 0; i < cap; i++) {
        this._instBox.setMatrixAt(i, zero);
        this._instShadow.setMatrixAt(i, zero);
        this._instBox.setColorAt(i, white);
      }
      this._instBox.instanceMatrix.needsUpdate = true;
      this._instShadow.instanceMatrix.needsUpdate = true;
      this.scene.add(this._instShadow);
      this.scene.add(this._instBox);
      this._instNext = 0; this._instFree = [];
    }

    _allocInst() {
      if (!this._instBox) this._initInst();
      if (this._instFree.length) return this._instFree.pop();
      if (this._instNext >= this._instCap) return -1;   // 超容量 → 调用方回退独立网格
      return this._instNext++;
    }

    _placeInst(idx, x, y, z, u) {
      if (!this._instBox || idx < 0) return;
      const m = this._tmpM4;
      m.makeTranslation(x, y + 0.28, z);
      this._instBox.setMatrixAt(idx, m);
      m.makeTranslation(x, y + 0.015, z);
      this._instShadow.setMatrixAt(idx, m);
      this._instBox.instanceMatrix.needsUpdate = true;
      this._instShadow.instanceMatrix.needsUpdate = true;
      if (u) {
        const c = new THREE.Color(u.side === 'DE' ? 0x5a614e : 0x35597f);
        if (!u.supplied) c.offsetHSL(0, 0, -0.06);
        this._instBox.setColorAt(idx, c);
        if (this._instBox.instanceColor) this._instBox.instanceColor.needsUpdate = true;
      }
    }

    _releaseInst(g) {
      const idx = g && g.userData ? g.userData.inst : -1;
      if (idx === undefined || idx < 0 || !this._instBox) return;
      const zero = (this._tmpM4 || (this._tmpM4 = new THREE.Matrix4())).makeScale(0, 0, 0);
      this._instBox.setMatrixAt(idx, zero);
      this._instShadow.setMatrixAt(idx, zero);
      this._instBox.instanceMatrix.needsUpdate = true;
      this._instShadow.instanceMatrix.needsUpdate = true;
      this._instFree.push(idx);
      g.userData.inst = -1;
    }

    _syncInst(g) {
      if (!g || !g.userData || g.userData.inst === undefined || g.userData.inst < 0) return;
      this._placeInst(g.userData.inst, g.position.x, g.position.y, g.position.z, null);
    }

    spawnUnit(u) {
      const g = new THREE.Group();
      const de = u.side === 'DE';
      const topMat = new THREE.MeshBasicMaterial({ map: this.unitCounterTexture(u) });
      const top = new THREE.Mesh(new THREE.PlaneGeometry(2.06, 2.06), topMat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.565;
      g.add(top);
      g.userData.top = top;   // 26p: 极远景 LOD 用
      // 注: 早期版本在算子上方挂过一个"组织度徽章 Sprite"(y=1.65)。相机是近乎垂直俯视,
      // 那个 sprite 投影下来正好压在算子面的 NATO 符号上, 且与算子底部的"组织 X"重复显示,
      // 故按用户要求移除(2026-10); 组织度只保留算子面底部与左侧单位面板两处。
      // 25c: 未移动算子金框呼吸高亮（方框贴算子外沿, 与算子同高）
      const hlGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.3, 0.58, 2.3));
      const hl = new THREE.LineSegments(hlGeo, this._hlMat);
      hl.visible = false;   // 26p: 只在 AI 阶段高亮该方未动单位时显示（此前常亮=白掏 600 次 draw call）
      g.add(hl);
      g.userData.hl = hl;
      /* 26c: 指挥部额外一圈常亮金框（比呼吸框外 0.06, 更亮） */
      if (u.isHQ) {
        const hqFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.42, 0.62, 2.42)), this._hqMat);
        hqFrame.userData.isHqFrame = true;
        g.add(hqFrame);
      }
      g.userData.unit = u;
      g.userData.uid = u.uid;
      g.userData.lastOrg = u.org;
      const w = this.hexWorld(u.c, u.r);
      const wy = this.hexTopY(this.hexAt(u.c, u.r)) + 0.02;
      g.position.set(w.x, wy, w.z);
      /* 26p: 落影 + 立体底座改由全局 InstancedMesh 批渲染（每帧 2 次 draw call 代替每算子 2 次）。
         容量兜底：极端情况(>1600 算子)退回独立网格，保证不会消失。 */
      const idx = this._allocInst();
      if (idx >= 0) {
        g.userData.inst = idx;
        this._placeInst(idx, w.x, wy, w.z, u);
      } else {
        g.userData.inst = -1;
        const shadowGeo = new THREE.CircleGeometry(1.28, 6);
        shadowGeo.rotateX(-Math.PI / 2);
        const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x10140f, transparent: true, opacity: 0.3, depthWrite: false }));
        shadow.position.y = 0.015;
        g.add(shadow);
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.55, 2.15),
          new THREE.MeshLambertMaterial({ color: de ? 0x5a614e : 0x35597f }));
        box.position.y = 0.28;
        g.add(box);
        if (this._lodFar) { shadow.visible = false; box.visible = false; }
      }
      if (this._lodFar) hl.visible = false;
      if (this.cam.dist > 260) top.visible = false;   // 26p: 极远景新入场单位直接套用 LOD
      this._unitMeshes.set(u.uid, g);
      this.scene.add(g);
      return g;
    }

    refreshUnit(u) {
      const g = this._unitMeshes.get(u.uid);
      if (!g) return;
      if (!u.alive || u.exited) {
        this.scene.remove(g);
        this._unitMeshes.delete(u.uid);
        this._releaseInst(g);   // 26p: 释放批渲染槽位
        this._disposeObject(g, [this._hlMat, this._hqMat]);   // 26p: 阵亡算子整组资源回收（共享材质除外）
        return;
      }
      // 组织度或增益变化 → 重绘算子面(组织度数字在算子面底部)
      const buffKey = (u.attach ? (u.attach.at ? '1' : '0') + (u.attach.fort ? '1' : '0') + (u.attach.repl ? '1' : '0') + (u.attach.aa ? '1' : '0') : '0000') + (u.fireSupport > 0 ? '1' : '0') +
        (this.game && Combat.passiveState ? (Combat.passiveState(this.game, u).key || 'x') : '');
      if (g.userData.lastOrg !== u.org || g.userData.lastBuffKey !== buffKey) {
        g.userData.lastOrg = u.org;
        g.userData.lastBuffKey = buffKey;
        const top = g.children.find(c => c.geometry && c.geometry.type === 'PlaneGeometry');
        if (top) {
          const old = top.material.map;
          top.material.map = this.unitCounterTexture(u);
          top.material.needsUpdate = true;
          if (old) old.dispose();
        }
      }
      // 位置同步(若被引擎直接移动)
      const w = this.hexWorld(u.c, u.r);
      const wy = this.hexTopY(this.hexAt(u.c, u.r)) + 0.02;
      g.position.set(w.x, wy, w.z);
      /* 26p: 批渲染的底座/落影跟随位置；断补/换阵营靠 instanceColor 着色 */
      if (g.userData.inst >= 0) {
        this._placeInst(g.userData.inst, w.x, wy, w.z, u);
      } else {
        const box = g.children.find(c => c.geometry && c.geometry.type === 'BoxGeometry');
        if (box) {
          box.material.color.setHex(u.side === 'DE' ? 0x5a614e : 0x35597f);
          if (!u.supplied) box.material.color.offsetHSL(0, 0, -0.06);
        }
      }
    }

    setHighlightSide(side) { this.highlightSide = side || null; }

    syncUnits(game) {
      const seen = new Set();
      for (const u of game.units) {
        if (!u.alive || u.exited) { this.refreshUnit(u); continue; }
        seen.add(u.uid);
        if (!this._unitMeshes.has(u.uid)) this.spawnUnit(u);
        this.refreshUnit(u);
      }
      for (const [uid, g] of [...this._unitMeshes]) {
        if (!seen.has(uid)) {
          this.scene.remove(g);
          this._unitMeshes.delete(uid);
          this._releaseInst(g);
          this._disposeObject(g, [this._hlMat, this._hqMat]);
        }
      }
    }

    /* 26p: 递归释放几何体/材质/贴图（sharedMats 为跨算子共用的材质, 不能 dispose） */
    _disposeObject(obj, sharedMats) {
      const shared = sharedMats || [];
      const kill = x => {
        if (x.geometry) x.geometry.dispose();
        const ms = x.material ? (Array.isArray(x.material) ? x.material : [x.material]) : [];
        for (const m of ms) {
          if (!m || shared.indexOf(m) >= 0) continue;
          if (m.map) m.map.dispose();
          m.dispose();
        }
      };
      if (obj.isObject3D && obj.children && obj.children.length) obj.traverse(kill);
      else kill(obj);
    }

    hexAt(c, r) { return this.map.hexes.get(Hex.key(c, r)); }

    /* ---------------- 覆盖层 ---------------- */
    _clearOverlay() {
      for (const m of this._overlay) {
        this.scene.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();   // 26p: 覆盖层每次选中重建, 材质必须释放
      }
      this._overlay = [];
      this._pulse = null;
      this._clearPathDots();
    }

    /* 26p: 路径点球共用一份 geo/mat, 换路径时必须连资源一起释放, 否则每次悬停累积 */
    _clearPathDots() {
      for (const d of this._pathDots) this.scene.remove(d);
      this._pathDots = [];
      if (this._pathGeo) { this._pathGeo.dispose(); this._pathGeo = null; }
      if (this._pathMat) { this._pathMat.dispose(); this._pathMat = null; }
    }

    _hexMark(c, r, color, opacity, yOff) {
      const geo = new THREE.CircleGeometry(SIZE * 0.92, 6);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(Math.PI / 6);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      const h = this.hexAt(c, r);
      const w = this.hexWorld(c, r);
      mesh.position.set(w.x, this.hexTopY(h) + (yOff || 0.12), w.z);
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this._overlay.push(mesh);
      return mesh;
    }

    /* —— 25g 行军箭头预览 —— */
    _marchArrow = [];

    clearMarchArrow() {
      for (const m of this._marchArrow) {
        this.scene.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();   // 26p: 悬停每次重画, 材质必须释放
      }
      this._marchArrow = [];
    }

    showMarchArrow(u, path, dist) {
      this.clearMarchArrow();
      if (!path || path.length < 2) return;
      const mpMax = u.mov || 6;
      const colOf = acc => (acc <= mpMax * 0.4 ? 0x7dc87a : acc <= mpMax * 0.75 ? 0xe6c85c : acc <= mpMax ? 0xe08a3c : 0xe05a4a);
      const W = 0.42;
      const addBand = (from, to, color, op) => {
        const a = this.hexWorld(from.c, from.r), b = this.hexWorld(to.c, to.r);
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (len < 0.01) return;
        const ang = Math.atan2(dx, dz);
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(W, len),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide }));
        seg.rotation.x = -Math.PI / 2; seg.rotation.z = ang;
        seg.position.set((a.x + b.x) / 2, this.hexTopY(this.hexAt(from.c, from.r)) + 0.26, (a.z + b.z) / 2);
        seg.renderOrder = 5;
        this.scene.add(seg); this._marchArrow.push(seg);
      };
      // 分段: 相邻累计档位同色合并为一段带(减少 mesh), 溢出段半透明
      let runFrom = path[0], runAcc = 0, runCol = null;
      for (let i = 1; i < path.length; i++) {
        const acc = dist.get(Hex.key(path[i].c, path[i].r)) || 0;
        const col = colOf(acc), op = acc > mpMax ? 0.45 : 0.85;
        if (runCol === null) runCol = { c: col, op };
        if (col !== runCol.c || op !== runCol.op) {
          addBand(runFrom, path[i], runCol.c, runCol.op);
          runFrom = path[i - 1]; runCol = { c: col, op };
        }
        runAcc = acc;
        if (i === path.length - 1) addBand(runFrom, path[i], runCol.c, runCol.op);
      }
      // 末端箭头(三角平面, 指向末段方向)
      const tail = path[path.length - 1], prev = path[path.length - 2];
      const a = this.hexWorld(prev.c, prev.r), b = this.hexWorld(tail.c, tail.r);
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len > 0.01) {
        const ang = Math.atan2(dx, dz);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 3),
          new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.95, depthWrite: false }));
        head.rotation.z = -ang + Math.PI;   // ConeGeometry 轴向 +Y, 俯视指向行进方向
        head.rotation.x = Math.PI / 2;
        head.position.set(b.x, this.hexTopY(this.hexAt(tail.c, tail.r)) + 0.34, b.z);
        head.renderOrder = 6;
        this.scene.add(head); this._marchArrow.push(head);
      }
    }

    showMoveRange(reach) {
      this._clearOverlay();
      for (const [k, cost] of reach.dist) {
        const p = Hex.parse(k);
        const h = this.hexAt(p.c, p.r);
        const c = this.game.unitAt(p.c, p.r) ? 0x000000 : 0x4fd0ff;
        this._hexMark(p.c, p.r, c, h.river ? 0.18 : 0.26);
      }
    }

    showAttackTargets(targets) {
      this._clearOverlay();
      for (const t of targets) {
        const mk = this._hexMark(t.c, t.r, 0xff5544, 0.4, 0.15);
        this._pulse = this._pulse || [];
        this._pulse.push(mk);
      }
    }

    showArtilleryRange(units, range) {
      this._clearOverlay();
      const seen = new Set();
      for (const u of units) {
        for (const p of Hex.range(u.c, u.r, range, this.map.cols, this.map.rows)) {
          const k = Hex.key(p.c, p.r);
          if (seen.has(k)) continue;
          seen.add(k);
          this._hexMark(p.c, p.r, 0xffaa33, 0.16);
        }
      }
    }

    // 城市补给覆盖：**只画最外圈的连续六边形轮廓**（不填充内部）。
    // 输入是 game.supplyCoverageFrom() 的成本扩散结果（受地形/道路/河流影响）。
    //
    // 三个关键实现点（2026-10-12 逐个踩过，勿改回去）：
    //   ① **不要用"邻居方向角 → 边序号"来配边**：Hex.neighbors() 只给奇偶行两套
    //      偏移，与六角形顶点的奇偶排列不是同一顺序，角度法会配错边，
    //      结果轮廓碎成一堆短线（实测 266/357 个端点是断头）。
    //      正确做法：逐条边算中点，取**中心离该中点最近的邻居格**作为对侧格。
    //   ② 只遍历"被覆盖格"的边：某条边恰好属于一个覆盖格时才会被画到，天然不重复。
    //   ③ 把边**按端点首尾相接串成闭合环**（每个顶点度数必为 2），
    //      再用 THREE.LineLoop 画——这样成品描边是连续闭环，不是一段段虚线。
    showSupplyCoverage(cov, opts) {
      this._clearOverlay();
      if (!cov || !cov.cost || !cov.cost.size) return 0;
      const hexes = this.map.hexes;
      const covered = cov.cost;

      const hexCenter = (c, r) => this.hexWorld(c, r);
      const corners = (c, r) => {
        const w = hexCenter(c, r);
        const h = hexes.get(Hex.key(c, r));
        const y = this.hexTopY(h) + 0.12;
        const pts = [];
        for (let a = 0; a < 6; a++) {
          const ang = Math.PI / 2 + a * Math.PI / 3;
          pts.push([w.x + SIZE * Math.cos(ang), y, w.z + SIZE * Math.sin(ang)]);
        }
        return pts;
      };
      const vkey = P => P[0].toFixed(3) + ',' + P[2].toFixed(3);

      /* ① 收集轮廓边（去重：同一条边只收一次） */
      const segs = new Map();
      for (const key of covered.keys()) {
        const p = Hex.parse(key);
        const cps = corners(p.c, p.r);
        const centers = Hex.neighbors(p.c, p.r).map(n => ({ n, w: hexCenter(n.c, n.r) }));
        for (let a = 0; a < 6; a++) {
          const A = cps[a], B = cps[(a + 1) % 6];
          const mx = (A[0] + B[0]) / 2, mz = (A[2] + B[2]) / 2;
          let best = null, bd = 1e9;
          for (const c of centers) {
            const d = Math.hypot(c.w.x - mx, c.w.z - mz);
            if (d < bd) { bd = d; best = c.n; }
          }
          const other = best && hexes.has(Hex.key(best.c, best.r)) ? best : null;
          if (other && covered.has(Hex.key(other.c, other.r))) continue;   // 内部边
          const ka = vkey(A), kb = vkey(B);
          const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          if (!segs.has(ek)) segs.set(ek, [A, B]);
        }
      }

      /* ② 端点邻接表 → 串成闭合环 */
      const adj = new Map();
      const coordOf = new Map();
      for (const [A, B] of segs.values()) {
        const ka = vkey(A), kb = vkey(B);
        coordOf.set(ka, A); coordOf.set(kb, B);
        if (!adj.has(ka)) adj.set(ka, []);
        if (!adj.has(kb)) adj.set(kb, []);
        adj.get(ka).push(kb); adj.get(kb).push(ka);
      }
      const visited = new Set();
      const loops = [];
      for (const start of adj.keys()) {
        if (visited.has(start)) continue;
        const loop = [];
        let cur = start, prev = null;
        for (;;) {
          if (visited.has(cur)) break;
          visited.add(cur);
          loop.push(coordOf.get(cur));
          const nbs = adj.get(cur) || [];
          const nxt = nbs.find(x => x !== prev && !visited.has(x)) || nbs.find(x => x !== prev);
          if (!nxt || visited.has(nxt)) break;
          prev = cur; cur = nxt;
        }
        if (loop.length >= 3) loops.push(loop);
      }

      /* ③ 双层材质画闭环：深色底 + 亮青面 */
      let drawn = 0;
      for (const loop of loops) {
        const pos = [];
        for (const P of loop) pos.push(P[0], P[1], P[2]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const under = new THREE.LineLoop(g, new THREE.LineBasicMaterial({
          color: 0x08202a, transparent: true, opacity: 0.9, depthWrite: false,
        }));
        under.position.y = -0.016;
        under.renderOrder = 4;
        const over = new THREE.LineLoop(g, new THREE.LineBasicMaterial({
          color: 0x7cf4ff, transparent: true, opacity: 1.0, depthWrite: false,
        }));
        over.renderOrder = 5;
        this.scene.add(under); this.scene.add(over);
        this._overlay.push(under, over);
        drawn += loop.length;
      }
      // 源点高亮环（keepOverlay：不要清掉刚画的轮廓）
      if (cov.source) this.selectHexRing(cov.source.c, cov.source.r, true);
      return drawn;
    }

    showPath(path) {
      this._clearPathDots();
      if (!path) return;
      const geo = this._pathGeo = new THREE.SphereGeometry(0.22, 8, 8);
      const mat = this._pathMat = new THREE.MeshBasicMaterial({ color: 0xbfefff });
      for (const p of path) {
        const m = new THREE.Mesh(geo, mat);
        const w = this.hexWorld(p.c, p.r);
        m.position.set(w.x, this.hexTopY(this.hexAt(p.c, p.r)) + 0.35, w.z);
        this.scene.add(m);
        this._pathDots.push(m);
      }
    }

    selectHexRing(c, r, keepOverlay) {
      if (!keepOverlay) this._clearSelectRing();
      const geo = new THREE.TorusGeometry(SIZE * 0.95, 0.09, 8, 32);
      geo.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffe084, transparent: true, opacity: 0.9, depthWrite: false,
      }));
      const h = this.hexAt(c, r);
      const w = this.hexWorld(c, r);
      mesh.position.set(w.x, this.hexTopY(h) + 0.3, w.z);
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      this._selRing = mesh;
    }
    _clearSelectRing() {
      if (this._selRing) {
        this.scene.remove(this._selRing);
        if (this._selRing.geometry) this._selRing.geometry.dispose();
        if (this._selRing.material) this._selRing.material.dispose();   // 26p: 不释放会在每次选中时累积显存
        this._selRing = null;
      }
    }
    clearSelection() {
      this._clearSelectRing();
      this._clearOverlay();
    }

    /* ---------------- 动画/特效 ---------------- */
    /* 26p: AI 大回合（全单位推进）时动画队列会越排越长——超过阈值就由 UI 直接落位,
       避免"画面追不上引擎"导致的整回合像卡死 */
    isBacklogged() { return this._anims.length >= 14; }

    animateMove(u, fromHex, path, onDone) {
      const g = this._unitMeshes.get(u.uid);
      if (!g || !path.length) { if (onDone) onDone(); return; }
      // 极速模式(原版39轮移植): 不播移动缓动, 直接落到终点——纯表现层, 不影响规则
      if (this.skipMoveAnim) {
        const w0 = this.hexWorld(u.c, u.r);
        g.position.set(w0.x, this.hexTopY(this.hexAt(u.c, u.r)) + 0.02, w0.z);
        if (onDone) onDone();
        return;
      }
      const keys = [];
      const src = { c: fromHex.c, r: fromHex.r };
      for (const p of [src, ...path]) {
        const w = this.hexWorld(p.c, p.r);
        keys.push(new THREE.Vector3(w.x, this.hexTopY(this.hexAt(p.c, p.r)) + 0.02, w.z));
      }
      const curve = new THREE.CatmullRomCurve3(keys, false, 'catmullrom', 0.2);
      // 动画时长: 2026-10 缩短(原 0.28+len*0.12)——开局 122 个算子后, 一方 AI 阶段会有 50+ 次
      // 移动动画串行播放, 旧时长会把一个 AI 回合拖到 40 秒以上; 另外动画队列积压时进一步加速。
      const dur = Math.min(0.55, 0.12 + path.length * 0.045) * (this._anims.length > 6 ? 0.5 : 1) * (this.animScale || 1);   // 原版39轮压缩
      this._anims.push({ t: 0, dur, curve, g, onDone, hop: true });
    }

    explosion(x, y, z, big) {
      const group = new THREE.Group();
      const flash = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95 })
      );
      group.add(flash);
      const n = big ? 26 : 16;
      const pgeo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      const vel = [];
      const rr = Math.random;
      for (let i = 0; i < n; i++) {
        pos[i * 3] = 0; pos[i * 3 + 1] = 0.3; pos[i * 3 + 2] = 0;
        vel.push(new THREE.Vector3((rr() - 0.5) * 8, rr() * 7 + 2, (rr() - 0.5) * 8));
      }
      pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0xffb066, size: 0.28, transparent: true }));
      group.add(pts);
      group.position.set(x, y, z);
      group.userData = { vel, flash, pts, t: 0, dur: 0.9 };
      this.scene.add(group);
      this._effects.push(group);
    }

    tracer(from, to) {
      const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }));
      this.scene.add(line);
      this._effects.push(line);
      line.userData = { t: 0, dur: 0.5, fade: true };
    }

    shake(unitUid) {
      const g = this._unitMeshes.get(unitUid);
      if (g) { g.userData.shake = 0.35; }
    }

    _initSnow() {
      if (this._snow) {
        this.scene.remove(this._snow);
        if (this._snow.geometry) this._snow.geometry.dispose();
        if (this._snow.material) this._snow.material.dispose();
        this._snow = null;
      }
      const n = 1600;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 240;
        pos[i * 3 + 1] = Math.random() * 60;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 240;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.32, transparent: true, opacity: 0.8 });
      this._snow = new THREE.Points(geo, mat);
      this._snow.visible = false;
      this._snow.userData.vel = new Float32Array(n);
      for (let i = 0; i < n; i++) this._snow.userData.vel[i] = 2 + Math.random() * 4;
      this.scene.add(this._snow);
    }

    setWeather(w) {
      const fog = this.scene.fog;
      if (w === 'clear') { fog.near = 380; fog.far = 900; this._snow.visible = false; this.scene.background.setHex(0x41576d); fog.color.setHex(0x41576d); }
      else if (w === 'fog') { fog.near = 220; fog.far = 620; this._snow.visible = false; this.scene.background.setHex(0x4c5259); fog.color.setHex(0x4c5259); }
      else { fog.near = 300; fog.far = 800; this._snow.visible = true; this.scene.background.setHex(0x505963); fog.color.setHex(0x505963); }
    }

    focusOn(c, r, dist) {
      const w = this.hexWorld(c, r);
      this.cam.tx = w.x; this.cam.tz = w.z;
      if (dist) this.cam.dist = dist;
      this._updateCamera();
    }

    /* ---------------- 相机与拾取 ---------------- */
    _updateCamera() {
      const cam = this.cam;
      // 平面图: 俯视角固定, 仅平移与缩放
      const pitch = cam.pitch;
      const dist = Math.max(14, Math.min(CAM_MAX_DIST, cam.dist));
      const y = Math.sin(pitch) * dist;
      const r = Math.cos(pitch) * dist;
      this.camera.position.set(cam.tx + Math.sin(cam.yaw) * r, y, cam.tz + Math.cos(cam.yaw) * r);
      this.camera.lookAt(cam.tx, 0, cam.tz);
    }

    // 视距钳制: 捏合/滚轮都只能落在 [14, CAM_MAX_DIST] 内。必须立刻写回 cam.dist,
    // 否则连续捏合会先攒下一大截"看不见的余量", 反向捏回时要先把它抵消掉, 手感像卡住。
    setDist(v) {
      this.cam.dist = Math.max(14, Math.min(CAM_MAX_DIST, v));
      return this.cam.dist;
    }

    zoomBy(f) {
      this.setDist(this.cam.dist * f);
      this._updateCamera();
    }

    // 取景: 让地图尽量整幅入画。竖屏手机全图所需视距会超出上限(参见 §19 第 24 条),
    // 此时退化为「短轴优先」——保证整条战线纵向完整可见, 横向交给拖动/缩放查看,
    // 而不是把镜头推到雾里(U 远→形象发灰)。
    fitView() {
      const b = this._bounds || { minX: -120, maxX: 120, minZ: -120, maxZ: 120 };
      const w = Math.max(1, b.maxX - b.minX), d = Math.max(1, b.maxZ - b.minZ);
      const t = Math.tan(this.camera.fov * Math.PI / 360);     // tan(fov/2)
      const aspect = Math.max(0.2, this.camera.aspect);
      const needDepth = d / 2 / t;                             // 纵向(幅度较小的一轴)完整入画
      const needAll = Math.max(needDepth, w / 2 / (t * aspect));// 全图所需
      // 相机俯角接近正下方, 横向再按 aspect 折算; 1.12 是留给图廓与俯角略略倾斜的尺寸余量
      const dist = needAll * 1.12 <= CAM_MAX_DIST ? needAll * 1.12 : needDepth * 1.25;
      this.setDist(dist);
      this.cam.tx = (b.minX + b.maxX) / 2;
      this.cam.tz = (b.minZ + b.maxZ) / 2;
      this._updateCamera();
    }

    // 按「屏幕像素 / 世界单位」定视距: 保证算子在任何屏幕尺寸下都有一致的手点大小。
    // 竖屏与横屏高度差 2 倍以上(844 → 390), 固定视距会让横屏算子缩到只有十几像素, 点不中。
    setDistForScale(pxPerUnit) {
      const h = this.container.clientHeight || window.innerHeight || 900;
      const t = Math.tan(this.camera.fov * Math.PI / 360);
      this.setDist(h / (2 * t * pxPerUnit));
      this._updateCamera();
    }

    _bindControls() {
      const el = this.renderer.domElement;
      el.style.touchAction = 'none';   // 触屏: 让浏览器别抢走拖动/捏合(与之配套的还有 index.html 里的 touch-action)
      // iOS Safari 旧版的 proprietary 手势事件: 屏蔽系统双指缩放
      for (const n of ['gesturestart', 'gesturechange', 'gestureend']) {
        el.addEventListener(n, e => e.preventDefault(), { passive: false });
      }

      const panBy = (dx, dy) => {
        const s = this.cam.dist * 0.0016;
        const sin = Math.sin(this.cam.yaw), cos = Math.cos(this.cam.yaw);
        // 原版30轮移植: 抓地图语义(内容跟手)。旧式 dy 两处符号反——横轴恰好对、纵轴反向
        // (yaw锁0时 tx 只剩 dx 项、tz 只剩 ±dy 项), 单指往下拖地图往上跑。
        this.cam.tx -= (dx * cos + dy * sin) * s;
        this.cam.tz += (dx * sin - dy * cos) * s;
        const b = this._bounds || { minX: -120, maxX: 120, minZ: -120, maxZ: 120 };
        this.cam.tx = Math.max(b.minX, Math.min(b.maxX, this.cam.tx));
        this.cam.tz = Math.max(b.minZ, Math.min(b.maxZ, this.cam.tz));
        this._updateCamera();
      };

      // —— 多指手势(手机端核心) ——
      // 1 指: 拖动平移(左/右键同效果)   2 指: 捏合缩放 + 同向拖动平移   松开: 位移在容差内才算"轻点"
      const pts = new Map();                   // pointerId -> {x, y}
      let moved = 0, downBtn = -1, downType = 'mouse';
      let pinch = 0, pinchMid = { x: 0, y: 0 };
      const pair = () => { const a = [...pts.values()]; return a.length >= 2 ? [a[0], a[1]] : null; };
      const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
      const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const syncPinch = () => { const p = pair(); if (!p) { pinch = 0; return; } pinch = gap(p[0], p[1]); pinchMid = mid(p[0], p[1]); };
      const grab = (fn, e) => { try { fn.call(el, e.pointerId); } catch (err) { /* 合成事件可能不支持捕获 */ } };

      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('pointerdown', e => {
        grab(el.setPointerCapture, e);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) { downBtn = e.button; downType = e.pointerType || 'mouse'; moved = 0; }
        else { moved += 999; syncPinch(); }    // 第二指落下即作废本次点击, 并重置捏合基准
      });
      el.addEventListener('pointermove', e => {
        const p = pts.get(e.pointerId);
        if (!p) { this._doHover(e); return; }  // 没按下 → 桌面端悬停提示
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        const two = pair();
        if (two) {
          const cur = gap(two[0], two[1]), m = mid(two[0], two[1]);
          if (pinch > 0 && cur > 0) {
            this.setDist(this.cam.dist * pinch / cur);  // 双指张开(cur 变大) → 系数<1 → 拉近; 捏合反之
            panBy(m.x - pinchMid.x, m.y - pinchMid.y);   // 双指整体位移 → 平移
          }
          pinch = cur; pinchMid = m;
          moved += Math.abs(dx) + Math.abs(dy);
        } else {
          moved += Math.abs(dx) + Math.abs(dy);
          panBy(dx, dy);
        }
      });
      const finish = e => {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        grab(el.releasePointerCapture, e);
        syncPinch();
        if (pts.size === 0) {
          // 指尖做不到 6px 稳如鼠标, 触屏的"轻点"容差放宽到 14px
          const tol = (downType === 'touch' || downType === 'pen') ? 14 : 6;
          if (downBtn === 0 && moved < tol) this._doClick(e);
          moved = 0; downBtn = -1;
        }
      };
      el.addEventListener('pointerup', finish);
      el.addEventListener('pointercancel', finish);
      el.addEventListener('lostpointercapture', e => { pts.delete(e.pointerId); pinch = 0; });
      el.addEventListener('wheel', e => {
        e.preventDefault();
        this.setDist(this.cam.dist * (e.deltaY > 0 ? 1.12 : 0.89));
        this._updateCamera();
      }, { passive: false });
      window.addEventListener('keydown', e => {
        const s = this.cam.dist * 0.06;
        const sin = Math.sin(this.cam.yaw), cos = Math.cos(this.cam.yaw);
        if (e.key === 'ArrowUp' || e.key === 'w') { this.cam.tz -= cos * s; this.cam.tx -= sin * s; }
        else if (e.key === 'ArrowDown' || e.key === 's') { this.cam.tz += cos * s; this.cam.tx += sin * s; }
        else if (e.key === 'ArrowLeft' || e.key === 'a') { this.cam.tx -= cos * s; this.cam.tz += sin * s; }
        else if (e.key === 'ArrowRight' || e.key === 'd') { this.cam.tx += cos * s; this.cam.tz -= sin * s; }
        else return;
        this._updateCamera();
      });
    }

    _pickHex(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._pointer, this.camera);
      // 优先拾取单位算子(凸出地面, 不受地形遮挡影响)
      if (this._unitMeshes.size) {
        const groups = [];
        for (const g of this._unitMeshes.values()) groups.push(g);
        /* 27j: 只认实体面网格(isMesh)——LineSegments(呼吸框/HQ金框)与 Points
           不参与算子拾取, 阈值膨胀已在上游归零, 这里再兜一层底。 */
        const uhits = this._raycaster.intersectObjects(groups, true).filter(h => h.object.isMesh === true);
        if (uhits.length) {
          let o = uhits[0].object;
          while (o && o.userData.uid === undefined) o = o.parent;
          if (o) {
            const u = this.game && this.game.units.find(x => x.uid === o.userData.uid && x.alive && !x.exited);
            if (u) return this.hexAt(u.c, u.r);
          }
        }
      }
      const hits = this._raycaster.intersectObject(this._hexMesh);
      if (!hits.length) return null;
      const idx = hits[0].instanceId;
      let i = 0;
      for (const [k, h] of this.map.hexes) {
        if (i === idx) return h;
        i++;
      }
      return null;
    }

    _doClick(e) {
      /* 26z: 双拾取——h=算子优先格, th=纯地形格。算子碰撞盒(2.15)大于格宽(2.0)并溢出邻格,
         拥挤区点"相邻格"时射线先命中选中单位自己的盒子 → onHexClick 收到自身格 →
         移动永不触发（玩家反馈"两格能动, 一格没反应"）。两格都交给 ui 裁量:
         选中/攻击用算子格, 移动在算子格不可达时回退地形格。 */
      const h = this._pickHex(e);
      const th = this._pickTerrainHex(e);
      if ((h || th) && this.onHexClick) this.onHexClick(h ? h.c : null, h ? h.r : null, th ? th.c : null, th ? th.r : null);
    }
    /* 25i: 纯地形拾取——鼠标射线与六角地面求交, 不受算子碰撞盒影响。
       用于悬停箭头/移动预览：拥挤区算子盒覆盖邻格时, 预览仍跟地面格走。 */
    _pickTerrainHex(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._pointer, this.camera);
      const hits = this._raycaster.intersectObject(this._hexMesh);
      if (!hits.length) return null;
      let i = 0;
      for (const [k, h] of this.map.hexes) {
        if (i === hits[0].instanceId) return h;
        i++;
      }
      return null;
    }

    _doHover(e) {
      const h = this._pickHex(e);
      const th = this._pickTerrainHex(e);   // 25i: 地面格（箭头预览用, 不受算子盒影响）
      const k = h ? Hex.key(h.c, h.r) : null;
      if (k !== this._hoverKey) {
        this._hoverKey = k;
        if (this.onHexHover) this.onHexHover(h ? h.c : null, h ? h.r : null, th ? th.c : null, th ? th.r : null);
      }
    }

    _resize() {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    /* ---------------- 主循环 ---------------- */
    _loop() {
      /* 25j 渲染循环自愈: 单帧异常只跳过该帧, RAF 链不中断; 首次 console.error
         ⚠ 26p: RAF 只能在此处申请一次——曾因 25j 补丁在 try 内重复申请,
         每帧派生两条链 → 回调指数增长 → 画面越来越卡直至卡死 */
      requestAnimationFrame(() => this._loop());
      try {

      const dt = Math.min(0.2, this._clock.getDelta());   // 原版39轮移植: 按真实时间推进, 低帧率不再拉长动画
      // 移动动画
      for (let i = this._anims.length - 1; i >= 0; i--) {
        const a = this._anims[i];
        a.t += dt / a.dur;
        const tt = Math.min(1, a.t);
        const pos = a.curve.getPoint(tt);
        a.g.position.copy(pos);
        this._syncInst(a.g);   // 26p: 批渲染底座跟随移动动画
        if (a.t >= 1) {
          this._anims.splice(i, 1);
          if (a.onDone) a.onDone();
        }
      }
      // 特效
      for (let i = this._effects.length - 1; i >= 0; i--) {
        const e = this._effects[i];
        e.userData.t = (e.userData.t || 0) + dt;
        const k = e.userData.t / e.userData.dur;
        if (e.userData.fade) {
          e.material.opacity = Math.max(0, 0.9 * (1 - k));
        } else {
          const f = e.userData.flash, pts = e.userData.pts, vel = e.userData.vel;
          f.scale.setScalar(1 + k * (e.userData.dur * 3));
          f.material.opacity = Math.max(0, 0.95 * (1 - k * 1.4));
          const arr = pts.geometry.attributes.position.array;
          for (let j = 0; j < vel.length; j++) {
            arr[j * 3] += vel[j].x * dt; arr[j * 3 + 1] += vel[j].y * dt; arr[j * 3 + 2] += vel[j].z * dt;
            vel[j].y -= 9.8 * dt;
          }
          pts.geometry.attributes.position.needsUpdate = true;
          pts.material.opacity = Math.max(0, 1 - k);
        }
        if (k >= 1) {
          this.scene.remove(e);
          this._disposeObject(e);   // 26p: 爆炸/曳光几何与材质每次新建, 到期必须释放
          this._effects.splice(i, 1);
        }
      }
      // 25c: 未移动算子金框呼吸（微亮, 不抢氛围）
      if (this._hlMat) this._hlMat.opacity = 0.26 + Math.sin(performance.now() * 0.0035) * 0.12;
      if (this._hqGlowPulse === undefined) this._hqGlowPulse = 0.9;
      this._hqGlowPulse = 0.88 + Math.sin(performance.now() * 0.0028) * 0.1;   // 26c3: 光晕高亮度微呼吸
      if (this._hqGlowMat) this._hqGlowMat.opacity = this._hqGlowPulse;
      /* 26p 远景 LOD + 金框显隐：镜头拉远(全图视野)时隐藏落影与金框，
         每算子从 5 次 draw call 降到 3 次——实测 605 算子 3040→约 1830，帧率约 +50%；
         拉近后自动恢复。highlightSide 变化时做一次全量同步，其余帧只跟 !u.moved。 */
      const far = this.cam.dist > 150;
      const veryFar = this.cam.dist > 260;   // 极远景: 算子面只有几个像素, 改画批渲染色块
      const hs = this.highlightSide;
      if (this._instBox) this._instBox.visible = !far || veryFar;
      if (hs !== this._hlSide || far !== this._lodFar || veryFar !== this._lodVeryFar) {
        this._hlSide = hs; this._lodFar = far; this._lodVeryFar = veryFar;
        for (const [, g] of this._unitMeshes) {
          const u = g.userData.unit;
          g.userData.hl.visible = !far && !!hs && !!u && u.alive && !u.exited && u.side === hs && !u.moved;
          if (g.userData.shadow) g.userData.shadow.visible = !far;   // 容量兜底网格
          if (g.userData.box) g.userData.box.visible = !far;
          if (g.userData.top) g.userData.top.visible = !veryFar;
        }
      } else if (hs && !far) {
        for (const [, g] of this._unitMeshes) {
          const u = g.userData.unit;
          g.userData.hl.visible = !!u && u.alive && !u.exited && u.side === hs && !u.moved;
        }
      }
      // 脉冲目标格
      if (this._pulse) {
        const s = 1 + Math.sin(performance.now() * 0.006) * 0.25;
        for (const m of this._pulse) m.scale.setScalar(s);
      }
      // 算子朝向固定(俯视平面图, 文字保持正读) + 抖动
      for (const [uid, g] of this._unitMeshes) {
        if (g.userData.shake > 0) {
          g.userData.shake -= dt;
          g.position.x += (Math.random() - 0.5) * 0.12;
          g.position.z += (Math.random() - 0.5) * 0.12;
        }
      }
      // 雪
      if (this._snow && this._snow.visible) {
        const arr = this._snow.geometry.attributes.position.array;
        const vel = this._snow.userData.vel;
        for (let i = 0; i < vel.length; i++) {
          arr[i * 3 + 1] -= vel[i] * dt;
          arr[i * 3] += Math.sin(performance.now() * 0.001 + i) * dt * 0.5;
          if (arr[i * 3 + 1] < 0) { arr[i * 3 + 1] = 55; }
        }
        this._snow.geometry.attributes.position.needsUpdate = true;
      }
      this.renderer.render(this.scene, this.camera);
    
      } catch (e) {
        if (!this._loopErr) { this._loopErr = true; console.error('[渲染循环异常已自愈]', e.message, e.stack && e.stack.split('\n')[1]); }
      }
    }
  }

  return Renderer;
})();
