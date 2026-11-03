/* Aspire-style material-removal preview.
 *
 * Solid rectangular stock → tool carves a heightfield → machined regions
 * get a lighter fill colour. Lambert + lights give readable relief shading.
 */

var stockSim = null;
var stockRunning = false;

// Aspire-like palette
var STOCK_COLOR = { r: 0.72, g: 0.55, b: 0.32 };      // uncut material
var FILL_COLOR  = { r: 0.93, g: 0.88, b: 0.72 };      // machined fill
var SIDE_COLOR  = { r: 0.45, g: 0.33, b: 0.18 };

function hideToolpathOverlay() {
    // Remove purple/yellow path overlays completely so future Z layers cannot
    // show through the stock preview during multi-pass (step-down) simulation.
    if (typeof clearToolpathLines === 'function') {
        clearToolpathLines();
        return;
    }
    if (typeof simLine !== 'undefined' && simLine) {
        if (scene) scene.remove(simLine);
        simLine.visible = false;
    }
    if (typeof simProgressLine !== 'undefined' && simProgressLine) {
        if (scene) scene.remove(simProgressLine);
        simProgressLine.visible = false;
    }
    if (typeof simTool !== 'undefined' && simTool) {
        if (scene) scene.remove(simTool);
        simTool.visible = false;
    }
}

function cleanupMaterialSimulation() {
    stockRunning = false;
    if (stockSim) {
        if (stockSim.mesh && scene) {
            scene.remove(stockSim.mesh);
            if (stockSim.geometry) stockSim.geometry.dispose();
            if (stockSim.mesh.material) stockSim.mesh.material.dispose();
        }
        if (stockSim.toolMesh && scene) {
            scene.remove(stockSim.toolMesh);
            if (stockSim.toolMesh.geometry) stockSim.toolMesh.geometry.dispose();
            if (stockSim.toolMesh.material) stockSim.toolMesh.material.dispose();
        }
    }
    stockSim = null;
    if (typeof sceneModelMesh !== 'undefined' && sceneModelMesh)
        sceneModelMesh.visible = true;
    if (typeof simLine !== 'undefined' && simLine)
        simLine.visible = true;
    if (typeof simProgressLine !== 'undefined' && simProgressLine)
        simProgressLine.visible = false;
    if (typeof simTool !== 'undefined' && simTool)
        simTool.visible = false;
    if (typeof stockBoxGroup !== 'undefined' && stockBoxGroup)
        stockBoxGroup.visible = true;
    if (typeof updateSimButton === 'function')
        updateSimButton();
    needsRender = true;
}

window.cleanupMaterialSimulation = cleanupMaterialSimulation;

function buildToolMesh(shape, radius) {
    let r = Math.max(0.05, radius);
    let geom;
    if (shape === 'flat') {
        geom = new THREE.CylinderGeometry(r, r, r * 3, 20);
        geom.rotateX(Math.PI / 2);
        geom.translate(0, 0, r * 1.5);
    } else if (shape === 'vbit90' || shape === 'vbit60' || shape === 'vbit30') {
        let angle = shape === 'vbit90' ? 90 : (shape === 'vbit60' ? 60 : 30);
        let half = (angle / 2) * Math.PI / 180;
        let h = Math.max(r / Math.tan(half), r * 0.5);
        geom = new THREE.ConeGeometry(r, h, 20);
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, 0, h / 2);
    } else {
        geom = new THREE.SphereGeometry(r, 18, 12);
        geom.translate(0, 0, r);
    }
    // Wireframe-ish solid tool like Aspire "Draw tool"
    let mat = new THREE.MeshBasicMaterial({
        color: 0x2a2a2a,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
    });
    return new THREE.Mesh(geom, mat);
}

function buildStockMesh(sim) {
    let nx = sim.nx;
    let ny = sim.ny;
    let bottomZ = sim.bottomZ;
    let topCount = nx * ny;
    let vertCount = topCount * 2;
    let pos = new Float32Array(vertCount * 3);
    let colors = new Float32Array(vertCount * 3);

    function setV(idx, x, y, z, col) {
        let o = idx * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        colors[o] = col.r; colors[o + 1] = col.g; colors[o + 2] = col.b;
    }

    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            let idx = j * nx + i;
            let x = sim.x0 + i * sim.dx;
            let y = sim.y0 + j * sim.dy;
            setV(idx, x, y, sim.topZ, STOCK_COLOR);
            setV(topCount + idx, x, y, bottomZ, SIDE_COLOR);
        }
    }

    let indices = [];
    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            let a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }
    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            let a = topCount + j * nx + i, b = a + 1, c = a + nx, d = c + 1;
            indices.push(a, b, c, b, d, c);
        }
    }
    function wall(i0, j0, i1, j1) {
        let t0 = j0 * nx + i0, t1 = j1 * nx + i1;
        let b0 = topCount + t0, b1 = topCount + t1;
        indices.push(t0, b0, t1, t1, b0, b1);
    }
    for (let i = 0; i < nx - 1; i++) {
        wall(i, 0, i + 1, 0);
        wall(i + 1, ny - 1, i, ny - 1);
    }
    for (let j = 0; j < ny - 1; j++) {
        wall(0, j + 1, 0, j);
        wall(nx - 1, j, nx - 1, j + 1);
    }

    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Lambert + vertex colors: directional light makes relief readable.
    // Falls back still works under SwiftShader (HA disabled).
    let material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        flatShading: false,
    });

    let mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    ensureStockLights();
    return { geometry: geometry, mesh: mesh };
}

/** Key light from above-front-left so carved slopes catch highlights/shadows. */
function ensureStockLights() {
    if (!scene) return;
    if (scene.getObjectByName('stockKeyLight')) return;

    let key = new THREE.DirectionalLight(0xfff2dd, 0.95);
    key.name = 'stockKeyLight';
    key.position.set(-0.65, -0.35, 1.15);
    scene.add(key);

    let fill = new THREE.DirectionalLight(0xdde8ff, 0.35);
    fill.name = 'stockFillLight';
    fill.position.set(0.55, 0.7, 0.4);
    scene.add(fill);

    let hemi = new THREE.AmbientLight(0xffffff, 0.28);
    hemi.name = 'stockAmbientLight';
    scene.add(hemi);
}

/** Shade a base RGB by a lambert term from the heightfield normal. */
function shadeByNormal(base, nx, ny, nz) {
    // Light direction matching stockKeyLight
    let lx = -0.65, ly = -0.35, lz = 1.15;
    let llen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    lx /= llen; ly /= llen; lz /= llen;
    let ndotl = nx * lx + ny * ly + nz * lz;
    let lit = 0.22 + 0.78 * Math.max(0, ndotl); // ambient + diffuse
    // Slight warm rim on steep faces
    let steep = 1 - Math.max(0, nz);
    return {
        r: Math.min(1, base.r * lit + 0.04 * steep),
        g: Math.min(1, base.g * lit + 0.02 * steep),
        b: Math.min(1, base.b * lit),
    };
}

function heightNormal(sim, i, j) {
    let nx = sim.nx, ny = sim.ny;
    let i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1);
    let j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
    let dzdx = (sim.heights[j * nx + i1] - sim.heights[j * nx + i0]) / ((i1 - i0) * sim.dx || 1);
    let dzdy = (sim.heights[j1 * nx + i] - sim.heights[j0 * nx + i]) / ((j1 - j0) * sim.dy || 1);
    // Normal of surface z=f(x,y): (-dzdx, -dzdy, 1)
    let x = -dzdx, y = -dzdy, z = 1;
    let len = Math.sqrt(x * x + y * y + z * z) || 1;
    return { x: x / len, y: y / len, z: z / len };
}

function toolSurfaceZ(sim, z, distance) {
    let r = sim.radius;
    if (sim.tool === 'flat')
        return z;
    if (sim.tool === 'vbit90' || sim.tool === 'vbit60' || sim.tool === 'vbit30') {
        let angle = sim.tool === 'vbit90' ? 90 : (sim.tool === 'vbit60' ? 60 : 30);
        let half = angle / 2 * Math.PI / 180;
        return z + distance / Math.tan(half);
    }
    let d = Math.min(distance, r);
    return z + r - Math.sqrt(Math.max(0, r * r - d * d));
}

function stampStock(sim, x, y, z) {
    let r = sim.radius;
    let cell = Math.min(sim.dx, sim.dy);
    let rc = r / cell + 2;
    let gx = (x - sim.x0) / sim.dx;
    let gy = (y - sim.y0) / sim.dy;
    let i0 = Math.max(0, Math.floor(gx - rc));
    let i1 = Math.min(sim.nx - 1, Math.ceil(gx + rc));
    let j0 = Math.max(0, Math.floor(gy - rc));
    let j1 = Math.min(sim.ny - 1, Math.ceil(gy + rc));
    let heights = sim.heights;
    let carved = sim.carved;
    let floorZ = sim.bottomZ;
    let modelFloor = sim.modelFloor;
    let dirtied = false;

    for (let j = j0; j <= j1; j++) {
        let py = sim.y0 + j * sim.dy;
        for (let i = i0; i <= i1; i++) {
            let px = sim.x0 + i * sim.dx;
            let d = Math.sqrt((px - x) * (px - x) + (py - y) * (py - y));
            if (d > r)
                continue;
            let surface = toolSurfaceZ(sim, z, d);
            if (surface < floorZ) surface = floorZ;
            let idx = j * sim.nx + i;
            // Never cut below the part surface — leaves the 3D model in the stock
            if (modelFloor && surface < modelFloor[idx])
                surface = modelFloor[idx];
            if (surface < heights[idx] - 1e-6) {
                heights[idx] = surface;
                carved[idx] = 1;
                dirtied = true;
            }
        }
    }
    return dirtied;
}

function sweepSegment(sim, a, b) {
    if (!a || !b)
        return false;
    // pngcam uses G1 for rapids too — only trust the isCut flag (from feed rate)
    if (!b[4])
        return false;
    if (Math.min(a[2], b[2]) > sim.topZ + sim.radius + 0.5)
        return false;

    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let step = Math.max(Math.min(sim.dx, sim.dy) * 0.45, sim.radius * 0.2, 0.03);
    let steps = Math.max(1, Math.ceil(dist / step));
    let dirty = false;
    for (let s = 0; s <= steps; s++) {
        let t = s / steps;
        if (stampStock(sim, a[0] + dx * t, a[1] + dy * t, a[2] + dz * t))
            dirty = true;
    }
    return dirty;
}

function updateStockGeometry(sim) {
    let pos = sim.geometry.attributes.position;
    let col = sim.geometry.attributes.color;
    let parr = pos.array;
    let carr = col.array;
    let topCount = sim.nx * sim.ny;
    let span = Math.max(1e-6, sim.topZ - sim.bottomZ);
    let nx = sim.nx, ny = sim.ny;

    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            let k = j * nx + i;
            let z = sim.heights[k];
            parr[k * 3 + 2] = z;
            parr[(topCount + k) * 3 + 2] = sim.bottomZ;

            let base;
            if (sim.carved[k]) {
                let t = (sim.topZ - z) / span;
                base = {
                    r: FILL_COLOR.r * (1 - 0.22 * t),
                    g: FILL_COLOR.g * (1 - 0.22 * t),
                    b: FILL_COLOR.b * (1 - 0.12 * t),
                };
            } else {
                base = STOCK_COLOR;
            }
            let n = heightNormal(sim, i, j);
            let shaded = shadeByNormal(base, n.x, n.y, n.z);
            carr[k * 3] = shaded.r;
            carr[k * 3 + 1] = shaded.g;
            carr[k * 3 + 2] = shaded.b;

            // Side/bottom a bit darker
            let side = shadeByNormal(SIDE_COLOR, 0.4, 0.2, 0.5);
            carr[(topCount + k) * 3] = side.r;
            carr[(topCount + k) * 3 + 1] = side.g;
            carr[(topCount + k) * 3 + 2] = side.b;
        }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (sim.geometry.attributes.normal) {
        sim.geometry.computeVertexNormals();
        sim.geometry.attributes.normal.needsUpdate = true;
    } else {
        sim.geometry.computeVertexNormals();
    }
}

function simSpeedFactor() {
    let el = document.getElementById('simspeed');
    let v = el ? parseFloat(el.value) : 100;
    if (!isFinite(v) || v < 1) v = 100;
    return v / 100;
}

function runStockSimulation(sim) {
    if (!sim.running || sim !== stockSim)
        return;

    let points = sim.points;
    let chunk = Math.max(40, Math.round(400 * simSpeedFactor()));
    let end = Math.min(points.length, sim.index + chunk);
    let dirty = false;
    for (let i = Math.max(1, sim.index); i < end; i++) {
        if (sweepSegment(sim, points[i - 1], points[i]))
            dirty = true;
    }
    sim.index = end;

    if (sim.toolMesh && points.length) {
        let p = points[Math.min(sim.index, points.length - 1)];
        sim.toolMesh.position.set(p[0], p[1], p[2]);
        sim.toolMesh.visible = true;
    }

    if (dirty)
        updateStockGeometry(sim);
    needsRender = true;

    if (sim.index >= points.length) {
        sim.running = false;
        stockRunning = false;
        updateStockGeometry(sim);
        if (sim.toolMesh) sim.toolMesh.visible = false;
        if (typeof updateSimButton === 'function') updateSimButton();
        needsRender = true;
        return;
    }
    requestAnimationFrame(function() { runStockSimulation(sim); });
}

function getSimulationStockWorld(job) {
    let pad = Math.max((job && job.tool && job.tool.diameter) || 0, 0.5) * 0.5;
    let sx0 = project.mesh.min.x - pad;
    let sx1 = project.mesh.max.x + pad;
    let sy0 = project.mesh.min.y - pad;
    let sy1 = project.mesh.max.y + pad;
    let topWorld = project.mesh.max.z;
    let botWorld = project.mesh.min.z;

    if (project.stock && project.stock.x > 0 && project.stock.y > 0 && project.stock.z > 0) {
        let mx = (project.mesh.min.x + project.mesh.max.x) / 2;
        let my = (project.mesh.min.y + project.mesh.max.y) / 2;
        sx0 = mx - project.stock.x / 2;
        sx1 = mx + project.stock.x / 2;
        sy0 = my - project.stock.y / 2;
        sy1 = my + project.stock.y / 2;
        botWorld = project.mesh.min.z;
        // Stock top is the top of the blank, which should at least cover the model
        topWorld = Math.max(project.mesh.max.z, botWorld + project.stock.z);
        if (project.stock.z > 0)
            topWorld = botWorld + project.stock.z;
    }
    return { sx0: sx0, sx1: sx1, sy0: sy0, sy1: sy1, topWorld: topWorld, botWorld: botWorld };
}

function meshSceneCenter() {
    // Always use the model AABB — NOT the displayed heightmap bbox (write-stock
    // after machining has a different centre and was breaking stamp alignment).
    return {
        x: (project.mesh.min.x + project.mesh.max.x) / 2,
        y: (project.mesh.min.y + project.mesh.max.y) / 2,
        z: (project.mesh.min.z + project.mesh.max.z) / 2,
    };
}

function gcodeToScenePoints(path, rotary) {
    let origin = project.mesh.origin;
    let Cx = (project.mesh.min.x + project.mesh.max.x) / 2 - origin.x;
    let Cy = (project.mesh.min.y + project.mesh.max.y) / 2 - origin.y;
    let Cz = (project.mesh.min.z + project.mesh.max.z) / 2 - origin.z;
    if (rotary) { Cy = 0; Cz = 0; }
    let xaxis = new THREE.Vector3(1, 0, 0);
    let out = [];
    for (let i = 0; i < path.length; i++) {
        let p = path[i];
        let v = new THREE.Vector3(p[0] - Cx, p[1] - Cy, p[2] - Cz);
        if (p[3])
            v.applyAxisAngle(xaxis, p[3] * Math.PI / 180);
        out.push([v.x, v.y, v.z, p[3] || 0, p[4] ? 1 : 0]);
    }
    return out;
}

function sampleModelFloor(imageData, w, h, sim, C) {
    // Map each stock grid cell to the project heightmap → scene Z of the part surface.
    let floor = new Float32Array(sim.nx * sim.ny);
    let data = imageData.data;
    let origin = project.mesh.origin;
    let xmin = project.mesh.min.x;
    let xmax = project.mesh.max.x;
    let ymin = project.mesh.min.y;
    let ymax = project.mesh.max.y;
    let zmin = project.mesh.min.z;
    let zmax = project.mesh.max.z;
    let depth = Math.max(1e-9, zmax - zmin);

    for (let j = 0; j < sim.ny; j++) {
        for (let i = 0; i < sim.nx; i++) {
            let sx = sim.x0 + i * sim.dx; // scene
            let sy = sim.y0 + j * sim.dy;
            let wx = sx + C.x; // world
            let wy = sy + C.y;
            let fx = (xmax <= xmin) ? 0 : (wx - xmin) / (xmax - xmin) * (w - 1);
            let fy = (ymax <= ymin) ? 0 : (1 - (wy - ymin) / (ymax - ymin)) * (h - 1);
            let hv = 0;
            if (fx >= 0 && fy >= 0 && fx <= w - 1 && fy <= h - 1) {
                // bilinear sample of 24-bit height
                let x0 = Math.floor(fx), y0 = Math.floor(fy);
                let x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
                let tx = fx - x0, ty = fy - y0;
                function at(x, y) {
                    let p = (y * w + x) * 4;
                    return data[p] * 65536 + data[p + 1] * 256 + data[p + 2];
                }
                let h00 = at(x0, y0), h10 = at(x1, y0), h01 = at(x0, y1), h11 = at(x1, y1);
                hv = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
            }
            let zWorld = zmin + (hv / 16777215) * depth;
            floor[j * sim.nx + i] = zWorld - C.z;
        }
    }
    return floor;
}

function beginStockSimWithPoints(points, job, modelFloor) {
    if (!points || points.length < 2)
        return false;

    cleanupMaterialSimulation();

    let C = meshSceneCenter();
    let sw = getSimulationStockWorld(job);
    let x0 = sw.sx0 - C.x;
    let x1 = sw.sx1 - C.x;
    let y0 = sw.sy0 - C.y;
    let y1 = sw.sy1 - C.y;
    let width = Math.max(1e-6, x1 - x0);
    let height = Math.max(1e-6, y1 - y0);
    let topZ = sw.topWorld - C.z;
    let bottomZ = sw.botWorld - C.z;

    // Finer grid → sharper relief under lighting (cap keeps software GL responsive)
    let cell = Math.max(0.08, Math.min(project.resolution || 0.5, Math.max(width, height) / 280));
    let nx = Math.max(8, Math.round(width / cell) + 1);
    let ny = Math.max(8, Math.round(height / cell) + 1);
    let maxCells = 360;
    if (nx > maxCells) nx = maxCells;
    if (ny > maxCells) ny = maxCells;

    let cuts = 0;
    for (let i = 0; i < points.length; i++)
        if (points[i][4]) cuts++;
    if (cuts < 2)
        return false;

    let sim = {
        nx: nx,
        ny: ny,
        x0: x0,
        y0: y0,
        dx: width / (nx - 1),
        dy: height / (ny - 1),
        topZ: topZ,
        bottomZ: bottomZ,
        heights: new Float32Array(nx * ny).fill(topZ),
        carved: new Uint8Array(nx * ny),
        modelFloor: modelFloor || null,
        tool: job.tool.shape,
        radius: Math.max(0.05, job.tool.diameter / 2),
        points: points,
        index: 0,
        running: true,
    };

    // Rebuild floor at the chosen grid resolution if a source image was provided
    if (modelFloor && modelFloor._imageData) {
        sim.modelFloor = sampleModelFloor(modelFloor._imageData, modelFloor._w, modelFloor._h, sim, C);
    }

    let built = buildStockMesh(sim);
    sim.geometry = built.geometry;
    sim.mesh = built.mesh;

    sim.toolMesh = buildToolMesh(job.tool.shape, job.tool.diameter / 2);
    scene.add(sim.toolMesh);
    sim.toolMesh.position.set(points[0][0], points[0][1], points[0][2]);

    stockSim = sim;

    if (sceneModelMesh) sceneModelMesh.visible = false;
    hideToolpathOverlay();
    if (typeof stockBoxGroup !== 'undefined' && stockBoxGroup)
        stockBoxGroup.visible = false;

    stockRunning = true;
    if (typeof updateSimButton === 'function') updateSimButton();
    needsRender = true;
    requestAnimationFrame(function() { runStockSimulation(sim); });
    return true;
}

function loadHeightmapImageData(file, cb) {
    if (!file) return cb(null);
    let img = new Image();
    img.onload = function() {
        let canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        let ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
            cb({
                _imageData: ctx.getImageData(0, 0, img.width, img.height),
                _w: img.width,
                _h: img.height,
            });
        } catch (e) {
            cb(null);
        }
    };
    img.onerror = function() { cb(null); };
    img.src = file + '?' + Math.random();
}

function startMaterialSimulation() {
    if (!project || !project.mesh || !project.mesh.width || !scene)
        return false;
    let job = project.jobs[currentjob];
    if (!job || !job.gcodefile)
        return false;

    showBusy(i18n.t('simulate') + '…');
    // Prefer the original surface heightmap so the carved part remains visible
    let floorSrc = project.heightmap || job.outputheightmap;
    loadHeightmapImageData(floorSrc, function(floorImg) {
        window.api.send('plot-toolpath', { file: job.gcodefile }, function(path) {
            hideBusy();
            let points = gcodeToScenePoints(path || [], project.rotary);
            simPathPoints = points;
            if (!beginStockSimWithPoints(points, job, floorImg)) {
                alert(i18n.t('sim_no_cuts'));
            }
        });
    });
    return true;
}

function stopMaterialSimulation() {
    // Aspire "Reset Preview": drop carved stock and restore the model view
    cleanupMaterialSimulation();
    // Toolpath overlays were removed during the preview — redraw them
    if (typeof drawJob === 'function')
        drawJob();
}
