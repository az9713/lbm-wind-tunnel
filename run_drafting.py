"""Two-car drafting study: 2D gap sweep (tandem + side-by-side) -> aero map.

Frame: cars fixed, air flows +x at U. Road (and ceiling) are moving walls at
the inflow speed — the physically correct frame for a car on a road; a
stationary floor would grow a spurious boundary layer that chokes the
underbody flow (see docs/plans, honesty protocol).

Tandem: leader upstream, trailing car downstream inside the leader's wake.
Side-by-side: plan view (no ground), lateral edge-to-edge offsets.
"""
import csv
from pathlib import Path

import numpy as np

from lbm import D2Q9, Solver
from diagnostics import MomentumExchange
from geometry import ahmed_body

L = 100                 # car length in cells
U = 0.08                # inflow speed (lattice)
RE_H = 100              # Reynolds on car height (tau safety: ~0.58)
NX, NY = 700, 200
GAPS = [0.25, 0.5, 1.0, 1.5, 2.0, 3.0]          # tandem, units of L
OFFSETS = [0.25, 0.5, 1.0]                      # side-by-side, units of W
STEPS, AVG = 25000, 5000                        # per run; mean over last AVG


def car_profile(shape, x0):
    """Ahmed-body side profile at x0 (2D mask incl. nothing else)."""
    m = ahmed_body(shape, L, anchor=x0)
    return m


def plan_profile(shape, x0, y0):
    """Top-down silhouette: rounded-nose rectangle, W = Ahmed width."""
    W = round(389 / 1044 * L)
    r = W // 2
    mask = np.zeros(shape, bool)
    xs = np.arange(shape[0])[:, None]
    ys = np.arange(shape[1])[None, :]
    body = (xs >= x0 + r) & (xs < x0 + L) & (ys >= y0) & (ys < y0 + W)
    nose = (xs - (x0 + r)) ** 2 + (ys - (y0 + r)) ** 2 <= r * r
    nose &= xs < x0 + r
    return mask | body | nose


def _tau():
    H = round(288 / 1044 * L) + round(50 / 1044 * L)   # height incl. clearance
    nu = U * H / RE_H
    return 3 * nu + 0.5


def run_tandem(gap_cells, steps=STEPS, record=None):
    """One tandem run. gap_cells<0 -> isolated car. Returns per-car stats."""
    shape = (NX, NY)
    floor = np.zeros(shape, bool); floor[:, 0] = True; floor[:, -1] = True
    xa = 110
    a = car_profile(shape, xa)
    solid = floor | a
    b = None
    if gap_cells >= 0:
        xb = xa + L + int(gap_cells)
        b = car_profile(shape, xb)
        solid = solid | b
    wu = np.zeros((2,) + shape); wu[0, :, 0] = U; wu[0, :, -1] = U
    u0 = np.zeros((2,) + shape); u0[0] = U; u0[:, solid] = 0.0
    s = Solver(D2Q9, shape, _tau(), u_init=u0, solid=solid, inlet_u=U, wall_u=wu)
    da = MomentumExchange(D2Q9, solid, body=a, U=U)
    db = MomentumExchange(D2Q9, solid, body=b, U=U) if b is not None else None
    hist = {"a": [], "b": []}
    for i in range(steps):
        s.step()
        if i >= steps - AVG:
            hist["a"].append(da.coefficients(s))
            if db: hist["b"].append(db.coefficients(s))
        if record and i >= steps - AVG and (i % record[0] == 0):
            record[1](s, i)
    out = {}
    for k, h in hist.items():
        if h:
            arr = np.array(h)
            out[k] = {"Cd": arr[:, 0].mean(), "Cd_std": arr[:, 0].std(),
                      "Cl": arr[:, 1].mean(), "A": (da if k == "a" else db).A}
    return out


def run_side_by_side(offset_cells, steps=STEPS):
    """Plan view, two hulls offset laterally; returns per-car (Cd, Cy)."""
    shape = (NX, NY)
    W = round(389 / 1044 * L)
    x0 = 150
    ya = NY // 2 - W - int(offset_cells) // 2
    yb = NY // 2 + int(offset_cells) - int(offset_cells) // 2
    a = plan_profile(shape, x0, ya)
    b = plan_profile(shape, x0, yb)
    solid = a | b
    u0 = np.zeros((2,) + shape); u0[0] = U; u0[:, solid] = 0.0
    s = Solver(D2Q9, shape, _tau(), u_init=u0, solid=solid, inlet_u=U)
    da = MomentumExchange(D2Q9, solid, body=a, U=U)
    db = MomentumExchange(D2Q9, solid, body=b, U=U)
    ha, hb = [], []
    for i in range(steps):
        s.step()
        if i >= steps - AVG:
            ha.append(da.coefficients(s)); hb.append(db.coefficients(s))
    ha, hb = np.array(ha), np.array(hb)
    return {"a": {"Cd": ha[:, 0].mean(), "Cy": ha[:, 1].mean()},
            "b": {"Cd": hb[:, 0].mean(), "Cy": hb[:, 1].mean()}}


def build_map(path="out/drafting_map.csv"):
    Path("out").mkdir(exist_ok=True)
    rows = []
    iso = run_tandem(-1)
    rows.append({"kind": "isolated", "param": "", "car": "a", **iso["a"]})
    print("isolated:", iso["a"], flush=True)
    for g in GAPS:
        r = run_tandem(int(g * L))
        for car in ("a", "b"):
            rows.append({"kind": "tandem", "param": g, "car": car, **r[car]})
        print(f"gap {g}L: leader Cd={r['a']['Cd']:.3f} trailing Cd={r['b']['Cd']:.3f}",
              flush=True)
    for o in OFFSETS:
        r = run_side_by_side(int(o * round(389 / 1044 * L)))
        for car in ("a", "b"):
            rows.append({"kind": "side", "param": o, "car": car, **r[car]})
        print(f"offset {o}W: Cy_a={r['a']['Cy']:.4f} Cy_b={r['b']['Cy']:.4f}",
              flush=True)
    keys = ["kind", "param", "car", "Cd", "Cd_std", "Cl", "Cy", "A"]
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in keys})
    return path


if __name__ == "__main__":
    print("tau =", _tau(), "U =", U, flush=True)
    print("map ->", build_map(), flush=True)
