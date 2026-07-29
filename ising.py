"""2D Ising model: checkerboard Metropolis, temperature sweep, Tc estimate.

Validation: susceptibility peak within 3% of Onsager's exact
Tc = 2/ln(1+sqrt(2)) = 2.269 (J = kB = 1). Video: domain coarsening at Tc.
"""
import json
from pathlib import Path

import numpy as np

TC_EXACT = 2 / np.log(1 + np.sqrt(2))   # 2.26919


def _mask(n):
    x, y = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    return (x + y) % 2 == 0


def sweep(s, T, rng, checker):
    """One Metropolis sweep via two checkerboard half-updates (vectorized)."""
    for sub in (checker, ~checker):
        nb = (np.roll(s, 1, 0) + np.roll(s, -1, 0)
              + np.roll(s, 1, 1) + np.roll(s, -1, 1))
        dE = 2.0 * s * nb
        accept = (dE <= 0) | (rng.random(s.shape) < np.exp(-dE / T))
        s[sub & accept] *= -1
    return s


def run_temp(n, T, rng, equil=400, measure=600):
    s = rng.choice(np.array([-1, 1], dtype=np.int8), size=(n, n))
    checker = _mask(n)
    for _ in range(equil):
        sweep(s, T, rng, checker)
    ms = []
    for _ in range(measure):
        sweep(s, T, rng, checker)
        ms.append(abs(s.mean()))
    ms = np.array(ms)
    chi = n * n * (np.mean(ms ** 2) - np.mean(ms) ** 2) / T
    return float(np.mean(ms)), float(chi)


def temperature_sweep(n=128, temps=None, seed=0, out="out/ising.json"):
    temps = temps if temps is not None else np.arange(1.8, 2.82, 0.05)
    rng = np.random.default_rng(seed)
    mags, chis = [], []
    for T in temps:
        m, chi = run_temp(n, float(T), rng)
        mags.append(m); chis.append(chi)
        print(f"T={T:.2f} m={m:.3f} chi={chi:.1f}", flush=True)
    chis = np.array(chis); temps = np.asarray(temps, dtype=float)
    # parabolic refinement around the susceptibility peak
    i = int(np.argmax(chis))
    if 0 < i < len(temps) - 1:
        a, b, c = chis[i - 1], chis[i], chis[i + 1]
        denom = a - 2 * b + c
        tc = temps[i] + 0.5 * (a - c) / denom * (temps[1] - temps[0]) if denom else temps[i]
    else:
        tc = temps[i]
    res = {"n": n, "temps": temps.tolist(), "m": mags, "chi": chis.tolist(),
           "Tc_measured": float(tc), "Tc_exact": float(TC_EXACT),
           "rel_err": float(abs(tc - TC_EXACT) / TC_EXACT)}
    Path("out").mkdir(exist_ok=True)
    json.dump(res, open(out, "w"), indent=1)
    print(f"Tc measured {tc:.4f} vs exact {TC_EXACT:.4f} "
          f"({res['rel_err']*100:.2f}%)", flush=True)
    return res


def coarsening_video(n=256, T=None, frames=300, every=4,
                     path="out/ising_coarsening.mp4"):
    from viz import render_2d
    T = T or TC_EXACT
    rng = np.random.default_rng(1)
    s = rng.choice(np.array([-1, 1], dtype=np.int8), size=(n, n))
    checker = _mask(n)
    flds = []
    for i in range(frames * every):
        sweep(s, T, rng, checker)
        if i % every == 0:
            flds.append(s.astype(float))
    return render_2d(flds, path, clim=(-1, 1), cmap="gray")


if __name__ == "__main__":
    temperature_sweep()
    print(coarsening_video())
