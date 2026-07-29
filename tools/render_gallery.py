"""Render every out/shape_*.npz into out/shape_<name>.mp4 (two-panel slices).
Run after run_shapes3d.py finishes (or per-object as they land)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from viz import render_3d_slices   # noqa: E402


def main():
    done = []
    for npz in sorted(Path("out").glob("shape_*.npz")):
        name = npz.stem.replace("shape_", "")
        out = Path("out") / f"shape_{name}.mp4"
        if out.exists() and out.stat().st_mtime > npz.stat().st_mtime:
            continue
        print("rendering", name, flush=True)
        _, meta = render_3d_slices(npz, out)
        done.append((name, meta.get("Re")))
    print("rendered:", done)


if __name__ == "__main__":
    main()
