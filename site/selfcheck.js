/* Golden-case self-checks — the same three cases the Python engine passed,
 * run live on the in-browser engine (CPU or GPU). Returns measured-vs-target
 * numbers; the UI shows them green/red and never hides a failure.
 * Runs in node too (tools/test_js_engine.js) — same file, zero divergence. */
"use strict";

const SelfCheck = (() => {
  // 1. Taylor–Green vortex: kinetic energy decays at exactly 2*nu*k^2.
  //    Checks bulk physics (collision + streaming), no boundaries at all.
  async function taylorGreen(makeEngine, p, progress) {
    const { n, tau, u0, steps } = p;
    const eng = makeEngine(n, n, { tau });
    const k = 2 * Math.PI / n;
    eng.initEquilibrium(1,
      (x, y) => u0 * Math.cos(k * x) * Math.sin(k * y),
      (x, y) => -u0 * Math.sin(k * x) * Math.cos(k * y));
    const e = [];
    const mass0 = eng.mass();
    const chunk = 50;
    for (let t = 0; t < steps; t += chunk) {
      eng.step(chunk);
      const m = eng.computeMoments();
      let ke = 0;
      for (let i = 0; i < m.ux.length; i++) {
        ke += m.ux[i] * m.ux[i] + m.uy[i] * m.uy[i];
      }
      e.push(ke);
      if (progress) { progress(t / steps); await yieldUI(); }
    }
    // fit log(e) vs t (samples every `chunk` steps); energy decays 2x rate
    const ts = e.map((_, i) => (i + 1) * chunk);
    const rate = -linfit(ts, e.map(Math.log)) / 2;
    const nu = (tau - 0.5) / 3;
    const target = 2 * nu * k * k;
    const err = Math.abs(rate - target) / target;
    const massDrift = Math.abs(eng.mass() - mass0) / mass0;
    return {
      name: "Taylor–Green decay",
      measured: rate, target, err, tol: p.tol,
      pass: err < p.tol,
      extra: { massDrift, massPass: massDrift < 1e-5 },
    };
  }

  // 2. Poiseuille channel: force-driven flow between walls must be a parabola.
  //    Checks the wall boundary condition.
  async function poiseuille(makeEngine, p, progress) {
    const { nx, ny, tau, g, steps } = p;
    const eng = makeEngine(nx, ny, { tau, gx: g });
    eng.setObstacle((x, y) => (y === 0 || y === ny - 1) ? 1 : 0);
    eng.initEquilibrium(1, 0, 0);
    const chunk = 500;
    for (let t = 0; t < steps; t += chunk) {
      eng.step(chunk);
      if (progress) { progress(t / steps); await yieldUI(); }
    }
    const m = eng.computeMoments();
    const h = (ny - 2) / 2;
    let maxDev = 0, uMax = 0;
    for (let y = 1; y < ny - 1; y++) uMax = Math.max(uMax, m.ux[y * nx + 0]);
    for (let y = 1; y < ny - 1; y++) {
      const yc = y - (ny - 1) / 2;
      const ana = 1 - (yc / h) * (yc / h);
      maxDev = Math.max(maxDev, Math.abs(m.ux[y * nx] / uMax - ana));
    }
    return {
      name: "Poiseuille profile",
      measured: maxDev, target: 0, err: maxDev, tol: p.tol,
      pass: maxDev < p.tol,
    };
  }

  // 3. Cylinder vortex street: Strouhal number must land in the same band the
  //    Python engine hit (and the literature reports). Checks open BCs +
  //    obstacle bounce-back + the force measurement, all at once.
  async function strouhal(makeEngine, p, progress) {
    const { nx, ny, D, U, Re, steps, warmup } = p;
    const Deff = p.Deff;                     // voxel diameter + half-link
    const nu = U * Deff / Re, tau = 3 * nu + 0.5;
    const eng = makeEngine(nx, ny, { tau, u0: U, open: true });
    const cxc = (nx / 4) | 0, cyc = (ny / 2) | 0, r2 = (D / 2) * (D / 2);
    eng.setObstacle((x, y) =>
      ((x - cxc) * (x - cxc) + (y - cyc) * (y - cyc) <= r2) ? 2 : 0);
    // impulsive start at U everywhere outside the cylinder (matches Python)
    eng.initEquilibrium(1, U, 0);
    const cl = [];
    const chunk = 100;
    for (let t = 0; t < steps; t += chunk) {
      eng.uPerturb = t < 1000 ? 0.05 * U : 0;
      for (let s = 0; s < chunk; s++) {
        eng.step(1);
        const tt = t + s;
        if (tt >= warmup && (tt & 1) === 0) {   // every 2nd step (Nyquist-safe:
          if (eng.syncForces) eng.syncForces(); // shedding period ~100 steps)
          cl.push(eng.bodyForce(2).fy);
        }
      }
      if (progress) { progress(t / steps); await yieldUI(); }
    }
    const st = dominantFreq(cl) / 2 * Deff / U;   // dt = 2 steps per sample
    return {
      name: "Cylinder Re=100 Strouhal",
      measured: st, target: p.pythonSt ?? 0.165,
      err: null, tol: null, band: p.band,
      pass: st > p.band[0] && st < p.band[1],
    };
  }

  function linfit(xs, ys) {          // least-squares slope
    const n = xs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
    }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  }

  function dominantFreq(sig) {       // Hann-windowed DFT peak (skip DC)
    const n = sig.length;
    const mean = sig.reduce((a, b) => a + b, 0) / n;
    const w = sig.map((v, i) =>
      (v - mean) * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
    let bestK = 1, bestP = -1;
    const kMax = Math.min(n / 2, 400);
    for (let k = 1; k < kMax; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const ph = 2 * Math.PI * k * i / n;
        re += w[i] * Math.cos(ph); im -= w[i] * Math.sin(ph);
      }
      const pw = re * re + im * im;
      if (pw > bestP) { bestP = pw; bestK = k; }
    }
    return bestK / n;
  }

  // MessageChannel yield: unlike setTimeout it is NOT subject to Chrome's
  // hidden-tab intensive timer throttling (1 timer/min), which would turn a
  // 2-minute check into hours when the window is occluded.
  const _mc = (typeof MessageChannel !== "undefined") ? new MessageChannel() : null;
  const _waiters = [];
  if (_mc) {
    _mc.port1.onmessage = () => {
      const r = _waiters.shift();
      if (r) r();
    };
  }
  function yieldUI() {
    if (!_mc) return Promise.resolve();
    return new Promise(r => {
      _waiters.push(r);
      _mc.port2.postMessage(0);
    });
  }

  return { taylorGreen, poiseuille, strouhal };
})();
if (typeof window !== "undefined") window.SelfCheck = SelfCheck;
if (typeof module !== "undefined") module.exports = SelfCheck;
