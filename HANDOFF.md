# HANDOFF — resume point for the LBM wind-tunnel project

**Read this first each new session.** Spec source of truth:
`docs/plans/2026-07-29-lbm-fluid-sim.md`. Debugging doctrine:
`docs/pre-mortem.md` (consult before touching any red assert).

## Current state (as of commit d868dd5, 2026-07-29 ~12:20; local repo, NO remote)

Implementation is COMPLETE except for background compute still finishing.
Everything is committed; working tree clean.

DONE and validated (numbers in README.md table + site validation ledger):
- Solver (`lbm.py` + numba `lbm_fast.py`, ~20 MLUPS), all fast tests pass
  (`pytest -m "not slow"`, ~70 s), slow tests passed this session:
  cylinder St=0.1925, sphere Cd=1.324 (PASS), Ising Tc 0.91% off, N-body
  drift 0.001%.
- Drafting study complete: map (68% saving at 0.25L), dynamics (emergent
  catch-up, ratio 11.4), strip, side-by-side; tests green (3L band = xfail
  by design, laminar physics).
- Site `site/index.html` feature-complete; in-browser GPU self-checks PASS
  (St identical to Python). Serve via `cd site && python -m http.server 8741`
  for browser automation (extension refuses file://; the page itself works
  from file://).
- 3D gallery: ahmed (Cd=2.62) and car (Cd=2.41) done + mp4s rendered.
- Suite: ising.py, nbody.py + videos.

RUNNING in two background pipelines (started ~12:05, ~2h total; logs
`out/pipe1.log` / `out/pipe2.log`; marker files `out/PIPE1_DONE` /
`out/PIPE2_DONE` appear when finished):
- P1: gallery rocket → airplane → ship → bird, then tools/render_gallery.py.
- P2: bird study gate → baseline → formation (`run_birds.py all`, fixed
  lift axis; pre-restart gate measured Cl=1.08±0.11 at 6° AoA so it will
  pass), then `run_hero3d.py` (tandem + side 3D Ahmed pairs).
- If a pipeline died (no marker, no python process burning CPU): rerun the
  commands above; every runner is idempotent and skips nothing dangerous.

## Next task (start here)

**When both PIPE markers exist:**
1. `python tools/export_golden.py && PYTHONPATH=. python tools/build_site_data.py`
2. Reload site (http.server as above) — verify §4 Bird formation and §5
   gallery cards fill with real numbers/videos; check `out/birds_formation.json`
   `benefit_sign_positive` and report it exactly as measured (sign claim only).
3. `python -m pytest -q` full suite once (slow included) for the record.
4. Extract one frame from a new gallery mp4 (e.g. airplane) and eyeball it.
5. Final commit. Goal condition = all plan requirements met; then update
   auto-memory (`lbm-fluid-sim-project.md` still says "planned" — fix it).

## Where to read things
- `README.md` — full run/regeneration pipeline (order matters).
- `docs/plans/2026-07-29-lbm-fluid-sim.md` — spec; priority ladder §"Priority
  order"; honesty protocol is binding.
- `docs/pre-mortem.md` — two rows already CONFIRMED (force-scale bug,
  lift-axis swap); read before debugging any assert.
- `assets/meshes/LICENSES.md` + `site/media/CREDITS.md` — mesh attribution
  (CC-BY items MUST keep attribution wherever published).

## Session-transient scratch (regenerate if needed; durable outputs committed)
- three.js bundle: built with esbuild in a scratch dir —
  `npm i three@0.160.1; npx esbuild entry.js --bundle --minify --format=iife`
  wrapping GLTFLoader+OrbitControls onto window; durable output is
  `site/vendor/three-bundle.js` (committed).
- Poiseuille force-balance scratch check became the permanent test
  `test_momentum_exchange_balances_body_force` — nothing else worth keeping.

## How to work (essentials)
- Background runs: `NUMBA_NUM_THREADS=6` per concurrent job (12 cores).
- Verify by observed effects: read a rendered frame, run the asserts —
  never claim from a clean exit.
- Site testing: browser occlusion suspends rAF and throttles timers —
  the page idles when hidden by design; set `window.__lab_force_run=true`
  in automation to force stepping; `window.__lab` exposes state/render.
