import numpy as np
from lbm import D2Q9, equilibrium, stream


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
