# Implementation plan: Live drafting race + Self-check theater

**Date:** 2026-08-01  
**Status:** draft  
**Repo:** this repository (`lbm-wind-tunnel`)  
**Goal:** Make the README headline playable (#1) and make trust a spectacle (#2), without breaking the honesty protocol.  
**Non-goals (this pair):** true moving-boundary LBM (plan section 12f), free-surface ship, fake high-Re.

---

## Design principles (binding)

1. Every displayed race/self-check number traces to a measured path (live force or pre-validated map).
2. Quasi-static race mode must show the **timescale ratio** (gap-close vs wake-convection) whenever it uses the aero map.
3. Self-checks never hide a red result; theater is presentation, not softer tolerances.
4. Prefer browser-only work that reuses `site/lbm-gpu.js`, `site/lbm-cpu.js`, `site/selfcheck.js`, `site/app.js`.
5. Python remains source of truth for goldens; browser must still pass `node tools/test_js_engine.js full`.

---

## Feature A — Live drafting race

### What the user experiences

- New lab mode/preset: **Race**.
- Two cars, identical engine force \(F_e = \tfrac12 C_{d,\mathrm{iso}} A U_{\mathrm{ref}}^2\).
- Trailer's Cd comes from a coupling strategy (MVP vs v2 below).
- Positions update over time; gap(t) chart + "caught!" banner when gap is at or below closest mapped gap.
- Gauges: Cd A/B, saving %, gap (L), speeds, timescale ratio.

### Coupling strategies

| Mode | Physics | Feasibility | Honesty note |
|------|---------|-------------|--------------|
| **MVP: map-driven ODE** | Cd(gap) from `SITE_DATA.drafting` / `dynamics.py` logic, integrate in JS each frame; **flow field can stay fixed or only re-stamp obstacles periodically** | High — reuses measured map | Same as offline dynamics; show timescale ratio |
| **v1.5: periodic re-stamp** | ODE moves cars; every N frames rebuild obstacle masks at new gap, reinit or keep flow | Medium | Wake partially tracks motion |
| **v2: live force-driven** | Each frame: `bodyForce` to Cd to net accel to move masks with refill or hard re-stamp | Hard without moving-boundary LBM | Closest to "true" race; may need force smoothing |

**Recommendation:** ship **MVP map-driven race with visual re-stamp of silhouettes**, not true fluid-structure interaction. Call it what it is: *"emergent catch-up from the measured aero map, with live wake visualization at the current gap."*

### MVP scope

**New / touched files**

| File | Change |
|------|--------|
| `site/app.js` | Preset `race`; race state machine; ODE integrator (port of `dynamics.py`); gap chart; UI bindings |
| `site/index.html` | Race preset button; race controls (Start / Reset / Pause race); gap(t) chart container; honesty caption |
| `site/style.css` | Race HUD (gap, speeds, caught banner) |
| `site/data.js` | No hand-edit — regenerated; ensure `drafting` + `dynamics` meta already present (they are) |
| Optional `site/race.js` | Extract ODE if `app.js` grows past comfort |

**Logic (port from `dynamics.py`)**

```
load tandem B Cd(gap) + isolated Cd from SITE_DATA.drafting
F_e = 0.5 * Cd_iso * A * 1^2   (nondim: L=1, V_ref=1)
integrate: m dv/dt = F_e - 0.5 * Cd(gap) * A * v^2 for trailer
           leader uses Cd_iso
visual: place silhouettes at x1(t), x2(t) on the road; re-stamp obst every race visual tick
optional: rebuildEngine(keepFlow=false) only when gap changes by > 0.05 L (avoid thrashing)
```

**UI**

- Preset button: `Race — catch the leader`
- Controls: Start race | Reset to gap0 | mass (optional advanced)
- Defaults: gap0 = 3 L (or max available map gap), m = 50 (match Python)
- Live: gap(t) line chart (reuse `lineChart`), Cd gauges, saving gauge
- On catch: freeze or hold station; show `timescale_ratio` from live integration (t_close / gap0)

**Validation gates (must pass before "done")**

| # | Gate | How |
|---|------|-----|
| R1 | Map loads | Isolated + at least 3 tandem-B gaps present in `SITE_DATA.drafting` |
| R2 | Parity with Python | At default params, JS `t_end`, `gap_end`, `caught` within ~5% of `DATA.dynamicsMeta` / offline `dynamics.py` |
| R3 | Honesty caption | Timescale ratio displayed and roughly >= 5 (else banner: "quasi-static assumption weak") |
| R4 | No silent NaNs | Existing nanStrikes path still resets; race mode does not bypass |
| R5 | Manual play | Start → trailer closes → caught; Reset restores gap0 |

**Out of MVP**

- Side-by-side race (lateral force map incomplete in browser)
- Live Cd from bodyForce driving the ODE without the map
- True moving boundaries / Galilean-corrected bounce-back

### v2 (later)

- Drive trailer force from rolling-mean `bodyForce(3)` while cars crawl; still re-stamp masks (no full refill).
- Compare live Cd(gap) curve to map mid-race (overlay).
- Optional light "leader AI" throttle so race ends in 20–40 s wall time on GPU.

---

## Feature B — Self-check theater

### What the user experiences

- In section 2 (or a full-screen overlay): **Run the show**.
- Three acts with narration + live mini-visual + progress:
  1. Taylor–Green — KE decay curve draws toward target rate
  2. Poiseuille — profile builds toward parabola
  3. Cylinder St — Cl(t) + spectrum peak lands in band
- Final curtain: green/red cards with measured vs target (same numbers as today — not softer).

### MVP scope

**Existing assets to reuse**

- `site/selfcheck.js` — already returns progress callbacks + pass/fail
- `site/app.js` — already wires self-check UI (see checks section)
- `site/golden.js` — Python targets
- `tools/test_js_engine.js` — headless parity (must stay green)

**New / touched files**

| File | Change |
|------|--------|
| `site/selfcheck.js` | Optional richer progress payloads: intermediate series samples (KE, profile, Cl) for plotting — **backward compatible** |
| `site/app.js` | Theater UI controller: stages, captions, charts, "Run the show" |
| `site/index.html` | Theater stage markup (canvas/SVG strip + caption + progress) |
| `site/style.css` | Stage layout, pass/fail drama without hiding fail |
| `tools/test_js_engine.js` | Only if selfcheck API changes; keep existing assertions |

**MVP narrative copy (short)**

1. "Bulk physics only — energy should die at rate \(2\nu k^2\)."
2. "Walls matter — channel flow must become a parabola."
3. "Open tunnel + force — shedding frequency must hit the Python St band."

**Validation gates**

| # | Gate | How |
|---|------|-----|
| S1 | Same tolerances | Theater uses identical pass criteria as current self-checks / golden |
| S2 | Headless still green | `node tools/test_js_engine.js full` |
| S3 | Fail is visible | Force a wrong tol in dev → red card, no auto-retry that hides it |
| S4 | Progress usable | Act never freezes UI; yields already exist via MessageChannel |
| S5 | Occlusion | With `__lab_force_run` or theater-local force, checks complete if tab throttled (document in HANDOFF) |

**Out of MVP**

- Replacing section 2 static table entirely (keep table + theater)
- Adding new golden cases (sphere 3D etc. — too slow for browser theater)
- Sound effects (nice later)

### v2 (later)

- Side-by-side "Python golden curve" vs "browser live curve"
- One-click export of a self-check receipt (JSON: engine, grid, measured, pass)
- Continuous smoke: theater runs on first visit if never run this session

---

## Suggested implementation order

```
Phase 0  Read & spike (0.5 day)
  - Confirm SITE_DATA.drafting + dynamicsMeta shape in site/data.js
  - Port dynamics.simulate() to a pure JS function with a tiny node/browser test

Phase 1  Race MVP (1–2 days)
  - race.js or app.js ODE + preset + HUD + gap chart
  - Visual re-stamp at current gap (static wake OK)
  - Gates R1–R5

Phase 2  Theater MVP (1 day)
  - Stage UI + captions + series plots from selfcheck progress
  - Gates S1–S5

Phase 3  Polish (0.5 day)
  - Scenario entry points from section 3 drafting prose ("Play the catch-up")
  - Accessibility: keyboard Start/Reset, aria-live for caught / check results
  - Manual Chrome pass on GPU + CPU fallback paths

Phase 4  (optional) Race v1.5 re-stamp throttle + live Cd overlay
```

**Total MVP estimate:** ~3–4 focused days, mostly `site/` JS/HTML/CSS. No Python production runs required if `data.js` already has the map (it does).

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Users think race is full two-way FSI | Caption + timescale ratio; wording "map-driven" |
| Re-stamp every frame kills GPU | Throttle re-stamp to gap change > 0.05 L or 10 Hz |
| Theater timeouts on CPU engine | Shorter TG/Poiseuille params for CPU path only — **document**; St may stay long with clear ETA |
| app.js bloat | Extract `race.js` / `theater.js` if either > ~200 lines |
| Honesty protocol drift | Any new number needs a row in validation ledger or explicit "demo only" label |

---

## Done definition (ship checklist)

- [ ] Race preset playable on GPU and CPU fallback
- [ ] JS dynamics parity check vs Python meta
- [ ] Timescale ratio always shown in race mode
- [ ] Theater runs all 3 acts; red/green honest
- [ ] `node tools/test_js_engine.js full` pass
- [ ] Manual: hard-reload after JS edits (Chrome cache note in HANDOFF)
- [ ] README one-liner + optional journey.html footnote only if you want marketing sync

---

## Decision needed from owner (only if disagreement)

Default if no reply: **MVP map-driven race + theater**, not live force FSI.

1. Race coupling: **map ODE (recommended)** vs live bodyForce
2. Ship theater as section 2 enhancement vs separate full-screen first-run modal
3. Whether to open a PR on `github.com/az9713/lbm-wind-tunnel` after MVP

---

## Origin

Planned in Buzz channel `lbm-wind-tunnel` (2026-08-01). Companion nest copy: `PLANS/LBM_LIVE_DRAFTING_AND_SELFCHECK_THEATER.md` in the Buzz workspace.
