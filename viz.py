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


def render_3d_slices(npz_path, out_path, fps=30):
    """Two-panel mp4 from a run_shapes3d npz: velocity magnitude (vertical
    center plane, top) + vorticity (same plane, bottom)."""
    import json
    d = np.load(npz_path, allow_pickle=False)
    meta = json.loads(str(d["meta"]))
    fv = d["frames_v"]            # (T, 2, nx, nz): [umag, vorticity]
    solid = d["solid_v"]
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    frames = out_path.parent / f"frames_{out_path.stem}"
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)
    umax = np.percentile(fv[-1, 0], 99.5)
    wmax = 3 * fv[-1, 1].std() or 1.0
    nx, nz = fv.shape[2], fv.shape[3]
    w = 800
    hpanel = int(round(w * nz / nx / 2)) * 2
    fig, (a1, a2) = plt.subplots(
        2, 1, figsize=(w / 100, 2 * hpanel / 100), dpi=100)
    for a in (a1, a2):
        a.set_position(a.get_position())
        a.axis("off")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0, hspace=0)
    im1 = a1.imshow(fv[0, 0].T, origin="lower", cmap="magma",
                    vmin=0, vmax=umax, interpolation="bilinear")
    im2 = a2.imshow(fv[0, 1].T, origin="lower", cmap="RdBu_r",
                    vmin=-wmax, vmax=wmax, interpolation="bilinear")
    rgba = np.zeros(solid.T.shape + (4,)); rgba[solid.T] = (0.12, 0.12, 0.12, 1)
    a1.imshow(rgba, origin="lower", interpolation="nearest")
    a2.imshow(rgba, origin="lower", interpolation="nearest")
    for i in range(fv.shape[0]):
        im1.set_data(fv[i, 0].T)
        im2.set_data(fv[i, 1].T)
        fig.savefig(frames / f"frame_{i:05d}.png")
    plt.close(fig)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
         "-i", str(frames / "frame_%05d.png"),
         "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
         "-pix_fmt", "yuv420p", str(out_path)], check=True)
    shutil.rmtree(frames)
    return out_path, meta
