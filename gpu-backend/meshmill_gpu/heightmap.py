"""STL → heightmap via GPU depth rasterization (Vulkan/WebGPU) or numpy CPU."""

from __future__ import annotations

import struct
import time
from pathlib import Path
from typing import Callable, Optional, Tuple

import numpy as np

from .device import GpuDevice, request_device
from .pngmap import write_heightmap_png
from .stl import StlInfo, iter_triangle_batches, probe_stl

ProgressCb = Optional[Callable[[str, int], None]]

SHADER_PATH = Path(__file__).with_name("shaders") / "rasterize.wgsl"


def _ortho_mvp(xmin, xmax, ymin, ymax, zmin, zmax, bottom: bool) -> bytes:
    """Column-major 4x4: world → clip. Higher world Z → larger NDC z when not bottom."""
    # Map X→[-1,1], Y→[-1,1] (Y flip so image row0 = ymax), Z→[0,1]
    sx = 2.0 / max(xmax - xmin, 1e-12)
    sy = 2.0 / max(ymax - ymin, 1e-12)
    # For top: larger Z → closer (ndc z larger with depthCompare greater)
    # depth clear = 0; we use greater so max Z wins.
    if not bottom:
        sz = 1.0 / max(zmax - zmin, 1e-12)
        tz = -zmin * sz
    else:
        # Invert Z so underside (min Z) wins as "max" after flip
        sz = -1.0 / max(zmax - zmin, 1e-12)
        tz = zmax * (-sz)

    # clip_x = sx * x + tx, etc. Y flipped: ymax → -1? Image top = ymax → NDC y = +1
    # then viewport maps NDC y=+1 to pixel y=0... actually wgpu viewport: y-down in framebuffer.
    # We want pixel (0,0) = (xmin, ymax). NDC: x=-1→left, y=+1→top in standard GL,
    # but WebGPU framebuffer y increases downward. So NDC y=+1 → top row = ymax. Good if:
    # y_ndc = sy_flip * y + ty with ymax → +1, ymin → -1
    sy = 2.0 / max(ymax - ymin, 1e-12)
    ty = -(ymax + ymin) * sy / 2.0  # wrong for flip
    # ymax → +1:  sy*ymax + ty = 1; ymin → -1: sy*ymin + ty = -1
    # => sy = 2/(ymax-ymin), ty = -(ymax+ymin)/(ymax-ymin)
    ty = -(ymax + ymin) / max(ymax - ymin, 1e-12)
    tx = -(xmax + xmin) / max(xmax - xmin, 1e-12)
    sx = 2.0 / max(xmax - xmin, 1e-12)
    sy = 2.0 / max(ymax - ymin, 1e-12)

    # column-major mat4
    m = [
        sx, 0.0, 0.0, 0.0,
        0.0, sy, 0.0, 0.0,
        0.0, 0.0, sz, 0.0,
        tx, ty, tz, 1.0,
    ]
    return struct.pack("16f", *m) + struct.pack("4f", 0.0, 0.0, 0.0, 0.0)


def _rasterize_cpu(
    path: str,
    width: int,
    height: int,
    bottom: bool,
    batch_tris: int,
    progress: ProgressCb,
) -> Tuple[np.ndarray, float, float, float, float]:
    zbuf = np.full((height, width), -np.inf if not bottom else np.inf, dtype=np.float32)
    xmin = ymin = zmin = np.inf
    xmax = ymax = zmax = -np.inf
    info = probe_stl(path)
    done = 0
    t0 = time.time()
    for pos, amin, amax in iter_triangle_batches(path, batch_tris=batch_tris, info=info):
        xmin, ymin, zmin = amin
        xmax, ymax, zmax = amax
        # Need full AABB first for correct mapping — two-pass if unknown.
        done += pos.shape[0] // 3
        if progress and info.triangles:
            progress("Drawing triangles", int(100 * done / max(info.triangles, 1)))
    # Second pass with known bounds
    if not np.isfinite(xmin):
        raise ValueError("Empty STL")
    zbuf = np.full((height, width), -np.inf if not bottom else np.inf, dtype=np.float32)
    done = 0
    sx = (width - 1) / max(xmax - xmin, 1e-12)
    sy = (height - 1) / max(ymax - ymin, 1e-12)
    for pos, _, _ in iter_triangle_batches(path, batch_tris=batch_tris, info=info):
        tris = pos.reshape(-1, 3, 3)
        for tri in tris:
            _fill_tri(zbuf, tri, xmin, ymax, sx, sy, bottom)
        done += tris.shape[0]
        if progress and info.triangles:
            progress("Drawing triangles", int(100 * done / max(info.triangles, 1)))
    if not bottom:
        empty = ~np.isfinite(zbuf) | (zbuf == -np.inf)
        zbuf[empty] = zmin
    else:
        empty = ~np.isfinite(zbuf) | (zbuf == np.inf)
        zbuf[empty] = zmax
    if progress:
        progress("Drawing triangles", 100)
    _ = t0
    return zbuf, float(xmin), float(xmax), float(ymin), float(ymax)


def _fill_tri(zbuf, tri, xmin, ymax, sx, sy, bottom: bool) -> None:
    """Barycentric fill; Y flips so row 0 = ymax."""
    h, w = zbuf.shape
    pts = []
    for v in tri:
        px = (v[0] - xmin) * sx
        py = (ymax - v[1]) * sy
        pts.append((px, py, v[2]))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx = max(int(np.floor(min(xs))), 0)
    maxx = min(int(np.ceil(max(xs))), w - 1)
    miny = max(int(np.floor(min(ys))), 0)
    maxy = min(int(np.ceil(max(ys))), h - 1)
    if minx > maxx or miny > maxy:
        return
    (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = pts
    den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(den) < 1e-20:
        return
    for y in range(miny, maxy + 1):
        for x in range(minx, maxx + 1):
            w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den
            w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den
            w2 = 1.0 - w0 - w1
            if w0 < 0 or w1 < 0 or w2 < 0:
                continue
            z = w0 * z0 + w1 * z1 + w2 * z2
            if bottom:
                if z < zbuf[y, x]:
                    zbuf[y, x] = z
            else:
                if z > zbuf[y, x]:
                    zbuf[y, x] = z


def _rasterize_gpu(
    gpu: GpuDevice,
    path: str,
    width: int,
    height: int,
    bottom: bool,
    batch_tris: int,
    progress: ProgressCb,
) -> Tuple[np.ndarray, float, float, float, float]:
    import wgpu

    device = gpu.device
    info = probe_stl(path)

    # Pass 1: AABB only
    xmin = ymin = zmin = np.inf
    xmax = ymax = zmax = -np.inf
    done = 0
    for pos, amin, amax in iter_triangle_batches(path, batch_tris=batch_tris, info=info):
        xmin, ymin, zmin = map(float, amin)
        xmax, ymax, zmax = map(float, amax)
        done += pos.shape[0] // 3
        if progress and info.triangles:
            progress("Bounds", int(50 * done / max(info.triangles, 1)))
    if not np.isfinite(xmin):
        raise ValueError("Empty STL")

    # Expand Z slightly so depth isn't clamped
    zpad = max((zmax - zmin) * 1e-4, 1e-6)
    zmin_e, zmax_e = zmin - zpad, zmax + zpad

    color_tex = device.create_texture(
        size=(width, height, 1),
        format="r32float",
        usage=wgpu.TextureUsage.RENDER_ATTACHMENT | wgpu.TextureUsage.COPY_SRC,
    )
    depth_tex = device.create_texture(
        size=(width, height, 1),
        format="depth32float",
        usage=wgpu.TextureUsage.RENDER_ATTACHMENT,
    )
    color_view = color_tex.create_view()
    depth_view = depth_tex.create_view()

    shader = device.create_shader_module(code=SHADER_PATH.read_text())
    bind_layout = device.create_bind_group_layout(
        entries=[
            {
                "binding": 0,
                "visibility": wgpu.ShaderStage.VERTEX,
                "buffer": {"type": wgpu.BufferBindingType.uniform},
            }
        ]
    )
    pipeline_layout = device.create_pipeline_layout(bind_group_layouts=[bind_layout])
    pipeline = device.create_render_pipeline(
        layout=pipeline_layout,
        vertex={
            "module": shader,
            "entry_point": "vs_main",
            "buffers": [
                {
                    "array_stride": 12,
                    "step_mode": "vertex",
                    "attributes": [
                        {"format": "float32x3", "offset": 0, "shader_location": 0},
                    ],
                }
            ],
        },
        primitive={"topology": wgpu.PrimitiveTopology.triangle_list},
        depth_stencil={
            "format": "depth32float",
            "depth_write_enabled": True,
            "depth_compare": wgpu.CompareFunction.greater,
        },
        fragment={
            "module": shader,
            "entry_point": "fs_main",
            "targets": [{"format": "r32float"}],
        },
    )

    uniform_data = _ortho_mvp(xmin, xmax, ymin, ymax, zmin_e, zmax_e, bottom)
    uniform_buf = device.create_buffer_with_data(
        data=uniform_data,
        usage=wgpu.BufferUsage.UNIFORM | wgpu.BufferUsage.COPY_DST,
    )
    bind_group = device.create_bind_group(
        layout=bind_layout,
        entries=[{"binding": 0, "resource": {"buffer": uniform_buf, "offset": 0, "size": len(uniform_data)}}],
    )

    # Clear once, then draw batches without clearing depth/color
    first = True
    done = 0
    max_verts = batch_tris * 3
    # Preallocate a vertex buffer large enough for one batch; rewrite each time
    vbo = device.create_buffer(
        size=max_verts * 12,
        usage=wgpu.BufferUsage.VERTEX | wgpu.BufferUsage.COPY_DST,
    )

    for pos, _, _ in iter_triangle_batches(path, batch_tris=batch_tris, info=info):
        nbytes = pos.nbytes
        device.queue.write_buffer(vbo, 0, pos)
        encoder = device.create_command_encoder()
        color_load = wgpu.LoadOp.clear if first else wgpu.LoadOp.load
        depth_load = wgpu.LoadOp.clear if first else wgpu.LoadOp.load
        first = False
        rp = encoder.begin_render_pass(
            color_attachments=[
                {
                    "view": color_view,
                    "load_op": color_load,
                    "store_op": wgpu.StoreOp.store,
                    "clear_value": (zmin_e if not bottom else zmax_e, 0, 0, 1),
                }
            ],
            depth_stencil_attachment={
                "view": depth_view,
                "depth_load_op": depth_load,
                "depth_store_op": wgpu.StoreOp.store,
                "depth_clear_value": 0.0,
            },
        )
        rp.set_pipeline(pipeline)
        rp.set_bind_group(0, bind_group)
        rp.set_vertex_buffer(0, vbo, 0, nbytes)
        rp.draw(pos.shape[0], 1, 0, 0)
        rp.end()
        device.queue.submit([encoder.finish()])
        done += pos.shape[0] // 3
        if progress and info.triangles:
            progress("Drawing triangles", 50 + int(50 * done / max(info.triangles, 1)))

    # Read back R32Float
    bpr = width * 4
    align = 256
    padded_bpr = ((bpr + align - 1) // align) * align
    nbytes = padded_bpr * height
    read_buf = device.create_buffer(
        size=nbytes,
        usage=wgpu.BufferUsage.COPY_DST | wgpu.BufferUsage.MAP_READ,
    )
    encoder = device.create_command_encoder()
    encoder.copy_texture_to_buffer(
        {"texture": color_tex},
        {"buffer": read_buf, "bytes_per_row": padded_bpr, "rows_per_image": height},
        (width, height, 1),
    )
    device.queue.submit([encoder.finish()])
    read_buf.map_sync(wgpu.MapMode.READ)
    # wgpu-py returns memoryview via read_mapped or map
    try:
        raw = read_buf.read_mapped()
    except Exception:
        raw = memoryview(read_buf)
    arr = np.frombuffer(raw, dtype=np.float32, count=(padded_bpr // 4) * height).reshape(height, padded_bpr // 4)
    zbuf = np.array(arr[:, :width], dtype=np.float32, copy=True)
    read_buf.unmap()

    if progress:
        progress("Drawing triangles", 100)
    return zbuf, xmin, xmax, ymin, ymax


def render_heightmap(
    stl_path: str,
    width: int,
    height: int,
    png_path: str,
    bottom: bool = False,
    batch_tris: int = 262_144,
    force_cpu: bool = False,
    progress: ProgressCb = None,
) -> dict:
    """Render STL to 24-bit heightmap PNG. Returns metadata dict."""
    gpu = None if force_cpu else request_device()
    t0 = time.time()
    if gpu is not None:
        try:
            zbuf, xmin, xmax, ymin, ymax = _rasterize_gpu(
                gpu, stl_path, width, height, bottom, batch_tris, progress
            )
            backend = f"gpu:{gpu.adapter_summary}"
        except Exception as e:
            if progress:
                progress(f"GPU failed ({e}); CPU", 0)
            zbuf, xmin, xmax, ymin, ymax = _rasterize_cpu(
                stl_path, width, height, bottom, batch_tris, progress
            )
            backend = f"cpu-fallback after {e}"
    else:
        zbuf, xmin, xmax, ymin, ymax = _rasterize_cpu(
            stl_path, width, height, bottom, batch_tris, progress
        )
        backend = "cpu"

    zmin = float(np.min(zbuf))
    zmax = float(np.max(zbuf))
    write_heightmap_png(png_path, zbuf, zmin, zmax)
    info = probe_stl(stl_path)
    return {
        "png": png_path,
        "width": width,
        "height": height,
        "zmin": zmin,
        "zmax": zmax,
        "xmin": xmin,
        "xmax": xmax,
        "ymin": ymin,
        "ymax": ymax,
        "triangles": info.triangles,
        "backend": backend,
        "seconds": time.time() - t0,
    }
