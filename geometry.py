"""Solid masks: procedural validation shapes (cylinder/sphere work in 2D/3D)."""
import numpy as np


def cylinder(shape, center, r):
    """Boolean solid mask: ball of radius r (circle in 2D, sphere in 3D)."""
    grids = np.ogrid[tuple(slice(0, n) for n in shape)]
    d2 = sum((g - c) ** 2 for g, c in zip(grids, center))
    return d2 <= r * r


sphere = cylinder  # same formula in 3D
