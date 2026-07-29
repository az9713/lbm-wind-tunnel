"""3D realistic-object gallery: flow past voxelized meshes at Re~200.

Each object: 20k steps in float32, saving mid-plane slices every 100 steps
(vertical center plane + horizontal plane through the body) plus Cd/Cl
history. Runs sequentially (one ~2 GB working set at a time). NaN guard:
if the run blows up, retry once at half Reynolds and say so in the output.

Usage: python run_shapes3d.py [object ...]   (default: all)
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

from lbm import D3Q19, Solver
from diagnostics import MomentumExchange
from geometry import ahmed_body, from_mesh

U = 0.08
STEPS = 20000
SAVE_EVERY = 100
MESHES = Path("assets/meshes")

# per-object config: mesh file (None = procedural Ahmed), rotation to put the
# nose upstream (-x = inflow side) & wings level, target length L in cells,
# domain shape, ground plane (cars get a moving road)
OBJECTS = {
    "ahmed":    dict(mesh=None, L=110, shape=(220, 100, 84), ground=True,  Re=200),
    "rocket":   dict(mesh="rocket.glb", L=130, shape=(220, 96, 96), ground=False, Re=200),
    "airplane": dict(mesh="airplane.glb", L=120, shape=(220, 110, 90), ground=False,
                     Re=200, aoa=-5.0),
    "ship":     dict(mesh="ship.glb", L=140, shape=(230, 96, 90), ground=False, Re=200),
    "bird":     dict(mesh="bird.glb", L=100, shape=(200, 130, 84), ground=False, Re=200),
}


def build_mask(name, cfg):
    shape = cfg["shape"]
    if cfg["mesh"] is None:
        mask = ahmed_body(shape, cfg["L"])
        info = {"frontal_area": int(mask.any(axis=0).sum()), "procedural": True}
    else:
        rot = cfg.get("rotate")
        if cfg.get("aoa"):
            rot = (rot or []) + [("y", cfg["aoa"])]
        mask, info = from_mesh(MESHES / cfg["mesh"], shape, cfg["L"],
                               rotate=rot, zmin=None if cfg["ground"] else None)
    if cfg["ground"]:
        mask = mask.copy()
        mask[:, :, 0] = True
    return mask, info


def run_object(name, cfg, re_override=None):
    shape = cfg["shape"]
    Re = re_override or cfg["Re"]
    mask, info = build_mask(name, cfg)
    body = mask.copy()
    if cfg["ground"]:
        body[:, :, 0] = False
    # characteristic size: frontal height of the body
    zs = np.nonzero(body.any(axis=(0, 1)))[0]
    D_char = int(zs.max() - zs.min() + 1) if len(zs) else 20
    nu = U * D_char / Re
    tau = 3 * nu + 0.5
    wu = None
    if cfg["ground"]:
        wu = np.zeros((3,) + shape, np.float32); wu[0, :, :, 0] = U
    u0 = np.zeros((3,) + shape, np.float32); u0[0] = U; u0[:, mask] = 0.0
    s = Solver(D3Q19, shape, tau, u_init=u0, solid=mask, inlet_u=U,
               wall_u=wu, dtype=np.float32)
    diag = MomentumExchange(D3Q19, mask, body=body, U=U)
    ys = np.nonzero(body.any(axis=(0, 2)))[0]
    ymid = int((ys.max() + ys.min()) // 2) if len(ys) else shape[1] // 2
    zsel = np.nonzero(body.any(axis=(0, 1)))[0]
    zmid = int((zsel.max() + zsel.min()) // 2) if len(zsel) else shape[2] // 2
    frames_v, frames_h, forces = [], [], []
    print(f"[{name}] Re={Re} tau={tau:.3f} D_char={D_char} "
          f"A={diag.A} cells={mask.sum()}", flush=True)
    for i in range(STEPS):
        s.step()
        cd, cl = diag.coefficients(s)
        forces.append((i, cd, cl))
        if i % SAVE_EVERY == 0:
            u = s.velocity()
            umag_v = np.sqrt((u[:, :, ymid, :] ** 2).sum(0))
            umag_h = np.sqrt((u[:, :, :, zmid] ** 2).sum(0))
            wy = np.gradient(u[0][:, ymid, :], axis=1) - np.gradient(u[2][:, ymid, :], axis=0)
            wz = np.gradient(u[1][:, :, zmid], axis=0) - np.gradient(u[0][:, :, zmid], axis=1)
            frames_v.append(np.stack([umag_v, wy]).astype(np.float32))
            frames_h.append(np.stack([umag_h, wz]).astype(np.float32))
            if i % 2000 == 0:
                print(f"[{name}] step {i} Cd={cd:.3f} Cl={cl:.3f}", flush=True)
            if not np.isfinite(cd):
                print(f"[{name}] NaN at step {i}", flush=True)
                return None
    out = Path("out"); out.mkdir(exist_ok=True)
    np.savez_compressed(
        out / f"shape_{name}.npz",
        frames_v=np.array(frames_v), frames_h=np.array(frames_h),
        solid_v=mask[:, ymid, :], solid_h=mask[:, :, zmid],
        meta=json.dumps({"name": name, "Re": Re, "tau": tau, "U": U,
                         "D_char": D_char, "A": int(diag.A),
                         "shape": list(shape), "L": cfg["L"],
                         "aoa": cfg.get("aoa", 0.0),
                         "ground": cfg["ground"],
                         "voxel_info": {k: v for k, v in info.items()
                                        if k != "extents_cells"}}))
    with open(out / f"forces_{name}.csv", "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["step", "Cd", "Cl"]); w.writerows(forces)
    tail = np.array(forces)[-5000:, 1:]
    print(f"[{name}] DONE Cd={tail[:, 0].mean():.3f}+-{tail[:, 0].std():.3f} "
          f"Cl={tail[:, 1].mean():.3f}", flush=True)
    return True


if __name__ == "__main__":
    names = sys.argv[1:] or list(OBJECTS)
    for n in names:
        ok = run_object(n, OBJECTS[n])
        if ok is None:
            print(f"[{n}] retrying at half Re", flush=True)
            run_object(n, OBJECTS[n], re_override=OBJECTS[n]["Re"] // 2)
