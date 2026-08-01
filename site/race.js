/* Map-driven two-car drafting dynamics (port of dynamics.py).
 * Quasi-static: Cd_trail(gap) from the measured aero map; ODE integration.
 * Works in browser (window.RaceDynamics) and Node (module.exports). */
"use strict";

const RaceDynamics = (() => {
  function rk4(f, y, t, dt) {
    const k1 = f(t, y);
    const k2 = f(t + dt / 2, addScaled(y, k1, dt / 2));
    const k3 = f(t + dt / 2, addScaled(y, k2, dt / 2));
    const k4 = f(t + dt, addScaled(y, k3, dt));
    // y + dt/6 * (k1 + 2k2 + 2k3 + k4)
    const out = new Float64Array(4);
    for (let i = 0; i < 4; i++) {
      out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
    return out;
  }

  function addScaled(y, k, s) {
    const o = new Float64Array(4);
    for (let i = 0; i < 4; i++) o[i] = y[i] + s * k[i];
    return o;
  }

  function lerp(x, xs, ys, left, right) {
    if (x <= xs[0]) return left !== undefined ? left : ys[0];
    if (x >= xs[xs.length - 1]) return right !== undefined ? right : ys[ys.length - 1];
    let i = 0;
    while (i < xs.length - 1 && xs[i + 1] < x) i++;
    const t = (x - xs[i]) / (xs[i + 1] - xs[i] || 1);
    return ys[i] + t * (ys[i + 1] - ys[i]);
  }

  /** Parse SITE_DATA.drafting rows -> { gaps, cdTrail, cdIso, A }. */
  function loadMapFromDrafting(rows) {
    if (!rows || !rows.length) return null;
    const gaps = [], cdTrail = [];
    let cdIso = null, A = 1;
    for (const row of rows) {
      if (row.kind === "isolated") {
        cdIso = parseFloat(row.Cd);
        if (row.A !== undefined && row.A !== "") A = parseFloat(row.A);
      } else if (row.kind === "tandem" && row.car === "b") {
        gaps.push(parseFloat(row.param));
        cdTrail.push(parseFloat(row.Cd));
      }
    }
    if (cdIso === null || gaps.length < 2) return null;
    // sort by gap ascending
    const order = gaps.map((_, i) => i).sort((a, b) => gaps[a] - gaps[b]);
    return {
      gaps: order.map(i => gaps[i]),
      cdTrail: order.map(i => cdTrail[i]),
      cdIso,
      A,
      gapMin: order.map(i => gaps[i])[0],
    };
  }

  /**
   * Full offline simulation (matches dynamics.py defaults).
   * @returns {{ t, gap, vLeader, vTrailing, caught, timescale_ratio, t_end, gap_end, gap0 }}
   */
  function simulate(map, opts = {}) {
    const m = opts.m !== undefined ? opts.m : 50.0;
    const gap0 = opts.gap0 !== undefined ? opts.gap0 : 3.0;
    const dt = opts.dt !== undefined ? opts.dt : 0.01;
    const tMax = opts.tMax !== undefined ? opts.tMax : 2000.0;
    const { gaps, cdTrail, cdIso } = map;
    const A = 1.0; // areas cancel; fold into engine force (same as Python)
    const Fe = 0.5 * cdIso * A * 1.0 * 1.0;

    function cdGap(g) {
      return lerp(g, gaps, cdTrail, cdTrail[0], cdIso);
    }

    function deriv(t, y) {
      const x1 = y[0], v1 = y[1], x2 = y[2], v2 = y[3];
      const gap = x1 - x2 - 1.0;
      const d1 = Fe - 0.5 * cdIso * A * v1 * v1;
      const d2 = Fe - 0.5 * cdGap(gap) * A * v2 * v2;
      return new Float64Array([v1, d1 / m, v2, d2 / m]);
    }

    let y = new Float64Array([gap0 + 1.0, 1.0, 0.0, 1.0]);
    const ts = [], gapSeries = [], vL = [], vT = [];
    let t = 0.0;
    while (t < tMax) {
      ts.push(t);
      gapSeries.push(y[0] - y[2] - 1.0);
      vL.push(y[1]);
      vT.push(y[3]);
      const gap = y[0] - y[2] - 1.0;
      if (gap <= gaps[0]) break;
      y = rk4(deriv, y, t, dt);
      t += dt;
    }
    const tClose = ts.length > 1 ? ts[ts.length - 1] : Infinity;
    const ratio = tClose / gap0;
    const gapEnd = gapSeries[gapSeries.length - 1];
    return {
      t: ts,
      gap: gapSeries,
      vLeader: vL,
      vTrailing: vT,
      caught: gapEnd <= gaps[0] + 1e-9,
      timescale_ratio: ratio,
      t_end: tClose,
      gap_end: gapEnd,
      gap0,
    };
  }

  /** Live stepper: holds mutable race state for the browser lab. */
  function createLive(map, opts = {}) {
    const m = opts.m !== undefined ? opts.m : 50.0;
    const gap0 = opts.gap0 !== undefined ? opts.gap0 : 3.0;
    const dt = opts.dt !== undefined ? opts.dt : 0.01;
    const { gaps, cdTrail, cdIso } = map;
    const A = 1.0;
    const Fe = 0.5 * cdIso * A;

    function cdGap(g) {
      return lerp(g, gaps, cdTrail, cdTrail[0], cdIso);
    }

    function deriv(t, y) {
      const gap = y[0] - y[2] - 1.0;
      const d1 = Fe - 0.5 * cdIso * A * y[1] * y[1];
      const d2 = Fe - 0.5 * cdGap(gap) * A * y[3] * y[3];
      return new Float64Array([y[1], d1 / m, y[3], d2 / m]);
    }

    const state = {
      map,
      m,
      gap0,
      dt,
      t: 0,
      y: new Float64Array([gap0 + 1.0, 1.0, 0.0, 1.0]),
      running: false,
      caught: false,
      history: [], // {t, gap, vL, vT}
      lastStampGap: gap0,
    };

    function gap() {
      return state.y[0] - state.y[2] - 1.0;
    }

    function reset() {
      state.t = 0;
      state.y = new Float64Array([gap0 + 1.0, 1.0, 0.0, 1.0]);
      state.running = false;
      state.caught = false;
      state.history = [{ t: 0, gap: gap0, vL: 1, vT: 1 }];
      state.lastStampGap = gap0;
    }

    function start() {
      if (state.caught) reset();
      state.running = true;
    }

    function pause() {
      state.running = false;
    }

    /** Advance `n` RK4 steps (or until catch). Returns snapshot. */
    function step(n = 1) {
      if (!state.running || state.caught) return snapshot();
      for (let i = 0; i < n; i++) {
        const g = gap();
        if (g <= gaps[0]) {
          state.caught = true;
          state.running = false;
          break;
        }
        state.y = rk4(deriv, state.y, state.t, dt);
        state.t += dt;
        if (state.history.length === 0 || state.t - state.history[state.history.length - 1].t >= 0.05) {
          state.history.push({
            t: state.t,
            gap: gap(),
            vL: state.y[1],
            vT: state.y[3],
          });
          if (state.history.length > 2000) state.history.splice(0, state.history.length - 2000);
        }
      }
      const g = gap();
      if (g <= gaps[0]) {
        state.caught = true;
        state.running = false;
      }
      return snapshot();
    }

    function snapshot() {
      const g = gap();
      const ratio = state.t > 0 ? state.t / gap0 : null;
      return {
        t: state.t,
        gap: g,
        vLeader: state.y[1],
        vTrailing: state.y[3],
        cdTrail: cdGap(g),
        cdIso,
        running: state.running,
        caught: state.caught,
        timescale_ratio: ratio,
        gap0,
        gapMin: gaps[0],
        history: state.history,
        needsRestamp: Math.abs(g - state.lastStampGap) >= 0.05,
      };
    }

    function markStamped() {
      state.lastStampGap = gap();
    }

    reset();
    return { reset, start, pause, step, snapshot, markStamped, map };
  }

  return { loadMapFromDrafting, simulate, createLive, lerp };
})();

if (typeof window !== "undefined") window.RaceDynamics = RaceDynamics;
if (typeof module !== "undefined") module.exports = RaceDynamics;
