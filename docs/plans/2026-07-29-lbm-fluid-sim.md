# Lattice Boltzmann Fluid Simulator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A validated Lattice Boltzmann (LBM) fluid simulator with two headline coupled-flow studies — **two racing cars drafting** (tandem and side-by-side, wake forces feeding back into the cars' motion) and **three birds gliding in V-formation** (trailing birds riding the leader's wingtip upwash) — plus a gallery of flow past realistic 3D objects (Ahmed-body car, rocket, airplane, ocean-liner hull, single bird), with solver correctness proven first on canonical geometries (cylinder, sphere) that have exact published answers.

**Honesty note on "realistic":** a real car drives at Reynolds number ~10 million; our lattice runs at Re ~100–1000. The videos show genuine fluid dynamics (wakes, vortex shedding, recirculation zones) around these shapes, and the Ahmed-body drag gets compared to published values, but this is qualitative flow visualization plus one benchmarked number — not engineering-grade aerodynamics. The ship is simulated fully immersed ("wind-tunnel mode"): a free water surface is a different, much harder LBM variant (YAGNI tonight).

**Architecture:** One dimension-agnostic BGK solver driven by a lattice descriptor object (D2Q9 for 2D, D3Q19 for 3D). Geometry is a boolean solid mask; walls are half-way bounce-back; forces come from momentum exchange. Pure numpy (float32 in 3D), no numba unless a run is measurably too slow. Long production runs execute locally in background Bash tasks — they cost zero tokens by design.

**Tech Stack:** Python 3 + numpy, matplotlib (frame rendering), ffmpeg (already on this machine) for mp4s, pytest. Nothing else.

**Budget rule:** Weekly all-models limit is the binding constraint (~10% left, resets 8pm PT). Checkpoints after Task 7 and Task 13: run `/usage` (user pastes result) and decide continue / throttle / extend to suite.

**Non-negotiables (user-set):**
1. **Rigor, no watering down.** Every displayed number traces to a validated run; every solver (Python *and* the in-browser engine) passes the same physics self-checks; limitations stated plainly, never hidden.
2. **Interactive, attractive, intuitive results site.** The user (not a designer) experiments with parameters directly — sliders, presets, drag-the-cars — with instant response, and comes back for more. Explanations layered: plain language first, full math one click away, rigor never sacrificed for simplicity.
3. **Configurable everything:** experiment parameters (Re, speed, gap, offset, shapes, grid) and presentation (colormaps, overlays, chart choices) both user-tweakable.
4. **Realistic geometry and rendering.** No blocky primitives on screen: cars, rocket, ship, birds are real 3D meshes (free CC0/CC-BY models), voxelized for the solver and rendered as smooth shaded models in the UI (bundled three.js viewers; 2D live sim uses true mesh-projected silhouettes). Canonical shapes (sphere, cylinder, Ahmed body) remain *only* as validation rows — published benchmark numbers exist for those, not for arbitrary pretty meshes. Captions state the voxel resolution the solver actually saw.

**Priority order under budget pressure** (later items drop first): core validated solver (0–7) → drafting map + dynamics (12a/b) → interactive site (13) → 3D gallery & hero runs (8–11, 12c) → suite (14). The site consumes the 2D results, so it does not depend on 3D finishing.

**Repo layout:**

```
fable_5_credit_3/
  lbm.py            # lattice descriptors + Solver (collide, stream, BCs, forces)
  geometry.py       # solid masks: cylinder+sphere (validation), Ahmed car, rocket, airplane, ship hull
  diagnostics.py    # drag/lift coefficients, Strouhal via FFT
  viz.py            # vorticity/slice frames -> mp4 via ffmpeg
  run_cylinder2d.py # 2D validation runs
  run_shapes3d.py   # production 3D object gallery
  run_drafting.py   # two-car tandem / side-by-side gap sweep
  dynamics.py       # two-car equations of motion driven by the measured aero map
  tests/test_lbm.py
  out/              # frames, videos, csv results (gitignored)
  assets/meshes/    # CC0/CC-BY realistic 3D models (car, rocket, airplane, ship, bird) + licenses
  site/             # interactive results website: index.html, lbm-gpu.js, media/ (incl. .glb models)
  docs/plans/       # this file
```

**Physics cheat sheet (used throughout):**

- BGK collision: `f += omega * (feq - f)`, `omega = 1/tau`, viscosity `nu = (tau - 0.5)/3` (lattice units).
- Equilibrium: `feq_i = w_i * rho * (1 + 3(c_i·u) + 4.5(c_i·u)^2 - 1.5|u|^2)`.
- Keep inflow speed `U <= 0.1` lattice units (low-Mach limit; higher = compressibility error).
- `Re = U * D / nu` where D = obstacle diameter in lattice cells.
- Streaming = `np.roll` per direction. Bounce-back = at solid cells, replace populations with their opposites.
- Momentum-exchange force on obstacle → `Cd = 2 Fx / (rho U^2 A)`, `Cl = 2 Fy / (rho U^2 A)` (A = frontal diameter in 2D, frontal area in 3D).

**Validation targets (the whole point — each is a test):**

| Check | Target | Source | Tolerance |
|---|---|---|---|
| Equilibrium moments | Σfeq=ρ, Σfeq·c=ρu | exact identity | 1e-6 |
| Taylor-Green 2D decay | u ~ exp(−2νk²t) | analytic | 2% |
| Poiseuille profile | parabola | analytic | 2% |
| Cylinder Re=20 | steady Cd ≈ 2.0–2.2 | lit. (unbounded 2D) | assert 1.5–3.0 & steady |
| Cylinder Re=100 Strouhal | St ≈ 0.16–0.17 | lit. | assert 0.14–0.20 |
| Sphere Re=100 Cd | 1.09 | Schiller–Naumann: Cd=24/Re·(1+0.15Re^0.687) | ±25% (voxelization+blockage) |
| Ahmed body Cd | ≈0.26–0.29 at high Re | Ahmed et al. 1984 (25–35° slant) | report + sanity range 0.2–1.0 (our Re is far lower) |
| Realistic shapes (rocket/plane/ship) | qualitative: attached vs separated flow, wake structure | — | visual + Cd table, no hard assert |
| Drafting: trailing-car drag at 0.25L gap | 30–60% reduction vs isolated | platoon/tandem-body literature | assert < 70% of isolated |
| Drafting: effect decay | Cd_trailing → Cd_isolated at 3L gap | — | within 15% |
| Drafting dynamics | gap closes on its own from measured aero map | emergent | assert gap(t) decreasing |
| Bird wake mechanism | wingtip vortex pair: downwash between tips, upwash outboard | Lissaman & Shollenberger 1970 | assert sign pattern in cross-flow plane |
| V-formation benefit | trailing birds' L/D > isolated bird's | formation-flight lit. (Portugal 2014) | assert sign; report magnitude honestly |
| (Suite) Ising Tc | 2.269 | Onsager exact | ±3% |

**Measurement & honesty protocol (from `docs/2026-07-29-blindspot-pass.md` — binding on all tasks):**

- **Pre-mortem before the first slow test:** one agent takes this validation table and, per row, writes the most likely BUG cause of failure, the most likely legitimate PHYSICS/DISCRETIZATION cause (blockage, effective diameter, laminar regime, force noise, fp precision), and the cheapest discriminating check. Saved to `docs/pre-mortem.md`; consulted before debugging any red assert.
- **Every reported force number carries its context:** blockage ratio of the run, effective diameter (mask + half-link ≈ D+1, used consistently in Re and Cd), and mean ± std over an integer number of shedding cycles after measured transient removal (Hann-windowed FFT for frequencies). Asserts use noise-aware margins.
- **Diagnostics get their own unit tests with synthetic inputs** (FFT on a known noisy sine with transient; per-body link partitioning on two nearby squares) — the measurement pipeline is half the epistemics and the cheaper place to look when an assert fails.
- **Regime honesty:** low-Re laminar wakes decay *slower* than turbulent ones — the drafting-recovery-at-3L assert may fail on real physics, not bugs; the pre-mortem covers which way to read each failure. The leader's drag change at close gap is measured and reported too.
- **Floor under the cars: moving-wall bounce-back** (road moves at inflow speed — the physically correct frame for a car on a road, and it avoids a spurious floor boundary layer choking the underbody flow). Stated in the report.
- **Quasi-static drafting dynamics:** compute and report the timescale ratio (gap-closing time / wake-convection time); the emergent-catch-up claim stands only with that ratio ≫ 1 printed next to it. Labeled a 2D analogue.

---

### Task 0: Repo scaffold

**Files:** Create `.gitignore`, `requirements.txt`, `tests/__init__.py` (empty), `out/.gitkeep`.

**Step 1:** `git init`, write `.gitignore` (`out/`, `__pycache__/`, `*.mp4` outside out, `.venv/`), `requirements.txt` (`numpy`, `matplotlib`, `pytest`).

**Step 2:** `pip install -r requirements.txt` (or verify already installed).

**Step 3:** `python -c "import numpy, matplotlib; print('ok')"` → expect `ok`.

**Step 4:** Commit `chore: scaffold LBM project`.

---

### Task 1: Lattice descriptors + equilibrium (D2Q9 first)

**Files:** Create `lbm.py`, `tests/test_lbm.py`.

**Step 1: Failing test**

```python
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
```

**Step 2:** `pytest tests/test_lbm.py -v` → FAIL (import error).

**Step 3: Implement** in `lbm.py`:

```python
import numpy as np
from dataclasses import dataclass

@dataclass(frozen=True)
class Lattice:
    c: np.ndarray      # (Q, dim) int velocities
    w: np.ndarray      # (Q,) weights
    opp: np.ndarray    # (Q,) index of opposite velocity

def _make(c, w):
    c, w = np.array(c), np.array(w)
    opp = np.array([int(np.where((c == -ci).all(1))[0][0]) for ci in c])
    return Lattice(c, w, opp)

D2Q9 = _make(
    [(0,0),(1,0),(0,1),(-1,0),(0,-1),(1,1),(-1,1),(-1,-1),(1,-1)],
    [4/9] + [1/9]*4 + [1/36]*4)

def equilibrium(lat, rho, u):
    # u shape: (dim, *grid); returns (Q, *grid)
    cu = np.einsum('qa,a...->q...', lat.c.astype(u.dtype), u)
    usq = (u * u).sum(0)
    return lat.w.reshape(-1, *([1]*u[0].ndim)) * rho * (1 + 3*cu + 4.5*cu**2 - 1.5*usq)
```

**Step 4:** pytest → PASS. **Step 5:** Commit `feat: D2Q9 lattice + equilibrium with moment tests`.

---

### Task 2: Streaming (periodic)

**Step 1: Failing test** — mass conserved and a density blob advects by exactly c_i per step:

```python
def test_streaming_conserves_mass_and_shifts():
    from lbm import D2Q9, stream
    f = np.zeros((9, 16, 16)); f[1, 8, 8] = 1.0   # east-moving population
    f2 = stream(D2Q9, f)
    assert f2.sum() == f.sum()
    assert f2[1, 9, 8] == 1.0                      # moved +x by 1
```

**Step 3: Implement** (grid axes are (x, y[, z]); roll axis a by c[q, a]):

```python
def stream(lat, f):
    out = np.empty_like(f)
    for q, ci in enumerate(lat.c):
        out[q] = np.roll(f[q], shift=tuple(ci), axis=tuple(range(ci.size)))
    return out
```

**Step 5:** Commit `feat: periodic streaming`.

---

### Task 3: BGK collision, validated on Taylor–Green vortex decay

**Step 1: Failing test** — init the analytic 2D Taylor–Green field on a periodic 64² grid, step 800 times, fit the kinetic-energy decay rate; must match `2*nu*k^2` within 2%:

```python
def test_taylor_green_decay():
    from lbm import D2Q9, Solver
    n, tau, u0 = 64, 0.8, 0.03
    nu = (tau - 0.5) / 3
    k = 2*np.pi/n
    x, y = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
    u = np.stack([ u0*np.cos(k*x)*np.sin(k*y), -u0*np.sin(k*x)*np.cos(k*y)])
    s = Solver(D2Q9, (n, n), tau, u_init=u)
    e = []
    for t in range(800):
        s.step(); e.append((s.velocity()**2).sum())
    rate = -np.polyfit(np.arange(800), np.log(e), 1)[0] / 2   # energy decays 2x faster
    assert abs(rate - 2*nu*k**2) / (2*nu*k**2) < 0.02
```

**Step 3: Implement** `Solver` in `lbm.py`: holds `f`, `tau`, optional `solid` mask, inlet velocity; `step()` = collide → stream (+ bounce-back and inlet/outlet from Tasks 4–5, no-ops for now); `rho()`, `velocity()` moment helpers.

**Step 5:** Commit `feat: BGK solver validated on Taylor-Green decay`.

---

### Task 4: Bounce-back walls, validated on Poiseuille flow

**Step 1: Failing test** — body-force-driven channel flow between two walls; steady profile must match the parabola within 2% (compare shapes, normalized to peak):

```python
def test_poiseuille_profile():
    from lbm import D2Q9, Solver
    nx, ny, tau, g = 8, 33, 0.9, 1e-6      # g = body force in +x
    solid = np.zeros((nx, ny), bool); solid[:, 0] = solid[:, -1] = True
    s = Solver(D2Q9, (nx, ny), tau, solid=solid, force=(g, 0.0))
    for _ in range(8000): s.step()
    ux = s.velocity()[0, 0, 1:-1]
    yc = np.arange(1, ny-1) - (ny-1)/2
    h = (ny - 2) / 2
    ana = 1 - (yc/h)**2
    assert np.allclose(ux/ux.max(), ana/ana.max(), atol=0.02)
```

**Step 3: Implement** full bounce-back (post-streaming: `f[q, solid] = f_prev[opp[q], solid]`) and Guo forcing (or the simpler `feq(rho, u + tau*F/rho)` shift — either passes at this tolerance; note the choice in a comment).

**Step 5:** Commit `feat: bounce-back walls + body force, Poiseuille-validated`.

---

### Task 5: Open flow — inlet/outlet, obstacle mask, momentum-exchange force

**Files:** Create `geometry.py`, `diagnostics.py`.

**Step 1: Failing test** — steady cylinder at Re=20 on a 400×160 grid (D=20 cells, U=0.05, tau from Re): Cd converges (last-500-step std < 1% of mean) and lands in [1.5, 3.0]:

```python
def test_cylinder_re20_steady_drag():
    from run_cylinder2d import make_sim
    s, diag = make_sim(nx=400, ny=160, D=20, U=0.05, Re=20)
    cds = [diag.coefficients(s)[0] for _ in range(4000) if s.step() or True][-500:]
    cd = np.mean(cds)
    assert np.std(cds) < 0.01 * cd
    assert 1.5 < cd < 3.0
```

**Step 3: Implement**
- `geometry.cylinder(shape, center, r)` → bool mask (works in 2D; sphere is the same formula in 3D).
- Inlet (x=0): set `f = feq(rho=1, u=(U,0))`. Outlet (x=-1): copy from x=-2 (zero-gradient).
- `diagnostics.MomentumExchange`: precompute boundary links (fluid cell with solid neighbor along c_q); force `F = Σ c_q (f_q + f_opp)` over links each step; `coefficients()` → (Cd, Cl).
- `run_cylinder2d.make_sim(...)`: wires grid, mask, tau = `3*U*D/Re + 0.5` ... i.e. `nu = U*D/Re`, `tau = 3*nu + 0.5`. Guard: warn if `tau < 0.55` (stability).

**Step 5:** Commit `feat: open-flow BCs, obstacle masks, momentum-exchange forces`.

---

### Task 6: Vortex street — Strouhal number at Re=100 (headline 2D validation)

**Step 1: Failing test** (marked `@pytest.mark.slow`, ~3–5 min) — Re=100, run 30k steps, FFT the lift-coefficient history from step 10k; dominant frequency f gives `St = f*D/U`; assert `0.14 < St < 0.20`. Seed asymmetry (tiny transverse inlet perturbation for the first 1000 steps) so shedding starts deterministically.

**Step 3: Implement** `diagnostics.strouhal(cl_history, D, U, dt=1)` via `np.fft.rfft` peak. Fix anything that fails (usual suspects: outlet reflections → lengthen domain to 600×240; tau too close to 0.5 → raise U to 0.08 and recompute).

**Step 5:** Commit `feat: Re=100 vortex street, Strouhal validated vs literature`.

---

### Task 7: 2D visualization → mp4

**Files:** Create `viz.py`.

**Step 1: Failing test** — `viz.render_2d(sim_frames, out/'test.mp4')` on 10 dummy vorticity fields produces a file > 10 kB.

**Step 3: Implement** vorticity = `dv/dx - du/dy` via `np.gradient`; matplotlib `imshow` (diverging colormap, solid mask overlaid in black) → png frames in `out/frames/` → `ffmpeg -y -framerate 30 -i frame_%05d.png -pix_fmt yuv420p out/name.mp4`. Reuse the known local gotcha: don't pass `C:`-style font paths to drawtext; we don't need drawtext at all.

**Step 4:** Also render a real 20-second Re=100 clip; **verify by opening a frame image** (Read the png) — vortex street visible.

**Step 5:** Commit `feat: vorticity video rendering`.

**CHECKPOINT A:** user runs `/usage`, pastes result. If weekly ≥ ~97% used: stop here, jump to Task 12 (production runs + minimal report). Else continue to 3D.

---

### Task 8: D3Q19 — the solver goes 3D

**Step 1: Failing tests** — (a) same moment identities as Task 1 for D3Q19; (b) 3D Poiseuille between plates (16×33×8 grid, periodic in x,z) matches the parabola within 2% — this reuses the Task 4 test body with a 3D grid, proving the solver is genuinely dimension-agnostic.

**Step 3: Implement** `D3Q19 = _make(...)` (the 19 velocities: rest + 6 face + 12 edge; weights 1/3, 1/18, 1/36). Everything else (equilibrium, stream, bounce-back, forcing) already generic — fix whatever isn't. Use `dtype=np.float32` for 3D solvers (memory: 19 × grid × 4 bytes × 2 copies; 160×80×80 ≈ 1.6 GB budget — verify fits, else shrink).

**Step 5:** Commit `feat: D3Q19 lattice, solver validated in 3D`.

---

### Task 9: 3D geometry — real meshes, voxelized (non-negotiable #4)

Realistic objects come from real 3D model files, voxelized onto the lattice. Canonical validation shapes stay procedural.

**Step 1: Acquire meshes** (doc-fetcher/WebSearch agent): one free, permissively licensed (CC0 / CC-BY, license recorded in `site/media/CREDITS.md`) low-to-mid-poly mesh each: racing/road car, rocket, airplane, cargo ship / ocean liner, gliding bird (wings spread). Sources: Thingiverse, Printables, Poly Pizza, Smithsonian 3D. Watertight preferred. Saved to `assets/meshes/`. **Fallback if no acceptable licensed mesh is found for some object:** the composed-primitive model from the previous plan revision (still committed in git history) — used *and labeled* as stylized.

**Step 2: Failing test** — `geometry.from_mesh(path, shape, L)` (via `trimesh` + `trimesh.voxel`): voxel volume within 10% of `mesh.volume` at target resolution; nose-upstream orientation applied; single connected solid component; frontal area (voxel-counted) recorded for Cd denominators.

**Step 3: Implement** `from_mesh` (load → scale longest axis to L cells → align → voxelize → fill interior). Keep procedural `sphere`, `cylinder`, `ahmed_body` (25° slant, Ahmed et al. proportions) — these are the *validation* bodies with published numbers; realistic meshes are the *showcase* bodies. The bird mesh must be checked for wing thickness ≥ 3 voxels at target L — if thinner, scale up L or locally thicken, noted in the report (blindspot #2: half-link error dominates thin geometry).

**Step 4:** For rendering: export each mesh (decimated if heavy) as `.glb` into `site/media/models/` for the site's three.js viewers, plus a side-profile silhouette PNG/polygon (mesh projection) for the 2D live sim's obstacle masks.

**Step 5:** Commit `feat: mesh-based realistic geometry pipeline (trimesh voxelization) + validation-shape library`. Add `trimesh` to requirements.

---

### Task 10: Sphere drag validation (headline 3D validation)

**Step 1: Failing test** (`@pytest.mark.slow`, ~10–20 min) — sphere D=16 in 160×80×80 domain, U=0.08, Re=100, run to steady Cd (~8k steps); Schiller–Naumann gives Cd=1.09; assert `0.8 < Cd < 1.4`.

**Step 3:** Frontal area for Cd is the voxel-counted projected area (not πr² of the ideal sphere) — voxelization makes this the honest denominator.

**Step 5:** Commit `feat: sphere drag validated vs Schiller-Naumann`.

**CHECKPOINT B:** `/usage` again. Decide: full gallery + report (Task 11–13), or minimal (Task 11 with 2 shapes, short report).

---

### Task 11: Realistic-object gallery (local compute burn — background)

**Files:** Create `run_shapes3d.py`.

**Step 1:** Runner: for each model — **Ahmed car (with ground plane), rocket, airplane (at ~5° angle of attack), ocean-liner hull, gliding bird** — at Re≈200 (and Re≈500 if time): run 20k steps in a **background Bash task**, saving every 100 steps: mid-plane velocity-magnitude + vorticity slices (the vertical center-plane and a horizontal plane through the body) as npz, plus Cd/Cl history csv. Domain ~200×96×96 (Ahmed body slightly wider). These runs take hours combined — that's the point; they cost no tokens while running.

**Physics to look for (goes in the report):** Ahmed body — separation bubble over the rear slant and the two counter-rotating trailing vortices it's famous for; rocket — blunt-base recirculation wake; airplane — pressure asymmetry giving nonzero lift (Cl > 0 at positive angle of attack, Cl ≈ 0 at 0°: that contrast is a real, assertable physics check); ship — bow stagnation and stern wake.

**Step 2:** While runs execute, proceed to Task 12 (2D sweep) and Task 13 scaffolding.

**Step 3:** When each finishes: `viz.render_3d_slices(...)` → side-by-side two-plane mp4 per object; Cd (and Cl for the airplane) table → `out/results.csv`. Ahmed-body Cd goes in the validation table against the published ≈0.26–0.29 with the Reynolds-number caveat stated. Verify each mp4 by reading one rendered frame.

**Step 4:** Commit `feat: realistic-object gallery runs + renders`.

**Optional Task 11b (only if user supplies or requests real mesh files):** STL import — add `trimesh` dependency, `geometry.from_stl(path, shape, L)` voxelizing any downloaded model (a real car/rocket STL). Skipped by default: new dependency + internet fetch for something the composed-primitive models already demonstrate. `# ponytail: composed primitives cover it; STL when a specific real mesh matters`

---

### Task 12: Two-car drafting study (the headline experiment)

Two racing cars close together — tandem (drafting) and side-by-side — showing how one car's airflow changes the forces on the other, then feeding those forces back into the cars' motion.

**Files:** Create `run_drafting.py`, `dynamics.py`. Modify `diagnostics.py` (momentum exchange must accept a *specific* mask so each car gets its own Cd/Cl even when both sit in one domain).

**12a: 2D gap sweep — the coupling map (cheap, minutes per run)**

2D car silhouettes (Ahmed-body side profile) over a ground plane, 700×200 grid. Tandem: gaps {0.25, 0.5, 1, 1.5, 2, 3}×L. Side-by-side (no ground, plan view): lateral offsets {0.25, 0.5, 1}×W. Each run logs Cd/Cl per car → `out/drafting_map.csv`.

**Failing test (the physics assert):** with the map built —
- `Cd_trailing(gap=0.25L) < 0.7 * Cd_isolated` (slipstream drag saving; literature shows 30–60% at close gap),
- `Cd_trailing(gap=3L)` within 15% of `Cd_isolated` (effect dies off with distance),
- side-by-side: lateral force magnitude on each car grows monotonically as offset shrinks.

**12b: Motion coupling — the drafting maneuver**

`dynamics.py`: two point-mass cars on a line, `m dv/dt = F_engine − ½ρv²A·Cd(gap)` with Cd(gap) interpolated from 12a's map (trailing car's Cd depends on gap; leading car's isolated). Same engine power both cars, trailing car starts 3L behind → integrate with `scipy`-free RK4 (~20 lines). Expected emergent behavior (assert it): the gap *closes on its own* — the trailing car sits in the slipstream, spends less power on drag, and reels the leader in. That's the coupled dynamic, from our own measured aero map. Output: gap-vs-time and speed-vs-time plots + an animation strip pairing car positions with the nearest-gap flow field snapshot.

**12c: 3D hero runs (background, budget/time gated)**

Two full 3D Ahmed bodies with ground plane: one tandem close-gap run, one side-by-side run (domain ~260×110×80). Center-plane vorticity videos showing the trailing car swallowed in the leader's wake. These are the showcase mp4s.

**12e: Bird formation study (3D, background — the aerial sibling of drafting)**

Why V-formations work: each wingtip sheds a trailing vortex; just outboard-behind the leader, the air is moving *upward*. A trailing bird positioned there gets free lift. This is inherently 3D — no 2D shortcut exists.

- **Go/no-go gate (cheap, runs first — blindspot #7):** single bird/wing must show Cl clearly above force noise at angle of attack and ≈0 at zero AoA. If lift doesn't clear the noise floor at this Re and wing thickness, stop — report that finding instead of burning hours of 3D compute on a formation run that cannot resolve the effect.
- **Baseline run:** one gliding bird, record its lift/drag and the wake: a cross-flow plane **0.5 wingspans** downstream (close, before viscous diffusion blurs the cores at this low Re) must show the counter-rotating wingtip vortex pair with upwash outboard of the tips (assert: vertical velocity > 0 outboard, < 0 between the tips — downwash). Also locate the *measured* upwash maximum in that plane.
- **Formation run:** three birds in triangular/V formation — leader + two trailing birds staggered ~1 wingspan back, each trailing bird's wingtip placed at the **measured upwash maximum** from the baseline (the vortex line drifts inboard/down at low Re; the textbook offset can miss it) — each with separate force accounting. **Expected result:** trailing birds' lift-to-drag ratio exceeds the isolated bird's; leader ≈ unchanged.
- **Rigor caveat, stated up front:** at our Reynolds (~200) and voxel resolution the effect may be small; the assert is on the *mechanism* (upwash present, trailing-bird benefit sign-positive). If the benefit is below measurement noise, the report says exactly that with the numbers — no watering down means no overclaiming either.
- Visuals: cross-flow plane animation showing the vortex pair, plus top-down and side vorticity slices of the full formation. Domain ~220×140×90.
- Output: per-bird L/D table (formation vs isolated) → `out/results.csv`; hero mp4.

**12f (explicitly out of scope tonight):** true moving-boundary LBM (masks translating/flapping through the lattice with Galilean-corrected bounce-back and cell refill) — this is what full flapping flight or within-run relative car motion would need. `# ponytail: aero-map + ODE captures drafting dynamics, fixed-wing gliding captures formation flight; moving boundaries when in-run motion matters`

**Commit** after each sub-part.

---

### Task 13: Interactive results site (primary user-facing deliverable)

A local, self-contained website in `site/` (open `site/index.html` in Chrome; no server, no internet needed). Two engines, one physics: the site embeds a **live WebGL D2Q9 LBM engine** for real-time 2D experiments, cross-validated against the Python engine, plus the precomputed validated results (3D gallery, benchmark tables) as data.

**REQUIRED SUB-SKILLS when building this task:** `example-skills:frontend-design` (aesthetic direction — invoke before writing any UI code), `dataviz` (before any chart/gauge/colormap), `web-design-guidelines` (compliance pass at the end).

**13a: In-browser LBM engine + self-checks**

- `site/lbm-gpu.js`: D2Q9 BGK as WebGL2 fragment shaders (float textures, ping-pong). Same algorithm, same equations as `lbm.py`. **Precision discipline (blindspot #8):** store population *deviations* f_i − w_i in the textures (raw f_i wastes the mantissa on the constant part); require `EXT_color_buffer_float`, and on fp16-only GPUs drop to an honest "visual-only mode — self-checks need full-precision GPU floats" banner rather than showing failing/fudged checks. CPU-JS fallback at reduced grid if WebGL2 unavailable entirely.
- **Golden-case protocol (blindspot #12):** Python exports 3 pinned cases as JSON into `site/` (Taylor–Green periodic = bulk physics; Poiseuille = walls; small cylinder = open BCs + forces), each with initial state, parameters, step count, expected observables, and fp32-justified tolerances. The self-check panel runs *those exact cases* — cross-validation is a button anyone can press, not a paragraph.
- **Failing test first (rigor bridge):** a "Self-checks" panel in the UI runs, live in the browser: (1) Taylor–Green decay rate vs analytic within 2%; (2) mass conservation drift < 1e-5; (3) cylinder Re=100 Strouhal within the same 0.14–0.20 band the Python engine passed. Panel shows measured-vs-target numbers and green/red status. The Python `out/results.csv` values are embedded for side-by-side comparison. If a check fails, the UI says so — never hide it.

**13b: The laboratory UI**

- **Presets** (one click, instantly running): "Vortex street", "Two cars drafting", "Side-by-side battle", "Airplane wing", "Bird formation (2D analogue — labeled as such; the real 3D study lives in the gallery)", "Design your own" (paint obstacles with the mouse).
- **Experiment controls** (sliders + numeric input, live): Reynolds number, inflow speed, car gap / lateral offset, obstacle size; **drag the cars with the mouse** and watch forces respond.
- **Live readouts:** per-car drag/lift gauges, rolling Cd-vs-time chart, current gap; the measured drag-reduction % vs the isolated baseline — the drafting effect as a big legible number.
- **Presentation controls:** field shown (velocity / vorticity / pressure / streamlines), colormap, simulation speed, pause/step/reset.
- **Guardrails, not lies:** slider clamps derive from the actual feasibility region (Ma² compressibility < 1%, tau > 0.55, grid cost — blindspot #3's triangle), and the UI explains a refusal in one sentence ("higher Reynolds needs a bigger grid — there's no free knob"). Rigor includes refusing to show garbage.
- **Drag transients (blindspot #9):** dragging an obstacle is a miniature moving-boundary problem — uncovered cells get equilibrium-refilled, which fires a pressure pop. Force readouts freeze/grey during a drag and for ~one domain flow-through after, with the reason in the ⓘ. The most-touched feature must never display spiking garbage numbers.
- **Realistic rendering (non-negotiable #4):** live 2D obstacles are true mesh-projected silhouettes (the actual car/bird outline, not boxes); each gallery entry pairs its flow video with an orbitable shaded 3D model (bundled three.js, `.glb` from Task 9) and states the voxel resolution the solver saw.
- Responsive layout, keyboard accessible, works at laptop sizes.

**13c: Layered explanations**

Every panel has an ⓘ: first a 2-sentence plain-language explanation (e.g. *"The trailing car hides from the wind inside the leader's wake — the same reason cyclists ride in a paceline"*), expandable to the full story with the actual equations and the measured numbers (KaTeX bundled locally or pre-rendered HTML math — no CDN). A "How this simulation works" page: collide-and-stream in plain language, then the full derivation-sketch, validation methodology, and the honest limitations list (2D live vs 3D precomputed, low-Mach, voxel boundaries, quasi-static coupling).

**13d: Precomputed results wing**

The validation table (every number from `out/results.csv`, no placeholders), the drafting Cd-vs-gap curve with the emergent catch-up trajectory from 12b, and the 3D gallery mp4s (Ahmed car, rocket, airplane, ship, tandem heroes) with per-video captions of what physics to look for. Videos load from `site/media/` as normal files.

**Step N:** Verify by driving it: open in Chrome (claude-in-chrome), run every preset, run the self-checks panel, screenshot each state, fix what's broken. Commit `feat: interactive results site`. Send `site/index.html` path + screenshots via SendUserFile.

---

### Task 14 (budget-gated): Suite extension

Only if Checkpoint B shows ≥ ~4% weekly budget left after Task 13:

- **Ising model** (`ising.py`): Metropolis on 128², temperature sweep 1.8→2.8; magnetization collapse + susceptibility peak; test: measured Tc within 3% of Onsager's 2.269. Video of spin domains coarsening.
- **N-body galaxy** (`nbody.py`): Barnes–Hut octree, 20k particles, two-disk collision; test: energy drift < 2% over the run with softening; mp4 of the merger.

Each follows the same loop: failing physics test → implement → validate → render → commit.

---

## Execution notes for the implementing agent

- Windows: use forward slashes in Python paths; ffmpeg is on PATH; **never** put a `C:` font path in an ffmpeg filter.
- Background runs: Bash `run_in_background=true`, one process per shape/Re, sequential within a family to avoid RAM contention (3D runs are ~1.6 GB each).
- Slow tests: `pytest -m "not slow"` in the inner loop; run slow ones once per task explicitly.
- If numpy 3D throughput is unusable (< ~0.5 MLUPS): first shrink grid, then and only then consider numba (`# ponytail: numba only if numpy measurably too slow`).
- All progress claims verified by observed effects: test output pasted, frame images Read, file sizes listed.
