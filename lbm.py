"""Dimension-agnostic BGK Lattice Boltzmann solver (D2Q9 / D3Q19)."""
import numpy as np
from dataclasses import dataclass

try:                       # optional numba acceleration (same physics,
    import lbm_fast        # same tests); numpy path remains the fallback
    _FAST = True
except Exception:
    _FAST = False


@dataclass(frozen=True)
class Lattice:
    c: np.ndarray      # (Q, dim) int velocities
    w: np.ndarray      # (Q,) weights
    opp: np.ndarray    # (Q,) index of opposite velocity


def _make(c, w):
    c, w = np.array(c), np.array(w)
    opp = np.array([int(np.where((c == -ci).all(1))[0][0]) for ci in c])
    return Lattice(c, w, opp)


D2Q9 = _make(
    [(0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (-1, -1), (1, -1)],
    [4/9] + [1/9]*4 + [1/36]*4)

D3Q19 = _make(
    [(0, 0, 0),
     (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
     (1, 1, 0), (-1, -1, 0), (1, -1, 0), (-1, 1, 0),
     (1, 0, 1), (-1, 0, -1), (1, 0, -1), (-1, 0, 1),
     (0, 1, 1), (0, -1, -1), (0, 1, -1), (0, -1, 1)],
    [1/3] + [1/18]*6 + [1/36]*12)


def equilibrium(lat, rho, u):
    # u shape: (dim, *grid); returns (Q, *grid)
    cu = np.einsum('qa,a...->q...', lat.c.astype(u.dtype), u)
    usq = (u * u).sum(0)
    return lat.w.reshape(-1, *([1]*u[0].ndim)) * rho * (1 + 3*cu + 4.5*cu**2 - 1.5*usq)


def stream(lat, f):
    out = np.empty_like(f)
    for q, ci in enumerate(lat.c):
        out[q] = _roll(f[q], ci)
    return out


def _roll(a, ci):
    # roll only the axes that actually shift (np.roll copies even for 0)
    ax = [i for i, s in enumerate(ci) if s]
    if not ax:
        return a.copy()
    return np.roll(a, shift=tuple(int(ci[i]) for i in ax), axis=tuple(ax))


class Solver:
    """BGK collide-and-stream with optional solid mask (full bounce-back),
    body force (velocity-shift forcing), and inlet/outlet open BCs."""

    def __init__(self, lat, shape, tau, u_init=None, solid=None, force=None,
                 inlet_u=None, wall_u=None, dtype=np.float64):
        self.lat, self.tau = lat, tau
        self.shape = shape
        self.solid = solid
        self.force = None if force is None else np.array(force, dtype=dtype)
        self.inlet_u = None if inlet_u is None else float(inlet_u)
        self.inlet_uy = 0.0   # transverse inlet component (shedding seed)
        rho = np.ones(shape, dtype=dtype)
        if u_init is None:
            u = np.zeros((lat.c.shape[1],) + tuple(shape), dtype=dtype)
        else:
            u = np.asarray(u_init, dtype=dtype)
        self.f = equilibrium(lat, rho, u).astype(dtype)
        # boundary links for half-way bounce-back: (q, opp_q, fluid cells with
        # a solid neighbor along c_q, moving-wall correction or 0)
        # wall_u: optional (dim, *shape) velocity of each solid cell — a moving
        # road under the cars; correction -6 w_q rho (c_q . u_wall).
        self.links = []
        if solid is not None:
            dim = lat.c.shape[1]
            for q, ci in enumerate(lat.c):
                if not ci.any():
                    continue
                neighbor = np.roll(solid, shift=tuple(-ci), axis=tuple(range(dim)))
                mask = (~solid) & neighbor
                if mask.any():
                    idx = np.nonzero(mask)
                    corr = 0.0
                    if wall_u is not None:
                        nb = tuple((idx[a] + ci[a]) % shape[a] for a in range(dim))
                        cu = sum(ci[a] * wall_u[(a,) + nb] for a in range(dim))
                        corr = (6.0 * lat.w[q] * cu).astype(dtype)
                    self.links.append((q, int(lat.opp[q]), idx, corr))

    def rho(self):
        return self.f.sum(0)

    def velocity(self):
        rho = self.rho()
        u = np.einsum('qa,q...->a...', self.lat.c.astype(self.f.dtype), self.f) / rho
        if self.solid is not None:
            u[:, self.solid] = 0.0
        return u

    def step(self):
        # hot loop: per-q fused equilibrium+collide with explicit moment sums —
        # the vectorized einsum/broadcast version allocated ~10 grid-sized
        # temporaries per step and was 4-5x slower on 3D grids
        lat, f = self.lat, self.f
        tau = self.tau
        c = lat.c
        w = lat.w
        dim = c.shape[1]
        if _FAST:
            if not hasattr(self, "_fpost"):
                self._fpost = np.empty_like(f)
                self._fnew = np.empty_like(f)
                self._cq = [np.ascontiguousarray(c[:, a]) for a in range(dim)]
                self._wq = w.astype(f.dtype)
            fpost, fnew = self._fpost, self._fnew
            g = self.force if self.force is not None else np.zeros(dim)
            if dim == 2:
                lbm_fast.collide_2d(f, fpost, self._cq[0], self._cq[1],
                                    self._wq, 1.0 / tau, g[0], g[1], tau)
                lbm_fast.stream_2d(fpost, fnew, self._cq[0], self._cq[1])
            else:
                lbm_fast.collide_3d(f, fpost, self._cq[0], self._cq[1],
                                    self._cq[2], self._wq, 1.0 / tau,
                                    g[0], g[1], g[2], tau)
                lbm_fast.stream_3d(fpost, fnew, self._cq[0], self._cq[1],
                                   self._cq[2])
            for q, oq, idx, corr in self.links:
                fnew[(oq,) + idx] = fpost[(q,) + idx] - corr
            if self.inlet_u is not None:
                self._open_bcs(fnew)
            # rotate buffers: old f becomes next fpost scratch
            self._fpost, self._fnew, self.f = self.f, fpost, fnew
            return
        rho = f.sum(0)
        inv_rho = 1.0 / rho
        us = None
        u = []
        for a in range(dim):
            ua = None
            for q in range(c.shape[0]):
                s = c[q, a]
                if s == 1:
                    ua = f[q].copy() if ua is None else np.add(ua, f[q], out=ua)
                elif s == -1:
                    ua = -f[q] if ua is None else np.subtract(ua, f[q], out=ua)
            ua *= inv_rho
            if self.force is not None:
                ua += tau * self.force[a] * inv_rho
            u.append(ua)
            us = ua * ua if us is None else np.add(us, ua * ua, out=us)
        self._u = u          # cached for velocity()
        omega = 1.0 / tau
        one_minus = 1.0 - omega
        base = 1.0 - 1.5 * us
        if not hasattr(self, "_fpost"):
            self._fpost = np.empty_like(f)
        fpost = self._fpost
        rw = rho * omega        # fold omega into the equilibrium prefactor
        for q in range(c.shape[0]):
            cu = None
            for a in range(dim):
                s = c[q, a]
                if s == 1:
                    cu = u[a].copy() if cu is None else np.add(cu, u[a], out=cu)
                elif s == -1:
                    cu = -u[a] if cu is None else np.subtract(cu, u[a], out=cu)
            if cu is None:
                feq_q = base.copy()
            else:
                feq_q = cu * cu
                feq_q *= 4.5
                feq_q += base
                cu *= 3.0
                feq_q += cu
            feq_q *= rw
            feq_q *= w[q]
            np.multiply(f[q], one_minus, out=fpost[q])
            fpost[q] += feq_q
        fnew = stream(lat, fpost)
        # half-way bounce-back: wall sits half a link beyond the last fluid
        # cell; populations reflect at the fluid boundary cell, so solid-cell
        # contents never matter and the exact momentum-exchange force is
        # F = 2 * sum_links c_q * f[opp_q] on the post-stream state.
        for q, oq, idx, corr in self.links:
            fnew[(oq,) + idx] = fpost[(q,) + idx] - corr
        if self.inlet_u is not None:
            self._open_bcs(fnew)
        self.f = fnew

    def _open_bcs(self, f):
        dim = self.lat.c.shape[1]
        uin = np.zeros((dim, 1) + self.shape[1:], dtype=f.dtype)
        uin[0] = self.inlet_u
        uin[1] = self.inlet_uy
        f[:, 0] = equilibrium(self.lat, np.ones((1,) + self.shape[1:], dtype=f.dtype), uin)[:, 0]
        f[:, -1] = f[:, -2]   # zero-gradient outlet
