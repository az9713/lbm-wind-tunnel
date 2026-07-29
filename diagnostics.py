"""Force measurement (momentum exchange) and frequency analysis."""
import numpy as np


class MomentumExchange:
    """Momentum-exchange force on a solid body.

    Precomputes boundary links: fluid cell with a solid neighbor along c_q.
    body: optional sub-mask — links are counted only where the solid neighbor
    belongs to this body, so two bodies in one domain get separate forces.
    """

    def __init__(self, lat, solid, body=None, U=1.0, A=None, rho0=1.0):
        self.lat = lat
        self.U, self.rho0 = U, rho0
        target = solid if body is None else body
        dim = lat.c.shape[1]
        self.links = []   # (q, index-tuple of fluid boundary cells)
        for q, ci in enumerate(lat.c):
            if not ci.any():
                continue
            # neighbor_solid[x] = target[x + c_q]
            neighbor = np.roll(target, shift=tuple(-ci), axis=tuple(range(dim)))
            mask = (~solid) & neighbor
            if mask.any():
                self.links.append((q, np.nonzero(mask)))
        # frontal area: voxel-counted projection along flow (x) axis + half-link rim
        proj = target.any(axis=0)
        self.A = A if A is not None else int(proj.sum()) + (1 if dim == 2 else 0)

    def force(self, f):
        """Exact momentum exchange for half-way bounce-back: on the
        post-stream state, f[opp_q, x_f] is the reflected copy of the
        outgoing post-collision population, so each link transfers
        2 * c_q * f[opp_q, x_f] to the wall per step."""
        lat = self.lat
        dim = lat.c.shape[1]
        F = np.zeros(dim)
        for q, idx in self.links:
            F += lat.c[q] * 2.0 * f[(lat.opp[q],) + idx].sum()
        return F

    def coefficients(self, solver):
        """(Cd, Cl): drag along +x, lift along the UP axis — y in 2D, z in 3D
        (the last axis both times). Confirmed pre-mortem row: returning F[1]
        in 3D silently reports the side force as 'lift'."""
        F = self.force(solver.f)
        denom = 0.5 * self.rho0 * self.U ** 2 * self.A
        return F[0] / denom, F[-1] / denom


def strouhal(cl_history, D, U, dt=1):
    """Dominant shedding frequency from lift history -> St = f*D/U.
    Hann-windowed FFT; caller removes the transient."""
    cl = np.asarray(cl_history, dtype=float)
    cl = cl - cl.mean()
    w = np.hanning(len(cl))
    spec = np.abs(np.fft.rfft(cl * w))
    freqs = np.fft.rfftfreq(len(cl), d=dt)
    fpeak = freqs[1:][np.argmax(spec[1:])]   # skip DC
    return fpeak * D / U
