# The Drafting Effect — a validated lattice-Boltzmann wind tunnel

Why does the second race car catch the first one? Why do geese fly in a V?
This project answers both with a fluid simulator built from scratch and
validated against exact and published answers before showing a single pretty
picture — then puts a live, cross-validated copy of the solver in your
browser.

**Open `site/index.html` in Chrome.** No server, no internet, no build step.

## What's here

| Piece | File(s) | Validation |
|---|---|---|
| D2Q9/D3Q19 BGK solver (numpy + optional numba, 20 MLUPS) | `lbm.py`, `lbm_fast.py` | Taylor–Green 2%, Poiseuille 2%, Couette, moment identities |
| Geometry: procedural + real-mesh voxelization (trimesh) | `geometry.py` | voxel volume vs mesh volume < 10% |
| Forces: exact half-way bounce-back momentum exchange | `diagnostics.py` | wall drag = body-force input to 1e-4 (Poiseuille balance) |
| Cylinder benchmarks | `run_cylinder2d.py` | Re=20 steady Cd in range; Re=100 St=0.1925 in lit. band |
| Sphere drag | `tests/` (slow) | Schiller–Naumann Cd=1.09 ± 25% |
| **Two-car drafting study** | `run_drafting.py`, `dynamics.py` | trailing-car saving vs platoon literature; emergent catch-up |
| **3-bird V-formation study** | `run_birds.py` | gated: lift resolvable → tip-vortex sign pattern → L/D benefit |
| 3D gallery: race car, Saturn V, airplane, ocean liner, bird | `run_shapes3d.py`, `assets/meshes/` | qualitative + Ahmed-body Cd reported vs 1984 experiment |
| Suite: Ising model, N-body galaxy merger | `ising.py`, `nbody.py` | Onsager Tc ± 3% (measured 0.91%); energy drift < 2% (measured ~0%) |
| **Interactive site** (live WebGL2 + CPU-fallback engine) | `site/` | same three golden cases pass in-browser; St identical to Python |

## Running

```bash
pip install -r requirements.txt
pytest -m "not slow"          # fast physics suite (~30 s)
pytest                        # + slow validations (cylinder St, sphere, Ising, N-body)

python run_cylinder2d.py clip # 2D production run + vortex-street mp4
python run_drafting.py        # gap sweep -> out/drafting_map.csv
python dynamics.py            # emergent catch-up from the measured map
python run_shapes3d.py        # 3D gallery (background-friendly, ~30 min/object)
python run_birds.py all       # V-formation study (gated)
python ising.py               # Tc sweep + coarsening video
python nbody.py               # 20k-particle galaxy merger

python tools/render_gallery.py    # npz -> gallery mp4s
python tools/export_golden.py     # golden cases -> site
python tools/build_site_data.py   # results + media -> site
node tools/test_js_engine.js full # browser engine physics, headless
```

## Honesty notes (also stated on the site)

- Real cars live at Re ~10⁷; these runs are Re ~10²–10³. Wakes, vortex
  streets, recirculation and drafting are genuine; the numbers are not
  engineering-grade aerodynamics and say so wherever they appear.
- Every force number carries its context: blockage ratio, voxel-counted
  frontal area, effective diameter (mask + half-link), mean ± std over the
  averaging window.
- The ship is fully immersed (wind-tunnel mode) — no free surface.
- The in-browser engine stores population deviations (f − w) to keep fp32
  honest, and refuses to fake self-checks on fp16-only GPUs.
- Mesh credits and licenses: `assets/meshes/LICENSES.md`, `site/media/CREDITS.md`.
