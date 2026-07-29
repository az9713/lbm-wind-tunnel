"""N-body galaxy collision: softened self-gravity, leapfrog KDK, energy audit.

ponytail: direct O(N^2) summation under numba instead of the planned
Barnes-Hut octree — at N=20k with 12 threads a step is well under a second,
the force is exactly the softened pairwise law (no tree approximation error),
and the energy-drift validation is the same. BH pays off at N >> 10^5.

Validation: total energy drift < 2% over the run (softened, G=1).
Video: two-disk collision, projected density.
"""
import json
from pathlib import Path

import numpy as np
from numba import njit, prange


@njit(parallel=True, fastmath=True, cache=True)
def accelerations(pos, mass, eps2, acc):
    n = pos.shape[0]
    for i in prange(n):
        ax = ay = az = 0.0
        xi, yi, zi = pos[i, 0], pos[i, 1], pos[i, 2]
        for j in range(n):
            dx = pos[j, 0] - xi
            dy = pos[j, 1] - yi
            dz = pos[j, 2] - zi
            r2 = dx * dx + dy * dy + dz * dz + eps2
            inv = mass[j] / (r2 * np.sqrt(r2))
            ax += dx * inv
            ay += dy * inv
            az += dz * inv
        acc[i, 0] = ax
        acc[i, 1] = ay
        acc[i, 2] = az


@njit(parallel=True, fastmath=True, cache=True)
def potential_energy(pos, mass, eps2):
    n = pos.shape[0]
    pe = 0.0
    for i in prange(n):
        s = 0.0
        for j in range(i + 1, n):
            dx = pos[j, 0] - pos[i, 0]
            dy = pos[j, 1] - pos[i, 1]
            dz = pos[j, 2] - pos[i, 2]
            s += mass[j] / np.sqrt(dx * dx + dy * dy + dz * dz + eps2)
        pe -= mass[i] * s
    return pe


def make_disk(n, m_total, m_central, rng, r_max=6.0, tilt=0.0):
    """Central mass + cold disk on circular orbits (G = 1)."""
    r = r_max * np.sqrt(rng.random(n)) + 0.3
    th = 2 * np.pi * rng.random(n)
    pos = np.stack([r * np.cos(th), r * np.sin(th),
                    0.05 * rng.standard_normal(n)], 1)
    # enclosed mass approx: central + disk fraction inside r
    m_disk = m_total - m_central
    m_enc = m_central + m_disk * (r / r_max) ** 2
    v = np.sqrt(m_enc / r)
    vel = np.stack([-v * np.sin(th), v * np.cos(th), np.zeros(n)], 1)
    if tilt:
        ct, st = np.cos(tilt), np.sin(tilt)
        R = np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]])
        pos = pos @ R.T
        vel = vel @ R.T
    pos = np.vstack([[0, 0, 0], pos])
    vel = np.vstack([[0, 0, 0], vel])
    mass = np.full(n + 1, m_disk / n)
    mass[0] = m_central
    return pos, vel, mass


def run(n_per=10000, steps=1500, dt=0.02, eps=0.05, save_every=5,
        energy_every=100, out_prefix="out/nbody", seed=0):
    rng = np.random.default_rng(seed)
    p1, v1, m1 = make_disk(n_per, 1.0, 0.3, rng)
    p2, v2, m2 = make_disk(n_per, 0.8, 0.25, rng, tilt=0.6)
    p2 += np.array([14.0, 6.0, 0.0])
    v2 += np.array([-0.32, -0.08, 0.0])       # infalling approach
    p1 -= np.array([2.0, 0.0, 0.0])
    pos = np.ascontiguousarray(np.vstack([p1, p2]))
    vel = np.ascontiguousarray(np.vstack([v1, v2]))
    mass = np.ascontiguousarray(np.concatenate([m1, m2]))
    eps2 = eps * eps
    acc = np.zeros_like(pos)
    accelerations(pos, mass, eps2, acc)
    frames, energies = [], []

    def total_energy():
        ke = 0.5 * (mass[:, None] * vel ** 2).sum()
        return float(ke + potential_energy(pos, mass, eps2))

    e0 = total_energy()
    for i in range(steps):
        vel += 0.5 * dt * acc
        pos += dt * vel
        accelerations(pos, mass, eps2, acc)
        vel += 0.5 * dt * acc
        if i % save_every == 0:
            h, _, _ = np.histogram2d(pos[:, 0], pos[:, 1], bins=280,
                                     range=[[-14, 22], [-12, 18]])
            frames.append(np.log1p(h).astype(np.float32))
        if i % energy_every == 0 or i == steps - 1:
            e = total_energy()
            energies.append((i, e))
            print(f"step {i}: E={e:.4f} drift={(e-e0)/abs(e0)*100:.3f}%",
                  flush=True)
    drift = abs(energies[-1][1] - e0) / abs(e0)
    Path("out").mkdir(exist_ok=True)
    json.dump({"n": int(len(mass)), "steps": steps, "dt": dt, "eps": eps,
               "energy": [[int(a), float(b)] for a, b in energies],
               "drift": float(drift)},
              open(out_prefix + ".json", "w"), indent=1)
    from viz import render_2d
    mx = max(f.max() for f in frames)
    render_2d(frames, out_prefix + "_merger.mp4", clim=(0, mx), cmap="magma")
    print(f"energy drift {drift*100:.2f}% over {steps} steps", flush=True)
    return drift


if __name__ == "__main__":
    run()
