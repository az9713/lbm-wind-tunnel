# HANDOFF — final state of the LBM wind-tunnel project

**Read this first each new session.** Spec source of truth:
`docs/plans/2026-07-29-lbm-fluid-sim.md`. Debugging doctrine:
`docs/pre-mortem.md` (consult before touching any red assert).

## Current state: COMPLETE + MVP race/theater (2026-08-01)

Original plan requirements met (2026-07-29). On **2026-08-01** the browser lab
gained two MVP features (commit `a9f12d4` and follow-ups on `main`):

| Feature | Where | What it is |
|---------|--------|------------|
| **Race — catch the leader** | §1 lab preset | Map-driven ODE (`site/race.js`) using measured Cd(gap) from drafting sweep; silhouettes re-stamp as gap closes; **not** full FSI |
| **Self-check theater** | §2 | **Run the show** runs Taylor–Green → Poiseuille → cylinder St with captions + series plots; **same tolerances** as the individual cards |

Status detail: `docs/plans/2026-08-01-MVP-IMPLEMENTATION-STATUS.md`  
Feature plan: `docs/plans/2026-08-01-live-drafting-selfcheck-theater.md`

### Headless checks for the new code

```bash
node tools/test_dynamics_parity.js    # JS ODE vs SITE_DATA.dynamicsMeta (~5%)
node tools/test_js_engine.js full     # TG + Poiseuille + Strouhal on CPU engine
```

Full Python suite (unchanged): **21 passed, 1 xfailed in 17m18s**
(`python -m pytest -q`; the xfail is the 3L drafting-recovery band, xfail by
design — laminar wakes genuinely persist further than turbulent ones).

Validated headline numbers (all also in the README table and the site's
validation ledger, every one measured, none asserted beyond its regime):
- Cylinder Re=100 St = 0.1925 (Python and in-browser WebGL2 engine identical)
- Sphere Re=100 Cd = 1.324 (Schiller–Naumann ±25% band)
- Drafting: 68% drag saving at 0.25L gap; emergent catch-up, timescale ratio 11.4
- 3D hero tandem: leader CdA=2.65 vs trailing CdB=1.62 (39% saving in full 3D)
- V-formation: trailing L/D 0.4077 / 0.4083 vs isolated 0.3920 (+4.0% / +4.2%),
  leader unchanged at 0.3925; gate Cl 1.081±0.106 at 6° vs 0.125±0.006 at 0°;
  wingtip vortex pair sign pattern confirmed (up outboard, down between tips)
- Gallery Cd (reported with regime, Re≈100–200 laminar): ahmed 2.62, car 2.41,
  rocket 2.16, airplane 2.41 (Cl 0.33), ship 2.48, bird 2.83
- Suite: Ising Tc 0.91% off Onsager exact; N-body drift 0.001%

## If you pick this up again

- Serve the site for browser work: `cd site && python -m http.server 8741`
  (the extension refuses `file://`; the page itself works from `file://`).
  **Chrome caches `app.js` aggressively — after editing site JS, hard-reload
  (ctrl+shift+r); a plain reload silently runs the old file.**
- Smoke the MVP: preset **Race** → Start → trailer closes → “caught”; §2
  **Run the show** → three green/red cards. For automation while the tab is
  occluded, `window.__lab_force_run=true` (turn off before screenshots).
- Race debug: `window.__lab.raceLive`, `window.__lab.raceMap`, `window.__lab.state`.
- Regenerate everything via the README pipeline (order matters), then
  `python tools/export_golden.py && PYTHONPATH=. python tools/build_site_data.py`.
- Explicitly out of scope (unchanged): true moving-boundary LBM — see plan §12f.
  Also deferred: live bodyForce race, side-by-side race, mesh drop, WebM record
  (see MVP status doc).

## Where to read things
- `README.md` — full run/regeneration pipeline (order matters).
- `docs/plans/2026-07-29-lbm-fluid-sim.md` — original day-of-build spec; honesty protocol is binding.
- `docs/plans/2026-08-01-live-drafting-selfcheck-theater.md` — race + theater plan.
- `docs/plans/2026-08-01-MVP-IMPLEMENTATION-STATUS.md` — shipped vs deferred.
- `docs/pre-mortem.md` — **four rows now CONFIRMED**; three of the four were
  axis/sign confusions in 3D geometry (force-scale over-read, lift-axis swap,
  gate control rotated about the wrong axis, formation placement sign error).
  In new 3D work here, suspect axis conventions first and check geometry
  cheaply (masks only, no solver) before spending hours of compute.
- `assets/meshes/LICENSES.md` + `site/media/CREDITS.md` — mesh attribution
  (CC-BY items MUST keep attribution wherever published).

## Session-transient scratch (durable record is the committed output)
- three.js bundle: built with esbuild in a scratch dir —
  `npm i three@0.160.1; npx esbuild entry.js --bundle --minify --format=iife`
  with `entry.js` hanging GLTFLoader + OrbitControls off `window`. Durable
  output is `site/vendor/three-bundle.js` (committed) — only rebuild if that
  file is lost or three.js needs upgrading.
- Frame eyeballing: `ffmpeg -y -ss 4 -i out/shape_<name>.mp4 -frames:v 1
  <scratchpad>/f.png` then read the png. Use an absolute `C:/...` path —
  an unset shell var silently retargets the write into the Git Bash prefix.
- No repo `CLAUDE.md`: conventions live in this file plus the plan's
  honesty protocol. Global user instructions still apply.

## How to work (essentials)
- Background runs: `NUMBA_NUM_THREADS=6` per concurrent job (12 cores).
- Verify by observed effects: read a rendered frame, run the asserts —
  never claim from a clean exit.
- Site testing: browser occlusion suspends rAF and throttles timers — the page
  idles when hidden by design; set `window.__lab_force_run=true` in automation
  to force stepping (turn it off before screenshotting — it starves the
  renderer); `window.__lab` exposes state/render/race handles.
