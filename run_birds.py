"""V-formation study: why trailing birds fly for free (wingtip upwash).

Stages (each gated on the previous, per the honesty protocol):
  gate      — single bird: Cl at ~5 deg AoA must clear the force noise floor,
              and Cl at 0 AoA must be ~0. If lift can't be resolved at this
              Re/resolution, STOP and report that instead of burning compute.
  baseline  — single bird: cross-flow plane 0.5 spans downstream must show the
              counter-rotating tip-vortex pair (downwash between the tips,
              upwash outboard). The measured upwash maximum sets the
              formation geometry — the textbook wingtip offset can miss it,
              because the vortex drifts inboard/down at low Re.
  formation — leader + two trailing birds staggered ~1 span back, wingtips at
              the measured upwash maximum; per-bird L/D vs isolated.

Usage: python run_birds.py [gate|baseline|formation|all]
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

from lbm import D3Q19, Solver
from diagnostics import MomentumExchange
from geometry import from_mesh, keep_largest_component

U = 0.08
RE = 200
MESH = Path("assets/meshes/bird.glb")
SPAN = 90          # wingspan in cells (longest mesh axis)
AOA = -6.0         # nose-down rotation puts wing chord at ~+6 deg incidence


def bird_mask(shape, rotate_extra=None, anchor=None, ycenter=None, zcenter=None):
    rot = [("y", AOA)] if AOA else []
    if rotate_extra:
        rot = rotate_extra + rot
    mask, info = from_mesh(MESH, shape, SPAN, rotate=rot or None, anchor=anchor)
    if ycenter is not None or zcenter is not None:
        idx = np.array(np.nonzero(mask))
        sh = [0, 0, 0]
        if ycenter is not None:
            sh[1] = int(round(ycenter - idx[1].mean()))
        if zcenter is not None:
            sh[2] = int(round(zcenter - idx[2].mean()))
        mask = np.roll(mask, sh, axis=(0, 1, 2))
    return mask, info


def run_sim(shape, masks, steps, sample_planes=(), tau=None):
    """masks: list of per-bird masks. Returns per-bird force history and the
    last sampled cross-flow planes {x_index: (uy, uz, w) time-mean}."""
    solid = np.zeros(shape, bool)
    for m in masks:
        solid |= m
    zs = np.nonzero(solid.any(axis=(0, 1)))[0]
    D_char = max(3, int(zs.max() - zs.min() + 1))
    nu = U * D_char / RE
    tau = tau or 3 * nu + 0.5
    u0 = np.zeros((3,) + shape, np.float32); u0[0] = U; u0[:, solid] = 0.0
    s = Solver(D3Q19, shape, tau, u_init=u0, solid=solid, inlet_u=U,
               dtype=np.float32)
    diags = [MomentumExchange(D3Q19, solid, body=m, U=U) for m in masks]
    hist = [[] for _ in masks]
    plane_acc = {x: None for x in sample_planes}
    n_acc = 0
    for i in range(steps):
        s.step()
        if i >= steps - 4000:
            for d, h in zip(diags, hist):
                h.append(d.coefficients(s))
        if sample_planes and i >= steps - 2000 and i % 50 == 0:
            u = s.velocity()
            n_acc += 1
            for x in sample_planes:
                pl = np.stack([u[1][x], u[2][x]])   # (2, ny, nz): v, w
                plane_acc[x] = pl if plane_acc[x] is None else plane_acc[x] + pl
        if i % 2000 == 0:
            c = [f"{d.coefficients(s)[0]:.3f}" for d in diags]
            print(f"step {i}: Cd {c} tau={tau:.3f}", flush=True)
            if not np.isfinite(s.f).all():
                raise RuntimeError("NaN blow-up")
    planes = {x: a / n_acc for x, a in plane_acc.items() if a is not None}
    stats = []
    for h, d in zip(hist, diags):
        arr = np.array(h)
        stats.append({"Cd": float(arr[:, 0].mean()), "Cd_std": float(arr[:, 0].std()),
                      "Cl": float(arr[:, 1].mean()), "Cl_std": float(arr[:, 1].std()),
                      "A": int(d.A)})
    return stats, planes, s


def wing_geometry(mask):
    """(y_tip_lo, y_tip_hi, z_wing_mean, x_trailing) of a bird mask."""
    idx = np.array(np.nonzero(mask))
    return (int(idx[1].min()), int(idx[1].max()),
            float(idx[2].mean()), int(idx[0].max()))


def stage_gate(shape=(160, 120, 80), steps=6000):
    """Cl at AoA must exceed 3x its own std AND the |Cl| at zero AoA."""
    out = {}
    for label, aoa in (("aoa", None), ("zero", [("y", -AOA)])):
        mask, info = bird_mask(shape, rotate_extra=aoa)
        mask = keep_largest_component(mask)
        stats, _, _ = run_sim(shape, [mask], steps)
        out[label] = stats[0]
        print(f"[gate {label}] {stats[0]}", flush=True)
    gate = (out["aoa"]["Cl"] > 3 * out["aoa"]["Cl_std"]
            and out["aoa"]["Cl"] > abs(out["zero"]["Cl"]) + 3 * out["zero"]["Cl_std"])
    out["pass"] = bool(gate)
    json.dump(out, open("out/birds_gate.json", "w"), indent=1)
    print("[gate]", "PASS" if gate else "FAIL — stop, report honestly", flush=True)
    return out


def stage_baseline(shape=(200, 130, 84), steps=10000):
    mask, info = bird_mask(shape)
    mask = keep_largest_component(mask)
    ylo, yhi, zw, xtrail = wing_geometry(mask)
    span = yhi - ylo + 1
    xplane = min(shape[0] - 2, xtrail + span // 2)     # 0.5 spans downstream
    stats, planes, s = run_sim(shape, [mask], steps, sample_planes=(xplane,))
    v, w = planes[xplane]
    # sign asserts: upwash outboard of tips, downwash between
    zlo, zhi = max(0, int(zw) - 6), min(shape[2], int(zw) + 7)
    out_lo = w[max(0, ylo - 8):ylo, zlo:zhi].mean()
    out_hi = w[yhi + 1:min(shape[1], yhi + 9), zlo:zhi].mean()
    mid = w[ylo + span // 3: yhi - span // 3, zlo:zhi].mean()
    # measured upwash maximum (outboard region, for formation placement)
    wsearch = w.copy()
    wsearch[ylo:yhi + 1, :] = -np.inf       # only outboard counts
    ymax, zmax = np.unravel_index(np.argmax(wsearch), w.shape)
    res = {"stats": stats[0], "span": span, "y_tips": [ylo, yhi],
           "z_wing": float(zw),
           "x_plane": int(xplane), "x_trail": int(xtrail),
           "upwash_outboard_lo": float(out_lo), "upwash_outboard_hi": float(out_hi),
           "downwash_mid": float(mid),
           "upwash_max_at": [int(ymax), int(zmax)],
           "upwash_max": float(w[ymax, zmax]),
           "mechanism_ok": bool(out_lo > 0 and out_hi > 0 and mid < 0)}
    np.savez_compressed("out/birds_baseline_plane.npz", v=v, w=w,
                        meta=json.dumps(res, default=str))
    json.dump(res, open("out/birds_baseline.json", "w"), indent=1)
    print("[baseline]", {k: v for k, v in res.items() if k != "stats"}, flush=True)
    return res


def stage_formation(shape=(230, 150, 90), steps=12000):
    base = json.load(open("out/birds_baseline.json"))
    span = base["span"]
    stagger = span                                     # ~1 span back
    lead_anchor = 30
    m_lead, _ = bird_mask(shape, anchor=lead_anchor)
    m_lead = keep_largest_component(m_lead)
    ylo, yhi, zw, _ = wing_geometry(m_lead)
    # place trailing birds' INNER wingtip at the measured upwash max offset
    dy = base["upwash_max_at"][0] - base["y_tips"][1]   # outboard shift (hi side)
    dz = base["upwash_max_at"][1] - int(round(base["z_wing"]))
    tr_anchor = lead_anchor + stagger
    m_r, _ = bird_mask(shape, anchor=tr_anchor,
                       ycenter=yhi + dy + span / 2, zcenter=zw + dz)
    m_l, _ = bird_mask(shape, anchor=tr_anchor,
                       ycenter=ylo - dy - span / 2, zcenter=zw + dz)
    m_r, m_l = keep_largest_component(m_r), keep_largest_component(m_l)
    if (m_lead & m_r).any() or (m_lead & m_l).any():
        raise RuntimeError("bird masks overlap — widen stagger")
    stats, _, _ = run_sim(shape, [m_lead, m_r, m_l], steps)
    iso = json.load(open("out/birds_baseline.json"))["stats"]
    def ld(s): return s["Cl"] / s["Cd"] if s["Cd"] else float("nan")
    res = {"leader": stats[0], "trail_right": stats[1], "trail_left": stats[2],
           "isolated": iso,
           "LD": {"isolated": ld(iso), "leader": ld(stats[0]),
                  "trail_right": ld(stats[1]), "trail_left": ld(stats[2])},
           "offsets": {"stagger": stagger, "dy": int(dy), "dz": int(dz)}}
    res["benefit_sign_positive"] = bool(
        res["LD"]["trail_right"] > res["LD"]["isolated"]
        and res["LD"]["trail_left"] > res["LD"]["isolated"])
    json.dump(res, open("out/birds_formation.json", "w"), indent=1)
    with open("out/birds_ld.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["bird", "Cd", "Cl", "L/D"])
        for k in ("isolated", "leader", "trail_right", "trail_left"):
            s_ = iso if k == "isolated" else stats[
                {"leader": 0, "trail_right": 1, "trail_left": 2}[k]]
            w.writerow([k, s_["Cd"], s_["Cl"], ld(s_)])
    print("[formation]", res["LD"], "benefit:", res["benefit_sign_positive"],
          flush=True)
    return res


if __name__ == "__main__":
    Path("out").mkdir(exist_ok=True)
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("gate", "all"):
        g = stage_gate()
        if not g["pass"] and what == "all":
            sys.exit("gate FAILED — see out/birds_gate.json")
    if what in ("baseline", "all"):
        stage_baseline()
    if what in ("formation", "all"):
        stage_formation()
