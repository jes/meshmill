/**
 * Minimal DXF parser for Meshmill (main or renderer).
 * Supports LWPOLYLINE, POLYLINE/VERTEX, LINE, CIRCLE, ARC.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DxfParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function fnum(v) {
        let n = parseFloat(v);
        return isFinite(n) ? n : 0;
    }

    function arcPoints(cx, cy, r, a0, a1, stepDeg) {
        stepDeg = stepDeg || 5;
        if (a1 < a0) a1 += 360;
        let n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / stepDeg));
        let pts = [];
        for (let i = 0; i <= n; i++) {
            let a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
    }

    function readPairs(text) {
        let lines = text.split(/\r?\n/);
        let pairs = [];
        for (let i = 0; i + 1 < lines.length; i += 2) {
            let code = parseInt(String(lines[i]).trim(), 10);
            if (!isFinite(code)) continue;
            pairs.push([code, lines[i + 1]]);
        }
        return pairs;
    }

    function parseDxfText(text) {
        let pairs = readPairs(text);
        let inEntities = false;
        let entities = [];
        let cur = null;
        let lwPts = [];

        function flush() {
            if (!cur) return;
            let t = cur.type;
            if (t === 'LWPOLYLINE' && lwPts.length >= 2) {
                let pts = lwPts.slice();
                let closed = !!cur.closed;
                if (closed && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]))
                    pts.push([pts[0][0], pts[0][1]]);
                entities.push({ layer: cur.layer || '0', closed: closed, points: pts });
            } else if (t === 'LINE') {
                entities.push({
                    layer: cur.layer || '0',
                    closed: false,
                    points: [[cur.x0 || 0, cur.y0 || 0], [cur.x1 || 0, cur.y1 || 0]],
                });
            } else if (t === 'CIRCLE' && cur.r > 0) {
                entities.push({
                    layer: cur.layer || '0',
                    closed: true,
                    points: arcPoints(cur.cx || 0, cur.cy || 0, cur.r, 0, 360, 3),
                });
            } else if (t === 'ARC' && cur.r > 0) {
                entities.push({
                    layer: cur.layer || '0',
                    closed: false,
                    points: arcPoints(cur.cx || 0, cur.cy || 0, cur.r, cur.a0 || 0, cur.a1 || 0, 3),
                });
            }
            cur = null;
            lwPts = [];
        }

        // POLYLINE … VERTEX … SEQEND
        let inPoly = false, polyLayer = '0', polyClosed = false, polyPts = [], pendingX = null;

        for (let pi = 0; pi < pairs.length; pi++) {
            let code = pairs[pi][0];
            let val = pairs[pi][1];
            let valU = String(val).trim().toUpperCase();

            if (code === 2 && valU === 'ENTITIES') {
                inEntities = true;
                flush();
                continue;
            }
            if (code === 0) {
                if (valU === 'ENDSEC') {
                    flush();
                    if (inPoly && polyPts.length >= 2) {
                        if (polyClosed && (polyPts[0][0] !== polyPts[polyPts.length - 1][0] ||
                            polyPts[0][1] !== polyPts[polyPts.length - 1][1]))
                            polyPts.push([polyPts[0][0], polyPts[0][1]]);
                        entities.push({ layer: polyLayer, closed: polyClosed, points: polyPts });
                    }
                    inEntities = false;
                    inPoly = false;
                    continue;
                }
                if (!inEntities) {
                    flush();
                    continue;
                }
                if (valU === 'POLYLINE') {
                    flush();
                    inPoly = true;
                    polyLayer = '0';
                    polyClosed = false;
                    polyPts = [];
                    pendingX = null;
                    cur = null;
                    continue;
                }
                if (valU === 'VERTEX' && inPoly) {
                    pendingX = null;
                    continue;
                }
                if (valU === 'SEQEND' && inPoly) {
                    if (polyPts.length >= 2) {
                        if (polyClosed && (polyPts[0][0] !== polyPts[polyPts.length - 1][0] ||
                            polyPts[0][1] !== polyPts[polyPts.length - 1][1]))
                            polyPts.push([polyPts[0][0], polyPts[0][1]]);
                        entities.push({ layer: polyLayer, closed: !!polyClosed, points: polyPts });
                    }
                    inPoly = false;
                    continue;
                }
                if (inPoly) continue;
                flush();
                if (valU === 'LWPOLYLINE' || valU === 'LINE' || valU === 'CIRCLE' || valU === 'ARC') {
                    cur = { type: valU, layer: '0' };
                    lwPts = [];
                } else {
                    cur = null;
                }
                continue;
            }

            if (!inEntities) continue;

            if (inPoly) {
                if (code === 8) polyLayer = String(val).trim() || '0';
                else if (code === 70) polyClosed = !!(parseInt(val, 10) & 1);
                else if (code === 10) pendingX = fnum(val);
                else if (code === 20 && pendingX != null) {
                    polyPts.push([pendingX, fnum(val)]);
                    pendingX = null;
                }
                continue;
            }

            if (!cur) continue;
            if (code === 8) cur.layer = String(val).trim() || '0';
            else if (cur.type === 'LWPOLYLINE') {
                if (code === 70) cur.closed = !!(parseInt(val, 10) & 1);
                else if (code === 10) cur._x = fnum(val);
                else if (code === 20) lwPts.push([cur._x || 0, fnum(val)]);
            } else if (cur.type === 'LINE') {
                if (code === 10) cur.x0 = fnum(val);
                else if (code === 20) cur.y0 = fnum(val);
                else if (code === 11) cur.x1 = fnum(val);
                else if (code === 21) cur.y1 = fnum(val);
            } else if (cur.type === 'CIRCLE' || cur.type === 'ARC') {
                if (code === 10) cur.cx = fnum(val);
                else if (code === 20) cur.cy = fnum(val);
                else if (code === 40) cur.r = fnum(val);
                else if (code === 50) cur.a0 = fnum(val);
                else if (code === 51) cur.a1 = fnum(val);
            }
        }
        flush();

        let contours = [];
        let bounds = null;
        for (let i = 0; i < entities.length; i++) {
            let e = entities[i];
            let pts = e.points || [];
            if (pts.length < 2) continue;
            let closed = !!e.closed || (pts.length > 2 &&
                pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]);
            for (let j = 0; j < pts.length; j++) {
                let x = pts[j][0], y = pts[j][1];
                if (!bounds) bounds = [x, y, x, y];
                else {
                    if (x < bounds[0]) bounds[0] = x;
                    if (y < bounds[1]) bounds[1] = y;
                    if (x > bounds[2]) bounds[2] = x;
                    if (y > bounds[3]) bounds[3] = y;
                }
            }
            // Cap vertices for UI responsiveness
            if (pts.length > 4000) {
                let step = Math.ceil(pts.length / 4000);
                let slim = [];
                for (let j = 0; j < pts.length; j += step) slim.push(pts[j]);
                if (closed && slim.length &&
                    (slim[0][0] !== slim[slim.length - 1][0] || slim[0][1] !== slim[slim.length - 1][1]))
                    slim.push([slim[0][0], slim[0][1]]);
                pts = slim;
            }
            contours.push({
                id: contours.length,
                name: (e.layer || '0') + ':' + contours.length,
                layer: e.layer || '0',
                closed: closed,
                points: pts,
            });
        }
        return { contours: contours, bounds: bounds };
    }

    return { parseDxfText: parseDxfText };
});
