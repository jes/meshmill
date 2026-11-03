"""CAD import: DXF always; DWG via external converters when available."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from .dxf import parse_dxf


def find_dwg_converters() -> List[str]:
    """Return available DWG→DXF converter command names/paths."""
    names = [
        "dwg2dxf",
        "dwg2dxf.exe",
        "ODAFileConverter",
        "TeighaFileConverter",
    ]
    found = []
    for n in names:
        p = shutil.which(n)
        if p:
            found.append(p)
    # Common LibreDWG / ODA install prefixes
    for extra in (
        "/usr/bin/dwg2dxf",
        "/usr/local/bin/dwg2dxf",
        str(Path.home() / ".local/bin/dwg2dxf"),
    ):
        if os.path.isfile(extra) and os.access(extra, os.X_OK) and extra not in found:
            found.append(extra)
    return found


def _converter_env() -> dict:
    """Ensure ~/.local LibreDWG install is visible to spawned tools."""
    env = os.environ.copy()
    home_bin = str(Path.home() / ".local" / "bin")
    home_lib = str(Path.home() / ".local" / "lib")
    path = env.get("PATH", "")
    if home_bin not in path.split(":"):
        env["PATH"] = home_bin + (":" + path if path else "")
    ld = env.get("LD_LIBRARY_PATH", "")
    if home_lib not in ld.split(":"):
        env["LD_LIBRARY_PATH"] = home_lib + (":" + ld if ld else "")
    return env


def dwg_to_dxf(dwg_path: str, dxf_path: str) -> str:
    """Convert DWG→DXF using the first working converter. Returns converter used."""
    converters = find_dwg_converters()
    if not converters:
        raise RuntimeError(
            "DWG support needs an external converter. Install LibreDWG "
            "(package libredwg-tools → dwg2dxf) or ODA File Converter, then retry."
        )
    dwg_path = str(Path(dwg_path).resolve())
    dxf_path = str(Path(dxf_path).resolve())
    Path(dxf_path).parent.mkdir(parents=True, exist_ok=True)
    env = _converter_env()
    errors = []
    for conv in converters:
        base = Path(conv).name.lower()
        try:
            if "dwg2dxf" in base:
                # dwg2dxf [-y] [-o outfile] file.dwg
                r = subprocess.run(
                    [conv, "-y", "-o", dxf_path, dwg_path],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    env=env,
                )
                if r.returncode == 0 and Path(dxf_path).is_file() and Path(dxf_path).stat().st_size > 0:
                    return conv
                # some builds: dwg2dxf file.dwg  writes file.dxf alongside
                alt = str(Path(dwg_path).with_suffix(".dxf"))
                if Path(alt).is_file():
                    shutil.copy2(alt, dxf_path)
                    return conv
                errors.append(f"{conv}: {r.stderr or r.stdout or r.returncode}")
            elif "oda" in base or "teigha" in base:
                # ODAFileConverter input_dir output_dir version type recurse audit
                with tempfile.TemporaryDirectory() as td:
                    indir = Path(td) / "in"
                    outdir = Path(td) / "out"
                    indir.mkdir()
                    outdir.mkdir()
                    shutil.copy2(dwg_path, indir / Path(dwg_path).name)
                    r = subprocess.run(
                        [conv, str(indir), str(outdir), "ACAD2018", "DXF", "0", "1"],
                        capture_output=True,
                        text=True,
                        timeout=180,
                        env=env,
                    )
                    outs = list(outdir.glob("*.dxf")) + list(outdir.glob("*.DXF"))
                    if outs:
                        shutil.copy2(outs[0], dxf_path)
                        return conv
                    errors.append(f"{conv}: {r.stderr or r.stdout or 'no dxf'}")
        except Exception as e:
            errors.append(f"{conv}: {e}")
    raise RuntimeError("DWG conversion failed:\n" + "\n".join(errors))


def parse_cad(path: str, out_json: Optional[str] = None) -> Dict[str, Any]:
    """Import DXF or DWG → contour dict (same shape as parse_dxf)."""
    path = str(path)
    ext = Path(path).suffix.lower()
    meta: Dict[str, Any]
    converter = None
    if ext == ".dwg":
        dxf_tmp = str(Path(path).with_suffix(".converted.dxf"))
        # Prefer project-local converted file next to working copy
        converter = dwg_to_dxf(path, dxf_tmp)
        meta = parse_dxf(dxf_tmp)
        meta["converted_from"] = path
        meta["converter"] = converter
        meta["dxf"] = dxf_tmp
    elif ext == ".dxf":
        meta = parse_dxf(path)
    else:
        raise ValueError(f"Unsupported CAD type: {ext} (use .dxf or .dwg)")
    meta["format"] = ext[1:]
    if out_json:
        import json

        Path(out_json).write_text(json.dumps(meta, indent=2), encoding="utf-8")
        meta["out"] = out_json
    return meta
