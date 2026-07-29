import numpy as np
import pytest
from lbm import D2Q9, Solver, equilibrium, stream


def test_equilibrium_moments_d2q9():
    lat = D2Q9
    rng = np.random.default_rng(0)
    rho = 1 + 0.05 * rng.standard_normal((8, 8))
    u = 0.05 * rng.standard_normal((2, 8, 8))
    feq = equilibrium(lat, rho, u)          # shape (9, 8, 8)
    assert np.allclose(feq.sum(0), rho, atol=1e-6)
    mom = np.einsum('qa,qxy->axy', lat.c.astype(float), feq)
    assert np.allclose(mom, rho * u, atol=1e-6)


def test_streaming_conserves_mass_and_shifts():
    f = np.zeros((9, 16, 16)); f[1, 8, 8] = 1.0   # east-moving population
    f2 = stream(D2Q9, f)
    assert f2.sum() == f.sum()
    assert f2[1, 9, 8] == 1.0                      # moved +x by 1


def test_taylor_green_decay():
    n, tau, u0 = 64, 0.8, 0.03
    nu = (tau - 0.5) / 3
    k = 2*np.pi/n
    x, y = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
    u = np.stack([u0*np.cos(k*x)*np.sin(k*y), -u0*np.sin(k*x)*np.cos(k*y)])
    s = Solver(D2Q9, (n, n), tau, u_init=u)
    e = []
    for t in range(800):
        s.step(); e.append((s.velocity()**2).sum())
    rate = -np.polyfit(np.arange(800), np.log(e), 1)[0] / 2   # energy decays 2x faster
    assert abs(rate - 2*nu*k**2) / (2*nu*k**2) < 0.02


def test_poiseuille_profile():
    nx, ny, tau, g = 8, 33, 0.9, 1e-6      # g = body force in +x
    solid = np.zeros((nx, ny), bool); solid[:, 0] = solid[:, -1] = True
    s = Solver(D2Q9, (nx, ny), tau, solid=solid, force=(g, 0.0))
    for _ in range(8000): s.step()
    ux = s.velocity()[0, 0, 1:-1]
    yc = np.arange(1, ny-1) - (ny-1)/2
    h = (ny - 2) / 2
    ana = 1 - (yc/h)**2
    assert np.allclose(ux/ux.max(), ana/ana.max(), atol=0.02)


def test_momentum_exchange_balances_body_force():
    # honesty protocol: diagnostics get their own tests. In steady Poiseuille
    # the wall drag must equal the injected body force exactly.
    from diagnostics import MomentumExchange
    nx, ny, tau, g = 8, 33, 0.9, 1e-6
    solid = np.zeros((nx, ny), bool); solid[:, 0] = solid[:, -1] = True
    s = Solver(D2Q9, (nx, ny), tau, solid=solid, force=(g, 0.0))
    for _ in range(8000): s.step()
    F = MomentumExchange(D2Q9, solid).force(s.f)
    assert abs(F[0] - g * (~solid).sum()) < 1e-4 * g * (~solid).sum()


def test_strouhal_on_synthetic_signal():
    # FFT pipeline test: noisy sine with transient must recover f0 (protocol).
    from diagnostics import strouhal
    rng = np.random.default_rng(1)
    t = np.arange(6000); f0 = 0.013
    sig = np.sin(2*np.pi*f0*t) + 0.2*rng.standard_normal(t.size)
    sig[:1000] += np.linspace(3, 0, 1000)          # transient
    st = strouhal(sig[1500:], D=20, U=0.05)        # St = f0*D/U = 5.2
    assert abs(st - f0*20/0.05) / (f0*20/0.05) < 0.03


def test_cylinder_re20_steady_drag():
    from run_cylinder2d import make_sim
    s, diag = make_sim(nx=400, ny=160, D=20, U=0.05, Re=20)
    cds = [diag.coefficients(s)[0] for _ in range(4000) if s.step() or True][-500:]
    cd = np.mean(cds)
    assert np.std(cds) < 0.01 * cd
    assert 1.5 < cd < 3.0


def test_equilibrium_moments_d3q19():
    from lbm import D3Q19
    rng = np.random.default_rng(3)
    rho = 1 + 0.05 * rng.standard_normal((6, 6, 6))
    u = 0.05 * rng.standard_normal((3, 6, 6, 6))
    feq = equilibrium(D3Q19, rho, u)
    assert np.allclose(feq.sum(0), rho, atol=1e-6)
    mom = np.einsum('qa,qxyz->axyz', D3Q19.c.astype(float), feq)
    assert np.allclose(mom, rho * u, atol=1e-6)


def test_poiseuille_3d_profile():
    # same physics as the 2D channel, on a 3D grid: proves dimension-agnosticism
    from lbm import D3Q19
    nx, ny, nz, tau, g = 16, 33, 8, 0.9, 1e-6
    solid = np.zeros((nx, ny, nz), bool); solid[:, 0, :] = solid[:, -1, :] = True
    s = Solver(D3Q19, (nx, ny, nz), tau, solid=solid, force=(g, 0.0, 0.0))
    for _ in range(8000): s.step()
    ux = s.velocity()[0, 0, 1:-1, 0]
    yc = np.arange(1, ny-1) - (ny-1)/2
    h = (ny - 2) / 2
    ana = 1 - (yc/h)**2
    assert np.allclose(ux/ux.max(), ana/ana.max(), atol=0.02)


def test_from_mesh_voxelization():
    # deterministic primitive: icosphere is watertight with known volume
    import trimesh
    from geometry import from_mesh
    m = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
    mask, info = from_mesh(m, (64, 40, 40), L=24)
    assert info["watertight"]
    assert abs(info["voxel_volume"] - info["mesh_volume"]) / info["mesh_volume"] < 0.10
    assert info["frontal_area"] > 0
    # single connected component: flood from one voxel reaches all of them
    from geometry import keep_largest_component
    assert keep_largest_component(mask).sum() == mask.sum()


def test_ahmed_body_mask():
    from geometry import ahmed_body
    mask3 = ahmed_body((120, 60, 50), L=60)
    assert mask3.any() and not mask3[:, :, 0].any()   # clearance above ground
    prof = mask3[:, 30, :]                            # centerline side profile
    heights = [prof[x].nonzero()[0].max() for x in range(120) if prof[x].any()]
    assert heights[-1] < max(heights)                 # rear slant drops the roofline


def test_render_2d_makes_mp4(tmp_path):
    from viz import render_2d
    rng = np.random.default_rng(2)
    fields = [rng.standard_normal((100, 50)) for _ in range(10)]
    out = render_2d(fields, tmp_path / "test.mp4")
    assert out.stat().st_size > 10_000


def test_couette_moving_wall():
    # top wall slides at U -> linear profile (validates moving-wall bounce-back)
    nx, ny, tau, U = 8, 33, 0.8, 0.05
    solid = np.zeros((nx, ny), bool); solid[:, 0] = solid[:, -1] = True
    wu = np.zeros((2, nx, ny)); wu[0, :, -1] = U
    s = Solver(D2Q9, (nx, ny), tau, solid=solid, wall_u=wu)
    for _ in range(6000): s.step()
    ux = s.velocity()[0, 0, 1:-1]
    y = np.arange(1, ny - 1)
    ana = U * (y - 0.5) / (ny - 2)        # walls at y=0.5 and y=ny-1.5
    assert np.allclose(ux, ana, atol=0.02 * U)


def test_two_body_link_partition():
    # per-body momentum-exchange links must partition the total exactly
    from diagnostics import MomentumExchange
    a = np.zeros((40, 20), bool); a[10:14, 8:12] = True
    b = np.zeros((40, 20), bool); b[17:21, 8:12] = True    # 3-cell gap
    solid = a | b
    n_all = sum(len(i[0]) for _, i in MomentumExchange(D2Q9, solid).links)
    n_a = sum(len(i[0]) for _, i in MomentumExchange(D2Q9, solid, body=a).links)
    n_b = sum(len(i[0]) for _, i in MomentumExchange(D2Q9, solid, body=b).links)
    assert n_a + n_b == n_all
    assert n_a == n_b > 0


def test_drafting_dynamics_synthetic_map():
    # with any drag-reduction-at-close-gap map, the gap must close on its own
    from dynamics import simulate
    gaps = np.array([0.25, 0.5, 1.0, 1.5, 2.0, 3.0])
    cd_trail = np.array([1.0, 1.2, 1.5, 1.7, 1.85, 1.95])   # rises toward iso
    r = simulate(gaps, cd_trail, cd_iso=2.0)
    assert r["caught"]
    d = np.diff(r["gap"])
    assert (d <= 1e-9).all()                 # gap monotonically decreasing
    assert r["timescale_ratio"] > 10         # quasi-static assumption holds


@pytest.mark.slow
def test_cylinder_re100_strouhal():
    from run_cylinder2d import run_re100
    r = run_re100()
    assert 0.14 < r["St"] < 0.20, r


@pytest.mark.slow
def test_ising_critical_temperature():
    # Onsager exact: Tc = 2/ln(1+sqrt(2)) = 2.269; susceptibility peak +-3%
    from ising import temperature_sweep, TC_EXACT
    res = temperature_sweep(n=96, temps=np.arange(2.0, 2.62, 0.05), seed=3)
    assert res["rel_err"] < 0.03, (res["Tc_measured"], TC_EXACT)


@pytest.mark.slow
def test_nbody_energy_conservation():
    # leapfrog + softening: energy drift must stay under 2%
    from nbody import run
    drift = run(n_per=1500, steps=400, save_every=1000,
                out_prefix="out/nbody_test")
    assert drift < 0.02, drift


@pytest.mark.slow
def test_sphere_re100_drag():
    # Schiller-Naumann: Cd = 24/Re*(1+0.15*Re^0.687) = 1.09 at Re=100.
    # +-25% band: voxelization + 20%-per-side blockage both push Cd up.
    from lbm import D3Q19
    from diagnostics import MomentumExchange
    import geometry
    nx, ny, nz, D, U, Re = 160, 80, 80, 16, 0.08, 100
    solid = geometry.sphere((nx, ny, nz), (nx // 4, ny // 2, nz // 2), D / 2)
    D_eff = int(solid[:, ny // 2, :].any(axis=0).sum()) + 1
    tau = 3 * U * D_eff / Re + 0.5
    u0 = np.zeros((3, nx, ny, nz), np.float32); u0[0] = U
    u0[:, solid] = 0.0
    s = Solver(D3Q19, (nx, ny, nz), tau, u_init=u0, solid=solid,
               inlet_u=U, dtype=np.float32)
    # frontal area: voxel-projected disk (honest denominator per protocol)
    diag = MomentumExchange(D3Q19, solid, U=U)
    cds = []
    for i in range(8000):
        s.step()
        if i >= 7500:
            cds.append(diag.coefficients(s)[0])
    cd = float(np.mean(cds))
    assert 0.8 < cd < 1.4, (cd, diag.A, D_eff)
