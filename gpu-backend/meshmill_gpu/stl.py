"""Streaming binary STL reader for out-of-core GPU upload."""

from __future__ import annotations

import os
import struct
from dataclasses import dataclass
from typing import Iterator, Optional, Tuple

import numpy as np

TRI_BYTES = 50
HEADER = 84


@dataclass
class StlInfo:
    path: str
    triangles: int
    size: int
    binary: bool
    aabb_min: Optional[np.ndarray] = None
    aabb_max: Optional[np.ndarray] = None


def probe_stl(path: str) -> StlInfo:
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        header = f.read(84)
    if len(header) < 84:
        raise ValueError(f"STL too small: {path}")
    n = struct.unpack_from("<I", header, 80)[0]
    expected = HEADER + n * TRI_BYTES
    binary = abs(expected - size) < 128 or (size > 200 and header[:5] != b"solid")
    if not binary:
        # ASCII — count facets cheaply without loading geometry
        n = 0
        with open(path, "rb") as f:
            for line in f:
                if line.lstrip().lower().startswith(b"facet"):
                    n += 1
    return StlInfo(path=path, triangles=n, size=size, binary=binary)


def _iter_ascii_triangles(path: str) -> Iterator[np.ndarray]:
    verts: list[tuple[float, float, float]] = []
    with open(path, "rt", errors="ignore") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 4 and parts[0].lower() == "vertex":
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
                if len(verts) == 3:
                    yield np.asarray(verts, dtype=np.float32)
                    verts.clear()


def iter_triangle_batches(
    path: str,
    batch_tris: int = 262_144,
    info: Optional[StlInfo] = None,
) -> Iterator[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Yield (positions[N*3,3], aabb_min, aabb_max) batches.

    positions are tightly packed triangle vertices (3 rows per triangle).
    Running AABB is returned with each batch (global so far).
    """
    info = info or probe_stl(path)
    gmin = np.array([np.inf, np.inf, np.inf], dtype=np.float64)
    gmax = np.array([-np.inf, -np.inf, -np.inf], dtype=np.float64)

    if not info.binary:
        buf: list[np.ndarray] = []
        count = 0
        for tri in _iter_ascii_triangles(path):
            buf.append(tri)
            count += 1
            if count >= batch_tris:
                pos = np.vstack(buf).astype(np.float32, copy=False)
                gmin = np.minimum(gmin, pos.min(axis=0))
                gmax = np.maximum(gmax, pos.max(axis=0))
                yield pos, gmin.copy(), gmax.copy()
                buf.clear()
                count = 0
        if buf:
            pos = np.vstack(buf).astype(np.float32, copy=False)
            gmin = np.minimum(gmin, pos.min(axis=0))
            gmax = np.maximum(gmax, pos.max(axis=0))
            yield pos, gmin.copy(), gmax.copy()
        return

    with open(path, "rb") as f:
        f.seek(HEADER)
        remaining = info.triangles
        while remaining > 0:
            n = min(batch_tris, remaining)
            raw = f.read(n * TRI_BYTES)
            if len(raw) < n * TRI_BYTES:
                n = len(raw) // TRI_BYTES
                raw = raw[: n * TRI_BYTES]
                remaining = n
            # normal(12) + 9 floats(36) + attr(2)
            dt = np.dtype(
                [
                    ("n", "<f4", 3),
                    ("v", "<f4", (3, 3)),
                    ("a", "<u2"),
                ]
            )
            tris = np.frombuffer(raw, dtype=dt, count=n)
            pos = np.ascontiguousarray(tris["v"].reshape(-1, 3))
            if pos.size:
                gmin = np.minimum(gmin, pos.min(axis=0))
                gmax = np.maximum(gmax, pos.max(axis=0))
                yield pos, gmin.astype(np.float64), gmax.astype(np.float64)
            remaining -= n


def load_all_positions(path: str, max_tris: Optional[int] = None) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Load full mesh positions (may be huge — prefer iter_triangle_batches)."""
    chunks = []
    gmin = gmax = None
    tris = 0
    for pos, amin, amax in iter_triangle_batches(path):
        chunks.append(pos)
        gmin, gmax = amin, amax
        tris += pos.shape[0] // 3
        if max_tris is not None and tris >= max_tris:
            break
    if not chunks:
        empty = np.zeros((0, 3), dtype=np.float32)
        z = np.zeros(3, dtype=np.float64)
        return empty, z, z
    return np.vstack(chunks), gmin, gmax
