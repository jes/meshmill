"""24-bit heightmap PNG encode/decode compatible with pngcam RGB mode."""

from __future__ import annotations

import numpy as np
from PIL import Image


def z_to_rgb24(z: np.ndarray, zmin: float, zmax: float) -> np.ndarray:
    """z float HxW → uint8 HxWx3 (R=MSB)."""
    span = max(float(zmax - zmin), 1e-12)
    t = np.clip((z.astype(np.float64) - zmin) / span, 0.0, 1.0)
    v = np.rint(t * (2**24 - 1)).astype(np.uint32)
    r = ((v >> 16) & 255).astype(np.uint8)
    g = ((v >> 8) & 255).astype(np.uint8)
    b = (v & 255).astype(np.uint8)
    return np.stack([r, g, b], axis=-1)


def rgb24_to_z(rgb: np.ndarray, zmin: float, zmax: float) -> np.ndarray:
    r = rgb[..., 0].astype(np.uint32)
    g = rgb[..., 1].astype(np.uint32)
    b = rgb[..., 2].astype(np.uint32)
    v = (r << 16) | (g << 8) | b
    t = v.astype(np.float64) / float(2**24 - 1)
    return zmin + t * (zmax - zmin)


def write_heightmap_png(path: str, z: np.ndarray, zmin: float, zmax: float) -> None:
    rgb = z_to_rgb24(z, zmin, zmax)
    # PNG row 0 is top; CAM Y usually grows upward — flip for screen-like maps.
    Image.fromarray(rgb, mode="RGB").save(path)


def read_heightmap_png(path: str, zmin: float = 0.0, zmax: float = 1.0) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    rgb = np.asarray(img)
    return rgb24_to_z(rgb, zmin, zmax)
