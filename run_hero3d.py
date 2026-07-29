"""3D hero runs (plan 12c): two full Ahmed bodies over a moving road.

tandem      — trailing car swallowed in the leader's wake (gap 0.25 L)
side        — side-by-side battle (lateral offset 0.35 W)

Center-plane slices + per-car force histories -> npz/csv, rendered by
tools/render_gallery.py naming convention (shape_hero_*.npz).
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

from lbm import D3Q19, Solver
from diagnostics import MomentumExchange
from geometry import ahmed_body

U = 0.08
STEPS = 12000
SAVE_EVERY = 60
L = 90


def build(kind):
    if kind == "tandem":
        shape = (300, 96, 80)
        gap = int(0.25 * L)
        a = ahmed_body(shape, L, anchor=40)
        b = ahmed_body(shape, L, anchor=40 + L + gap)
    else:
        shape = (240, 130, 80)
        W = round(389 / 1044 * L)
        off = int(0.35 * W)
        a = ahmed_body(shape, L, anchor=60)
        b = ahmed_body(shape, L, anchor=60)
        sh = (W + off) // 2
        a = np.roll(a, -sh, axis=1)
        b = np.roll(b, W + off - sh, axis=1)
    solid = a | b
    solid = solid.copy()
    solid[:, :, 0] = True         # road
    return shape, solid, a, b


def run(kind):
    shape, solid, a, b = build(kind)
    zs = np.nonzero(a.any(axis=(0, 1)))[0]
    D_char = int(zs.max() - zs.min() + 1)
    tau = max(3 * U * D_char / 200 + 0.5, 0.555)
    Re = round(3 * U * D_char / (tau - 0.5))
    wu = np.zeros((3,) + shape, np.float32)
    wu[0, :, :, 0] = U
    u0 = np.zeros((3,) + shape, np.float32); u0[0] = U; u0[:, solid] = 0.0
    s = Solver(D3Q19, shape, tau, u_init=u0, solid=solid, inlet_u=U,
               wall_u=wu, dtype=np.float32)
    da = MomentumExchange(D3Q19, solid, body=a, U=U)
    db = MomentumExchange(D3Q19, solid, body=b, U=U)
    ys = np.nonzero(a.any(axis=(0, 2)))[0]
    ymid = int(ys.mean())
    zmid = int(zs.mean())
    frames_v, frames_h, forces = [], [], []
    print(f"[hero_{kind}] Re={Re} tau={tau:.3f} grid={shape}", flush=True)
    for i in range(STEPS):
        s.step()
        ca, cb = da.coefficients(s), db.coefficients(s)
        forces.append((i, ca[0], ca[1], cb[0], cb[1]))
        if i % SAVE_EVERY == 0:
            u = s.velocity()
            umag_v = np.sqrt((u[:, :, ymid, :] ** 2).sum(0))
            umag_h = np.sqrt((u[:, :, :, zmid] ** 2).sum(0))
            wy = np.gradient(u[0][:, ymid, :], axis=1) - np.gradient(u[2][:, ymid, :], axis=0)
            wz = np.gradient(u[1][:, :, zmid], axis=0) - np.gradient(u[0][:, :, zmid], axis=1)
            frames_v.append(np.stack([umag_v, wy]).astype(np.float32))
            frames_h.append(np.stack([umag_h, wz]).astype(np.float32))
            if not np.isfinite(ca[0]):
                print(f"[hero_{kind}] NaN at {i}", flush=True)
                return
        if i % 1980 == 0:
            print(f"[hero_{kind}] step {i} CdA={ca[0]:.2f} CdB={cb[0]:.2f}",
                  flush=True)
    out = Path("out"); out.mkdir(exist_ok=True)
    np.savez_compressed(
        out / f"shape_hero_{kind}.npz",
        frames_v=np.array(frames_v), frames_h=np.array(frames_h),
        solid_v=solid[:, ymid, :], solid_h=solid[:, :, zmid],
        meta=json.dumps({"name": f"hero_{kind}", "Re": Re, "tau": tau, "U": U,
                         "D_char": D_char, "A": int(da.A),
                         "shape": list(shape), "L": L, "ground": True}))
    with open(out / f"forces_hero_{kind}.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["step", "CdA", "ClA", "CdB", "ClB"]); w.writerows(forces)
    tail = np.array(forces)[-4000:]
    print(f"[hero_{kind}] DONE CdA={tail[:,1].mean():.3f} "
          f"CdB={tail[:,3].mean():.3f}", flush=True)


if __name__ == "__main__":
    for kind in (sys.argv[1:] or ["tandem", "side"]):
        run(kind)
