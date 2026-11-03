"""CLI for Meshmill GPU backend."""

from __future__ import annotations

import argparse
import json
import sys


def _progress(stage: str, pct: int) -> None:
    print(f"{stage}: {pct}%", file=sys.stderr, flush=True)


def cmd_device(_args: argparse.Namespace) -> int:
    from .device import list_adapters, request_device

    adapters = list_adapters()
    if not adapters:
        print("No WebGPU/Vulkan adapters (CPU-only fallback available).")
        return 1
    for a in adapters:
        print(a)
    dev = request_device()
    if dev:
        print(f"selected: {dev.adapter_summary}")
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    from .stl import probe_stl

    info = probe_stl(args.stl)
    print(
        json.dumps(
            {
                "path": info.path,
                "triangles": info.triangles,
                "size": info.size,
                "binary": info.binary,
            },
            indent=2,
        )
    )
    return 0


def cmd_decimate(args: argparse.Namespace) -> int:
    from .decimate import decimate_stl

    meta = decimate_stl(
        args.stl,
        args.out,
        target_tris=args.target,
        progress=None if args.quiet else _progress,
    )
    print(json.dumps(meta, indent=2))
    return 0


def cmd_render(args: argparse.Namespace) -> int:
    from .heightmap import render_heightmap

    png = args.png or (args.stl + ".png")
    meta = render_heightmap(
        args.stl,
        width=args.width,
        height=args.height,
        png_path=png,
        bottom=args.bottom,
        batch_tris=args.batch_tris,
        force_cpu=args.cpu,
        progress=None if args.quiet else _progress,
    )
    print(json.dumps(meta, indent=2))
    return 0


def cmd_toolpath(args: argparse.Namespace) -> int:
    from .toolpath import generate_toolpath

    meta = generate_toolpath(
        args.heightmap,
        args.gcode,
        width_mm=args.width_mm,
        height_mm=args.height_mm,
        depth_mm=args.depth_mm,
        tool_diameter=args.tool_diameter,
        tool_shape=args.tool_shape,
        step_over=args.step_over,
        step_down=args.step_down,
        roughing_only=args.roughing_only,
        xy_feed=args.xy_feed,
        z_feed=args.z_feed,
        rapid_feed=args.rapid_feed,
        rapid_clearance=args.rapid_clearance,
        x_offset=args.x_offset,
        y_offset=args.y_offset,
        z_offset=args.z_offset,
        route=args.route,
        omit_top=args.omit_top,
        omit_bottom=args.omit_bottom,
        write_stock=args.write_stock,
        read_stock=args.read_stock,
        force_cpu=args.cpu,
        progress=None if args.quiet else _progress,
    )
    print(json.dumps(meta, indent=2))
    return 0


def cmd_dxf(args: argparse.Namespace) -> int:
    from .cad_import import parse_cad

    path = getattr(args, "dxf", None) or getattr(args, "cad", None)
    try:
        meta = parse_cad(path, out_json=args.out)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        print(json.dumps({"error": str(e)}))
        return 1
    # Avoid dumping huge contour JSON to stdout (can stall Electron pipes).
    summary = {
        "file": meta.get("file") or path,
        "format": meta.get("format"),
        "contours": len(meta.get("contours") or []),
        "bounds": meta.get("bounds"),
        "out": meta.get("out") or args.out,
        "converter": meta.get("converter"),
        "dxf": meta.get("dxf"),
    }
    print(json.dumps(summary, indent=2))
    return 0


def _profile_kwargs(args):
    return dict(
        heightmap_png=args.heightmap,
        contour_json=args.contour,
        width_mm=args.width_mm,
        height_mm=args.height_mm,
        depth_mm=args.depth_mm,
        tool_diameter=args.tool_diameter,
        step_down=args.step_down,
        allowance_mm=args.allowance,
        xy_feed=args.xy_feed,
        z_feed=args.z_feed,
        rapid_feed=args.rapid_feed,
        rapid_clearance=args.rapid_clearance,
        z_offset=args.z_offset,
        xmin=args.x_offset,
        ymin=args.y_offset,
        spindle=args.spindle,
        contour_out=args.write_contour,
        progress=None if args.quiet else _progress,
    )


def cmd_profile_outside(args: argparse.Namespace) -> int:
    from .profile import generate_profile

    meta = generate_profile(args.gcode, side="outside", **_profile_kwargs(args))
    print(json.dumps(meta, indent=2))
    return 0


def cmd_profile_inside(args: argparse.Namespace) -> int:
    from .profile import generate_profile

    meta = generate_profile(args.gcode, side="inside", **_profile_kwargs(args))
    print(json.dumps(meta, indent=2))
    return 0


def cmd_pocket(args: argparse.Namespace) -> int:
    from .profile import generate_pocket

    meta = generate_pocket(
        args.gcode,
        heightmap_png=args.heightmap,
        contour_json=args.contour,
        width_mm=args.width_mm,
        height_mm=args.height_mm,
        depth_mm=args.depth_mm,
        tool_diameter=args.tool_diameter,
        step_over=args.step_over,
        step_down=args.step_down,
        allowance_mm=args.allowance,
        xy_feed=args.xy_feed,
        z_feed=args.z_feed,
        rapid_feed=args.rapid_feed,
        rapid_clearance=args.rapid_clearance,
        z_offset=args.z_offset,
        xmin=args.x_offset,
        ymin=args.y_offset,
        spindle=args.spindle,
        style=args.style,
        contour_out=args.write_contour,
        progress=None if args.quiet else _progress,
    )
    print(json.dumps(meta, indent=2))
    return 0


def _add_profile_args(p):
    p.add_argument("--gcode", required=True)
    p.add_argument("--heightmap", default=None)
    p.add_argument("--contour", default=None)
    p.add_argument("--width-mm", type=float, required=True)
    p.add_argument("--height-mm", type=float, required=True)
    p.add_argument("--depth-mm", type=float, required=True)
    p.add_argument("--tool-diameter", type=float, default=6.0)
    p.add_argument("--step-down", type=float, default=2.0)
    p.add_argument("--allowance", type=float, default=0.0)
    p.add_argument("--xy-feed", type=float, default=400.0)
    p.add_argument("--z-feed", type=float, default=50.0)
    p.add_argument("--rapid-feed", type=float, default=10000.0)
    p.add_argument("--rapid-clearance", type=float, default=5.0)
    p.add_argument("--x-offset", type=float, default=0.0)
    p.add_argument("--y-offset", type=float, default=0.0)
    p.add_argument("--z-offset", type=float, default=0.0)
    p.add_argument("--spindle", type=float, default=10000.0)
    p.add_argument("--write-contour", default=None)
    p.add_argument("--quiet", action="store_true")
    return p


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="meshmill_gpu", description="GPU CAM backend for Meshmill")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("device", help="List GPU adapters")
    d.set_defaults(func=cmd_device)

    pr = sub.add_parser("probe", help="STL triangle/size probe (no load into RAM)")
    pr.add_argument("stl")
    pr.set_defaults(func=cmd_probe)

    de = sub.add_parser("decimate", help="Spatial-decimate huge STL for preview")
    de.add_argument("stl")
    de.add_argument("--out", required=True)
    de.add_argument("--target", type=int, default=400_000)
    de.add_argument("--quiet", action="store_true")
    de.set_defaults(func=cmd_decimate)

    r = sub.add_parser("render", help="STL → heightmap PNG (GPU Z-buffer)")
    r.add_argument("stl")
    r.add_argument("--width", type=int, default=400)
    r.add_argument("--height", type=int, default=400)
    r.add_argument("--png", default=None)
    r.add_argument("--bottom", action="store_true")
    r.add_argument("--batch-tris", type=int, default=262144)
    r.add_argument("--cpu", action="store_true", help="Force CPU rasterizer")
    r.add_argument("--quiet", action="store_true")
    r.set_defaults(func=cmd_render)

    t = sub.add_parser("toolpath", help="Heightmap PNG → G-code")
    t.add_argument("heightmap")
    t.add_argument("--gcode", required=True)
    t.add_argument("--width-mm", type=float, required=True)
    t.add_argument("--height-mm", type=float, required=True)
    t.add_argument("--depth-mm", type=float, required=True)
    t.add_argument("--tool-diameter", type=float, default=6.0)
    t.add_argument("--tool-shape", choices=["ball", "flat"], default="ball")
    t.add_argument("--step-over", type=float, default=1.5)
    t.add_argument("--step-down", type=float, default=None)
    t.add_argument("--roughing-only", action="store_true")
    t.add_argument("--xy-feed", type=float, default=400.0)
    t.add_argument("--z-feed", type=float, default=50.0)
    t.add_argument("--rapid-feed", type=float, default=10000.0)
    t.add_argument("--rapid-clearance", type=float, default=5.0)
    t.add_argument("--x-offset", type=float, default=0.0)
    t.add_argument("--y-offset", type=float, default=0.0)
    t.add_argument("--z-offset", type=float, default=0.0)
    t.add_argument("--route", choices=["horizontal", "vertical"], default="horizontal")
    t.add_argument("--omit-top", action="store_true")
    t.add_argument("--omit-bottom", action="store_true")
    t.add_argument("--write-stock", default=None)
    t.add_argument("--read-stock", default=None)
    t.add_argument("--cpu", action="store_true")
    t.add_argument("--quiet", action="store_true")
    t.set_defaults(func=cmd_toolpath)

    dx = sub.add_parser("dxf", help="Import DXF/DWG contours")
    dx.add_argument("dxf")
    dx.add_argument("--out", default=None, help="Write JSON contours")
    dx.set_defaults(func=cmd_dxf)

    cad = sub.add_parser("cad", help="Import DXF or DWG (DWG needs dwg2dxf)")
    cad.add_argument("cad")
    cad.add_argument("--out", default=None)
    cad.set_defaults(func=cmd_dxf)

    po = _add_profile_args(sub.add_parser("profile-outside", help="Outside contour trim"))
    po.set_defaults(func=cmd_profile_outside)

    pi = _add_profile_args(sub.add_parser("profile-inside", help="Inside contour profile"))
    pi.set_defaults(func=cmd_profile_inside)

    pk = _add_profile_args(sub.add_parser("pocket", help="Pocket inside contour"))
    pk.add_argument("--step-over", type=float, default=1.5)
    pk.add_argument("--style", choices=["hatch", "concentric"], default="hatch")
    pk.set_defaults(func=cmd_pocket)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
