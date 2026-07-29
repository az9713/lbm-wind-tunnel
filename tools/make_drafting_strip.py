"""Animation strip for the drafting maneuver (plan 12b): gap(t) from the ODE
paired with the measured flow field nearest each marked gap. Produces
out/drafting_strip.png. Run after dynamics.py and snapshot_fields()."""
import csv
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main():
    t, gap = [], []
    with open("out/dynamics.csv") as fh:
        for row in csv.DictReader(fh):
            t.append(float(row["t"])); gap.append(float(row["gap"]))
    t, gap = np.array(t), np.array(gap)
    snaps = {}
    for p in Path("out").glob("drafting_snap_*.npz"):
        d = np.load(p)
        snaps[float(d["gap"])] = (d["vort"], d["solid"])
    marks = sorted(snaps.keys(), reverse=True)
    fig = plt.figure(figsize=(12, 7.2))
    ax = fig.add_axes((0.07, 0.52, 0.9, 0.44))
    ax.plot(t, gap, color="#c43a35", lw=2)
    ax.set_xlabel("time  [car lengths / leader speed]")
    ax.set_ylabel("gap  [car lengths]")
    ax.set_title("The catch-up is emergent: same engine power, the follower "
                 "closes in because its measured drag falls inside the wake")
    ax.grid(alpha=0.3)
    for i, g in enumerate(marks):
        # first time the ODE gap crosses this value
        idx = np.argmax(gap <= g) if (gap <= g).any() else len(gap) - 1
        ax.plot(t[idx], gap[idx], "o", color="#141a1e", ms=6)
        ax.annotate(f"  t={t[idx]:.0f}", (t[idx], gap[idx]), fontsize=9)
        vort, solid = snaps[g]
        axi = fig.add_axes((0.07 + i * 0.31, 0.06, 0.28, 0.36))
        clim = 3 * vort.std()
        axi.imshow(vort.T, origin="lower", cmap="RdBu_r",
                   vmin=-clim, vmax=clim, aspect="auto")
        rgba = np.zeros(solid.T.shape + (4,)); rgba[solid.T] = (0.1, 0.1, 0.1, 1)
        axi.imshow(rgba, origin="lower", aspect="auto")
        axi.set_xticks([]); axi.set_yticks([])
        axi.set_title(f"gap = {g} L  (measured field)", fontsize=10)
    fig.savefig("out/drafting_strip.png", dpi=110)
    print("wrote out/drafting_strip.png")


if __name__ == "__main__":
    main()
