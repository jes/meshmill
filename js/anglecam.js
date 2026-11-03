/* Angled raster CAM: rotate heightmap, run horizontal route, unrotate G-code.
 *
 * pngcam only supports horizontal / vertical / helical. For an arbitrary
 * cut angle we rotate the heightmap content by -angle, generate a horizontal
 * toolpath, then rotate every XY move by +angle around the part centre.
 *
 * Heightmap rotation runs in the Electron main process (nativeImage) so it
 * does not depend on renderer Image/canvas loading of local temp files.
 */

/** Origin-relative XY bounds of the blank (stock box or model AABB). */
function getStockBoundsOriginRelative(project) {
    let o = project.mesh.origin;
    if (project.stock && project.stock.x > 0 && project.stock.y > 0) {
        let mx = (project.mesh.min.x + project.mesh.max.x) / 2;
        let my = (project.mesh.min.y + project.mesh.max.y) / 2;
        return {
            xmin: mx - project.stock.x / 2 - o.x,
            xmax: mx + project.stock.x / 2 - o.x,
            ymin: my - project.stock.y / 2 - o.y,
            ymax: my + project.stock.y / 2 - o.y,
        };
    }
    return {
        xmin: project.mesh.min.x - o.x,
        xmax: project.mesh.max.x - o.x,
        ymin: project.mesh.min.y - o.y,
        ymax: project.mesh.max.y - o.y,
    };
}

function pointInBounds(x, y, b, eps) {
    eps = eps || 1e-6;
    return x >= b.xmin - eps && x <= b.xmax + eps && y >= b.ymin - eps && y <= b.ymax + eps;
}

/** Liang-Barsky clip of segment to axis-aligned box. Returns null if outside. */
function clipSegmentToBounds(x0, y0, x1, y1, b) {
    let dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    let p = [-dx, dx, -dy, dy];
    let q = [x0 - b.xmin, b.xmax - x0, y0 - b.ymin, b.ymax - y0];
    for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-12) {
            if (q[i] < 0) return null;
            continue;
        }
        let r = q[i] / p[i];
        if (p[i] < 0) {
            if (r > t1) return null;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return null;
            if (r < t1) t1 = r;
        }
    }
    return {
        x0: x0 + t0 * dx,
        y0: y0 + t0 * dy,
        x1: x0 + t1 * dx,
        y1: y0 + t1 * dy,
        t0: t0,
        t1: t1,
    };
}

/**
 * Drop / clip G0/G1 moves so the tool centre stays inside the stock rectangle.
 * Cutting moves that leave the blank are truncated or removed (Aspire-like
 * material boundary). pngcam uses G1+high F for rapids — treat those as travel.
 */
function clipGcodeToStockBounds(gcodePath, bounds, safeZ, cb) {
    window.api.send('read-file', gcodePath, function(r) {
        if (r.err) return cb(r.err);
        let b = {
            xmin: bounds.xmin - 0.05,
            xmax: bounds.xmax + 0.05,
            ymin: bounds.ymin - 0.05,
            ymax: bounds.ymax + 0.05,
        };
        let lines = r.data.split(/\r?\n/);
        let curX = (bounds.xmin + bounds.xmax) / 2;
        let curY = (bounds.ymin + bounds.ymax) / 2;
        let curZ = safeZ;
        let lastF = 10000;
        let out = [];

        function lineIsCutting(codeIs1) {
            if (!codeIs1) return false;
            return lastF < 8000;
        }

        function withFeed(prefix, f) {
            return prefix + (f != null ? (' F' + f) : '');
        }

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (!/^G0*[01](?!\d)/i.test(line)) {
                out.push(line);
                continue;
            }
            let codeIs1 = /^G0*1(?!\d)/i.test(line);
            let xm = line.match(/\bX([+\-0-9.]+)/i);
            let ym = line.match(/\bY([+\-0-9.]+)/i);
            let zm = line.match(/\bZ([+\-0-9.]+)/i);
            let fm = line.match(/\bF([+\-0-9.]+)/i);
            if (fm) lastF = parseFloat(fm[1]);
            let nx = xm ? parseFloat(xm[1]) : curX;
            let ny = ym ? parseFloat(ym[1]) : curY;
            let nz = zm ? parseFloat(zm[1]) : curZ;
            let isCut = lineIsCutting(codeIs1);
            let prevInside = pointInBounds(curX, curY, b);
            let nextInside = pointInBounds(nx, ny, b);

            if (prevInside && nextInside) {
                out.push(line);
            } else if (!prevInside && !nextInside) {
                // Angled passes often span outside→outside while crossing stock
                let clipped = clipSegmentToBounds(curX, curY, nx, ny, b);
                if (clipped && isCut) {
                    let z0 = curZ + clipped.t0 * (nz - curZ);
                    let z1 = curZ + clipped.t1 * (nz - curZ);
                    out.push('G1 Z' + safeZ.toFixed(4) + ' F10000');
                    out.push('G1 X' + clipped.x0.toFixed(4) + ' Y' + clipped.y0.toFixed(4) + ' F10000');
                    out.push('G1 Z' + z0.toFixed(4) + ' F' + lastF);
                    out.push(withFeed('G1 X' + clipped.x1.toFixed(4) + ' Y' + clipped.y1.toFixed(4) + ' Z' + z1.toFixed(4), lastF));
                    out.push('G1 Z' + safeZ.toFixed(4) + ' F10000');
                    lastF = 10000;
                } else if (!isCut) {
                    out.push(line);
                }
            } else {
                let clipped = clipSegmentToBounds(curX, curY, nx, ny, b);
                if (!clipped) {
                    if (!isCut) out.push(line);
                } else if (prevInside && !nextInside) {
                    let zPart = ' Z' + (curZ + clipped.t1 * (nz - curZ)).toFixed(4);
                    if (isCut) {
                        out.push(withFeed('G1 X' + clipped.x1.toFixed(4) + ' Y' + clipped.y1.toFixed(4) + zPart, lastF));
                        out.push('G1 Z' + safeZ.toFixed(4) + ' F10000');
                        lastF = 10000;
                    } else {
                        out.push(withFeed('G1 X' + clipped.x1.toFixed(4) + ' Y' + clipped.y1.toFixed(4) + zPart, lastF));
                    }
                } else if (isCut) {
                    out.push('G1 Z' + safeZ.toFixed(4) + ' F10000');
                    out.push('G1 X' + clipped.x0.toFixed(4) + ' Y' + clipped.y0.toFixed(4) + ' F10000');
                    let zEntry = curZ + clipped.t0 * (nz - curZ);
                    out.push('G1 Z' + zEntry.toFixed(4) + ' F' + lastF);
                    out.push(withFeed('G1 X' + nx.toFixed(4) + ' Y' + ny.toFixed(4) + ' Z' + nz.toFixed(4), lastF));
                } else {
                    out.push(line);
                }
            }
            curX = nx; curY = ny; curZ = nz;
        }

        window.api.send('write-file', {
            file: gcodePath,
            data: out.join('\n'),
        }, function(writeErr) {
            cb(writeErr || null);
        });
    });
}

/** Build a world-axis-aligned heightmap whose content is the original
 *  geometry rotated by -angleDeg around centre. */
function plainMeshBounds(mesh, origin) {
    return {
        mesh: {
            min: { x: +mesh.min.x, y: +mesh.min.y, z: +mesh.min.z },
            max: { x: +mesh.max.x, y: +mesh.max.y, z: +mesh.max.z },
        },
        origin: {
            x: +(origin && origin.x) || 0,
            y: +(origin && origin.y) || 0,
            z: +(origin && origin.z) || 0,
        },
    };
}

function buildAngledHeightmap(srcFile, mesh, origin, angleDeg, resolution, outFile, cb, stockBounds) {
    let plain = plainMeshBounds(mesh, origin);
    window.api.send('rotate-heightmap', {
        srcFile: srcFile,
        outFile: outFile,
        angleDeg: angleDeg,
        resolution: resolution,
        mesh: plain.mesh,
        origin: plain.origin,
        stockBounds: stockBounds || null,
    }, function(r) {
        if (!r) return cb('rotate-heightmap: no reply');
        if (r.error) return cb(r.error);
        cb(null, r);
    });
}

/** Map a rotated write-stock PNG back onto the original heightmap grid. */
function unrotateStockHeightmap(rotatedFile, meta, mesh, origin, outW, outH, outFile, cb) {
    let plain = plainMeshBounds(mesh, origin);
    window.api.send('unrotate-heightmap', {
        srcFile: rotatedFile,
        outFile: outFile,
        meta: meta,
        mesh: plain.mesh,
        origin: plain.origin,
        outW: outW,
        outH: outH,
    }, function(r) {
        if (!r) return cb('unrotate-heightmap: no reply');
        if (r.error) return cb(r.error);
        cb(null);
    });
}

function unrotateGcodeFile(gcodePath, meta, cb) {
    window.api.send('read-file', gcodePath, function(r) {
        if (r.err) return cb(r.err);
        let rad = meta.angleDeg * Math.PI / 180;
        let cos = Math.cos(rad);
        let sin = Math.sin(rad);
        let cx = meta.cx;
        let cy = meta.cy;

        let lines = r.data.split(/\r?\n/);
        let curX = cx;
        let curY = cy;
        let out = [];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            // Match G0/G1 even when there is no space before X (G1X..)
            if (/^G0*[01](?!\d)/i.test(line)) {
                let xm = line.match(/\bX([+\-0-9.]+)/i);
                let ym = line.match(/\bY([+\-0-9.]+)/i);
                if (xm) curX = parseFloat(xm[1]);
                if (ym) curY = parseFloat(ym[1]);
                let dx = curX - cx;
                let dy = curY - cy;
                let nx = cx + dx * cos - dy * sin;
                let ny = cy + dx * sin + dy * cos;
                if (xm)
                    line = line.replace(/\bX[+\-0-9.]+/i, 'X' + nx.toFixed(4));
                else
                    line = line.replace(/^(G0*[01])/i, '$1 X' + nx.toFixed(4));
                if (ym)
                    line = line.replace(/\bY[+\-0-9.]+/i, 'Y' + ny.toFixed(4));
                else
                    line = line.replace(/^(G0*[01](?:\s*X[+\-0-9.]+)?)/i, '$1 Y' + ny.toFixed(4));
            }
            out.push(line);
        }

        window.api.send('write-file', {
            file: gcodePath,
            data: out.join('\n'),
        }, function(writeErr) {
            cb(writeErr || null);
        });
    });
}
