import numpy as np
from lbm import D2Q9, equilibrium


def test_equilibrium_moments_d2q9():
    lat = D2Q9
    rng = np.random.default_rng(0)
    rho = 1 + 0.05 * rng.standard_normal((8, 8))
    u = 0.05 * rng.standard_normal((2, 8, 8))
    feq = equilibrium(lat, rho, u)          # shape (9, 8, 8)
    assert np.allclose(feq.sum(0), rho, atol=1e-6)
    mom = np.einsum('qa,qxy->axy', lat.c.astype(float), feq)
    assert np.allclose(mom, rho * u, atol=1e-6)
