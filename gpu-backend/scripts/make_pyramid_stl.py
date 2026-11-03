#!/usr/bin/env python3
"""Write a tiny binary pyramid STL for smoke tests."""
import struct
import sys
from pathlib import Path


def tri(n, a, b, c):
    return struct.pack("<3f9fH", *n, *a, *b, *c, 0)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "pyramid.stl")
    # Base 40x40 on Z=0, apex at (20,20,15)
    v = [
        (0, 0, 0),
        (40, 0, 0),
        (40, 40, 0),
        (0, 40, 0),
        (20, 20, 15),
    ]
    faces = [
        (0, 1, 4),
        (1, 2, 4),
        (2, 3, 4),
        (3, 0, 4),
        (0, 2, 1),  # base (two tris)
        (0, 3, 2),
    ]
    tris = []
    for i, j, k in faces:
        a, b, c = v[i], v[j], v[k]
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        tris.append(tri((nx, ny, nz), a, b, c))
    blob = b"\0" * 80 + struct.pack("<I", len(tris)) + b"".join(tris)
    out.write_bytes(blob)
    print(out, len(tris), "triangles")


if __name__ == "__main__":
    main()
