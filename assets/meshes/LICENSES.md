# Mesh provenance and licenses

All five meshes below are freely redistributable. Three are CC0 (public domain, no
attribution required); two are CC-BY 3.0 and **must** carry the attribution text given
below wherever the rendered output is published. The same information, formatted as a
public-facing credits page, lives in `site/media/CREDITS.md`.

Downloaded 2026-07-29.

---

## car.glb — racing car

- **Source pack**: Kenney "Car Kit" (v1.1), model file `Models/GLB format/race.glb`
- **Pack URL**: https://kenney.nl/assets/car-kit
- **Download URL**: https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip
- **Author**: Kenney (www.kenney.nl)
- **License**: CC0 1.0 Universal (public domain) — https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required**: No. Kenney requests optional credit as "Kenney" or "www.kenney.nl".
- **Mesh**: open-wheel Formula-style race car, 5 sub-meshes (body + 4 wheels), 3090 verts / 1952 faces,
  extents 1.300 x 0.733 x 2.560, long axis +Z (nose along Z), not watertight.

## rocket.glb — Saturn V launch vehicle

- **Source**: Poly Pizza (Google Poly archive), model "Saturn V"
- **Model URL**: https://poly.pizza/m/6RAy77V1fNz
- **Download URL**: https://static.poly.pizza/c282e376-5b93-4056-8ef4-975ead50e29c.glb
- **Author**: Mr. Peel
- **License**: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/
- **Attribution text (required)**: `Saturn V by Mr. Peel (CC-BY 3.0) via Poly Pizza`
- **Mesh**: full three-stage Saturn V with five F-1 engines and launch-escape tower.
  60 sub-meshes, 11382 verts / 5748 faces, extents 0.260 x 1.400 x 0.260,
  long axis +Y (stands vertically), not watertight.

## airplane.glb — light propeller aircraft

- **Source**: Poly Pizza (Google Poly archive), model "Small Airplane"
- **Model URL**: https://poly.pizza/m/7cvx6ex-xfL
- **Download URL**: https://static.poly.pizza/077afae1-24b7-4bac-a31d-53d367002a04.glb
- **Author**: Vojtěch Balák
- **License**: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/
- **Attribution text (required)**: `Small Airplane by Vojtěch Balák (CC-BY 3.0) via Poly Pizza`
- **Mesh**: high-wing single-propeller light aircraft with fixed landing gear.
  6 sub-meshes, 1116 verts / 584 faces, extents 11.073 x 4.667 x 9.729,
  wingspan along X, fuselage along Z, cleanly axis-aligned, not watertight.

## ship.glb — ocean liner

- **Source pack**: Kenney "Watercraft Kit" (v2.1), model file `Models/GLB format/ship-ocean-liner.glb`
- **Pack URL**: https://kenney.nl/assets/watercraft-kit
- **Download URL**: https://kenney.nl/media/pages/assets/watercraft-kit/a335cfed49-1713519620/kenney_watercraft-pack.zip
- **Author**: Kenney (www.kenney.nl)
- **License**: CC0 1.0 Universal (public domain) — https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required**: No. Kenney requests optional credit as "Kenney" or "www.kenney.nl".
- **Mesh**: four-funnel ocean liner with full hull below the waterline.
  1 sub-mesh, 4366 verts / 2796 faces, extents 4.760 x 8.934 x 21.280,
  keel-to-mast along Y, bow-to-stern along Z, not watertight.

## bird.glb — gliding eagle, wings spread

- **Source**: Poly Pizza (Google Poly archive), model "Eagle"
- **Model URL**: https://poly.pizza/m/1Z5L1v0bfu7
- **Download URL**: https://static.poly.pizza/195b3ebe-8570-4bb0-b88b-125c206e74fc.glb
- **Author**: Robert Mirabelle
- **License**: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/
- **Attribution text (required)**: `Eagle by Robert Mirabelle (CC-BY 3.0) via Poly Pizza`
- **Mesh**: eagle in a soaring/gliding pose, wings fully extended with a shallow gull-wing
  dihedral and fanned tail. 4 sub-meshes, 14214 verts / 7108 faces,
  extents 260.070 x 32.157 x 121.983 — wingspan (X) is 2.13x the body length (Z),
  confirming the wings are spread rather than folded. Not watertight.

---

## Notes for downstream use

- Every file is a glTF-binary **Scene** containing several sub-meshes, not a single mesh.
  `trimesh.load()` returns a `trimesh.Scene`; concatenate with
  `trimesh.util.concatenate([g.copy() for g in scene.geometry.values()])` before voxelising.
- None of the five are watertight, which is normal for game-art meshes (open hulls, no
  interior geometry). For a solid-voxel LBM mask, use a ray-stabbing or winding-number
  fill on the concatenated mesh rather than relying on `mesh.volume`.
- Scales differ wildly between sources (rocket ~1.4 units tall, eagle ~260 units across).
  Normalise each mesh to the domain before use.

## Rejected candidates (recorded so they are not retried)

- Kenney Space Kit rocket parts (`rocket_baseA.glb` etc., CC0): modular segments, not a
  complete rocket — a single file is a stubby 1.8 x 1.6 x 1.8 stage. Kept as the CC0
  fallback only if the CC-BY Saturn V ever needs replacing.
- Boeing 747 by Miha Lunar, https://poly.pizza/m/49CLof4tP2V (CC-BY 3.0): good geometry but
  the model is baked rotated ~45 deg in yaw and pitched nose-up, so its bounding box is
  meaningless without reorientation. Usable if a jet airliner is preferred over a prop plane.
- "Flying gull" / "Flying seagull" (Poly by Google, CC-BY 3.0): wings spread but raised in a
  steep V mid-flap, not a glide.
- "Raven" (Poly by Google, CC-BY 3.0): perched with wings folded — fails the wings-out requirement.
