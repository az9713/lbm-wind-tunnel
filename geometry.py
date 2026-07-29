"""Solid masks: procedural validation shapes (cylinder/sphere work in 2D/3D)."""
import numpy as np


def cylinder(shape, center, r):
    """Boolean solid mask: ball of radius r (circle in 2D, sphere in 3D)."""
    grids = np.ogrid[tuple(slice(0, n) for n in shape)]
    d2 = sum((g - c) ** 2 for g, c in zip(grids, center))
    return d2 <= r * r


sphere = cylinder  # same formula in 3D


def ahmed_body(shape, L, slant_deg=25.0, anchor=None, clearance=None):
    """Ahmed reference body (Ahmed et al. 1984 proportions), voxelized.
    L = body length in cells, flow along +x, ground at z=0 (3D) or y=0 (2D
    side profile via ahmed_profile). Returns bool mask."""
    # proportions of the 1044 mm body
    W = max(3, round(389 / 1044 * L))
    H = max(3, round(288 / 1044 * L))
    slant_x = round(222 * np.cos(np.radians(slant_deg)) / 1044 * L)
    r = round(100 / 1044 * L)          # front-edge rounding radius
    c = round(50 / 1044 * L) if clearance is None else clearance
    dim = len(shape)
    if anchor is None:
        x0 = shape[0] // 4
    else:
        x0 = anchor
    x = np.arange(L)
    top = np.full(L, float(H))
    if slant_x > 0:
        drop = np.tan(np.radians(slant_deg)) * (x - (L - slant_x))
        top = np.minimum(top, H - np.where(x >= L - slant_x, drop, 0.0))
    # front rounding: top and bottom front edges (quarter circles in x–height)
    bot = np.zeros(L)
    if r > 0:
        fx = r - np.minimum(x, r)
        edge = r - np.sqrt(np.maximum(r**2 - fx**2, 0.0))
        top = np.minimum(top, H - edge)
        bot = np.maximum(bot, edge)
    mask = np.zeros(shape, bool)
    if dim == 2:
        ys = np.arange(shape[1])
        for i in range(L):
            xi = x0 + i
            if 0 <= xi < shape[0]:
                mask[xi, :] = (ys >= c + bot[i]) & (ys < c + top[i])
    else:
        ny, nz = shape[1], shape[2]
        y0 = (ny - W) // 2
        zs = np.arange(nz)
        for i in range(L):
            xi = x0 + i
            if 0 <= xi < shape[0]:
                zsel = (zs >= c + bot[i]) & (zs < c + top[i])
                mask[xi, y0:y0 + W, :] = zsel[None, :]
    return mask


def _flood(mask, seed):
    """Connected region of mask containing seed (face-adjacency), via dilation."""
    region = np.zeros_like(mask)
    region[seed] = True
    while True:
        grown = region.copy()
        for ax in range(mask.ndim):
            grown |= np.roll(region, 1, ax) | np.roll(region, -1, ax)
        grown &= mask
        if (grown == region).all():
            return region
        region = grown


def keep_largest_component(mask):
    """Largest face-connected solid component (drops floating debris)."""
    remaining = mask.copy()
    best = None
    while remaining.any():
        seed = tuple(a[0] for a in np.nonzero(remaining))
        comp = _flood(remaining, seed)
        if best is None or comp.sum() > best.sum():
            best = comp
        remaining &= ~comp
    return best if best is not None else mask


def from_mesh(path_or_mesh, shape, L, rotate=None, anchor=None, zmin=None,
              axes=None, flips=None):
    """Voxelize a mesh onto the lattice: longest axis scaled to L cells,
    interior filled, largest component kept, centered (flow along +x).

    rotate: optional (axis, degrees) or list of them, applied in the MESH
    frame before voxelization (e.g. angle of attack).
    axes: optional permutation mapping lattice axes to mesh axes, e.g.
    (2, 0, 1) = lattice x from mesh Z (length), y from mesh X, z from mesh Y —
    the common glTF Y-up/Z-long convention. Exact (no resampling).
    flips: optional (bool, bool, bool) — mirror lattice axes after permuting
    (e.g. flip x to point the nose upstream).
    zmin: if given, place the body's lowest voxel at this z index (3D).
    Returns (mask, info dict: voxel_volume, mesh_volume, frontal_area, pitch).
    """
    import trimesh
    if isinstance(path_or_mesh, (str, bytes)) or hasattr(path_or_mesh, "__fspath__"):
        m = trimesh.load(path_or_mesh, force="mesh")
    else:
        m = path_or_mesh
    if rotate is not None:
        unit = {"x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}
        for ax, deg in ([rotate] if isinstance(rotate[0], str) else rotate):
            m = m.copy()
            m.apply_transform(trimesh.transformations.rotation_matrix(
                np.radians(deg), unit[ax], m.bounds.mean(axis=0)))
    pitch = m.extents.max() / L
    if m.is_watertight:
        # interior voxelization: cell center inside mesh (no half-shell bloat)
        lo = m.bounds[0]
        ns = np.maximum(np.ceil(m.extents / pitch).astype(int), 1)
        axes_pts = [lo[a] + (np.arange(ns[a]) + 0.5) * pitch for a in range(3)]
        pts = np.stack(np.meshgrid(*axes_pts, indexing="ij"), -1).reshape(-1, 3)
        small = m.contains(pts).reshape(tuple(ns))
    else:
        # surface voxelization + fill (game-asset meshes with open seams)
        vg = m.voxelized(pitch)
        try:
            vg = vg.fill()
        except Exception:
            pass
        solid_pts = np.asarray(vg.points)
        idx = np.round((solid_pts - solid_pts.min(0)) / pitch).astype(int)
        small = np.zeros(idx.max(0) + 1, bool)
        small[tuple(idx.T)] = True
    small = keep_largest_component(small)
    if axes is not None:
        small = np.transpose(small, axes)
    if flips is not None:
        for a, fl in enumerate(flips):
            if fl:
                small = np.flip(small, axis=a)
    small = np.ascontiguousarray(small)
    mask = np.zeros(shape, bool)
    dims = small.shape
    off = []
    for a in range(3):
        if a == 2 and zmin is not None:
            off.append(zmin)
        elif a == 0 and anchor is not None:
            off.append(anchor)
        else:
            off.append(max(0, (shape[a] - dims[a]) // 2))
    sl_dst, sl_src = [], []
    for a in range(3):
        n = min(dims[a], shape[a] - off[a])
        sl_dst.append(slice(off[a], off[a] + n))
        sl_src.append(slice(0, n))
    mask[tuple(sl_dst)] = small[tuple(sl_src)]
    info = {
        "voxel_volume": float(mask.sum()) * pitch**3,
        "mesh_volume": float(abs(m.volume)) if m.is_watertight else None,
        "frontal_area": int(mask.any(axis=0).sum()),
        "pitch": float(pitch),
        "watertight": bool(m.is_watertight),
        "extents_cells": [int(x) for x in np.ptp(np.array(mask.nonzero()), axis=1) + 1]
        if mask.any() else [0, 0, 0],
    }
    return mask, info
