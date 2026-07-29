# HANDOFF — LBM fluid simulator

**Status: implementation essentially COMPLETE (2026-07-29 afternoon session).**
Spec: `docs/plans/2026-07-29-lbm-fluid-sim.md`. This file tracks what exists
and how to regenerate anything.

## What is built and validated (all committed)

- **Solver** `lbm.py` + `lbm_fast.py` (numba kernels, ~20 MLUPS 3D; numpy
  fallback). D2Q9 + D3Q19, half-way bounce-back (moving walls supported),
  velocity-shift forcing, equilibrium inlet / zero-gradient outlet.
- **Tests** `tests/test_lbm.py` — fast suite ~30 s (`pytest -m "not slow"`),
  slow suite: cylinder Re=100 St, sphere drag, Ising Tc, N-body energy.
  All passing as of this session; drafting-map asserts pass, the 3L-recovery
  band is a documented xfail (laminar wake persistence — see pre-mortem).
- **Key measured numbers**: cylinder Re=20 Cd≈2.3 steady; Re=100 St=0.1925
  (blockage 13.75%); isolated 2D car Cd=2.291±0.004; drafting map 0.25L→
  Cd 0.744 (68% saving), 3L→1.796; side-by-side |Cy| antisym, 5.66 at 0.25W;
  Ising Tc 2.2486 (0.91% off Onsager); N-body drift 0.001%/1500 steps.
- **Site** `site/index.html` (open directly in Chrome, no server): live
  WebGL2 D2Q9 engine (deviation storage) + CPU fallback; all three golden
  self-checks PASS in-browser (browser St 0.1925 == Python St exactly);
  6 presets incl. drag-the-cars; guardrail clamps; drafting/birds/gallery/
  validation sections fill from `site/data.js`.
- **Suite** `ising.py` (checkerboard Metropolis) + `nbody.py` (direct-sum
  numba gravity — deliberate deviation from planned Barnes-Hut, documented
  in the file header).

## Production runs (background pipelines this session)

- DONE: 2D cylinder clip (`out/cylinder_re100.mp4`), drafting tandem sweep,
  Ising sweep + coarsening video, N-body merger video.
- IN FLIGHT at last save: drafting side-by-side (2 of 3 offsets left),
  sphere slow test, bird study (gate→baseline→formation), 3D gallery
  (ahmed mid-run; car/rocket/airplane/ship/bird queued), hero 3D runs not
  yet started (`python run_hero3d.py`, run after gallery frees CPU).

## Regeneration pipeline (order matters)

```
python run_drafting.py            # -> out/drafting_map.csv
python dynamics.py                # -> out/dynamics.{csv,png}
python run_drafting.py snapshots  # -> out/drafting_snap_*.npz
python tools/make_drafting_strip.py
python run_shapes3d.py            # -> out/shape_*.npz + forces_*.csv
python run_hero3d.py              # -> out/shape_hero_*.npz
python run_birds.py all           # -> out/birds_*.json + plane npz
python tools/render_gallery.py    # npz -> out/shape_*.mp4
python tools/export_golden.py     # -> site/golden.js
python tools/build_site_data.py   # -> site/data.js + site/media/*
```

- NUMBA_NUM_THREADS: use ~6 per concurrent job on this 12-core box.
- Verify site by driving it (claude-in-chrome on http://localhost:8741 via
  `python -m http.server 8741` in site/ — the extension refuses file://; the
  page itself works from file://, verified headless).

## Sharp edges learned this session

- Momentum-exchange force: naive full-way-BB link formula over-reads ~2.2×;
  the exact check is Poiseuille wall-drag = g·N_fluid (a fast permanent test).
- Browser: hidden-tab timers are intensively throttled (1/min) — self-checks
  yield via MessageChannel; the render loop has a guarded setTimeout fallback.
- Mesh orientation: glTF Y-up/Z-long → lattice via axes=(2,0,1) permutation
  (+x flips for car/rocket/ship). AoA = mesh-frame rotate about X, +deg nose-up.
- fp32 GPU + thin gaps (car wheels vs road) blow up: cars sink 2 cells into
  the road on the site; tau floors at 0.555 in 3D runners (effective Re printed).
- Chrome headless min window ≈ 500px: narrower screenshots crop, not reflow —
  not a site bug.

## Remaining niceties (not blockers)

- Bird-study results were pending at last write — check `out/birds_*.json`,
  then `python tools/build_site_data.py` and reload the site.
- Hero 3D runs + their renders.
- Final Chrome walkthrough of every section with full data.
