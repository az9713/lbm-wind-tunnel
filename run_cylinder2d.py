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


def run_re100(nx=400, ny=160, D=20, U=0.08, steps=30000, warmup=10000):
    """Vortex street: returns dict with Strouhal number and force stats.
    U=0.08 keeps tau clear of the 0.5 stability edge at Re=100."""
    from diagnostics import strouhal
    s, diag = make_sim(nx, ny, D, U, Re=100)
    cds, cls = [], []
    for i in range(steps):
        s.inlet_uy = 0.05 * U if i < 1000 else 0.0   # deterministic shedding seed
        s.step()
        if i >= warmup:
            cd, cl = diag.coefficients(s)
            cds.append(cd); cls.append(cl)
    return {
        "St": strouhal(cls, diag.D_eff, U),
        "Cd_mean": float(np.mean(cds)), "Cd_std": float(np.std(cds)),
        "Cl_amp": float(np.std(cls) * np.sqrt(2)),
        "D_eff": diag.D_eff, "blockage": diag.blockage,
    }


def render_re100_clip(path="out/cylinder_re100.mp4", nx=400, ny=160, D=20,
                      U=0.08, steps=30000, record_from=12000, every=30):
    """20 s vortex-street clip: 600 vorticity frames at 30 fps."""
    from viz import render_2d, vorticity
    s, diag = make_sim(nx, ny, D, U, Re=100)
    fields = []
    for i in range(steps):
        s.inlet_uy = 0.05 * U if i < 1000 else 0.0
        s.step()
        if i >= record_from and (i - record_from) % every == 0:
            fields.append(vorticity(s.velocity()))
    clim = 3 * np.std(fields[-1])
    return render_2d(fields, path, solid=s.solid, clim=(-clim, clim))


if __name__ == "__main__":
    import sys
    if "clip" in sys.argv:
        print(render_re100_clip())
    else:
        s, diag = make_sim(nx=400, ny=160, D=20, U=0.05, Re=20)
        for i in range(4000):
            s.step()
            if i % 500 == 0:
                cd, cl = diag.coefficients(s)
                print(f"step {i}: Cd={cd:.3f} Cl={cl:.4f}")
        print("blockage", diag.blockage, "D_eff", diag.D_eff)
