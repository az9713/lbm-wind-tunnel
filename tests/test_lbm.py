import numpy as np
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
