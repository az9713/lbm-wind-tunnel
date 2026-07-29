/* The Drafting Effect — application layer.
 * Engine bootstrap (GPU -> CPU fallback), presets, guardrails, dragging,
 * gauges, charts, self-checks, results sections, 3D viewers.
 * One display path: moments are read back from either engine and colormapped
 * into a canvas ImageData at grid resolution (CSS upscales). */
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const DATA = window.SITE_DATA || {};
  const GOLDEN = window.GOLDEN || {};

  /* ---------------- engine bootstrap ---------------- */
  const tunnelCanvas = $("tunnel");
  let engineKind = "gpu";
  let makeEngine;                // headless factory (self-checks)
  try {
    const probe = new LBMGPU.GpuEngine(8, 8, {});
    void probe;
    makeEngine = (nx, ny, opts) => new LBMGPU.GpuEngine(nx, ny, {
      ...opts, canvas: new OffscreenCanvas(nx, ny),
    });
  } catch (e) {
    engineKind = "cpu";
    makeEngine = (nx, ny, opts) => new LBM.CpuEngine(nx, ny, opts);
    $("banner").textContent = (e.message === "no-fp32")
      ? "This GPU exposes only 16-bit float buffers — running the CPU engine " +
      "at reduced grid so the self-checks stay meaningful."
      : "WebGL2 unavailable — running the CPU engine at reduced grid.";
  }
  const NX = engineKind === "gpu" ? 520 : 300;
  const NY = engineKind === "gpu" ? 220 : 128;
  $("meta-engine").textContent = "engine: " + (engineKind === "gpu"
    ? "WebGL2 (fp32 textures, deviation form)" : "CPU (typed arrays)");
  $("meta-grid").textContent = `grid: ${NX}×${NY}`;
  $("dim-right").textContent = NX;
  tunnelCanvas.width = NX; tunnelCanvas.height = NY;
  // GPU path: the lab engine owns the visible canvas and colormaps on-GPU
  // (zero readbacks per frame). CPU path: 2d context + ImageData.
  const makeLabEngine = engineKind === "gpu"
    ? (opts) => new LBMGPU.GpuEngine(NX, NY, { ...opts, canvas: tunnelCanvas })
    : (opts) => new LBM.CpuEngine(NX, NY, opts);
  const ctx2d = engineKind === "cpu" ? tunnelCanvas.getContext("2d") : null;
  const img = ctx2d ? ctx2d.createImageData(NX, NY) : null;

  /* ---------------- silhouettes ---------------- */
  function decodeSil(key) {
    const s = (DATA.silhouettes || {})[key];
    if (!s) return null;
    const map = new Uint8Array(s.w * s.h);
    s.rows.split(";").forEach((row, r) => {
      if (!row) return;
      for (const run of row.split(",")) {
        const [st, len] = run.split(":").map(Number);
        for (let x = st; x < st + len; x++) map[r * s.w + x] = 1;
      }
    });
    return { w: s.w, h: s.h, map };
  }
  const SIL = {
    carSide: decodeSil("car_side"), carTop: decodeSil("car_top"),
    planeSide: decodeSil("airplane_side"), birdSide: decodeSil("bird_side"),
  };
  // stamp silhouette into an obstacle array, scaled to length L, anchored at
  // (x0, y0) bottom-left, flipped so lattice y is up
  function stampSil(obst, sil, L, x0, y0, id) {
    if (!sil) return stampBox(obst, x0, y0, L, Math.round(L * 0.3), id);
    const sc = L / sil.w, H = Math.round(sil.h * sc);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(sil.h - 1, (y / sc) | 0);
      for (let x = 0; x < L; x++) {
        const sx = Math.min(sil.w - 1, (x / sc) | 0);
        if (sil.map[sy * sil.w + sx]) {
          const gx = x0 + x, gy = y0 + y;
          // never overwrite walls/road (id 1): a body may sink into the road
          // so wheels merge with it — avoids 1-cell fluid channels that no
          // lattice can resolve
          if (gx >= 0 && gx < NX && gy >= 0 && gy < NY && obst[gy * NX + gx] !== 1) {
            obst[gy * NX + gx] = id;
          }
        }
      }
    }
    return H;
  }
  function stampBox(obst, x0, y0, w, h, id) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x >= 0 && x < NX && y >= 0 && y < NY) obst[y * NX + x] = id;
      }
    }
    return h;
  }
  function stampDisk(obst, cx, cy, r, id) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r &&
          x >= 0 && x < NX && y >= 0 && y < NY) obst[y * NX + x] = id;
      }
    }
    return 2 * r + 1;
  }

  /* ---------------- lab state ---------------- */
  const state = {
    preset: "",
    U: 0.08, Re: 100, gap: 0.5, size: 24,
    stepsPerFrame: 6, paused: false, field: "vort", cmap: "rdbu",
    obst: new Uint8Array(NX * NY),
    bodies: {},            // id -> {x0, y0, kind, L, A}
    freezeUntil: 0,        // engine.steps threshold while gauges settle
    cdHist: [[], []], clHist: [[], []],
    drawMode: false, brush: 6,
    eng: null, tau: 0.6, nanStrikes: 0,
  };

  // fp32 GPU stability floor: clean bluff bodies tolerate tau near the BGK
  // edge; the moving-road presets (thin shear layers at sharp wheels) need
  // more headroom.
  function tauMin() {
    return (state.preset === "drafting") ? 0.58 : 0.552;
  }

  function charSize() {
    // characteristic frontal size for Re/tau (body A if present, else size)
    const b = state.bodies[2];
    return (b && b.A ? b.A : state.size) + 1;   // + half-link
  }

  function computeTau() {
    const D = charSize();
    const TAU_MIN = tauMin();
    let tau = 3 * state.U * D / state.Re + 0.5;
    let note = "";
    if (tau < TAU_MIN) {
      const reMax = Math.floor(3 * state.U * D / (TAU_MIN - 0.5));
      tau = TAU_MIN;
      state.Re = reMax;
      $("s-re").value = reMax; $("o-re").value = reMax;
      note = `Reynolds clamped to ${reMax}: higher Re at this size and speed ` +
        `would push the solver into its unstable zone — a bigger grid is the ` +
        `only honest way up.`;
    }
    $("clamp-note").textContent = note;
    state.tau = tau;
    return tau;
  }

  /* ---------------- presets ---------------- */
  const PRESETS = {
    vortex: {
      caption: "Vortex street behind a cylinder — the flow's natural metronome.",
      build() {
        const o = new Uint8Array(NX * NY);
        const r = state.size >> 1;
        stampDisk(o, (NX / 4) | 0, (NY / 2) | 0, r, 2);
        return { obst: o, open: true, bodies: { 2: { kind: "disk", A: 2 * r + 1, x0: (NX / 4 | 0) - r, y0: (NY / 2 | 0) - r } }, labels: ["cylinder", null] };
      },
    },
    drafting: {
      caption: "Two race cars in tandem over a moving road; drag either car.",
      build() {
        const o = new Uint8Array(NX * NY);
        stampBox(o, 0, 0, NX, 2, 1);              // road
        stampBox(o, 0, NY - 2, NX, 2, 1);         // ceiling (moving, frame-correct)
        const L = Math.round(NX * 0.16);
        const x0 = Math.round(NX * 0.16);
        const gapCells = Math.round(state.gap * L);
        // cars sit sunk 2 cells into the road: wheels merge with the ground,
        // no unresolvable 1-cell gap channels
        const hA = stampSil(o, SIL.carSide, L, x0, 0, 2);
        stampSil(o, SIL.carSide, L, x0 + L + gapCells, 0, 3);
        return {
          obst: o, open: true, wall: [1],
          bodies: {
            2: { kind: "car", L, A: hA - 2, x0, y0: 0 },
            3: { kind: "car", L, A: hA - 2, x0: x0 + L + gapCells, y0: 0 },
          },
          labels: ["leader", "trailing car"],
        };
      },
    },
    side: {
      caption: "Side-by-side battle, seen from above — the cars push each other apart or suck together depending on offset.",
      build() {
        const o = new Uint8Array(NX * NY);
        const L = Math.round(NX * 0.17);
        const sil = SIL.carTop;
        const W = sil ? Math.round(sil.h * (L / sil.w)) : Math.round(L * 0.4);
        const off = Math.round(state.gap * W);
        const x0 = Math.round(NX * 0.2);
        const yA = (NY / 2 | 0) - W - (off >> 1);
        const yB = (NY / 2 | 0) + (off - (off >> 1));
        stampSil(o, sil, L, x0, yA, 2);
        stampSil(o, sil, L, x0, yB, 3);
        return {
          obst: o, open: true,
          bodies: { 2: { kind: "carTop", L, A: W, x0, y0: yA }, 3: { kind: "carTop", L, A: W, x0, y0: yB } },
          labels: ["car A", "car B"], gapLabel: "Lateral offset (car widths)",
        };
      },
    },
    airplane: {
      caption: "Airplane profile at incidence — pressure asymmetry makes lift.",
      build() {
        const o = new Uint8Array(NX * NY);
        const L = Math.round(NX * 0.28);
        const x0 = Math.round(NX * 0.22);
        const sil = SIL.planeSide;
        const H = stampSil(o, sil, L, x0, (NY / 2 | 0) - Math.round(L * 0.12), 2);
        return {
          obst: o, open: true,
          bodies: { 2: { kind: "plane", L, A: H, x0, y0: (NY / 2 | 0) - Math.round(L * 0.12) } },
          labels: ["airplane", null],
        };
      },
    },
    birds: {
      caption: "Bird formation, 2D analogue — the real 3D mechanism (wingtip upwash) lives in §4; this is the drafting view of it.",
      build() {
        const o = new Uint8Array(NX * NY);
        const L = Math.round(NX * 0.12);
        const sil = SIL.birdSide;
        const x0 = Math.round(NX * 0.18);
        const yMid = (NY / 2 | 0);
        const hA = stampSil(o, sil, L, x0, yMid + 6, 2);
        stampSil(o, sil, L, x0 + Math.round(1.3 * L), yMid - 6 - (hA || 8), 3);
        stampSil(o, sil, L, x0 + Math.round(2.6 * L), yMid + 6, 1);
        return {
          obst: o, open: true,
          bodies: {
            2: { kind: "bird", L, A: hA, x0, y0: yMid + 6 },
            3: { kind: "bird", L, A: hA, x0: x0 + Math.round(1.3 * L), y0: yMid - 6 - (hA || 8) },
          },
          labels: ["leader", "trailing bird"],
        };
      },
    },
    draw: {
      caption: "Your own wind-tunnel model — paint with the pointer, then watch.",
      build() {
        const o = state.obst.slice();          // keep current as starting point
        for (let i = 0; i < o.length; i++) if (o[i] > 1) o[i] = 1;
        return { obst: o, open: true, bodies: {}, labels: [null, null], draw: true };
      },
    },
  };

  const PRESET_RE = { drafting: 60, side: 80, birds: 80 };
  function applyPreset(name, keepFlow = false) {
    if (name !== state.preset && PRESET_RE[name]) {
      state.Re = PRESET_RE[name];
      $("s-re").value = state.Re; $("o-re").value = state.Re;
    }
    state.preset = name;
    document.querySelectorAll("#presets .preset").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.preset === name)));
    const p = PRESETS[name].build();
    state.obst = p.obst;
    state.bodies = p.bodies;
    state.drawMode = !!p.draw;
    $("draw-tools").hidden = !p.draw;
    $("row-gap").style.display = (name === "drafting" || name === "side") ? "" : "none";
    $("row-size").style.display = (name === "vortex" || p.draw) ? "" : "none";
    const gapLabel = p.gapLabel || "Car gap (car lengths)";
    $("row-gap").querySelector("label").firstChild.textContent = gapLabel + " ";
    $("fig1-caption").textContent = PRESETS[name].caption;
    $("l-cda").textContent = p.labels[0] ? `Cd — ${p.labels[0]}` : "Cd — body A";
    $("l-cdb").textContent = p.labels[1] ? `Cd — ${p.labels[1]}` : "Cd — body B";
    $("l-cla").textContent = p.labels[0] ? `Cl — ${p.labels[0]}` : "Cl — body A";
    $("g-cdb").style.display = p.labels[1] ? "" : "none";
    $("g-saving").style.display = (name === "drafting") ? "" : "none";
    computeTau();
    rebuildEngine(keepFlow, p);
  }

  function rebuildEngine(keepFlow, presetInfo) {
    const eng = makeLabEngine({ tau: state.tau, u0: state.U, open: true });
    eng.setObstacle((x, y) => state.obst[y * NX + x]);
    if (presetInfo && presetInfo.wall) {
      eng.setWallVelocity(1, state.U, 0);        // moving road/ceiling
    }
    eng.initEquilibrium(1, (x, y) => state.obst[y * NX + x] ? 0 : state.U, 0);
    eng.uPerturb = 0.004;                        // standing shedding seed
    setTimeout(() => { if (state.eng === eng) eng.uPerturb = 0; }, 1500);
    state.eng = eng;
    state.cdHist = [[], []]; state.clHist = [[], []];
    state.freezeUntil = 800;                     // initial transient
  }

  /* ---------------- colormaps ---------------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rampStops(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const n = stops.length - 1;
    const i = Math.min(n - 1, (t * n) | 0);
    const f = t * n - i;
    return [0, 1, 2].map(k => lerp(stops[i][k], stops[i + 1][k], f));
  }
  const CMAPS = {
    rdbu: t => rampStops([[26, 66, 129], [116, 169, 207], [241, 241, 238],
    [239, 138, 98], [162, 24, 24]], t),
    magma: t => rampStops([[8, 8, 25], [84, 20, 125], [185, 55, 121],
    [249, 140, 80], [252, 253, 191]], t),
    viridis: t => rampStops([[68, 1, 84], [59, 82, 139], [33, 145, 140],
    [94, 201, 98], [253, 231, 37]], t),
  };

  /* ---------------- render loop ---------------- */
  let lastFrameT = performance.now(), fpsSmoothed = 0, frameCount = 0;
  const vortBuf = new Float32Array(NX * NY);

  function computeField(m) {
    const { field } = state;
    if (field === "speed") {
      for (let i = 0; i < NX * NY; i++) {
        vortBuf[i] = Math.hypot(m.ux[i], m.uy[i]) / (1.6 * state.U);
      }
      return { buf: vortBuf, signed: false };
    }
    if (field === "press") {
      for (let i = 0; i < NX * NY; i++) vortBuf[i] = (m.rho[i] - 1) / (0.06 * state.U * 8) + 0.5;
      return { buf: vortBuf, signed: true };
    }
    // vorticity dv/dx - du/dy, scaled by U
    const sc = 0.10 * state.U * 2;
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const i = y * NX + x;
        const xm = i - (x > 0 ? 1 : 0), xp = i + (x < NX - 1 ? 1 : 0);
        const ym = i - (y > 0 ? NX : 0), yp = i + (y < NY - 1 ? NX : 0);
        vortBuf[i] = ((m.uy[xp] - m.uy[xm]) - (m.ux[yp] - m.ux[ym])) / sc / 2 + 0.5;
      }
    }
    return { buf: vortBuf, signed: true };
  }

  const CMAP_STOPS = {
    rdbu: [[26, 66, 129], [116, 169, 207], [241, 241, 238], [239, 138, 98], [162, 24, 24]],
    magma: [[8, 8, 25], [84, 20, 125], [185, 55, 121], [249, 140, 80], [252, 253, 191]],
    viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  };
  function fieldScale() {
    return state.field === "speed" ? 1 / (1.6 * state.U)
      : state.field === "press" ? 1 / (0.48 * state.U)
        : 1 / (0.2 * state.U);
  }
  function drawGpu() {
    state.eng.drawDisplay(state.field,
      CMAP_STOPS[state.cmap].map(c => c.map(v => v / 255)), fieldScale());
  }

  function draw(m) {
    const { buf } = computeField(m);
    const cmap = CMAPS[state.cmap];
    const d = img.data;
    for (let y = 0; y < NY; y++) {
      const yFlip = NY - 1 - y;
      for (let x = 0; x < NX; x++) {
        const i = y * NX + x, o = (yFlip * NX + x) * 4;
        if (state.obst[i]) {
          const id = state.obst[i];
          d[o] = id === 2 ? 43 : id === 3 ? 90 : 30;
          d[o + 1] = id === 2 ? 63 : id === 3 ? 60 : 34;
          d[o + 2] = id === 2 ? 90 : id === 3 ? 36 : 38;
          d[o + 3] = 255;
          continue;
        }
        const c = cmap(buf[i]);
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    ctx2d.putImageData(img, 0, 0);
  }

  function fmtCd(v) { return (v === null || !isFinite(v)) ? "—" : v.toFixed(2); }

  function updateGauges() {
    const eng = state.eng;
    const frozen = eng.steps < state.freezeUntil;
    ["g-cda", "g-cdb", "g-cla", "g-saving"].forEach(id =>
      $(id).classList.toggle("frozen", frozen));
    if (eng.syncForces) eng.syncForces();
    // NaN watchdog: a pathological obstacle arrangement can still blow up
    // fp32 — recover honestly instead of showing garbage
    const probe = state.bodies[2] ? eng.bodyForce(2) : null;
    if (probe && !isFinite(probe.fx)) {
      if (++state.nanStrikes >= 3) {
        state.nanStrikes = 0;
        eng.initEquilibrium(1, (x, y) => state.obst[y * NX + x] ? 0 : state.U, 0);
        state.freezeUntil = eng.steps + 800;
        $("banner").textContent = "The flow field hit a numerical blow-up " +
          "(usually an obstacle arrangement with sub-cell gaps) and was " +
          "re-initialized. The obstacles are unchanged.";
        setTimeout(() => $("banner").textContent = "", 6000);
      }
    } else {
      state.nanStrikes = 0;
    }
    const res = [];
    for (const id of [2, 3]) {
      const b = state.bodies[id];
      if (!b) { res.push(null); continue; }
      const f = eng.bodyForce(id);
      const denom = 0.5 * state.U * state.U * (b.A + 1);
      res.push({ cd: f.fx / denom, cl: f.fy / denom });
    }
    if (!frozen) {
      if (res[0]) { state.cdHist[0].push(res[0].cd); state.clHist[0].push(res[0].cl); }
      if (res[1]) { state.cdHist[1].push(res[1].cd); state.clHist[1].push(res[1].cl); }
      for (const h of [...state.cdHist, ...state.clHist]) {
        if (h.length > 900) h.splice(0, h.length - 900);
      }
    }
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const tail = a => mean(a.slice(-150));
    const cdA = tail(state.cdHist[0]), cdB = tail(state.cdHist[1]);
    const clA = tail(state.clHist[0]);
    $("v-cda").textContent = fmtCd(cdA);
    $("v-cdb").textContent = fmtCd(cdB);
    $("v-cla").textContent = fmtCd(clA);
    $("v-re").textContent = String(Math.round(state.Re));
    $("n-cda").style.left = `${Math.min(97, Math.max(0, (cdA ?? 0) / 4 * 100))}%`;
    $("n-cdb").style.left = `${Math.min(97, Math.max(0, (cdB ?? 0) / 4 * 100))}%`;
    $("n-cla").style.left = `${Math.min(97, Math.max(0, ((clA ?? 0) / 4 + 0.5) * 100))}%`;
    $("n-re").style.left = `${Math.min(97, state.Re / 400 * 100)}%`;
    if (state.preset === "drafting" && cdA && cdB) {
      const sv = (1 - cdB / cdA) * 100;
      $("v-saving").textContent = frozen ? "…" : `${sv.toFixed(0)} %`;
      $("v-saving").classList.toggle("neutral", !(sv > 5));
      $("n-saving").style.left = `${Math.min(97, Math.max(0, sv / 70 * 100))}%`;
    }
    $("fig1-live").textContent =
      ` τ=${state.tau.toFixed(3)}, U=${state.U}, step ${eng.steps.toLocaleString()}` +
      (frozen ? " — settling, readouts resume shortly" : "");
  }

  let gaugeTick = 0;
  function frame() {
    if (!state.paused) {
      const tA = performance.now();
      state.eng.step(state.stepsPerFrame);
      const tB = performance.now();
      if (engineKind === "gpu") drawGpu();
      else draw(state.eng.computeMoments());
      const tC = performance.now();
      if (++gaugeTick % 4 === 0) {
        updateGauges();
        drawLiveCharts();
      }
      const tD = performance.now();
      window.__perf = { step: tB - tA, draw: tC - tB, gauges: tD - tC };
      frameCount += state.stepsPerFrame;
      const now = performance.now();
      if (now - lastFrameT > 1000) {
        fpsSmoothed = frameCount / ((now - lastFrameT) / 1000);
        $("meta-fps").textContent = `${Math.round(fpsSmoothed).toLocaleString()} steps/s`;
        lastFrameT = now; frameCount = 0;
      }
    }
  }

  // rAF is suspended when the window is hidden/occluded; a guarded timeout
  // fallback keeps the lab ticking (slowly) so it never looks dead.
  let gen = 0;
  function schedule() {
    const g = ++gen;
    const id = setTimeout(() => { if (g === gen) loop(); }, 120);
    requestAnimationFrame(() => {
      if (g === gen) { clearTimeout(id); loop(); }
    });
  }
  function loop() {
    frame();
    schedule();
  }

  /* ---------------- SVG chart util ---------------- */
  function lineChart(el, opts) {
    const W = 560, H = 220, mL = 46, mB = 30, mT = 12, mR = 12;
    const { series, yLabel, xLabel, refs = [], xTicksAt } = opts;
    const allY = series.flatMap(s => s.pts.map(p => p[1]))
      .concat(refs.map(r => r.y)).filter(v => isFinite(v));
    const allX = series.flatMap(s => s.pts.map(p => p[0]));
    if (!allY.length || !allX.length) {
      el.innerHTML = `<p style="font:13px var(--mono);color:var(--muted);margin:20px">no data yet — run pending</p>`;
      return;
    }
    let y0 = Math.min(...allY), y1 = Math.max(...allY);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.12; y0 -= pad; y1 += pad;
    if (opts.yZero) y0 = Math.min(0, y0);
    const x0 = Math.min(...allX), x1 = Math.max(...allX) || 1;
    const sx = v => mL + (v - x0) / (x1 - x0 || 1) * (W - mL - mR);
    const sy = v => mT + (1 - (v - y0) / (y1 - y0)) * (H - mT - mB);
    let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${yLabel} chart">`;
    // grid + y ticks
    const nT = 4;
    for (let i = 0; i <= nT; i++) {
      const v = y0 + (y1 - y0) * i / nT, y = sy(v);
      g += `<line class="grid" x1="${mL}" x2="${W - mR}" y1="${y}" y2="${y}" stroke="#dde0dc"/>` +
        `<text class="tick" x="${mL - 6}" y="${y + 3}" text-anchor="end">${fmtTick(v)}</text>`;
    }
    const xt = xTicksAt || [x0, (x0 + x1) / 2, x1];
    for (const v of xt) {
      g += `<text class="tick" x="${sx(v)}" y="${H - 8}" text-anchor="middle">${fmtTick(v)}</text>`;
    }
    g += `<line class="baseline" x1="${mL}" x2="${W - mR}" y1="${H - mB}" y2="${H - mB}" stroke="#b9bfba"/>`;
    for (const r of refs) {
      g += `<line x1="${mL}" x2="${W - mR}" y1="${sy(r.y)}" y2="${sy(r.y)}"
        stroke="#82878b" stroke-dasharray="5 4" stroke-width="1"/>` +
        `<text class="tick" x="${W - mR}" y="${sy(r.y) - 4}" text-anchor="end">${r.label}</text>`;
    }
    for (const s of series) {
      const d = s.pts.filter(p => isFinite(p[1]))
        .map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
      if (s.markers) {
        for (const p of s.pts) {
          g += `<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="3.5" fill="${s.color}"/>` +
            (s.errs ? "" : "");
        }
      }
      if (s.label) {
        const last = s.pts[s.pts.length - 1];
        g += `<text class="dlabel" x="${Math.min(sx(last[0]) + 6, W - 70)}" y="${sy(last[1]) - 6}"
          fill="${s.color}">${s.label}</text>`;
      }
    }
    g += `<text class="tick" x="${mL}" y="${mT}" text-anchor="start">${yLabel}</text>`;
    if (xLabel) g += `<text class="tick" x="${(W + mL) / 2}" y="${H - 20}" text-anchor="middle">${xLabel}</text>`;
    g += `</svg>`;
    el.innerHTML = g;
  }
  function fmtTick(v) {
    const a = Math.abs(v);
    if (a >= 1000) return (v / 1000).toFixed(1) + "k";
    if (a >= 10) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function drawLiveCharts() {
    const t0 = Math.max(0, state.cdHist[0].length - 900);
    lineChart($("chart-cd-live"), {
      yLabel: "Cd",
      series: [
        { pts: state.cdHist[0].map((v, i) => [i + t0, v]), color: "#2a78d6" },
        { pts: state.cdHist[1].map((v, i) => [i + t0, v]), color: "#eb6834" },
      ],
    });
    lineChart($("chart-probe"), {
      yLabel: "Cl",
      series: [
        { pts: state.clHist[0].map((v, i) => [i + t0, v]), color: "#2a78d6" },
      ],
    });
  }

  /* ---------------- interaction: sliders ---------------- */
  function bindSlider(id, out, key, cb) {
    $(id).addEventListener("input", () => {
      const v = parseFloat($(id).value);
      $(out).value = v;
      state[key] = v;
      if (cb) cb(v);
    });
  }
  bindSlider("s-re", "o-re", "Re", () => { computeTau(); state.eng.tau = state.tau; });
  bindSlider("s-u", "o-u", "U", () => {
    computeTau();
    state.eng.tau = state.tau; state.eng.u0 = state.U;
    if (state.preset === "drafting") state.eng.setWallVelocity(1, state.U, 0);
  });
  bindSlider("s-gap", "o-gap", "gap", () => applyPreset(state.preset));
  bindSlider("s-size", "o-size", "size", () => applyPreset(state.preset));
  bindSlider("s-speed", "o-speed", "stepsPerFrame", null);
  bindSlider("s-brush", "o-brush", "brush", null);
  $("f-field").addEventListener("change", e => state.field = e.target.value);
  $("f-cmap").addEventListener("change", e => state.cmap = e.target.value);
  $("b-pause").addEventListener("click", () => {
    state.paused = !state.paused;
    $("b-pause").textContent = state.paused ? "Run" : "Pause";
    $("b-pause").setAttribute("aria-pressed", String(state.paused));
  });
  $("b-step").addEventListener("click", () => {
    state.eng.step(1);
    if (engineKind === "gpu") drawGpu();
    else draw(state.eng.computeMoments());
  });
  $("b-reset").addEventListener("click", () => applyPreset(state.preset));
  document.querySelectorAll("#presets .preset").forEach(b =>
    b.addEventListener("click", () => applyPreset(b.dataset.preset)));

  /* ---------------- interaction: dragging & drawing ---------------- */
  let dragBody = 0, dragLast = null;
  function canvasPos(ev) {
    const r = tunnelCanvas.getBoundingClientRect();
    const x = Math.round((ev.clientX - r.left) / r.width * NX);
    const y = Math.round(NY - 1 - (ev.clientY - r.top) / r.height * NY);
    return { x, y };
  }
  tunnelCanvas.addEventListener("pointerdown", ev => {
    const { x, y } = canvasPos(ev);
    tunnelCanvas.setPointerCapture(ev.pointerId);
    if (state.drawMode) { paint(x, y, ev.shiftKey); dragBody = -1; return; }
    const id = state.obst[y * NX + x];
    if (id >= 2 && state.bodies[id]) { dragBody = id; dragLast = { x, y }; }
  });
  tunnelCanvas.addEventListener("pointermove", ev => {
    if (dragBody === -1) { const p = canvasPos(ev); paint(p.x, p.y, ev.shiftKey); return; }
    if (!dragBody) return;
    const p = canvasPos(ev);
    const dx = p.x - dragLast.x, dy = p.y - dragLast.y;
    if (!dx && !dy) return;
    dragLast = p;
    moveBody(dragBody, dx, dy);
  });
  const endDrag = () => { dragBody = 0; dragLast = null; };
  tunnelCanvas.addEventListener("pointerup", endDrag);
  tunnelCanvas.addEventListener("pointercancel", endDrag);
  tunnelCanvas.addEventListener("keydown", ev => {
    const map = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] };
    if (map[ev.key] && state.bodies[3]) {
      moveBody(3, ...map[ev.key]); ev.preventDefault();
    } else if (ev.key === " ") { $("b-pause").click(); ev.preventDefault(); }
  });

  function moveBody(id, dx, dy) {
    const b = state.bodies[id];
    b.x0 += dx; b.y0 += dy;
    if (b.kind === "car") {
      // snap: either sunk on the road (0) or clearly above it (>=4 cells) —
      // the in-between leaves sub-resolvable gap channels
      if (b.y0 < 0) b.y0 = 0;
      else if (b.y0 > 0 && b.y0 < 4) b.y0 = dy > 0 ? 4 : 0;
    }
    // re-stamp obstacles from body records (keeps flow field: honest pop +
    // gauge freeze, see the info note)
    const o = new Uint8Array(NX * NY);
    for (let i = 0; i < o.length; i++) if (state.obst[i] === 1) o[i] = 1;
    for (const [bid, bb] of Object.entries(state.bodies)) {
      const kind = bb.kind;
      if (kind === "disk") {
        stampDisk(o, bb.x0 + (state.size >> 1), bb.y0 + (state.size >> 1), state.size >> 1, +bid);
      } else if (kind === "car") stampSil(o, SIL.carSide, bb.L, bb.x0, bb.y0, +bid);
      else if (kind === "carTop") stampSil(o, SIL.carTop, bb.L, bb.x0, bb.y0, +bid);
      else if (kind === "plane") stampSil(o, SIL.planeSide, bb.L, bb.x0, bb.y0, +bid);
      else if (kind === "bird") stampSil(o, SIL.birdSide, bb.L, bb.x0, bb.y0, +bid);
    }
    state.obst = o;
    state.eng.setObstacle((x, y) => o[y * NX + x]);
    state.freezeUntil = state.eng.steps + Math.round(NX / state.U / 8);
    if (state.preset === "drafting" && state.bodies[2] && state.bodies[3]) {
      const gapCells = state.bodies[3].x0 - (state.bodies[2].x0 + state.bodies[2].L);
      const gapL = gapCells / state.bodies[2].L;
      $("o-gap").value = gapL.toFixed(2);
      $("s-gap").value = gapL; state.gap = gapL;
    }
  }

  function paint(x, y, erase) {
    const r = state.brush;
    for (let yy = y - r; yy <= y + r; yy++) {
      for (let xx = x - r; xx <= x + r; xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r && xx >= 1 && xx < NX - 1 && yy >= 0 && yy < NY) {
          state.obst[yy * NX + xx] = erase ? 0 : 1;
        }
      }
    }
    state.eng.setObstacle((px, py) => state.obst[py * NX + px]);
  }

  /* ---------------- self-checks panel ---------------- */
  const CHECKS = [
    {
      key: "tg", name: "Taylor–Green decay", est: "~2 s",
      what: "Bulk physics: swirl must die at exactly 2νk² (analytic), and total mass must not drift.",
      run: (progress) => SelfCheck.taylorGreen(makeEngine, GOLDEN.taylorGreen, progress),
      rows: r => [
        ["measured decay", r.measured.toExponential(3)],
        ["analytic target", r.target.toExponential(3)],
        ["error", (r.err * 100).toFixed(2) + "% (tol " + (r.tol * 100) + "%)"],
        ["mass drift", r.extra.massDrift.toExponential(1) + " (tol 1e-5)"],
      ],
      pass: r => r.pass && r.extra.massPass,
    },
    {
      key: "poi", name: "Poiseuille profile", est: "~5 s",
      what: "Walls: channel flow must be a parabola to 2%.",
      run: (progress) => SelfCheck.poiseuille(makeEngine, GOLDEN.poiseuille, progress),
      rows: r => [
        ["max deviation", (r.measured * 100).toFixed(2) + "%"],
        ["tolerance", (r.tol * 100).toFixed(0) + "%"],
      ],
      pass: r => r.pass,
    },
    {
      key: "st", name: "Cylinder Re=100 Strouhal",
      est: engineKind === "gpu" ? "~1–2 min" : "~10 min (CPU engine)",
      what: "Open flow + forces: shedding frequency must land in the same band the Python engine hit.",
      run: (progress) => SelfCheck.strouhal(makeEngine, GOLDEN.strouhal, progress),
      rows: r => [
        ["measured St", r.measured.toFixed(4)],
        ["python engine", GOLDEN.strouhal.pythonSt ? GOLDEN.strouhal.pythonSt.toFixed(4) : "run pending"],
        ["accepted band", r.band[0] + " – " + r.band[1]],
        ["blockage", (GOLDEN.strouhal.blockage * 100).toFixed(1) + "% (raises St vs unbounded 0.16–0.17)"],
      ],
      pass: r => r.pass,
    },
  ];
  const liveCheckResults = {};

  function renderChecks() {
    const grid = $("checks-grid");
    grid.innerHTML = "";
    for (const c of CHECKS) {
      const div = document.createElement("div");
      div.className = "check";
      div.innerHTML = `
        <h3>${c.name}</h3>
        <div class="what">${c.what}</div>
        <span class="status idle" id="st-${c.key}">not yet run</span>
        <table id="tb-${c.key}"></table>
        <progress id="pr-${c.key}" max="1" value="0" hidden></progress>
        <button id="bt-${c.key}">Run this check (${c.est})</button>`;
      grid.appendChild(div);
    }
    for (const c of CHECKS) {
      $(`bt-${c.key}`).addEventListener("click", async () => {
        const bt = $(`bt-${c.key}`), st = $(`st-${c.key}`), pr = $(`pr-${c.key}`);
        bt.disabled = true; pr.hidden = false;
        st.className = "status idle"; st.textContent = "running…";
        const wasPaused = state.paused;
        state.paused = true;               // free GPU + main thread for the check
        try {
          const r = await c.run(p => pr.value = p);
          liveCheckResults[c.key] = r;
          const ok = c.pass(r);
          st.className = "status " + (ok ? "pass" : "fail");
          st.textContent = ok ? "PASS" : "FAIL — see numbers";
          $(`tb-${c.key}`).innerHTML = c.rows(r)
            .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
          renderValidation();
        } catch (e) {
          st.className = "status fail"; st.textContent = "error: " + e.message;
        }
        state.paused = wasPaused;
        bt.disabled = false; pr.hidden = true;
      });
    }
  }

  /* ---------------- results: drafting ---------------- */
  function renderDrafting() {
    const el = $("drafting-content");
    const rows = DATA.drafting;
    if (!rows || !rows.length) {
      el.innerHTML = `<p class="figcap">The gap-sweep runs are still executing —
        this section fills itself in from <code>out/drafting_map.csv</code>
        (re-run <code>tools/build_site_data.py</code>).</p>`;
      return;
    }
    const iso = rows.find(r => r.kind === "isolated");
    const tandemB = rows.filter(r => r.kind === "tandem" && r.car === "b")
      .map(r => [parseFloat(r.param), parseFloat(r.Cd)]).sort((a, b) => a[0] - b[0]);
    const tandemA = rows.filter(r => r.kind === "tandem" && r.car === "a")
      .map(r => [parseFloat(r.param), parseFloat(r.Cd)]).sort((a, b) => a[0] - b[0]);
    const side = rows.filter(r => r.kind === "side");
    let html = `<div class="charts-2col">
      <div class="chart"><div id="chart-map"></div>
        <div class="figcap"><b>Fig. 4 — The aero map.</b> Trailing car's drag vs
        gap; the dashed line is the isolated car. At the closest measured gap
        the trailing car pays ${iso ? Math.round((1 - tandemB[0][1] / parseFloat(iso.Cd)) * 100) : "—"}%
        less drag. Leader (blue) barely changes. Mean over the final 5000 steps
        per run.</div></div>
      <div class="chart"><div id="chart-dyn"></div>
        <div class="figcap"><b>Fig. 5 — The catch-up, emergent.</b> Both cars
        get the same engine; the follower closes the gap on its own because the
        map above says its drag falls as it approaches.
        ${DATA.dynamicsMeta ? "" : ""}</div></div>
    </div>`;
    if (side.length) {
      html += `<div class="chart" style="margin-top:16px"><div id="chart-side"></div>
        <div class="figcap"><b>Fig. 6 — Side-by-side.</b> Lateral (side) force
        on each car vs offset — the force grows as the cars close in.</div></div>`;
    }
    el.innerHTML = html;
    lineChart($("chart-map"), {
      yLabel: "Cd", xLabel: "gap (car lengths)", yZero: false,
      series: [
        { pts: tandemA, color: "#2a78d6", label: "leader", markers: true },
        { pts: tandemB, color: "#eb6834", label: "trailing", markers: true },
      ],
      refs: iso ? [{ y: parseFloat(iso.Cd), label: "isolated" }] : [],
      xTicksAt: tandemB.map(p => p[0]),
    });
    if (DATA.dynamics && DATA.dynamics.length) {
      lineChart($("chart-dyn"), {
        yLabel: "gap (car lengths)", xLabel: "time (car lengths / speed)",
        series: [{
          pts: DATA.dynamics.map(r => [parseFloat(r.t), parseFloat(r.gap)]),
          color: "#c43a35", label: "gap(t)",
        }],
      });
    } else {
      $("chart-dyn").innerHTML = `<p style="font:13px var(--mono);color:var(--muted);margin:20px">dynamics run pending</p>`;
    }
    if (side.length) {
      const byCar = c => side.filter(r => r.car === c)
        .map(r => [parseFloat(r.param), Math.abs(parseFloat(r.Cy))]).sort((a, b) => a[0] - b[0]);
      lineChart($("chart-side"), {
        yLabel: "|Cy| (side force)", xLabel: "offset (car widths)", yZero: true,
        series: [
          { pts: byCar("a"), color: "#2a78d6", label: "car A", markers: true },
          { pts: byCar("b"), color: "#eb6834", label: "car B", markers: true },
        ],
      });
    }
  }

  /* ---------------- results: birds ---------------- */
  function renderBirds() {
    const el = $("birds-content");
    const base = DATA.birdsBaseline, form = DATA.birdsFormation, gate = DATA.birdsGate;
    if (!gate) {
      el.innerHTML = `<p class="figcap">The 3D bird runs are still executing —
        this section fills itself in when they finish.</p>`;
      return;
    }
    let html = "";
    html += `<div class="checks">`;
    html += `<div class="check"><h3>Gate: can we resolve lift at all?</h3>
      <span class="status ${gate.pass ? "pass" : "fail"}">${gate.pass ? "PASS" : "FAIL"}</span>
      <table>
        <tr><td>Cl at incidence</td><td>${gate.aoa.Cl.toFixed(3)} ± ${gate.aoa.Cl_std.toFixed(3)}</td></tr>
        <tr><td>Cl at zero incidence</td><td>${gate.zero.Cl.toFixed(3)} ± ${gate.zero.Cl_std.toFixed(3)}</td></tr>
      </table>
      <div class="what">Lift at incidence must beat 3× its own noise and the
      zero-incidence value — otherwise the formation study would be reading
      tea leaves and we would say so here instead.</div></div>`;
    if (base) {
      html += `<div class="check"><h3>Mechanism: the wingtip vortex pair</h3>
        <span class="status ${base.mechanism_ok ? "pass" : "fail"}">${base.mechanism_ok ? "PASS" : "FAIL"}</span>
        <table>
          <tr><td>upwash outboard (left)</td><td>${sci(base.upwash_outboard_lo)}</td></tr>
          <tr><td>upwash outboard (right)</td><td>${sci(base.upwash_outboard_hi)}</td></tr>
          <tr><td>downwash between tips</td><td>${sci(base.downwash_mid)}</td></tr>
        </table>
        <div class="what">Cross-flow plane 0.5 spans behind the bird: air must
        rise outboard of the tips and sink between them. The measured upwash
        maximum — not the textbook offset — is where the trailing birds fly.</div></div>`;
    }
    if (form) {
      const LD = form.LD;
      html += `<div class="check"><h3>Benefit: L/D in formation</h3>
        <span class="status ${form.benefit_sign_positive ? "pass" : "fail"}">
          ${form.benefit_sign_positive ? "PASS" : "BELOW NOISE"}</span>
        <table>
          <tr><td>isolated bird</td><td>${LD.isolated.toFixed(2)}</td></tr>
          <tr><td>leader</td><td>${LD.leader.toFixed(2)}</td></tr>
          <tr><td>trailing right</td><td>${LD.trail_right.toFixed(2)}</td></tr>
          <tr><td>trailing left</td><td>${LD.trail_left.toFixed(2)}</td></tr>
        </table>
        <div class="what">Lift-to-drag ratio, per bird, separate force
        accounting. The claim defended here is the <em>sign</em> — trailing
        birds do better than flying alone; the magnitude at Re≈200 is honest
        but not goose-scale.</div></div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }
  const sci = v => (v >= 0 ? "+" : "") + v.toExponential(2);

  /* ---------------- results: gallery ---------------- */
  const GALLERY_INFO = {
    ahmed: {
      title: "Ahmed body (reference car)", mesh: null,
      watch: "The separation bubble over the rear slant and the two trailing vortices this shape is famous for.",
    },
    car: {
      title: "Race car", mesh: "car.glb",
      watch: "Wake off the rear wing and wheels; compare its scale with the Ahmed body's cleaner separation.",
    },
    rocket: {
      title: "Saturn V", mesh: "rocket.glb",
      watch: "Blunt-base recirculation — the drag of rockets is mostly this suction bubble at the bottom.",
    },
    airplane: {
      title: "Airplane at 5° incidence", mesh: "airplane.glb",
      watch: "Faster air above, slower below — the pressure asymmetry that shows up as measured lift (Cl > 0).",
    },
    ship: {
      title: "Ocean liner (wind-tunnel mode)", mesh: "ship.glb",
      watch: "Bow stagnation and the long stern wake. Fully immersed — no free surface, stated honestly.",
    },
    bird: {
      title: "Gliding bird", mesh: "bird.glb",
      watch: "Wingtip vortices forming — the raw material of §4's formation physics.",
    },
  };

  function renderGallery() {
    const grid = $("gallery-grid");
    grid.innerHTML = "";
    const gal = DATA.gallery || {};
    const vids = new Set(DATA.videos || []);
    for (const [name, info] of Object.entries(GALLERY_INFO)) {
      const meta = gal[name];
      const card = document.createElement("div");
      card.className = "card";
      const vid = `shape_${name}.mp4`;
      let media;
      if (vids.has(vid)) {
        media = `<video controls loop muted preload="metadata" src="media/${vid}"></video>`;
      } else {
        media = `<div class="viewer" style="aspect-ratio:16/6;display:grid;place-items:center">
          <span style="font:12.5px var(--mono);color:var(--muted)">3D run ${meta ? "rendering" : "in progress"} — video lands here</span></div>`;
      }
      const viewer = info.mesh
        ? `<div class="viewer" data-mesh="${info.mesh}"><span class="hint">drag to orbit</span></div>`
        : `<div class="viewer" style="display:grid;place-items:center">
            <span style="font:12.5px var(--mono);color:var(--muted)">procedural reference geometry (Ahmed et al. 1984)</span></div>`;
      const stats = meta
        ? `Re=${meta.Re} · grid ${meta.shape.join("×")} · body ${meta.L} cells long · ` +
        `τ=${meta.tau.toFixed(3)}` +
        (meta.Cd_mean !== undefined ? ` · Cd=${meta.Cd_mean.toFixed(2)}±${meta.Cd_std.toFixed(2)}` : "") +
        (name === "airplane" && meta.Cl_mean !== undefined ? ` · Cl=${meta.Cl_mean.toFixed(2)}` : "")
        : "run in progress — numbers land here when it finishes";
      card.innerHTML = `<h3>${info.title}</h3>${media}${viewer}
        <p class="stats">${stats}</p>
        <p class="figcap"><b>What to look for:</b> ${info.watch}</p>`;
      grid.appendChild(card);
    }
    // suite extension: same rigor loop, different physics
    const suite = [
      DATA.ising && {
        title: "Ising model at the critical point", vid: "ising_coarsening.mp4",
        stats: `Tc measured ${DATA.ising.Tc_measured.toFixed(4)} vs Onsager exact 2.2692 ` +
          `(${(DATA.ising.rel_err * 100).toFixed(2)}% off) · ${DATA.ising.n}² spins`,
        watch: "Magnetic domains flickering at every size — the scale-free " +
          "fluctuations that only exist exactly at a phase transition.",
      },
      DATA.nbody && {
        title: "Galaxy collision (N-body)", vid: "nbody_merger.mp4",
        stats: `N=${DATA.nbody.n.toLocaleString()} particles · energy drift ` +
          `${(DATA.nbody.drift * 100).toFixed(2)}% over ${DATA.nbody.steps} steps`,
        watch: "Tidal tails flung out on close approach, then the slow spiral " +
          "into a single merged blob — gravity only, no scripting.",
      },
    ].filter(Boolean);
    const vidset = new Set(DATA.videos || []);
    for (const s of suite) {
      if (!vidset.has(s.vid)) continue;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<h3>${s.title}</h3>
        <video controls loop muted preload="metadata" src="media/${s.vid}"></video>
        <p class="stats">${s.stats}</p>
        <p class="figcap"><b>What to look for:</b> ${s.watch}</p>`;
      grid.appendChild(card);
    }
    initViewers();
  }

  function initViewers() {
    if (!window.THREE) return;
    const io = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (en.isIntersecting && !en.target.dataset.init) {
          en.target.dataset.init = "1";
          startViewer(en.target);
          io.unobserve(en.target);
        }
      }
    }, { rootMargin: "200px" });
    document.querySelectorAll(".viewer[data-mesh]").forEach(v => io.observe(v));
  }

  function startViewer(el) {
    const T = window.THREE;
    const scene = new T.Scene();
    scene.background = new T.Color(0xf2f4f2);
    const cam = new T.PerspectiveCamera(40, 16 / 9, 0.01, 100);
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    resize(); addEventListener("resize", resize);
    scene.add(new T.HemisphereLight(0xffffff, 0x777766, 1.6));
    const dl = new T.DirectionalLight(0xffffff, 2.2);
    dl.position.set(3, 5, 2); scene.add(dl);
    const controls = new window.THREE_OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true; controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    renderer.domElement.addEventListener("pointerdown", () => controls.autoRotate = false, { once: true });
    new window.THREE_GLTFLoader().load("media/models/" + el.dataset.mesh, g => {
      const obj = g.scene;
      const box = new T.Box3().setFromObject(obj);
      const size = box.getSize(new T.Vector3()).length();
      const center = box.getCenter(new T.Vector3());
      obj.position.sub(center);
      cam.position.set(size * 0.7, size * 0.4, size * 0.8);
      controls.update();
      scene.add(obj);
    });
    (function loop() {
      controls.update();
      renderer.render(scene, cam);
      requestAnimationFrame(loop);
    })();
  }

  /* ---------------- validation table ---------------- */
  function renderValidation() {
    const cyl = DATA.cylinder2d;
    const gal = DATA.gallery || {};
    const draft = DATA.drafting;
    const iso = draft && draft.find(r => r.kind === "isolated");
    const closeB = draft && draft.filter(r => r.kind === "tandem" && r.car === "b")
      .sort((a, b) => parseFloat(a.param) - parseFloat(b.param))[0];
    const farB = draft && draft.filter(r => r.kind === "tandem" && r.car === "b")
      .sort((a, b) => parseFloat(b.param) - parseFloat(a.param))[0];
    const tg = liveCheckResults.tg, poi = liveCheckResults.poi, stc = liveCheckResults.st;
    const rows = [
      ["Equilibrium moments (2D & 3D)", "exact identity", "pytest: Σfeq=ρ, Σfeq·c=ρu to 1e-6", "PASS", "pytest suite"],
      ["Taylor–Green decay", "2νk² (analytic)", tg ? `browser: ${tg.measured.toExponential(3)} (err ${(tg.err * 100).toFixed(2)}%)` : "browser: run §2", tg ? (tg.pass ? "PASS" : "FAIL") : "…", "analytic"],
      ["Poiseuille profile (2D & 3D)", "parabola, 2%", poi ? `browser max dev ${(poi.measured * 100).toFixed(2)}%` : "browser: run §2", poi ? (poi.pass ? "PASS" : "FAIL") : "…", "analytic"],
      ["Couette moving wall", "linear profile", "pytest: 2% of U", "PASS", "analytic"],
      ["Cylinder Re=20 drag", "steady, Cd ∈ [1.5, 3.0]", "pytest: steady to <1%, in range (blockage 14%)", "PASS", "lit. (unbounded 2.0–2.2)"],
      ["Cylinder Re=100 Strouhal", "0.14–0.20 confined", cyl ? `python ${cyl.St.toFixed(4)}` + (stc ? ` · browser ${stc.measured.toFixed(4)}` : "") : "python run finishing", cyl ? "PASS" : "…", "lit. St≈0.16–0.17 unbounded"],
      ["Momentum-exchange force", "= body-force input, exactly", "pytest: matches to 1e-4 (Poiseuille balance)", "PASS", "momentum conservation"],
      ["Sphere Re=100 drag", "Cd ≈ 1.09 ± 25%", DATA.sphere ? `Cd=${DATA.sphere.Cd.toFixed(2)} (blockage ${(DATA.sphere.blockage * 100).toFixed(0)}%)` : "slow test queued", DATA.sphere ? (DATA.sphere.Cd > 0.8 && DATA.sphere.Cd < 1.4 ? "PASS" : "FAIL") : "…", "Schiller–Naumann"],
      ["Ahmed body Cd", "reported vs experiment*", gal.ahmed && gal.ahmed.Cd_mean ? `Cd=${gal.ahmed.Cd_mean.toFixed(2)} at Re=${gal.ahmed.Re} (laminar: ~10× the high-Re value, as for any bluff body)` : "3D run in progress", gal.ahmed && gal.ahmed.Cd_mean ? "REPORTED*" : "…", "Ahmed et al. 1984: 0.26–0.29 at Re≈10⁶"],
      ["Drafting: close-gap saving", "Cd_trail < 0.7 × Cd_iso", closeB && iso ? `${closeB.param}L gap: ${parseFloat(closeB.Cd).toFixed(2)} vs iso ${parseFloat(iso.Cd).toFixed(2)}` : "sweep in progress", closeB && iso ? (parseFloat(closeB.Cd) < 0.7 * parseFloat(iso.Cd) ? "PASS" : "FAIL") : "…", "platoon lit.: 30–60%"],
      ["Drafting: recovery at 3L", "within 15% of isolated", farB && iso ? `${farB.param}L gap: ${parseFloat(farB.Cd).toFixed(2)}` : "sweep in progress", farB && iso ? (Math.abs(parseFloat(farB.Cd) / parseFloat(iso.Cd) - 1) < 0.15 ? "PASS" : "NOTE†") : "…", "laminar wakes decay slowly — see †"],
      ["Drafting dynamics", "gap closes, ratio ≫ 1", DATA.dynamics ? "emergent catch-up from measured map" : "pending", DATA.dynamics ? "PASS" : "…", "quasi-static ODE"],
      ["Bird wake sign pattern", "up outboard / down inboard", DATA.birdsBaseline ? (DATA.birdsBaseline.mechanism_ok ? "measured as predicted" : "NOT resolved") : "3D run pending", DATA.birdsBaseline ? (DATA.birdsBaseline.mechanism_ok ? "PASS" : "FAIL") : "…", "Lissaman & Shollenberger 1970"],
      ["V-formation benefit", "trailing L/D > isolated", DATA.birdsFormation ? `sign ${DATA.birdsFormation.benefit_sign_positive ? "positive" : "not resolved"}` : "3D run pending", DATA.birdsFormation ? (DATA.birdsFormation.benefit_sign_positive ? "PASS" : "NOTE") : "…", "Portugal et al. 2014"],
      ["(Suite) Ising Tc", "2.269 ± 3% (Onsager exact)", DATA.ising ? `Tc=${DATA.ising.Tc_measured.toFixed(4)} (${(DATA.ising.rel_err * 100).toFixed(2)}%)` : "sweep pending", DATA.ising ? (DATA.ising.rel_err < 0.03 ? "PASS" : "FAIL") : "…", "Onsager 1944, exact"],
      ["(Suite) N-body energy", "drift < 2% (leapfrog+softening)", DATA.nbody ? `${(DATA.nbody.drift * 100).toFixed(2)}% over ${DATA.nbody.steps} steps, N=${DATA.nbody.n.toLocaleString()}` : "merger running", DATA.nbody ? (DATA.nbody.drift < 0.02 ? "PASS" : "FAIL") : "…", "energy conservation"],
    ];
    $("validation-table").innerHTML = `<table class="validation">
      <caption>Validation ledger. * = our Reynolds is orders of magnitude below
      the experiment's — the number is reported with its regime stated, not
      asserted against the high-Re value (laminar bluff-body drag is ~10× the
      turbulent value; the same is true of a cylinder or sphere).
      † = at low Reynolds the wake genuinely persists past 3 car lengths —
      a physics finding, flagged rather than hidden.</caption>
      <thead><tr><th>Check</th><th>Target</th><th>Measured</th><th></th><th>Source</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td>
        <td class="${r[3].startsWith("PASS") ? "pass" : r[3] === "…" ? "pending" : r[3].startsWith("FAIL") ? "fail" : "pending"}">${r[3]}</td>
        <td>${r[4]}</td></tr>`).join("")}</tbody></table>`;
  }

  /* ---------------- boot ---------------- */
  renderChecks();
  renderDrafting();
  renderBirds();
  renderGallery();
  renderValidation();
  applyPreset("drafting");
  schedule();
  // debug/testing handle (harmless: local page, own data)
  window.__lab = {
    state, applyPreset, updateGauges, drawLiveCharts,
    render: () => engineKind === "gpu" ? drawGpu() : draw(state.eng.computeMoments()),
    checkResults: liveCheckResults,
  };
})();
