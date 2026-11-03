"""Heightmap → tool-offset map → scanline G-code (with step-down roughing)."""

from __future__ import annotations

import struct
import time
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import numpy as np

from .device import request_device
from .pngmap import read_heightmap_png, write_heightmap_png

ProgressCb = Optional[Callable[[str, int], None]]


def _kernel_mm(
    radius_mm: float,
    sx: float,
    sy: float,
    shape: str,
) -> Tuple[np.ndarray, int]:
    rad = int(np.ceil(radius_mm / max(min(sx, sy), 1e-12)))
    ys, xs = np.ogrid[-rad : rad + 1, -rad : rad + 1]
    dist = np.sqrt((xs * sx) ** 2 + (ys * sy) ** 2)
    mask = dist <= radius_mm + 1e-9
    if shape == "ball":
        add = np.where(
            mask,
            radius_mm - np.sqrt(np.maximum(radius_mm**2 - dist**2, 0.0)),
            -np.inf,
        )
    else:
        add = np.where(mask, 0.0, -np.inf)
    return add.astype(np.float32), rad


def tool_offset_mm(
    z: np.ndarray,
    width_mm: float,
    height_mm: float,
    radius_mm: float,
    shape: str = "ball",
    force_cpu: bool = False,
) -> Tuple[np.ndarray, str]:
    h, w = z.shape
    if radius_mm < 1e-6:
        return z.copy(), "noop"
    sx = width_mm / max(w - 1, 1)
    sy = height_mm / max(h - 1, 1)
    add, rad = _kernel_mm(radius_mm, sx, sy, shape)

    if not force_cpu:
        try:
            out = _tool_offset_gpu_mm(z, add, rad)
            if shape == "ball":
                out = out - radius_mm
            return out, "gpu"
        except Exception as e:
            backend = f"cpu-fallback:{e}"
    else:
        backend = "cpu"

    out = np.full_like(z, -np.inf)
    for y in range(h):
        y0, y1 = max(0, y - rad), min(h, y + rad + 1)
        ky0, ky1 = y0 - (y - rad), y1 - (y - rad)
        for x in range(w):
            x0, x1 = max(0, x - rad), min(w, x + rad + 1)
            kx0, kx1 = x0 - (x - rad), x1 - (x - rad)
            out[y, x] = np.max(z[y0:y1, x0:x1] + add[ky0:ky1, kx0:kx1])
    if shape == "ball":
        out = out - radius_mm
    return out, backend


def _tool_offset_gpu_mm(z: np.ndarray, add: np.ndarray, rad: int) -> np.ndarray:
    import wgpu

    gpu = request_device()
    if gpu is None:
        raise RuntimeError("No GPU")
    device = gpu.device
    h, w = z.shape
    kh, kw = add.shape
    src = np.ascontiguousarray(z, dtype=np.float32)
    kern = np.ascontiguousarray(add, dtype=np.float32)
    kern = np.where(np.isfinite(kern), kern, np.float32(-1e30))

    shader = device.create_shader_module(
        code="""
struct P {
    width: u32,
    height: u32,
    kw: u32,
    kh: u32,
    rad: i32,
    _p0: i32,
    _p1: i32,
    _p2: i32,
};
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> kern: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (u32(x) >= p.width || u32(y) >= p.height) { return; }
    var best: f32 = -1e30;
    for (var ky: i32 = 0; ky < i32(p.kh); ky++) {
        let yy = y + ky - p.rad;
        if (yy < 0 || yy >= i32(p.height)) { continue; }
        for (var kx: i32 = 0; kx < i32(p.kw); kx++) {
            let xx = x + kx - p.rad;
            if (xx < 0 || xx >= i32(p.width)) { continue; }
            let a = kern[u32(ky) * p.kw + u32(kx)];
            if (a < -1e29) { continue; }
            let z = src[u32(yy) * p.width + u32(xx)];
            best = max(best, z + a);
        }
    }
    dst[u32(y) * p.width + u32(x)] = best;
}
"""
    )
    params = struct.pack("<IIIIiiii", w, h, kw, kh, rad, 0, 0, 0)
    ubuf = device.create_buffer_with_data(data=params, usage=wgpu.BufferUsage.UNIFORM)
    src_buf = device.create_buffer_with_data(
        data=src, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_DST
    )
    kern_buf = device.create_buffer_with_data(
        data=kern, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_DST
    )
    dst_buf = device.create_buffer(
        size=src.nbytes,
        usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC,
    )
    bgl = device.create_bind_group_layout(
        entries=[
            {"binding": 0, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.uniform}},
            {"binding": 1, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
            {"binding": 2, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
            {"binding": 3, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.storage}},
        ]
    )
    pipe = device.create_compute_pipeline(
        layout=device.create_pipeline_layout(bind_group_layouts=[bgl]),
        compute={"module": shader, "entry_point": "main"},
    )
    bg = device.create_bind_group(
        layout=bgl,
        entries=[
            {"binding": 0, "resource": {"buffer": ubuf, "offset": 0, "size": len(params)}},
            {"binding": 1, "resource": {"buffer": src_buf, "offset": 0, "size": src.nbytes}},
            {"binding": 2, "resource": {"buffer": kern_buf, "offset": 0, "size": kern.nbytes}},
            {"binding": 3, "resource": {"buffer": dst_buf, "offset": 0, "size": src.nbytes}},
        ],
    )
    enc = device.create_command_encoder()
    cpass = enc.begin_compute_pass()
    cpass.set_pipeline(pipe)
    cpass.set_bind_group(0, bg)
    cpass.dispatch_workgroups((w + 7) // 8, (h + 7) // 8, 1)
    cpass.end()
    read_buf = device.create_buffer(
        size=src.nbytes, usage=wgpu.BufferUsage.COPY_DST | wgpu.BufferUsage.MAP_READ
    )
    enc.copy_buffer_to_buffer(dst_buf, 0, read_buf, 0, src.nbytes)
    device.queue.submit([enc.finish()])
    read_buf.map_sync(wgpu.MapMode.READ)
    try:
        raw = read_buf.read_mapped()
    except Exception:
        raw = memoryview(read_buf)
    out = np.frombuffer(raw, dtype=np.float32, count=w * h).reshape(h, w).copy()
    read_buf.unmap()
    return out


def _pixel_to_mm(x, y, w, h, width_mm, height_mm, x_off, y_off):
    xm = x_off + width_mm * (x / max(w - 1, 1))
    ym = y_off + height_mm * (1.0 - y / max(h - 1, 1))
    return xm, ym


def scanline_gcode(
    z_tool: np.ndarray,
    *,
    width_mm: float,
    height_mm: float,
    zmin: float,
    zmax: float,
    step_over_mm: float,
    xy_feed: float,
    z_feed: float,
    rapid_feed: float,
    rapid_clearance: float,
    x_offset: float = 0.0,
    y_offset: float = 0.0,
    z_offset: float = 0.0,
    route: str = "horizontal",
    omit_top: bool = False,
    omit_bottom: bool = False,
    z_stock: Optional[np.ndarray] = None,
    header: bool = True,
    footer: bool = True,
) -> List[str]:
    """Emit G-code lines for one Z-pass. Optionally skip XY where stock already clear."""
    h, w = z_tool.shape

    def cut_z(zv: float) -> float:
        return float(zv - zmax + z_offset)

    px_per_mm_x = (w - 1) / max(width_mm, 1e-12)
    step_px = max(1, int(round(step_over_mm * px_per_mm_x)))
    safe = rapid_clearance + z_offset
    eps = (zmax - zmin) * 1e-4 + 1e-6
    stock_eps = max(eps, 1e-3)

    lines: List[str] = []
    if header:
        lines += ["G21", "G90", f"G0 Z{safe:.4f} F{rapid_feed:.1f}"]

    def need_cut(y: int, x: int, zv: float) -> bool:
        if omit_top and zv >= zmax - eps:
            return False
        if omit_bottom and zv <= zmin + eps:
            return False
        if z_stock is not None:
            # Only cut where stock is still above this pass (material to remove)
            if float(z_stock[y, x]) <= zv + stock_eps:
                return False
        return True

    def emit_row(y: int, xs):
        started = False
        for x in xs:
            zv = float(z_tool[y, x])
            if not need_cut(y, x, zv):
                if started:
                    lines.append(f"G0 Z{safe:.4f} F{rapid_feed:.1f}")
                    started = False
                continue
            xm, ym = _pixel_to_mm(x, y, w, h, width_mm, height_mm, x_offset, y_offset)
            cz = cut_z(zv)
            if not started:
                lines.append(f"G0 X{xm:.4f} Y{ym:.4f} F{rapid_feed:.1f}")
                lines.append(f"G1 Z{cz:.4f} F{z_feed:.1f}")
                started = True
            else:
                lines.append(f"G1 X{xm:.4f} Y{ym:.4f} Z{cz:.4f} F{xy_feed:.1f}")
        if started:
            lines.append(f"G0 Z{safe:.4f} F{rapid_feed:.1f}")

    if route == "vertical":
        px_per_mm_y = (h - 1) / max(height_mm, 1e-12)
        step_px = max(1, int(round(step_over_mm * px_per_mm_y)))
        for i, x in enumerate(range(0, w, step_px)):
            ys = range(0, h) if (i % 2 == 0) else range(h - 1, -1, -1)
            started = False
            for y in ys:
                zv = float(z_tool[y, x])
                if not need_cut(y, x, zv):
                    if started:
                        lines.append(f"G0 Z{safe:.4f} F{rapid_feed:.1f}")
                        started = False
                    continue
                xm, ym = _pixel_to_mm(x, y, w, h, width_mm, height_mm, x_offset, y_offset)
                cz = cut_z(zv)
                if not started:
                    lines.append(f"G0 X{xm:.4f} Y{ym:.4f} F{rapid_feed:.1f}")
                    lines.append(f"G1 Z{cz:.4f} F{z_feed:.1f}")
                    started = True
                else:
                    lines.append(f"G1 X{xm:.4f} Y{ym:.4f} Z{cz:.4f} F{xy_feed:.1f}")
            if started:
                lines.append(f"G0 Z{safe:.4f} F{rapid_feed:.1f}")
    else:
        for i, y in enumerate(range(0, h, step_px)):
            xs = range(0, w) if (i % 2 == 0) else range(w - 1, -1, -1)
            emit_row(y, xs)

    if footer:
        lines += [f"G0 Z{safe:.4f} F{rapid_feed:.1f}", "M2"]
    return lines


def generate_toolpath(
    heightmap_png: str,
    gcode_path: str,
    *,
    width_mm: float,
    height_mm: float,
    depth_mm: float,
    tool_diameter: float = 6.0,
    tool_shape: str = "ball",
    step_over: float = 1.5,
    step_down: Optional[float] = None,
    roughing_only: bool = False,
    xy_feed: float = 400.0,
    z_feed: float = 50.0,
    rapid_feed: float = 10000.0,
    rapid_clearance: float = 5.0,
    x_offset: float = 0.0,
    y_offset: float = 0.0,
    z_offset: float = 0.0,
    route: str = "horizontal",
    omit_top: bool = False,
    omit_bottom: bool = False,
    write_stock: Optional[str] = None,
    read_stock: Optional[str] = None,
    force_cpu: bool = False,
    progress: ProgressCb = None,
) -> dict:
    t0 = time.time()
    if progress:
        progress("Loading heightmap", 5)
    z = read_heightmap_png(heightmap_png, 0.0, depth_mm)
    zmin, zmax = 0.0, float(depth_mm)
    h, w = z.shape
    radius_mm = tool_diameter * 0.5
    if progress:
        progress("Tool offset", 15)
    z_finish, backend = tool_offset_mm(
        z, width_mm, height_mm, radius_mm, tool_shape, force_cpu=force_cpu
    )

    # Stock surface before this job (world Z, same encoding as heightmap)
    if read_stock:
        z_stock = read_heightmap_png(read_stock, 0.0, depth_mm)
        if z_stock.shape != z_finish.shape:
            # Nearest resize
            from PIL import Image
            img = Image.fromarray(
                ((z_stock - zmin) / max(zmax - zmin, 1e-12) * 255).astype(np.uint8)
            )
            img = img.resize((w, h), Image.NEAREST)
            z_stock = np.asarray(img, dtype=np.float64) / 255.0 * (zmax - zmin) + zmin
            z_stock = z_stock.astype(np.float32)
    else:
        z_stock = np.full_like(z_finish, zmax, dtype=np.float32)

    common = dict(
        width_mm=width_mm,
        height_mm=height_mm,
        zmin=zmin,
        zmax=zmax,
        step_over_mm=step_over,
        xy_feed=xy_feed,
        z_feed=z_feed,
        rapid_feed=rapid_feed,
        rapid_clearance=rapid_clearance,
        x_offset=x_offset,
        y_offset=y_offset,
        z_offset=z_offset,
        route=route,
        omit_top=omit_top,
        omit_bottom=omit_bottom,
    )

    lines: List[str] = []
    sd = float(step_down) if step_down and step_down > 0 else None
    do_rough = sd is not None and sd < (zmax - zmin) - 1e-6
    passes = 0

    if do_rough:
        max_passes = int(np.ceil((zmax - zmin) / sd)) + 3
        for pi in range(max_passes):
            if progress:
                progress("Roughing", 20 + int(60 * pi / max(max_passes, 1)))
            # Ceiling this pass may reach
            z_pass = np.maximum(z_finish, z_stock - sd)
            removable = float(np.max(z_stock - z_pass))
            if removable < 1e-4:
                break
            # Stop before a redundant "almost finish" rough pass when finish follows
            if not roughing_only and float(np.max(z_pass - z_finish)) < 1e-3:
                break
            body = scanline_gcode(
                z_pass,
                z_stock=z_stock,
                header=(len(lines) == 0),
                footer=False,
                **common,
            )
            lines.extend(body)
            z_stock = np.minimum(z_stock, z_pass)
            passes += 1
            if roughing_only and float(np.max(z_stock - z_finish)) <= sd + 1e-3:
                # Leave up to one step_down of material (or less)
                break

        if not roughing_only:
            if progress:
                progress("Finish pass", 85)
            body = scanline_gcode(
                z_finish,
                z_stock=z_stock,
                header=(len(lines) == 0),
                footer=False,
                **common,
            )
            lines.extend(body)
            z_stock = np.minimum(z_stock, z_finish)
            passes += 1
    else:
        if progress:
            progress("Scanline", 70)
        body = scanline_gcode(
            z_finish,
            z_stock=z_stock if read_stock else None,
            header=True,
            footer=False,
            **common,
        )
        lines.extend(body)
        z_stock = np.minimum(z_stock, z_finish)
        passes = 1

    safe = rapid_clearance + z_offset
    lines += [f"G0 Z{safe:.4f} F{rapid_feed:.1f}", "M2"]
    Path(gcode_path).write_text("\n".join(lines) + "\n", encoding="utf-8")

    if write_stock:
        # Output stock after this job (pngcam-compatible 0..depth encoding)
        write_heightmap_png(
            write_stock,
            np.clip(z_stock, zmin, zmax + radius_mm),
            zmin,
            zmax,
        )

    if progress:
        progress("Done", 100)
    return {
        "gcode": gcode_path,
        "backend": backend,
        "seconds": time.time() - t0,
        "pixels": [w, h],
        "passes": passes,
        "roughing": bool(do_rough),
    }
