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


def test_render_2d_makes_mp4(tmp_path):
    from viz import render_2d
    rng = np.random.default_rng(2)
    fields = [rng.standard_normal((100, 50)) for _ in range(10)]
    out = render_2d(fields, tmp_path / "test.mp4")
    assert out.stat().st_size > 10_000


@pytest.mark.slow
def test_cylinder_re100_strouhal():
    from run_cylinder2d import run_re100
    r = run_re100()
    assert 0.14 < r["St"] < 0.20, r
