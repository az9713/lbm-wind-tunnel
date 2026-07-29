"""Dimension-agnostic BGK Lattice Boltzmann solver (D2Q9 / D3Q19)."""
import numpy as np
from dataclasses import dataclass


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


def equilibrium(lat, rho, u):
    # u shape: (dim, *grid); returns (Q, *grid)
    cu = np.einsum('qa,a...->q...', lat.c.astype(u.dtype), u)
    usq = (u * u).sum(0)
    return lat.w.reshape(-1, *([1]*u[0].ndim)) * rho * (1 + 3*cu + 4.5*cu**2 - 1.5*usq)


def stream(lat, f):
    out = np.empty_like(f)
    for q, ci in enumerate(lat.c):
        out[q] = np.roll(f[q], shift=tuple(ci), axis=tuple(range(ci.size)))
    return out
