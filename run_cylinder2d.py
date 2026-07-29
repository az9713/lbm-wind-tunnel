"""2D cylinder validation runs (Re=20 steady drag, Re=100 vortex street)."""
import warnings
import numpy as np
from lbm import D2Q9, Solver
from diagnostics import MomentumExchange
import geometry


def make_sim(nx, ny, D, U, Re):
    """Cylinder in open flow. tau from the *effective* diameter (mask + half-link),
    used consistently in Re and Cd (honesty protocol)."""
    solid = geometry.cylinder((nx, ny), (nx // 4, ny // 2), D / 2)
    D_eff = int(solid.any(axis=0).sum()) + 1   # voxel extent + half-link
    nu = U * D_eff / Re
    tau = 3 * nu + 0.5
    if tau < 0.55:
        warnings.warn(f"tau={tau:.3f} < 0.55: near stability limit")
    u0 = np.zeros((2, nx, ny)); u0[0] = U
    u0[:, solid] = 0.0
    s = Solver(D2Q9, (nx, ny), tau, u_init=u0, solid=solid, inlet_u=U)
    diag = MomentumExchange(D2Q9, solid, U=U)
    diag.D_eff = D_eff
    diag.blockage = D_eff / ny
    return s, diag


if __name__ == "__main__":
    s, diag = make_sim(nx=400, ny=160, D=20, U=0.05, Re=20)
    for i in range(4000):
        s.step()
        if i % 500 == 0:
            cd, cl = diag.coefficients(s)
            print(f"step {i}: Cd={cd:.3f} Cl={cl:.4f}")
    print("blockage", diag.blockage, "D_eff", diag.D_eff)
