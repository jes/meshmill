"""Spatial decimation for huge binary/ASCII STL (preview proxy)."""

from __future__ import annotations

import struct
import time
from typing import Callable, Optional

import numpy as np

from .stl import TRI_BYTES, HEADER, iter_triangle_batches, probe_stl

ProgressCb = Optional[Callable[[str, int], None]]


def _aabb(path: str, progress: ProgressCb = None):
    info = probe_stl(path)
    gmin = np.array([np.inf, np.inf, np.inf], dtype=np.float64)
    gmax = np.array([-np.inf, -np.inf, -np.inf], dtype=np.float64)
    done = 0
    for pos, amin, amax in iter_triangle_batches(path, batch_tris=524_288, info=info):
        gmin = np.minimum(gmin, amin)
        gmax = np.maximum(gmax, amax)
        done += pos.shape[0] // 3
        if progress and info.triangles:
            progress("Bounds", int(30 * done / max(info.triangles, 1)))
    if not np.isfinite(gmin[0]):
        raise ValueError("Empty STL")
    return info, gmin, gmax


def decimate_stl(
    src: str,
    dst: str,
    target_tris: int = 400_000,
    progress: ProgressCb = None,
) -> dict:
    """Keep ~target_tris by retaining the largest triangle in each spatial cell."""
    t0 = time.time()
    info, gmin, gmax = _aabb(src, progress)
    if info.triangles <= target_tris:
        # Straight copy
        with open(src, "rb") as fsrc, open(dst, "wb") as fdst:
            while True:
                chunk = fsrc.read(1024 * 1024)
                if not chunk:
                    break
                fdst.write(chunk)
        if progress:
            progress("Done", 100)
        return {
            "src": src,
            "dst": dst,
            "triangles_in": info.triangles,
            "triangles_out": info.triangles,
            "copied": True,
            "seconds": time.time() - t0,
        }

    extent = np.maximum(gmax - gmin, 1e-9)
    # Prefer roughly cubic cells; allocate ~target cells
    cells = max(int(np.ceil(target_tris ** (1.0 / 3.0))), 4)
    # Stretch grid by extent so cells are roughly cubic in mm
    nx = max(int(round(cells * extent[0] / extent.mean())), 4)
    ny = max(int(round(cells * extent[1] / extent.mean())), 4)
    nz = max(int(round(cells * extent[2] / extent.mean())), 4)
    # Cap total cells to ~2x target to bound memory
    while nx * ny * nz > target_tris * 2 and (nx > 4 or ny > 4 or nz > 4):
        if nx >= ny and nx >= nz:
            nx = max(4, nx - 1)
        elif ny >= nz:
            ny = max(4, ny - 1)
        else:
            nz = max(4, nz - 1)

    # best[cell] = (area, packed 9 floats)
    best_area: dict[int, float] = {}
    best_verts: dict[int, bytes] = {}

    done = 0
    for pos, _, _ in iter_triangle_batches(src, batch_tris=262_144, info=info):
        tris = pos.reshape(-1, 3, 3)
        # area via cross product
        e1 = tris[:, 1] - tris[:, 0]
        e2 = tris[:, 2] - tris[:, 0]
        cross = np.cross(e1, e2)
        areas = 0.5 * np.linalg.norm(cross, axis=1)
        cents = tris.mean(axis=1)
        ix = np.clip(((cents[:, 0] - gmin[0]) / extent[0] * nx).astype(np.int32), 0, nx - 1)
        iy = np.clip(((cents[:, 1] - gmin[1]) / extent[1] * ny).astype(np.int32), 0, ny - 1)
        iz = np.clip(((cents[:, 2] - gmin[2]) / extent[2] * nz).astype(np.int32), 0, nz - 1)
        keys = (ix + iy * nx + iz * nx * ny).astype(np.int64)
        for i in range(tris.shape[0]):
            a = float(areas[i])
            if a < 1e-18:
                continue
            k = int(keys[i])
            prev = best_area.get(k)
            if prev is not None and prev >= a:
                continue
            best_area[k] = a
            best_verts[k] = tris[i].astype(np.float32).tobytes()
        done += tris.shape[0]
        if progress and info.triangles:
            progress("Decimate", 30 + int(60 * done / max(info.triangles, 1)))

    # If still too many cells, keep top target by area
    items = sorted(best_area.items(), key=lambda kv: kv[1], reverse=True)
    if len(items) > target_tris:
        items = items[:target_tris]
    keys_keep = [k for k, _ in items]

    out_n = len(keys_keep)
    with open(dst, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", out_n))
        for k in keys_keep:
            verts = np.frombuffer(best_verts[k], dtype=np.float32).reshape(3, 3)
            a, b, c = verts
            ux, uy, uz = b - a
            vx, vy, vz = c - a
            nx_, ny_, nz_ = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            f.write(struct.pack("<3f", float(nx_), float(ny_), float(nz_)))
            f.write(verts.astype(np.float32).tobytes())
            f.write(struct.pack("<H", 0))

    if progress:
        progress("Done", 100)
    return {
        "src": src,
        "dst": dst,
        "triangles_in": info.triangles,
        "triangles_out": out_n,
        "grid": [nx, ny, nz],
        "copied": False,
        "seconds": time.time() - t0,
    }
