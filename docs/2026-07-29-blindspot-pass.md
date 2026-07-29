# Blindspot pass: LBM fluid simulation project (solver + drafting/formation studies + WebGL site)

> Generated 2026-07-29 by the blind-spot-pass skill, grounded in `docs/plans/2026-07-29-lbm-fluid-sim.md`.

## Core thesis

The solver will almost certainly *work*. The danger is not crashing code — it is **systematic errors that produce plausible-looking wrong numbers, and regime mismatches that make correct numbers mean less than they appear to**. LBM at Re 100–1000 on a voxel grid is a different physical world from real cars at Re 10⁷. Several quantitative assertions (drafting 30–60% savings, monotone side forces, V-formation benefit) implicitly borrow expectations from the *high-Re turbulent* literature into a *low-Re laminar* simulation. The blindspots below are mostly about knowing, before a test fails or falsely passes, **which discrepancies are bugs, which are known systematic biases, and which are genuine physics differences.**

## False framing to correct

> "If the validation tests pass, the drafting and formation numbers are trustworthy."

Passing Taylor–Green, Poiseuille, and cylinder benchmarks proves the *solver* solves the equations it claims to solve. It does **not** prove the *experiments* answer the questions being asked. The drafting map and bird study carry three extra layers of error the benchmarks never test: confinement (walls too close), regime mismatch (laminar wake vs turbulent wake), and coupling approximation (steady-state force map driving a dynamic maneuver).

## First-order blindspots

### 1. Blockage: the domain walls are part of the experiment
Blockage ratio = obstacle frontal size / channel cross-section. Re=20 cylinder: D=20 in ny=160 → 12.5% blockage → systematic +10–20% on Cd vs unbounded literature. Report every Cd with its blockage ratio. Amplified in 3D (sphere D=16 in 80×80) and side-by-side runs (two cars ≈ double blockage).

### 2. The wall isn't where the mask says (half-link boundary + staircase)
Half-way bounce-back puts the effective wall ~half a cell outside the boolean mask: a "D=20" cylinder behaves like D≈21 (≈5% Re shift). Large *relative* error for thin geometry (bird wings a few voxels thick, underbody gaps). BGK bounce-back wall position also drifts slightly with tau. Report a consistent effective diameter.

### 3. The stability–accuracy–cost triangle
Low-Mach limit (U ≲ 0.1), stability (tau comfortably > 0.5), Re = U·D/ν with ν=(tau−0.5)/3. Fix Re and D → U and tau are locked. Higher Re requires a bigger obstacle in cells → bigger grid → more compute. No free knob. This formula belongs behind the UI slider clamps, with a one-sentence explanation when a combination is refused. Re 10⁷ is out of scope for plain BGK entirely, not just "tonight".

### 4. Drafting expectations come from the wrong Reynolds regime
30–60% trailing-car reduction figures are high-Re turbulent platoon results. At Re≈200 the laminar wake mixes less and lives longer: drag reduction may be *larger* and decay *slower* — the "recovered to within 15% of isolated at 3L gap" assert is the one most likely to fail *for physics reasons, not bugs*. Tandem bluff bodies at low Re can also show non-monotonic/lock-in behavior, and the **leader's** drag typically drops at close gap too (worth reporting).

### 5. Unsteady wakes make forces distributions, not values
Above Re≈47 the wake sheds; Cd oscillates forever — only its cycle-average converges. Protocol: detect end of transient (which also includes the impulsive-start pressure wave bouncing off the outlet), average over an integer number of shedding periods, report mean ± std, write asserts with noise-aware margins. The trailing body sits in an oscillating wake → largest fluctuations, longest averaging.

### 6. Quasi-static coupling in the drafting ODE has a validity condition
Using steady-state Cd(gap) inside a dynamic ODE assumes the wake re-adjusts faster than the gap changes. Compute and report the ratio (gap-closing timescale / wake-convection timescale) — if ≫ 1, the approximation is defensible and *stated*; the map is also 2D (silhouettes), so label the dynamics a 2D analogue.

### 7. The bird study's enemy is viscous diffusion; order the asserts as a go/no-go cascade
At Re≈200 a wingtip vortex core diffuses fast; one span downstream it may be a blur, and a thin voxel wing may only reach L/D ≈ 2–5 (not a real bird's ~15). Cascade: (1) single wing shows Cl > 0 at AoA, ≈0 at zero AoA — cheap, run first; (2) vortex pair sign pattern at 0.5 span downstream (closer, before diffusion); (3) only then the 3-bird run — and place trailing birds at the *measured* upwash maximum from the baseline run (the vortex line moves inboard/down as it evolves), not at the textbook position.

### 8. WebGL twin: fp16/fp32 precision fails self-checks before the math does
WebGL2 float-texture *rendering* needs `EXT_color_buffer_float`; some GPUs only render half-float (~3 decimal digits). Populations sit at w_i ± tiny — store *deviations* f_i − w_i to reclaim mantissa bits. Detect the extension; on fp16-only hardware fall back honestly ("self-checks require full-precision GPU floats; visual-only mode"). Define Python-vs-JS comparison tolerances up front.

### 9. Mouse-dragging obstacles IS the moving-boundary problem
Uncovered cells have no valid populations; equilibrium refill fires a pressure pop; teleporting masks fires a small explosion; bounce-back ignores wall velocity. Acceptable for a toy — but force gauges will spike during/after drags. Freeze/grey the force readouts during a drag plus ~1 domain flow-through afterwards, with the reason in the ⓘ. Otherwise the most-touched feature displays garbage numbers.

### 10. The ground plane grows its own boundary layer
A no-slip floor's boundary layer thickens like √(νx/U); at Re≈200 it can rival the cars' ground clearance by the time flow reaches the (especially trailing) car, choking underbody flow. Options: free-slip floor, **moving-wall bounce-back floor (best match to a car on a road — road moves at inflow speed in the car's frame)**, or no-slip with caveat. Choose deliberately and state it.

### 11. The measurement pipeline needs the same rigor as the solver
Half the validation table is measurements. Test diagnostics in isolation with analytically known inputs: Strouhal-FFT on synthetic sines (with noise/transient/leakage; Hann window), per-body momentum-exchange link partitioning on two nearby squares, transient-detection heuristic. Diagnostics bugs are cheaper to find than solver bugs — look there first.

### 12. Two engines drift apart without a pinned protocol
Export 2–3 golden cases from Python (initial field + parameters + expected observables as JSON; cover bulk physics / walls / open BCs), ship them into `site/`, have the self-check panel run those exact cases. "Cross-validated" becomes a button, not a paragraph.

## Rat-hole warnings

Do **not** start with: collision-operator upgrades (MRT/TRT/regularized), GPU-accelerating the Python engine, or (before the physics works) mesh-import perfectionism. None are the bottleneck at these Re. On the site: do not polish colormaps before the self-check panel and readout-freezing exist — a gorgeous demo showing spiking garbage forces violates non-negotiable #1.

## Highest-yield next action

**Pre-mortem the validation table before the first slow test:** for each assert, list (a) the most likely BUG cause of failure, (b) the most likely legitimate PHYSICS/DISCRETIZATION cause (blockage, effective diameter, laminar regime, force noise, fp precision), and (c) the cheapest discriminating check. Rank by false-alarm probability; flag tolerances that are too tight or uselessly loose.
