# MVP implementation status — race + self-check theater

**Date:** 2026-08-01  
**Status:** shipped on `main` (feature commit `a9f12d4`; docs refresh follow)  
**Plan:** `docs/plans/2026-08-01-live-drafting-selfcheck-theater.md`

## Implemented (MVP)

### A. Live drafting race
| Item | Status |
|------|--------|
| `site/race.js` — port of `dynamics.py` (RK4, map load, full simulate, live stepper) | Done |
| Preset **Race — catch the leader** | Done |
| Map-driven ODE from `SITE_DATA.drafting` | Done |
| Visual re-stamp when Δgap ≥ 0.05 L | Done |
| Race HUD: gap, t, v_trail, timescale ratio, status | Done |
| Start / Pause / Reset controls | Done |
| gap(t) live chart (Fig. 3 in race mode) | Done |
| Honesty caption (map-driven, not FSI) | Done |
| §3 link “Play the catch-up” | Done |
| Headless parity vs `dynamicsMeta` (~5%) | Done (`tools/test_dynamics_parity.js`) |

### B. Self-check theater
| Item | Status |
|------|--------|
| “Run the show” sequential three acts | Done |
| Captions per act | Done |
| Progress bar + series chart (KE / profile / Cl) | Done |
| Same tolerances as individual cards | Done |
| Updates §2 cards + validation ledger | Done |
| `selfcheck.js` returns `series` for theater (backward compatible) | Done |

### Documentation (this refresh)
| Item | Status |
|------|--------|
| README What’s here / Running / Docs / honesty note for Race | Done |
| HANDOFF current state, smoke path, `__lab` race handles | Done |
| This status file + plan checklist marked shipped | Done |
| Journey epilogue (2026-08-01) in `docs/journey.src.html` → rebuild `journey.html` | Done |
| `demo.html` blurb | Done |
| Site masthead meta line date note | Done |

### Tests run (agent, at ship)
| Command | Result |
|---------|--------|
| `node tools/test_dynamics_parity.js` | all PASS (t_end err ~0.03%, ratio ~11.36) |
| `node tools/test_js_engine.js fast` | TG + Poiseuille PASS |
| `node tools/test_js_engine.js full` | + Strouhal St=0.1925 PASS |

## Not implemented (out of this MVP / deferred)

| Item | Why |
|------|-----|
| Live `bodyForce`-driven race (v2) | Explicitly later; needs force smoothing / moving boundary |
| True moving-boundary LBM (§12f) | Out of plan scope |
| Side-by-side race | Lateral map incomplete in browser path |
| First-run full-screen theater modal | Chose §2 enhancement |
| In-browser WebM record / mesh drop / mobile polish | Product polish, later |
| Automated Chrome/playwright visual test | Not in repo; manual hard-reload recommended |
| GPU-only theater path differences | Uses same SelfCheck factories |

## Manual smoke (owner, optional)
1. Serve `site/` (`python -m http.server 8741` from `site/`)
2. Hard-reload (Ctrl+Shift+R)
3. Preset **Race** → Start → trailer closes → “caught”
4. §2 **Run the show** → three green/red cards

## Files (feature + docs)
- Feature: `site/race.js`, `site/app.js`, `site/index.html`, `site/style.css`, `site/selfcheck.js`, `tools/test_dynamics_parity.js`
- Docs: `README.md`, `HANDOFF.md`, this file, plan file, `docs/journey.src.html` / `journey.html`, `demo.html`
