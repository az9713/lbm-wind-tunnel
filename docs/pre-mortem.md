# Pre-mortem: why each validation row might fail

Consulted before debugging any red assert. Per row: most likely BUG cause,
most likely legitimate PHYSICS/DISCRETIZATION cause, cheapest discriminating check.

| Row | Likely BUG | Likely PHYSICS/DISCRETIZATION | Cheapest discriminating check |
|---|---|---|---|
| Equilibrium moments | weight/velocity table typo, wrong einsum axis | none — exact identity | print Σw, Σw·c, Σw·cc (must be 1, 0, ⅓δ) |
| Taylor–Green decay | wrong ν(τ) relation, energy fit over transient | compressibility at too-high u0 | halve u0: bug unchanged, compressibility error shrinks 4× |
| Poiseuille | forcing scheme factor (τ vs τ−½), wall at wrong offset | half-way wall location off by ½ cell in analytic h | compare shapes normalized to peak (kills prefactor); vary ny |
| Cylinder Re=20 Cd | **momentum-exchange formula scale/timing** (CONFIRMED 2026-07-29: full-way BB + naive link formula over-read 2.18×; fixed via half-way BB + exact Ladd pairing) | blockage (D_eff/ny≈14%) raises Cd 15–30% over unbounded 2.0–2.2 | Poiseuille wall-drag balance: F must equal g·N_fluid exactly |
| Re=100 Strouhal | FFT on transient, wrong D_eff in St | outlet reflection contaminating shedding; τ near 0.5 noise | synthetic-sine strouhal test; lengthen domain, St shift <5% = physics |
| Sphere Re=100 Cd | frontal area denominator (ideal πr² vs voxel count) | voxelization surface roughness, blockage in 80² cross-section | recompute Cd with both areas; ratio explains gap or not |
| Ahmed body Cd | slant angle wrong in voxel build | Re 4 orders below experiment — laminar wake ≠ turbulent | report only; sanity band 0.2–1.0 |
| Drafting close-gap | per-body link partition mixing the two cars' forces | gap too small for grid (< 5 cells) merges wakes numerically | two-square link-partition unit test; count gap cells |
| Drafting 3L recovery | domain too short — trailing car sits in outlet zone | laminar wakes decay slower than turbulent: 15% band may be real physics | double domain length: bug moves the number, physics doesn't |
| Drafting dynamics | interpolation outside measured gap range | quasi-static assumption invalid (timescale ratio ~1) | print gap-closing time / wake-convection time; need ≫1 |
| Bird wake signs | y/z axis swap in cross-plane extraction (CONFIRMED 2026-07-29, variant: `coefficients()` returned F[1]=side force as "lift" in 3D — bird gate read Cl≈0±noise at 6° AoA; fixed to F[-1]=up axis, gate rerun) | vortex cores diffused at Re≈200 before sample plane | sample at 0.25 spans too: closer = stronger if physics |
| V-formation L/D | per-bird force accounting cross-contamination (CONFIRMED variant 2026-07-29: gate's zero-AoA control counter-rotated about **y** while AOA pitches about **x** — control still flew at ~6°, Cl_zero≈Cl_aoa, gate failed; discriminated by mask chordwise-slope check (−4.34° vs +0.89°), fixed to `("x", -AOA)`) | benefit below force noise floor at this Re/resolution | go/no-go gate: single-wing Cl at AoA must clear noise first; pitch-check masks geometrically before running |
| Ising Tc | Metropolis acceptance sign, missing J/kT | finite-size shift of apparent Tc (~+1% at 128²) | susceptibility peak vs Binder crossing agreement |

General rules learned so far:
- Force-measurement pipeline is the first suspect for any Cd/Cl anomaly — it has
  an exact self-check (Poiseuille balance) that takes seconds. Run it first.
- A steady-but-wrong number is a scale bug; a noisy number is transient/regime.
- When a tolerance fails marginally, vary the domain/grid before touching physics:
  numbers that chase the grid are discretization, numbers that stay put are bugs.
