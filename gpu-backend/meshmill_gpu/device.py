"""WebGPU / Vulkan device helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

try:
    import wgpu
except ImportError:  # pragma: no cover
    wgpu = None


@dataclass
class GpuDevice:
    adapter_summary: str
    device: object
    backend: str


def list_adapters() -> list[str]:
    if wgpu is None:
        return []
    return [a.summary for a in wgpu.gpu.enumerate_adapters_sync()]


def request_device(prefer: str = "high-performance") -> Optional[GpuDevice]:
    if wgpu is None:
        return None
    adapters = wgpu.gpu.enumerate_adapters_sync()
    if not adapters:
        return None
    # Prefer discrete/integrated Vulkan over llvmpipe/OpenGL.
    ranked = sorted(
        adapters,
        key=lambda a: (
            0 if "Vulkan" in a.summary and "llvmpipe" not in a.summary.lower() else
            1 if "Vulkan" in a.summary else
            2
        ),
    )
    adapter = ranked[0]
    # Still honour power preference when multiple good adapters exist.
    try:
        adapter = wgpu.gpu.request_adapter_sync(power_preference=prefer) or adapter
        if adapter and "llvmpipe" in adapter.summary.lower() and len(ranked) > 1:
            adapter = ranked[0]
    except Exception:
        pass
    device = adapter.request_device_sync()
    backend = "vulkan" if "Vulkan" in adapter.summary else "other"
    return GpuDevice(adapter_summary=adapter.summary, device=device, backend=backend)
