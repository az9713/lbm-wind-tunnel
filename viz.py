"""Render 2D fields (vorticity etc.) to mp4 via matplotlib frames + ffmpeg."""
import shutil
import subprocess
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def vorticity(u):
    """omega = dv/dx - du/dy for u shaped (2, nx, ny)."""
    return np.gradient(u[1], axis=0) - np.gradient(u[0], axis=1)


def render_2d(fields, path, solid=None, fps=30, clim=None, cmap="RdBu_r"):
    """fields: iterable of (nx, ny) arrays -> mp4 at path. Returns path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = path.parent / f"frames_{path.stem}"
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)
    fields = list(fields) if not isinstance(fields, list) else fields
    if clim is None:
        m = max(np.abs(f).max() for f in fields) or 1.0
        clim = (-m, m)
    nx, ny = fields[0].shape
    w = 800
    h = int(round(w * ny / nx / 2)) * 2   # even for yuv420p
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    ax = fig.add_axes((0, 0, 1, 1)); ax.axis("off")
    im = ax.imshow(fields[0].T, origin="lower", cmap=cmap,
                   vmin=clim[0], vmax=clim[1], interpolation="bilinear")
    if solid is not None:
        rgba = np.zeros(solid.T.shape + (4,))
        rgba[solid.T] = (0.1, 0.1, 0.1, 1.0)
        ax.imshow(rgba, origin="lower", interpolation="nearest")
    for i, fld in enumerate(fields):
        im.set_data(fld.T)
        fig.savefig(frames / f"frame_{i:05d}.png")
    plt.close(fig)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
         "-i", str(frames / "frame_%05d.png"),
         "-pix_fmt", "yuv420p", str(path)], check=True)
    shutil.rmtree(frames)
    return path
