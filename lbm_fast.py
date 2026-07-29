"""Numba-fused collide+stream kernels for the LBM solver.

Optional accelerator: lbm.Solver uses these when numba imports cleanly and
falls back to the pure-numpy path otherwise. Physics is identical — the whole
pytest suite passes through both paths (the kernels are exercised by the same
tests once numba is installed).

Fusion: one pass computes moments + BGK collision per cell (no grid-sized
temporaries), a second pass pull-streams with periodic wrap. Bounce-back and
open BCs stay in lbm.Solver (cheap, and shared with the numpy path).
"""
import numpy as np
from numba import njit, prange


@njit(parallel=True, fastmath=True, cache=True)
def collide_2d(f, fpost, cx, cy, w, omega, gx, gy, tau):
    Q, nx, ny = f.shape
    for x in prange(nx):
        for y in range(ny):
            rho = 0.0
            mx = 0.0
            my = 0.0
            for q in range(Q):
                v = f[q, x, y]
                rho += v
                mx += cx[q] * v
                my += cy[q] * v
            ux = mx / rho + tau * gx / rho
            uy = my / rho + tau * gy / rho
            us = ux * ux + uy * uy
            for q in range(Q):
                cu = cx[q] * ux + cy[q] * uy
                feq = w[q] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * us)
                fpost[q, x, y] = f[q, x, y] + omega * (feq - f[q, x, y])


@njit(parallel=True, fastmath=True, cache=True)
def collide_3d(f, fpost, cx, cy, cz, w, omega, gx, gy, gz, tau):
    Q, nx, ny, nz = f.shape
    for x in prange(nx):
        for y in range(ny):
            for z in range(nz):
                rho = 0.0
                mx = 0.0
                my = 0.0
                mz = 0.0
                for q in range(Q):
                    v = f[q, x, y, z]
                    rho += v
                    mx += cx[q] * v
                    my += cy[q] * v
                    mz += cz[q] * v
                ux = mx / rho + tau * gx / rho
                uy = my / rho + tau * gy / rho
                uz = mz / rho + tau * gz / rho
                us = ux * ux + uy * uy + uz * uz
                for q in range(Q):
                    cu = cx[q] * ux + cy[q] * uy + cz[q] * uz
                    feq = w[q] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * us)
                    fpost[q, x, y, z] = f[q, x, y, z] + omega * (feq - f[q, x, y, z])


@njit(parallel=True, fastmath=True, cache=True)
def stream_2d(fpost, fnew, cx, cy):
    Q, nx, ny = fpost.shape
    for x in prange(nx):
        for y in range(ny):
            for q in range(Q):
                xs = x - cx[q]
                if xs < 0:
                    xs += nx
                elif xs >= nx:
                    xs -= nx
                ys = y - cy[q]
                if ys < 0:
                    ys += ny
                elif ys >= ny:
                    ys -= ny
                fnew[q, x, y] = fpost[q, xs, ys]


@njit(parallel=True, fastmath=True, cache=True)
def stream_3d(fpost, fnew, cx, cy, cz):
    Q, nx, ny, nz = fpost.shape
    for x in prange(nx):
        for y in range(ny):
            for z in range(nz):
                for q in range(Q):
                    xs = x - cx[q]
                    if xs < 0:
                        xs += nx
                    elif xs >= nx:
                        xs -= nx
                    ys = y - cy[q]
                    if ys < 0:
                        ys += ny
                    elif ys >= ny:
                        ys -= ny
                    zs = z - cz[q]
                    if zs < 0:
                        zs += nz
                    elif zs >= nz:
                        zs -= nz
                    fnew[q, x, y, z] = fpost[q, xs, ys, zs]
