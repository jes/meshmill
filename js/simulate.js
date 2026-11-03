/* Material-removal simulation.
 *
 * The stock is a heightfield covering the model footprint. G-code cutting
 * moves (G1) are swept with the current tool shape and lower the heightfield,
 * so the simulation ends with the machined part carved out of the stock.
 */

var stockSim = null;
var stockRunning = false;

function cleanupMaterialSimulation() {
    stockRunning = false;
    if (stockSim && stockSim.mesh && scene) {
        scene.remove(stockSim.mesh);
        stockSim.geometry.dispose();
        stockSim.mesh.material.dispose();
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
    if (typeof updateSimButton === 'function')
        updateSimButton();
}

window.cleanupMaterialSimulation = cleanupMaterialSimulation;

function buildStockMesh(sim) {
    let nx = sim.nx;
    let ny = sim.ny;
    let pos = new Float32Array(nx*ny*3);
    let indices = [];
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            let k = (j*nx+i)*3;
            pos[k] = sim.x0 + i*sim.dx;
            pos[k+1] = sim.y0 + j*sim.dy;
            pos[k+2] = sim.topZ;
        }
    }
    for (let j = 0; j < ny-1; j++) {
        for (let i = 0; i < nx-1; i++) {
            let a = j*nx+i;
            let b = a+1;
            let c = a+nx;
            let d = c+1;
            indices.push(a,c,b, b,c,d);
        }
    }
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    let material = new THREE.MeshPhongMaterial({
        color: 0xc9a06a,
        shininess: 6,
        specular: 0x222222,
        side: THREE.DoubleSide,
    });
    let mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    return { geometry: geometry, mesh: mesh };
}

function toolSurfaceZ(sim, z, distance) {
    let r = sim.radius;
    if (sim.tool === 'flat')
        return z;
    if (sim.tool === 'vbit90' || sim.tool === 'vbit60' || sim.tool === 'vbit30') {
        let angle = sim.tool === 'vbit90' ? 90 : (sim.tool === 'vbit60' ? 60 : 30);
        let half = angle/2 * Math.PI/180;
        return z + distance / Math.tan(half);
    }
    // ball-nose
    let d = Math.min(distance, r);
    return z + r - Math.sqrt(Math.max(0, r*r - d*d));
}

function stampStock(sim, x, y, z) {
    let r = sim.radius;
    let cell = Math.min(sim.dx, sim.dy);
    let rc = r / cell + 1;
    let gx = (x - sim.x0) / sim.dx;
    let gy = (y - sim.y0) / sim.dy;
    let i0 = Math.max(0, Math.floor(gx - rc));
    let i1 = Math.min(sim.nx-1, Math.ceil(gx + rc));
    let j0 = Math.max(0, Math.floor(gy - rc));
    let j1 = Math.min(sim.ny-1, Math.ceil(gy + rc));
    let heights = sim.heights;

    for (let j = j0; j <= j1; j++) {
        let py = sim.y0 + j*sim.dy;
        for (let i = i0; i <= i1; i++) {
            let px = sim.x0 + i*sim.dx;
            let d = Math.sqrt((px-x)*(px-x) + (py-y)*(py-y));
            if (d > r)
                continue;
            let surface = toolSurfaceZ(sim, z, d);
            let idx = j*sim.nx+i;
            if (surface < heights[idx])
                heights[idx] = surface;
        }
    }
}

function sweepSegment(sim, a, b) {
    if (!a || !b || !b[4])
        return;
    if (Math.min(a[2], b[2]) > sim.topZ + 0.001 && Math.max(a[2], b[2]) > sim.topZ + 0.001)
        return;

    let dx = b[0]-a[0];
    let dy = b[1]-a[1];
    let dz = b[2]-a[2];
    let dist = Math.sqrt(dx*dx + dy*dy);
    let step = Math.max(Math.min(sim.dx, sim.dy)*0.6, sim.radius*0.4, 0.05);
    let steps = Math.max(1, Math.ceil(dist/step));
    for (let s = 0; s <= steps; s++) {
        let t = s/steps;
        stampStock(sim, a[0]+dx*t, a[1]+dy*t, a[2]+dz*t);
    }
}

function updateStockGeometry(sim) {
    let attr = sim.geometry.attributes.position;
    let arr = attr.array;
    for (let k = 0; k < sim.heights.length; k++)
        arr[k*3+2] = sim.heights[k];
    attr.needsUpdate = true;
}

function runStockSimulation(sim) {
    if (!sim.running || sim !== stockSim)
        return;

    let points = sim.points;
    let end = Math.min(points.length, sim.index + 350);
    for (let i = sim.index; i < end; i++) {
        if (i > 0)
            sweepSegment(sim, points[i-1], points[i]);
    }
    sim.index = end;

    if (simTool && points.length)
        simTool.position.copy(points[Math.min(sim.index, points.length-1)]);

    updateStockGeometry(sim);
    needsRender = true;
    sim.chunks++;
    if (sim.chunks % 5 === 0)
        sim.geometry.computeVertexNormals();

    if (sim.index >= points.length) {
        sim.running = false;
        stockRunning = false;
        if (simTool) simTool.visible = false;
        if (typeof updateSimButton === 'function') updateSimButton();
        return;
    }
    requestAnimationFrame(function() { runStockSimulation(sim); });
}

function startMaterialSimulation() {
    if (!simPoints || simPoints.length < 2 || !project || !project.mesh || !project.mesh.width || !scene)
        return false;

    cleanupMaterialSimulation();

    let job = project.jobs[currentjob];
    if (!job)
        return false;

    let origin = project.mesh.origin;
    let Cx = scenemiddle.x + origin.x;
    let Cy = scenemiddle.y + origin.y;
    let Cz = scenemiddle.z + origin.z;

    let x0 = project.mesh.min.x - Cx;
    let x1 = project.mesh.max.x - Cx;
    let y0 = project.mesh.min.y - Cy;
    let y1 = project.mesh.max.y - Cy;
    let width = Math.max(1e-6, x1-x0);
    let height = Math.max(1e-6, y1-y0);
    let topZ = project.mesh.max.z - Cz;

    let cell = Math.max(project.resolution || 0.25, Math.max(width, height)/260);
    let nx = Math.max(2, Math.round(width/cell)+1);
    let ny = Math.max(2, Math.round(height/cell)+1);

    let sim = {
        nx: nx,
        ny: ny,
        x0: x0,
        y0: y0,
        dx: width/(nx-1),
        dy: height/(ny-1),
        topZ: topZ,
        heights: new Float32Array(nx*ny).fill(topZ),
        tool: job.tool.shape,
        radius: Math.max(0.05, job.tool.diameter/2),
        points: simPoints,
        index: 0,
        chunks: 0,
        running: true,
    };

    let built = buildStockMesh(sim);
    sim.geometry = built.geometry;
    sim.mesh = built.mesh;
    stockSim = sim;

    if (sceneModelMesh) sceneModelMesh.visible = false;
    if (simLine) simLine.visible = false;
    if (simProgressLine) simProgressLine.visible = false;
    if (simTool) {
        simTool.visible = true;
        simTool.position.copy(simPoints[0]);
    }

    stockRunning = true;
    if (typeof updateSimButton === 'function') updateSimButton();
    requestAnimationFrame(function() { runStockSimulation(sim); });
    return true;
}

function stopMaterialSimulation() {
    cleanupMaterialSimulation();
}
