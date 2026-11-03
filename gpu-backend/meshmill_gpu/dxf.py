"""Minimal DXF importer: LWPOLYLINE, POLYLINE, LINE, CIRCLE, ARC."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from .contour import ensure_ccw

Point = Tuple[float, float]


def _read_pairs(path: str):
    with open(path, "rt", encoding="utf-8", errors="ignore") as f:
        lines = [ln.rstrip("\r\n") for ln in f]
    i = 0
    while i + 1 < len(lines):
        code = lines[i].strip()
        val = lines[i + 1]
        i += 2
        try:
            c = int(code)
        except ValueError:
            continue
        yield c, val


def _f(v: str) -> float:
    try:
        return float(v.strip())
    except ValueError:
        return 0.0


def _arc_points(cx, cy, r, a0_deg, a1_deg, step_deg=5.0) -> List[Point]:
    a0 = a0_deg
    a1 = a1_deg
    if a1 < a0:
        a1 += 360.0
    n = max(2, int(math.ceil(abs(a1 - a0) / step_deg)))
    pts = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _parse_polyline_vertices(path: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    in_entities = False
    in_poly = False
    layer = "0"
    closed = False
    pts: List[Point] = []
    pending_x: Optional[float] = None
    for code, val in _read_pairs(path):
        if code == 2 and val.strip().upper() == "ENTITIES":
            in_entities = True
            continue
        if code == 0:
            v = val.strip().upper()
            if v == "ENDSEC":
                if in_poly and pts:
                    if closed and pts[0] != pts[-1]:
                        pts.append(pts[0])
                    out.append({"layer": layer, "closed": closed, "points": pts})
                in_entities = False
                in_poly = False
                continue
            if not in_entities:
                continue
            if v == "POLYLINE":
                in_poly = True
                layer, closed, pts = "0", False, []
                pending_x = None
                continue
            if v == "VERTEX" and in_poly:
                pending_x = None
                continue
            if v == "SEQEND" and in_poly:
                if pts:
                    if closed and pts[0] != pts[-1]:
                        pts.append(pts[0])
                    out.append(
                        {
                            "layer": layer,
                            "closed": closed or (len(pts) > 2 and pts[0] == pts[-1]),
                            "points": pts,
                        }
                    )
                in_poly = False
                continue
            continue
        if not in_entities or not in_poly:
            continue
        if code == 8:
            layer = val.strip() or "0"
        elif code == 70:
            closed = bool(int(float(val)) & 1)
        elif code == 10:
            pending_x = _f(val)
        elif code == 20 and pending_x is not None:
            pts.append((pending_x, _f(val)))
            pending_x = None
    return out


def parse_dxf(path: str) -> Dict[str, Any]:
    entities: List[Dict[str, Any]] = []
    in_entities = False
    cur: Optional[Dict[str, Any]] = None
    lw_pts: List[Point] = []

    def flush():
        nonlocal cur, lw_pts
        if not cur:
            return
        t = cur.get("type")
        if t == "LWPOLYLINE" and lw_pts:
            closed = bool(cur.get("closed"))
            pts = list(lw_pts)
            if closed and pts and pts[0] != pts[-1]:
                pts.append(pts[0])
            entities.append({"layer": cur.get("layer", "0"), "closed": closed, "points": pts})
        elif t == "LINE":
            entities.append(
                {
                    "layer": cur.get("layer", "0"),
                    "closed": False,
                    "points": [
                        (cur.get("x0", 0.0), cur.get("y0", 0.0)),
                        (cur.get("x1", 0.0), cur.get("y1", 0.0)),
                    ],
                }
            )
        elif t == "CIRCLE":
            cx, cy, r = cur.get("cx", 0.0), cur.get("cy", 0.0), cur.get("r", 0.0)
            if r > 0:
                entities.append(
                    {
                        "layer": cur.get("layer", "0"),
                        "closed": True,
                        "points": _arc_points(cx, cy, r, 0.0, 360.0, 3.0),
                    }
                )
        elif t == "ARC":
            cx, cy, r = cur.get("cx", 0.0), cur.get("cy", 0.0), cur.get("r", 0.0)
            if r > 0:
                entities.append(
                    {
                        "layer": cur.get("layer", "0"),
                        "closed": False,
                        "points": _arc_points(cx, cy, r, cur.get("a0", 0.0), cur.get("a1", 0.0), 3.0),
                    }
                )
        cur = None
        lw_pts = []

    for code, val in _read_pairs(path):
        if code == 2 and val.strip().upper() == "ENTITIES":
            in_entities = True
            flush()
            continue
        if code == 0:
            v = val.strip().upper()
            if v == "ENDSEC":
                flush()
                in_entities = False
                continue
            if not in_entities:
                flush()
                continue
            flush()
            if v in ("LWPOLYLINE", "LINE", "CIRCLE", "ARC"):
                cur = {"type": v, "layer": "0"}
                lw_pts = []
            else:
                cur = None
            continue
        if not in_entities or not cur:
            continue
        t = cur["type"]
        if code == 8:
            cur["layer"] = val.strip() or "0"
        elif t == "LWPOLYLINE":
            if code == 70:
                cur["closed"] = bool(int(float(val)) & 1)
            elif code == 10:
                cur["_x"] = _f(val)
            elif code == 20:
                lw_pts.append((cur.get("_x", 0.0), _f(val)))
        elif t == "LINE":
            if code == 10:
                cur["x0"] = _f(val)
            elif code == 20:
                cur["y0"] = _f(val)
            elif code == 11:
                cur["x1"] = _f(val)
            elif code == 21:
                cur["y1"] = _f(val)
        elif t in ("CIRCLE", "ARC"):
            if code == 10:
                cur["cx"] = _f(val)
            elif code == 20:
                cur["cy"] = _f(val)
            elif code == 40:
                cur["r"] = _f(val)
            elif code == 50:
                cur["a0"] = _f(val)
            elif code == 51:
                cur["a1"] = _f(val)
    flush()

    for e in _parse_polyline_vertices(path):
        entities.append(e)

    contours = []
    bounds = None
    for i, e in enumerate(entities):
        pts = e.get("points") or []
        if len(pts) < 2:
            continue
        pts2 = [(float(x), float(y)) for x, y in pts]
        closed = bool(e.get("closed")) or (len(pts2) > 2 and pts2[0] == pts2[-1])
        if closed:
            pts2 = ensure_ccw(pts2 if pts2[0] == pts2[-1] else pts2 + [pts2[0]])
        for x, y in pts2:
            if bounds is None:
                bounds = [x, y, x, y]
            else:
                bounds[0] = min(bounds[0], x)
                bounds[1] = min(bounds[1], y)
                bounds[2] = max(bounds[2], x)
                bounds[3] = max(bounds[3], y)
        contours.append(
            {
                "id": len(contours),
                "name": f"{e.get('layer', '0')}:{len(contours)}",
                "layer": e.get("layer", "0"),
                "closed": closed,
                "points": [[x, y] for x, y in pts2],
            }
        )
    return {"contours": contours, "bounds": bounds, "file": path}
