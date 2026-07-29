/* D2Q9 BGK lattice-Boltzmann engine — CPU (typed arrays).
 *
 * Same algorithm and equations as lbm.py: BGK collision, pull streaming,
 * half-way bounce-back (with moving-wall correction), equilibrium inlet +
 * zero-gradient outlet, exact Ladd momentum exchange per body.
 * Grid indexing: i = y*nx + x (canvas order). Physics validated by the
 * in-page self-checks against the same golden cases as the Python engine.
 */
"use strict";

const LBM = (() => {
  // D2Q9: order matches lbm.py
  const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
  const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
  const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
  const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];

  class CpuEngine {
    constructor(nx, ny, opts = {}) {
      this.nx = nx; this.ny = ny; this.n = nx * ny;
      this.tau = opts.tau ?? 0.6;
      this.u0 = opts.u0 ?? 0;          // inlet speed (0 => periodic, no BCs)
      this.uPerturb = 0;               // transverse inlet seed
      this.gx = opts.gx ?? 0; this.gy = opts.gy ?? 0;
      this.open = !!opts.open;         // inlet/outlet at x=0 / x=nx-1
      this.f = []; this.f2 = [];
      for (let q = 0; q < 9; q++) {
        this.f.push(new Float32Array(this.n));
        this.f2.push(new Float32Array(this.n));
      }
      this.obst = new Uint8Array(this.n);   // 0 fluid, else body id
      this.wallUx = new Float32Array(8);    // per body id (1..7) wall velocity
      this.wallUy = new Float32Array(8);
      this.rho = new Float32Array(this.n);
      this.ux = new Float32Array(this.n);
      this.uy = new Float32Array(this.n);
      this.forces = [];                     // per body {fx, fy} accumulated
      for (let b = 0; b < 8; b++) this.forces.push({ fx: 0, fy: 0 });
      this.steps = 0;
      this.initEquilibrium(1, 0, 0);
    }

    initEquilibrium(rho0, ux0, uy0) {
      const uxA = typeof ux0 === "function";
      for (let i = 0; i < this.n; i++) {
        const x = i % this.nx, y = (i / this.nx) | 0;
        const ux = uxA ? ux0(x, y) : ux0;
        const uy = typeof uy0 === "function" ? uy0(x, y) : uy0;
        const r = typeof rho0 === "function" ? rho0(x, y) : rho0;
        this.setEq(i, r, this.obst[i] ? 0 : ux, this.obst[i] ? 0 : uy);
      }
      this.steps = 0;
    }

    setEq(i, r, ux, uy) {
      const us = ux * ux + uy * uy;
      for (let q = 0; q < 9; q++) {
        const cu = CX[q] * ux + CY[q] * uy;
        this.f[q][i] = W[q] * r * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * us);
      }
    }

    setObstacle(fn) {           // fn(x, y) -> body id (0 = fluid)
      for (let i = 0; i < this.n; i++) {
        const v = fn(i % this.nx, (i / this.nx) | 0) | 0;
        if (this.obst[i] && !v && this.steps > 0) {
          // uncovered cell: equilibrium refill (documented pressure pop)
          this.setEq(i, 1, this.u0, 0);
        }
        this.obst[i] = v;
      }
    }

    setWallVelocity(body, ux, uy) { this.wallUx[body] = ux; this.wallUy[body] = uy; }

    step(nSteps = 1) {
      const { nx, ny, n, f, f2, obst, tau } = this;
      const omega = 1 / tau;
      const fx = new Float64Array(8), fy = new Float64Array(8);
      for (let s = 0; s < nSteps; s++) {
        // collide (in place): also caches moments
        for (let i = 0; i < n; i++) {
          if (obst[i]) continue;
          let r = 0, mx = 0, my = 0;
          for (let q = 0; q < 9; q++) {
            const v = f[q][i]; r += v; mx += CX[q] * v; my += CY[q] * v;
          }
          let ux = mx / r, uy = my / r;
          if (this.gx || this.gy) { ux += tau * this.gx / r; uy += tau * this.gy / r; }
          this.rho[i] = r; this.ux[i] = ux; this.uy[i] = uy;
          const us = ux * ux + uy * uy;
          for (let q = 0; q < 9; q++) {
            const cu = CX[q] * ux + CY[q] * uy;
            const feq = W[q] * r * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * us);
            f[q][i] += omega * (feq - f[q][i]);
          }
        }
        // stream (pull) + half-way bounce-back + momentum exchange
        for (let b = 0; b < 8; b++) { fx[b] = 0; fy[b] = 0; }
        for (let q = 0; q < 9; q++) {
          const cx = CX[q], cy = CY[q], oq = OPP[q];
          const dst = f2[q], src = f[q], srcO = f[oq];
          for (let y = 0; y < ny; y++) {
            let ys = y - cy; if (ys < 0) ys += ny; else if (ys >= ny) ys -= ny;
            const row = y * nx, rowS = ys * nx;
            for (let x = 0; x < nx; x++) {
              const i = row + x;
              if (obst[i]) { dst[i] = src[i]; continue; }
              let xs = x - cx; if (xs < 0) xs += nx; else if (xs >= nx) xs -= nx;
              const j = rowS + xs, ob = obst[j];
              if (ob) {
                // population leaving cell i along oq reflects back into q
                const out = srcO[i];
                const corr = 6 * W[oq]
                  * (CX[oq] * this.wallUx[ob] + CY[oq] * this.wallUy[ob]);
                dst[i] = out - corr;
                fx[ob] += 2 * CX[oq] * out - corr * CX[oq];
                fy[ob] += 2 * CY[oq] * out - corr * CY[oq];
              } else {
                dst[i] = src[j];
              }
            }
          }
        }
        for (let q = 0; q < 9; q++) {
          const t = this.f[q]; this.f[q] = this.f2[q]; this.f2[q] = t;
        }
        if (this.open) this.applyOpenBCs();
        for (let b = 0; b < 8; b++) {
          this.forces[b].fx = fx[b]; this.forces[b].fy = fy[b];
        }
        this.steps++;
      }
    }

    applyOpenBCs() {
      const { nx, ny, f } = this;
      const u = this.u0, v = this.uPerturb, us = u * u + v * v;
      for (let y = 0; y < ny; y++) {
        const iIn = y * nx, iOut = y * nx + nx - 1, iPre = iOut - 1;
        for (let q = 0; q < 9; q++) {
          const cu = CX[q] * u + CY[q] * v;
          f[q][iIn] = W[q] * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * us);
          f[q][iOut] = f[q][iPre];
        }
      }
    }

    // moments were cached during collide; recompute fresh for t=0 reads
    computeMoments() {
      const { n, f, obst } = this;
      for (let i = 0; i < n; i++) {
        let r = 0, mx = 0, my = 0;
        for (let q = 0; q < 9; q++) {
          const v = f[q][i]; r += v; mx += CX[q] * v; my += CY[q] * v;
        }
        this.rho[i] = r;
        this.ux[i] = obst[i] ? 0 : mx / r;
        this.uy[i] = obst[i] ? 0 : my / r;
      }
      return { rho: this.rho, ux: this.ux, uy: this.uy };
    }

    mass() {
      let m = 0;
      for (let q = 0; q < 9; q++) {
        const a = this.f[q];
        for (let i = 0; i < this.n; i++) m += a[i];
      }
      return m;
    }

    bodyForce(b) { return this.forces[b]; }
  }

  return { CpuEngine, CX, CY, W, OPP };
})();
if (typeof window !== "undefined") window.LBM = LBM;
if (typeof module !== "undefined") module.exports = LBM;
