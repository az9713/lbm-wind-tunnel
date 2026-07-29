# HANDOFF — resume point for the LBM fluid simulator

**Read this first each new session.** No `CLAUDE.md` exists yet; the spec source of truth is `docs/plans/2026-07-29-lbm-fluid-sim.md`.

## Current state (as of 2026-07-29, ~7am PT)
- **Planning is complete; zero code written.** No tests, no `requirements.txt` installed, no meshes downloaded.
- The implementation plan (`docs/plans/2026-07-29-lbm-fluid-sim.md`) went through five user revision rounds and is final: validated D2Q9/D3Q19 BGK solver → two-car drafting study (Cd(gap) map + quasi-static ODE dynamics) → 3-bird V-formation study → realistic-mesh object gallery (car, rocket, airplane, ocean liner, bird via trimesh voxelization) → interactive WebGL results site with in-browser self-checks. Four user non-negotiables are at the top of the plan (rigor / interactive attractive site / configurable everything / realistic geometry+rendering) — treat them as binding.
- `2026-07-29-lbm-fluid-sim.md` at repo root is a **snapshot copy** the user asked for; the `docs/plans/` file is the original. If they diverge, `docs/plans/` wins; refresh the root copy after edits.
- `docs/2026-07-29-blindspot-pass.md` holds the blind-spot survey; its findings are already folded into the plan's "Measurement & honesty protocol" section (binding on all tasks — pre-mortem before first slow test, blockage/effective-diameter reporting, mean±std force protocol, moving-wall floor, golden-case cross-validation, fp16 fallback, drag-readout freezing).
- Git repo initialized this session (plan Task 0 partially done: init yes; requirements/scaffold no). No remote — local only; nothing to push.
- `.ignore/` directory at root is pre-existing user noise — leave untracked.

## Next task
- **Get the user's execution-mode decision, then start plan Task 0.** The pending question (asked three times, never answered): execute **subagent-driven in this session** (recommended) or in a **parallel session** via `superpowers:executing-plans`. Once answered: Task 0 (scaffold, `.gitignore`, `requirements.txt`: numpy/matplotlib/pytest, later trimesh) → Task 1 (D2Q9 + equilibrium, TDD) per the plan. Run the **pre-mortem** (see plan's Measurement & honesty protocol) before the first slow test (Task 5's Re=20 run).
- **Budget context that motivated this project (time-sensitive):** user wanted to burn remaining weekly credits before the reset **Jul 29 8pm PT** (weekly all-models was 90% used at ~6am, the binding constraint; Fable bucket 50%). After that reset this urgency is void — if resuming post-reset, ask the user whether the project continues under normal budget discipline. Priority ladder under pressure is in the plan header: solver → drafting → site → 3D gallery → suite.

## Where to read things (reference, don't re-derive)
- `docs/plans/2026-07-29-lbm-fluid-sim.md` — full spec: tasks 0–14, validation table with tolerances, physics cheat sheet, non-negotiables, priority ladder, budget checkpoints (after Task 7 and Task 13: user pastes `/usage`).
- `docs/2026-07-29-blindspot-pass.md` — why-a-test-fails reference (bug vs systematic vs real physics); consult before debugging any red assert.

## Session-transient scratch
- None. The blind-spot agent's output is fully captured in `docs/2026-07-29-blindspot-pass.md` (its task output file was empty — content arrived via notification and was transcribed).

## How to work (essentials)
- Ponytail full is the user's standing default (minimal diff, stdlib-first) — but the plan's non-negotiables override where they conflict; rigor and the site's polish are explicitly requested, not gold-plating.
- TDD per plan: failing physics test → implement → pass → commit, each task. Slow tests marked `@pytest.mark.slow`, excluded from the inner loop.
- Long 3D runs go in background Bash tasks (zero tokens while running); sequential within a family (~1.6 GB RAM each).
- Verify by observed effects: pasted test output, Read rendered frames, file sizes — never a clean exit alone.
- Required sub-skills when building the site: `example-skills:frontend-design`, `dataviz`, `web-design-guidelines`; verify by driving it in Chrome (claude-in-chrome).
