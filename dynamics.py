"""Two-car drafting dynamics: point-mass cars driven by the measured aero map.

Quasi-static coupling: Cd of the trailing car is a function of the current
gap, interpolated from the 2D sweep (out/drafting_map.csv). Valid only when
the gap-closing timescale is much longer than the wake-convection timescale —
the ratio is computed and reported alongside any result (honesty protocol).
Units: car length = 1, leader steady speed = 1, air density = 1.
"""
import csv

import numpy as np


def rk4(f, y, t, dt):
    k1 = f(t, y)
    k2 = f(t + dt / 2, y + dt / 2 * k1)
    k3 = f(t + dt / 2, y + dt / 2 * k2)
    k4 = f(t + dt, y + dt * k3)
    return y + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)


def load_map(path="out/drafting_map.csv"):
    """-> (gaps array in L units, Cd_trailing array, Cd_isolated, A)."""
    gaps, cds = [], []
    cd_iso = area = None
    with open(path) as fh:
        for row in csv.DictReader(fh):
            if row["kind"] == "isolated":
                cd_iso = float(row["Cd"]); area = float(row["A"])
            elif row["kind"] == "tandem" and row["car"] == "b":
                gaps.append(float(row["param"])); cds.append(float(row["Cd"]))
    order = np.argsort(gaps)
    return np.array(gaps)[order], np.array(cds)[order], cd_iso, area


def simulate(gaps, cd_trail, cd_iso, m=50.0, gap0=3.0, dt=0.01, t_max=2000.0):
    """Integrate both cars until the trailing car reaches the closest mapped
    gap (slipstream caught) or t_max. Returns dict of time series + timescale
    ratio (must be >> 1 for the quasi-static map to be valid)."""
    A = 1.0                      # areas cancel: fold into engine force
    F_e = 0.5 * cd_iso * A * 1.0 ** 2      # engine force = isolated drag at v=1

    def cd_gap(g):
        return float(np.interp(g, gaps, cd_trail,
                               left=cd_trail[0], right=cd_iso))

    def deriv(t, y):
        x1, v1, x2, v2 = y
        gap = x1 - x2 - 1.0
        d1 = F_e - 0.5 * cd_iso * A * v1 ** 2
        d2 = F_e - 0.5 * cd_gap(gap) * A * v2 ** 2
        return np.array([v1, d1 / m, v2, d2 / m])

    y = np.array([gap0 + 1.0, 1.0, 0.0, 1.0])   # leader ahead by gap0+L
    ts, out = [], []
    t = 0.0
    while t < t_max:
        ts.append(t); out.append(y.copy())
        gap = y[0] - y[2] - 1.0
        if gap <= gaps[0]:
            break
        y = rk4(deriv, y, t, dt)
        t += dt
    out = np.array(out); ts = np.array(ts)
    gap_series = out[:, 0] - out[:, 2] - 1.0
    # timescale honesty: gap-closing time vs wake convection time (~gap0/V)
    t_close = ts[-1] if len(ts) > 1 else np.inf
    ratio = t_close / gap0
    return {"t": ts, "gap": gap_series, "v_leader": out[:, 1],
            "v_trailing": out[:, 3], "caught": bool(gap_series[-1] <= gaps[0]),
            "timescale_ratio": ratio}


def run(map_path="out/drafting_map.csv", out_prefix="out/dynamics"):
    import json
    gaps, cd_trail, cd_iso, _ = load_map(map_path)
    r = simulate(gaps, cd_trail, cd_iso)
    json.dump({"caught": r["caught"], "t_end": float(r["t"][-1]),
               "timescale_ratio": float(r["timescale_ratio"]),
               "gap0": 3.0, "gap_end": float(r["gap"][-1])},
              open(out_prefix + "_meta.json", "w"), indent=1)
    with open(out_prefix + ".csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["t", "gap", "v_leader", "v_trailing"])
        for i in range(0, len(r["t"]), 10):
            w.writerow([r["t"][i], r["gap"][i], r["v_leader"][i], r["v_trailing"][i]])
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(8, 6), sharex=True)
    a1.plot(r["t"], r["gap"]); a1.set_ylabel("gap [car lengths]")
    a1.set_title(f"Drafting catch-up from the measured aero map "
                 f"(timescale ratio {r['timescale_ratio']:.0f})")
    a2.plot(r["t"], r["v_leader"], label="leader")
    a2.plot(r["t"], r["v_trailing"], label="trailing")
    a2.set_xlabel("t [car lengths / leader speed]"); a2.set_ylabel("speed")
    a2.legend()
    fig.savefig(out_prefix + ".png", dpi=120)
    return r


if __name__ == "__main__":
    r = run()
    print("caught:", r["caught"], "t_end:", r["t"][-1],
          "timescale_ratio:", r["timescale_ratio"])
