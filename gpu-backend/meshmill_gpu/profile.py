"""Contour profile (outside/inside) and pocket toolpaths."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable, List, Optional, Sequence, Tuple

import numpy as np

from .contour import (
    Ring,
    dilate_mask,
    ensure_ccw,
    erode_mask,
    extract_outer_ring_px,
    heightmap_mask,
    offset_ring_inward,
    offset_ring_outward,
    point_in_ring,
    px_ring_to_mm,
    ring_area,
    simplify_ring,
    silhouette_from_heightmap,
)
from .pngmap import read_heightmap_png

ProgressCb = Optional[Callable[[str, int], None]]
Point = Tuple[float, float]


def _ring_from_json_points(points: Sequence[Sequence[float]]) -> Ring:
    ring = [(float(p[0]), float(p[1])) for p in points]
    if len(ring) >= 3 and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ensure_ccw(ring)


def _load_base_ring(
    *,
    heightmap_png: Optional[str],
    contour_json: Optional[str],
    width_mm: float,
    height_mm: float,
    depth_mm: float,
    xmin: float,
    ymin: float,
) -> Tuple[Ring, str, Optional[np.ndarray]]:
    """Return (base_contour, source, heightmap_z_or_None)."""
    if contour_json:
        data = json.loads(Path(contour_json).read_text(encoding="utf-8"))
        pts = data.get("points") or data.get("contour") or []
        base = _ring_from_json_points(pts)
        src = data.get("source") or "contour"
        return base, src, None
    if heightmap_png:
        z = read_heightmap_png(heightmap_png, 0.0, depth_mm)
        base = silhouette_from_heightmap(
            z, width_mm=width_mm, height_mm=height_mm, xmin=xmin, ymin=ymin
        )
        return base, "heightmap", z
    raise ValueError("Need heightmap_png or contour_json")


def _offset_side(
    base: Ring,
    z: Optional[np.ndarray],
    *,
    side: str,
    tool_radius_mm: float,
    allowance_mm: float,
    width_mm: float,
    height_mm: float,
    xmin: float,
    ymin: float,
) -> Ring:
    dist = abs(tool_radius_mm) + allowance_mm
    if z is not None:
        zmin = float(np.min(z))
        mask = heightmap_mask(z, zmin)
        h, w = z.shape
        px_per_mm = 0.5 * (
            (w - 1) / max(width_mm, 1e-12) + (h - 1) / max(height_mm, 1e-12)
        )
        rad_px = int(max(1, round(dist * px_per_mm)))
        if side == "outside":
            m = dilate_mask(mask, rad_px)
        else:
            m = erode_mask(mask, rad_px)
        ring_px = extract_outer_ring_px(m)
        if len(ring_px) >= 3:
            ring = px_ring_to_mm(
                ring_px,
                width_px=w,
                height_px=h,
                width_mm=width_mm,
                height_mm=height_mm,
                xmin=xmin,
                ymin=ymin,
            )
            return simplify_ring(ensure_ccw(ring), 0.4)
    if side == "outside":
        return offset_ring_outward(ensure_ccw(base), dist)
    return offset_ring_inward(ensure_ccw(base), dist)


def _z_levels(z_offset: float, depth_mm: float, step_down: float) -> List[float]:
    top = float(z_offset)
    bottom = float(z_offset) - float(depth_mm)
    sd = abs(step_down) if step_down and step_down > 0 else abs(depth_mm)
    levels: List[float] = []
    z = top - sd
    while z > bottom + 1e-6:
        levels.append(z)
        z -= sd
    levels.append(bottom)
    return levels


def profile_gcode(
    ring: Ring,
    *,
    z_levels: List[float],
    xy_feed: float,
    z_feed: float,
    rapid_feed: float,
    safe_z: float,
    spindle: float = 0.0,
) -> str:
    if len(ring) < 4:
        raise ValueError("Contour too short for profile")
    pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
    lines = ["G21", "G90", f"G0 Z{safe_z:.4f} F{rapid_feed:.1f}"]
    if spindle > 0:
        lines.append(f"M3 S{spindle:.0f}")
    x0, y0 = pts[0]
    for zcut in z_levels:
        lines.append(f"G0 X{x0:.4f} Y{y0:.4f} F{rapid_feed:.1f}")
        lines.append(f"G1 Z{zcut:.4f} F{z_feed:.1f}")
        for x, y in pts[1:]:
            lines.append(f"G1 X{x:.4f} Y{y:.4f} F{xy_feed:.1f}")
        lines.append(f"G1 X{x0:.4f} Y{y0:.4f} F{xy_feed:.1f}")
        lines.append(f"G0 Z{safe_z:.4f} F{rapid_feed:.1f}")
    if spindle > 0:
        lines.append("M5")
    lines.append("M2")
    return "\n".join(lines) + "\n"


def multi_ring_gcode(
    rings: List[Ring],
    *,
    z_levels: List[float],
    xy_feed: float,
    z_feed: float,
    rapid_feed: float,
    safe_z: float,
    spindle: float = 0.0,
) -> str:
    """Cut each ring at each Z (outer→inner per level)."""
    usable = [r for r in rings if len(r) >= 4]
    if not usable:
        raise ValueError("No pocket rings")
    lines = ["G21", "G90", f"G0 Z{safe_z:.4f} F{rapid_feed:.1f}"]
    if spindle > 0:
        lines.append(f"M3 S{spindle:.0f}")
    for zcut in z_levels:
        for ring in usable:
            pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
            x0, y0 = pts[0]
            lines.append(f"G0 X{x0:.4f} Y{y0:.4f} F{rapid_feed:.1f}")
            lines.append(f"G1 Z{zcut:.4f} F{z_feed:.1f}")
            for x, y in pts[1:]:
                lines.append(f"G1 X{x:.4f} Y{y:.4f} F{xy_feed:.1f}")
            lines.append(f"G1 X{x0:.4f} Y{y0:.4f} F{xy_feed:.1f}")
            lines.append(f"G0 Z{safe_z:.4f} F{rapid_feed:.1f}")
    if spindle > 0:
        lines.append("M5")
    lines.append("M2")
    return "\n".join(lines) + "\n"


def hatch_segments(
    ring: Ring,
    stepover_mm: float,
    tool_radius_mm: float,
) -> List[Tuple[Point, Point]]:
    """Horizontal hatch lines inside inset ring."""
    inset = offset_ring_inward(ring, tool_radius_mm)
    if len(inset) < 4 or abs(ring_area(inset)) < 1e-3:
        return []
    pts = inset[:-1] if inset[0] == inset[-1] else list(inset)
    ys = [p[1] for p in pts]
    xs = [p[0] for p in pts]
    ymin, ymax = min(ys), max(ys)
    xmin, xmax = min(xs), max(xs)
    segs: List[Tuple[Point, Point]] = []
    y = ymin + tool_radius_mm
    flip = False
    while y <= ymax - tool_radius_mm + 1e-9:
        # Intersect horizontal line with polygon edges
        hits = []
        n = len(pts)
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            if (y1 > y) == (y2 > y):
                continue
            if abs(y2 - y1) < 1e-15:
                continue
            t = (y - y1) / (y2 - y1)
            hits.append(x1 + t * (x2 - x1))
        hits.sort()
        # Pair intersections
        pairs = []
        for i in range(0, len(hits) - 1, 2):
            a, b = hits[i], hits[i + 1]
            if b - a > 1e-4:
                pairs.append((a, b))
        if flip:
            pairs = list(reversed([(b, a) for a, b in pairs]))
        for a, b in pairs:
            # shrink ends slightly so we stay inside
            if b < a:
                a, b = b, a
                segs.append(((b - 0.01, y), (a + 0.01, y)))
            else:
                segs.append(((a + 0.01, y), (b - 0.01, y)))
        y += stepover_mm
        flip = not flip
    return segs


def hatch_gcode(
    segs: List[Tuple[Point, Point]],
    *,
    z_levels: List[float],
    xy_feed: float,
    z_feed: float,
    rapid_feed: float,
    safe_z: float,
    spindle: float = 0.0,
) -> str:
    lines = ["G21", "G90", f"G0 Z{safe_z:.4f} F{rapid_feed:.1f}"]
    if spindle > 0:
        lines.append(f"M3 S{spindle:.0f}")
    for zcut in z_levels:
        for (a, b) in segs:
            lines.append(f"G0 X{a[0]:.4f} Y{a[1]:.4f} F{rapid_feed:.1f}")
            lines.append(f"G1 Z{zcut:.4f} F{z_feed:.1f}")
            lines.append(f"G1 X{b[0]:.4f} Y{b[1]:.4f} F{xy_feed:.1f}")
            lines.append(f"G0 Z{safe_z:.4f} F{rapid_feed:.1f}")
    if spindle > 0:
        lines.append("M5")
    lines.append("M2")
    return "\n".join(lines) + "\n"


def generate_profile(
    gcode_path: str,
    *,
    side: str = "outside",
    heightmap_png: Optional[str] = None,
    contour_json: Optional[str] = None,
    width_mm: float,
    height_mm: float,
    depth_mm: float,
    tool_diameter: float = 6.0,
    step_down: float = 2.0,
    allowance_mm: float = 0.0,
    xy_feed: float = 400.0,
    z_feed: float = 50.0,
    rapid_feed: float = 10000.0,
    rapid_clearance: float = 5.0,
    z_offset: float = 0.0,
    xmin: float = 0.0,
    ymin: float = 0.0,
    spindle: float = 10000.0,
    contour_out: Optional[str] = None,
    progress: ProgressCb = None,
) -> dict:
    t0 = time.time()
    side = "inside" if side == "inside" else "outside"
    radius = tool_diameter * 0.5
    if progress:
        progress("Contour", 10)
    base, source, z = _load_base_ring(
        heightmap_png=heightmap_png,
        contour_json=contour_json,
        width_mm=width_mm,
        height_mm=height_mm,
        depth_mm=depth_mm,
        xmin=xmin,
        ymin=ymin,
    )
    if len(base) < 4:
        raise ValueError("Base contour too short")
    ring = _offset_side(
        base,
        z,
        side=side,
        tool_radius_mm=radius,
        allowance_mm=allowance_mm,
        width_mm=width_mm,
        height_mm=height_mm,
        xmin=xmin,
        ymin=ymin,
    )
    if len(ring) < 4:
        raise ValueError(f"Failed to build {side} contour")
    if side == "inside" and abs(ring_area(ring)) < 1e-2:
        raise ValueError("Inside contour collapsed — contour smaller than tool")

    if contour_out:
        Path(contour_out).write_text(
            json.dumps({"points": ring, "source": source, "side": side}, indent=2),
            encoding="utf-8",
        )
    if progress:
        progress("Profile passes", 50)
    levels = _z_levels(z_offset, depth_mm, step_down)
    safe = rapid_clearance + z_offset
    gcode = profile_gcode(
        ring,
        z_levels=levels,
        xy_feed=xy_feed,
        z_feed=z_feed,
        rapid_feed=rapid_feed,
        safe_z=safe,
        spindle=spindle,
    )
    Path(gcode_path).write_text(gcode, encoding="utf-8")
    if progress:
        progress("Done", 100)
    return {
        "gcode": gcode_path,
        "source": source,
        "side": side,
        "points": len(ring),
        "passes": len(levels),
        "seconds": time.time() - t0,
        "contour": contour_out,
    }


def generate_outside_profile(gcode_path: str, **kwargs) -> dict:
    return generate_profile(gcode_path, side="outside", **kwargs)


def generate_inside_profile(gcode_path: str, **kwargs) -> dict:
    return generate_profile(gcode_path, side="inside", **kwargs)


def generate_pocket(
    gcode_path: str,
    *,
    heightmap_png: Optional[str] = None,
    contour_json: Optional[str] = None,
    width_mm: float,
    height_mm: float,
    depth_mm: float,
    tool_diameter: float = 6.0,
    step_over: float = 1.5,
    step_down: float = 2.0,
    allowance_mm: float = 0.0,
    xy_feed: float = 400.0,
    z_feed: float = 50.0,
    rapid_feed: float = 10000.0,
    rapid_clearance: float = 5.0,
    z_offset: float = 0.0,
    xmin: float = 0.0,
    ymin: float = 0.0,
    spindle: float = 10000.0,
    style: str = "hatch",  # hatch | concentric
    contour_out: Optional[str] = None,
    progress: ProgressCb = None,
) -> dict:
    """Pocket (выборка) inside contour: hatch or concentric offsets."""
    t0 = time.time()
    radius = tool_diameter * 0.5
    if progress:
        progress("Contour", 10)
    base, source, z = _load_base_ring(
        heightmap_png=heightmap_png,
        contour_json=contour_json,
        width_mm=width_mm,
        height_mm=height_mm,
        depth_mm=depth_mm,
        xmin=xmin,
        ymin=ymin,
    )
    # First leave allowance on wall: inset by R + allowance
    wall = abs(radius) + abs(allowance_mm)
    levels = _z_levels(z_offset, depth_mm, step_down)
    safe = rapid_clearance + z_offset
    step = max(step_over, radius * 0.2)

    if style == "concentric":
        if progress:
            progress("Concentric", 40)
        rings: List[Ring] = []
        if z is not None:
            zmin = float(np.min(z))
            mask = heightmap_mask(z, zmin)
            h, w = z.shape
            px_per_mm = 0.5 * (
                (w - 1) / max(width_mm, 1e-12) + (h - 1) / max(height_mm, 1e-12)
            )
            m = erode_mask(mask, int(max(1, round(wall * px_per_mm))))
            step_px = int(max(1, round(step * px_per_mm)))
            for _ in range(500):
                if not m.any():
                    break
                ring_px = extract_outer_ring_px(m)
                if len(ring_px) < 3:
                    break
                ring = simplify_ring(
                    ensure_ccw(
                        px_ring_to_mm(
                            ring_px,
                            width_px=w,
                            height_px=h,
                            width_mm=width_mm,
                            height_mm=height_mm,
                            xmin=xmin,
                            ymin=ymin,
                        )
                    ),
                    0.4,
                )
                if abs(ring_area(ring)) < 1e-2:
                    break
                rings.append(ring)
                m = erode_mask(m, step_px)
        else:
            inset = offset_ring_inward(base, wall)
            d = 0.0
            for _ in range(500):
                r = offset_ring_inward(inset, d) if d > 0 else inset
                if len(r) < 4 or abs(ring_area(r)) < max(1.0, radius):
                    break
                rings.append(r)
                d += step
        if not rings:
            raise ValueError("Pocket collapsed — area smaller than tool")
        gcode = multi_ring_gcode(
            rings,
            z_levels=levels,
            xy_feed=xy_feed,
            z_feed=z_feed,
            rapid_feed=rapid_feed,
            safe_z=safe,
            spindle=spindle,
        )
        ntool = sum(len(r) for r in rings)
        if contour_out:
            Path(contour_out).write_text(
                json.dumps({"rings": rings, "source": source, "style": style}, indent=2),
                encoding="utf-8",
            )
    else:
        if progress:
            progress("Hatch", 40)
        # Apply wall inset via allowance on hatch helper (tool_radius = wall)
        segs = hatch_segments(base, step, wall)
        if not segs:
            raise ValueError("No pocket hatch segments — contour too small")
        gcode = hatch_gcode(
            segs,
            z_levels=levels,
            xy_feed=xy_feed,
            z_feed=z_feed,
            rapid_feed=rapid_feed,
            safe_z=safe,
            spindle=spindle,
        )
        ntool = len(segs)
        if contour_out:
            Path(contour_out).write_text(
                json.dumps(
                    {
                        "segments": [[[a[0], a[1]], [b[0], b[1]]] for a, b in segs],
                        "source": source,
                        "style": "hatch",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )

    Path(gcode_path).write_text(gcode, encoding="utf-8")
    if progress:
        progress("Done", 100)
    return {
        "gcode": gcode_path,
        "source": source,
        "style": style,
        "elements": ntool,
        "passes": len(levels),
        "seconds": time.time() - t0,
        "contour": contour_out,
    }
