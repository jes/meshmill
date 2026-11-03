"""Heightmap silhouette, polygon offset, and contour utilities."""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import numpy as np

Point = Tuple[float, float]
Ring = List[Point]


def heightmap_mask(z: np.ndarray, zmin: float, eps: Optional[float] = None) -> np.ndarray:
    """True where model material exists (above empty/black floor)."""
    if eps is None:
        eps = max((float(np.max(z)) - zmin) * 1e-3, 1e-4)
    return z > (zmin + eps)


def _neighbors8(y: int, x: int):
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            yield y + dy, x + dx


def dilate_mask(mask: np.ndarray, radius_px: int) -> np.ndarray:
    """Binary dilate by approx radius (square+disk hybrid)."""
    if radius_px <= 0:
        return mask.copy()
    h, w = mask.shape
    out = mask.copy()
    ys, xs = np.where(mask)
    r2 = radius_px * radius_px
    for y, x in zip(ys.tolist(), xs.tolist()):
        y0, y1 = max(0, y - radius_px), min(h, y + radius_px + 1)
        x0, x1 = max(0, x - radius_px), min(w, x + radius_px + 1)
        for yy in range(y0, y1):
            for xx in range(x0, x1):
                if (yy - y) * (yy - y) + (xx - x) * (xx - x) <= r2:
                    out[yy, xx] = True
    return out


def erode_mask(mask: np.ndarray, radius_px: int) -> np.ndarray:
    if radius_px <= 0:
        return mask.copy()
    return ~dilate_mask(~mask, radius_px)


def extract_outer_ring_px(mask: np.ndarray) -> Ring:
    """Moore-neighborhood trace of the outer boundary (pixel centres)."""
    h, w = mask.shape
    # Pad so outer contour is well-defined
    pad = np.pad(mask.astype(np.uint8), 1, mode="constant", constant_values=0)
    # Find top-most, then left-most solid pixel as start (on boundary)
    start = None
    for y in range(1, h + 1):
        for x in range(1, w + 1):
            if pad[y, x] and (
                pad[y - 1, x] == 0
                or pad[y + 1, x] == 0
                or pad[y, x - 1] == 0
                or pad[y, x + 1] == 0
            ):
                start = (y, x)
                break
        if start:
            break
    if not start:
        return []

    # Clockwise Moore: directions from backtrack
    dirs = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    ring: List[Tuple[int, int]] = []
    y, x = start
    # Enter from left of start
    back = 6  # came from left → check from up-left
    for _ in range(h * w * 4):
        ring.append((y, x))
        found = False
        for k in range(8):
            di = (back + k) % 8
            ny, nx = y + dirs[di][0], x + dirs[di][1]
            if pad[ny, nx]:
                # New back is opposite of entry, then +1 for next search start
                back = (di + 5) % 8
                y, x = ny, nx
                found = True
                break
        if not found:
            break
        if (y, x) == start and len(ring) > 2:
            break
    # Convert padded → original pixel coords (centres)
    return [(float(x - 1) + 0.5, float(y - 1) + 0.5) for (y, x) in ring]


def px_ring_to_mm(
    ring_px: Ring,
    *,
    width_px: int,
    height_px: int,
    width_mm: float,
    height_mm: float,
    xmin: float = 0.0,
    ymin: float = 0.0,
) -> Ring:
    """Pixel (col,row) with row0=top → mm (x,y) with y up."""
    out: Ring = []
    for px, py in ring_px:
        x = xmin + width_mm * (px / max(width_px - 1, 1))
        y = ymin + height_mm * (1.0 - py / max(height_px - 1, 1))
        out.append((float(x), float(y)))
    return out


def simplify_ring(ring: Ring, epsilon: float) -> Ring:
    """Douglas–Peucker closed-ring simplify."""
    if len(ring) < 4 or epsilon <= 0:
        return ring

    def perp_dist(p, a, b):
        ax, ay = a
        bx, by = b
        px, py = p
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return abs(px - ax) + abs(py - ay)
        t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        qx, qy = ax + t * dx, ay + t * dy
        return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5

    def dp(pts):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        idx, dmax = 0, 0.0
        for i in range(1, len(pts) - 1):
            d = perp_dist(pts[i], a, b)
            if d > dmax:
                idx, dmax = i, d
        if dmax > epsilon:
            left = dp(pts[: idx + 1])
            right = dp(pts[idx:])
            return left[:-1] + right
        return [a, b]

    # Open temporarily (drop closing duplicate if present)
    pts = list(ring)
    if pts and pts[0] == pts[-1]:
        pts = pts[:-1]
    simp = dp(pts + [pts[0]])
    if simp and simp[0] == simp[-1]:
        simp = simp[:-1]
    if len(simp) >= 3:
        simp.append(simp[0])
    return simp


def ring_area(ring: Ring) -> float:
    if len(ring) < 3:
        return 0.0
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return 0.5 * a


def ensure_ccw(ring: Ring) -> Ring:
    if ring_area(ring) < 0:
        pts = ring[:-1] if ring and ring[0] == ring[-1] else list(ring)
        pts.reverse()
        pts.append(pts[0])
        return pts
    return ring


def offset_ring_inward(ring: Ring, dist: float) -> Ring:
    """Inset CCW ring by positive distance."""
    return offset_ring_outward(ring, -abs(dist))


def offset_ring_outward(ring: Ring, dist: float) -> Ring:
    """Simple miter offset. Positive dist = outward for CCW ring."""
    if abs(dist) < 1e-12 or len(ring) < 4:
        return list(ring)
    ring = ensure_ccw(ring)
    pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
    n = len(pts)
    out: Ring = []
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        e1 = (p1[0] - p0[0], p1[1] - p0[1])
        e2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1 = (e1[0] ** 2 + e1[1] ** 2) ** 0.5 or 1.0
        l2 = (e2[0] ** 2 + e2[1] ** 2) ** 0.5 or 1.0
        # Right normals = outward for CCW rings (Y-up, CCW boundary)
        n1 = (e1[1] / l1, -e1[0] / l1)
        n2 = (e2[1] / l2, -e2[0] / l2)
        nx, ny = n1[0] + n2[0], n1[1] + n2[1]
        ln = (nx ** 2 + ny ** 2) ** 0.5
        if ln < 1e-9:
            nx, ny = n1
            ln = 1.0
        # miter length
        dot = max(-1.0, min(1.0, n1[0] * n2[0] + n1[1] * n2[1]))
        miter = dist / max((1.0 + dot) * 0.5, 0.1) ** 0.5
        miter = max(-5 * abs(dist), min(5 * abs(dist), miter if dist > 0 else -miter))
        # Use averaged normal * dist with miter clamp
        scale = dist / ln
        # Better: offset along angle bisector
        bx, by = nx / ln, ny / ln
        # miter factor
        cos_h = max(0.05, (1.0 + dot) * 0.5) ** 0.5
        m = dist / cos_h
        m = max(-8 * abs(dist), min(8 * abs(dist), m))
        out.append((p1[0] + bx * m, p1[1] + by * m))
    out.append(out[0])
    return out


def point_in_ring(x: float, y: float, ring: Ring) -> bool:
    pts = ring[:-1] if ring and ring[0] == ring[-1] else ring
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi):
            inside = not inside
        j = i
    return inside


def silhouette_from_heightmap(
    z: np.ndarray,
    *,
    width_mm: float,
    height_mm: float,
    xmin: float = 0.0,
    ymin: float = 0.0,
    zmin: Optional[float] = None,
    simplify_mm: float = 0.5,
    dilate_px: int = 0,
) -> Ring:
    zmin = float(np.min(z)) if zmin is None else zmin
    mask = heightmap_mask(z, zmin)
    if dilate_px > 0:
        mask = dilate_mask(mask, dilate_px)
    ring_px = extract_outer_ring_px(mask)
    if len(ring_px) < 3:
        return []
    h, w = z.shape
    ring = px_ring_to_mm(
        ring_px,
        width_px=w,
        height_px=h,
        width_mm=width_mm,
        height_mm=height_mm,
        xmin=xmin,
        ymin=ymin,
    )
    ring = ensure_ccw(ring)
    return simplify_ring(ring, simplify_mm)


def clip_segment_outside(
    a: Point, b: Point, ring: Ring, samples: int = 16
) -> List[Tuple[Point, Point]]:
    """Keep portions of AB that lie outside the ring (approx via sampling)."""
    # Sample and merge outside runs
    pts = []
    for i in range(samples + 1):
        t = i / samples
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        pts.append(((x, y), not point_in_ring(x, y, ring)))
    segs: List[Tuple[Point, Point]] = []
    run_start = None
    for i, (p, out) in enumerate(pts):
        if out and run_start is None:
            run_start = p
        if (not out or i == len(pts) - 1) and run_start is not None:
            end = p if out and i == len(pts) - 1 else pts[i - 1][0]
            if run_start != end:
                segs.append((run_start, end))
            run_start = None
    return segs
