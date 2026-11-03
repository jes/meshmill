var container;
var camera;
var renderer;
var scene;
var scenemiddle;
var controls;
var sceneLargest = 1;

var simPoints = [];
var simIndex = 0;
var simPlaying = false;
var simLine = null;
var simProgressLine = null;
var simTool = null;
var simToolRadius = 2;
var sceneModelMesh = null;
var stockDims = null;
var stockBoxGroup = null;
var contourGroup = null;
var needsRender = true;

function showContourScene(resetCamera) {
    if (!project || !project.contours || !project.contours.length) return;
    if (!project.mesh || !project.mesh.width) {
        if (typeof project.applyCadBounds === 'function')
            project.applyCadBounds(null, project.contours);
    }
    if (!project.mesh || !project.mesh.width) return;
    let w = Math.max(project.mesh.width, 1);
    let h = Math.max(project.mesh.height, 1);
    let geom = new THREE.PlaneGeometry(w, h);
    let cx = (project.mesh.min.x + project.mesh.max.x) / 2;
    let cy = (project.mesh.min.y + project.mesh.max.y) / 2;
    let cz = (project.mesh.min && project.mesh.min.z != null) ? project.mesh.min.z : 0;
    geom.translate(cx, cy, cz);
    showScene(geom, {
        origin: project.mesh.origin || { x: 0, y: 0, z: 0 },
        subtractOrigin: true,
        resetCamera: !!resetCamera,
        contourGround: true,
    });
}

function showScene(geometry, opts) {
    opts = opts || {};

    if (typeof window.cleanupMaterialSimulation === 'function')
        window.cleanupMaterialSimulation();

    container = document.getElementById('scene-view');

    if (!geometry) {
        if (project && project.contours && project.contours.length) {
            showContourScene(!!opts.resetCamera);
        }
        return;
    }

    // rebuilding the scene invalidates any running simulation
    simPlaying = false;
    simPoints = [];
    if (typeof simPathPoints !== 'undefined')
        simPathPoints = [];
    simLine = null;
    simProgressLine = null;
    simTool = null;
    updateSimButton();

    // One WebGL context for the whole app. Recreating it on every scene
    // rebuild leaks contexts and can wedge the GPU process.
    if (!renderer) {
        renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
        });
        renderer.setClearColor(0x12151a, 1);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.appendChild(renderer.domElement);
    }

    var material;
    if (opts.contourGround) {
        material = new THREE.MeshBasicMaterial({
            color: 0x1a222c,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
    } else if (opts.vertexColors) {
        material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
        });
    } else {
        material = new THREE.MeshPhongMaterial({
            color: 0x0cf4c7,
            shininess: 1,
            specular: 1,
        });
    }
    var mesh = new THREE.Mesh(geometry, material);
    sceneModelMesh = mesh;

    geometry.computeBoundingBox();
    var bb = geometry.boundingBox;
    // Use bbox *size* (not max corner) so CAD drawings far from world origin frame correctly.
    var largestDimension = Math.max(
        bb.max.x - bb.min.x,
        bb.max.y - bb.min.y,
        bb.max.z - bb.min.z
    );
    sceneLargest = largestDimension || 1;

    var origin = opts.origin ? {...opts.origin} : {x:0, y:0, z:0};

    // Everything is displayed in origin-relative coordinates:
    // subtract the machine origin, then centre the result on the scene origin.
    var center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    if (opts.subtractOrigin) {
        center.x -= origin.x;
        center.y -= origin.y;
        center.z -= origin.z;
    }
    scenemiddle = center;

    var tx = -center.x;
    var ty = -center.y;
    var tz = -center.z;
    if (opts.subtractOrigin) {
        tx -= origin.x;
        ty -= origin.y;
        tz -= origin.z;
    }
    let xf = new THREE.Matrix4().makeTranslation(tx, ty, tz);
    if (typeof mesh.geometry.applyMatrix4 === 'function')
        mesh.geometry.applyMatrix4(xf);
    else if (typeof mesh.geometry.applyMatrix === 'function')
        mesh.geometry.applyMatrix(xf);

    let newCamera = false;
    // Large DXF drawings exceed the old far=10000 clip plane → empty viewport.
    let camNear = Math.max(0.01, Math.min(1, sceneLargest / 1000));
    let camFar = Math.max(10000, sceneLargest * 50);
    if (!camera) {
        camera = new THREE.PerspectiveCamera(70, container.clientWidth/container.clientHeight, camNear, camFar);
        camera.add(new THREE.DirectionalLight(0xffffff, 0.75));
        newCamera = true;
    } else {
        camera.near = camNear;
        camera.far = camFar;
        camera.updateProjectionMatrix();
    }
    if (newCamera || opts.resetCamera) {
        camera.position.set(0, 0, Math.max(sceneLargest * 2, camNear * 10));
        camera.lookAt(0, 0, 0);
    }

    scene = new THREE.Scene();
    scene.add(mesh);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    scene.add(camera);

    addOriginVisualisation(scene, {x:-center.x, y:-center.y, z:-center.z}, sceneLargest / 2);

    // TODO: prevent gimbal lock
    if (controls) {
        controls.dispose();
        controls = null;
    }
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.rotateSpeed = 0.25;
    controls.dampingFactor = 0.99;
    controls.enableZoom = true;
    controls.zoomSpeed = 2;
    controls.autoRotate = false;
    controls.addEventListener('change', function() { needsRender = true; });

    onWindowResize();
    needsRender = true;
    updateStockBox();
    updateContourOverlay();
}

function updateStockBox() {
    if (stockBoxGroup && scene) {
        scene.remove(stockBoxGroup);
        stockBoxGroup = null;
    }
    if (!stockDims || !scene || !project || !project.mesh || !project.mesh.width || !scenemiddle)
        return;

    let origin = project.mesh.origin;
    let cx = (project.mesh.min.x + project.mesh.max.x)/2 - (scenemiddle.x + origin.x);
    let cy = (project.mesh.min.y + project.mesh.max.y)/2 - (scenemiddle.y + origin.y);
    let z0 = project.mesh.min.z - (scenemiddle.z + origin.z);

    let sx = stockDims.x;
    let sy = stockDims.y;
    let sz = stockDims.z;
    let geometry = new THREE.BoxGeometry(sx, sy, sz);
    let material = new THREE.MeshPhongMaterial({
        color: 0x17d4a5,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
    });
    let box = new THREE.Mesh(geometry, material);
    let edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x17d4a5, transparent: true, opacity: 0.75 })
    );

    let group = new THREE.Group();
    group.add(box);
    group.add(edges);
    group.position.set(cx, cy, z0 + sz/2);
    scene.add(group);
    stockBoxGroup = group;
    needsRender = true;
}

function showStockBox(sx, sy, sz) {
    stockDims = { x: sx, y: sy, z: sz };
    updateStockBox();
}

function updateContourOverlay() {
    if (contourGroup && scene) {
        scene.remove(contourGroup);
        contourGroup = null;
    }
    if (!scene || !project || !project.contours || !project.contours.length)
        return;
    let origin = (project.mesh && project.mesh.origin)
        ? project.mesh.origin
        : { x: 0, y: 0, z: 0 };
    let mid = scenemiddle || { x: 0, y: 0, z: 0 };
    let zTop = (project.mesh && project.mesh.max && project.mesh.max.z != null)
        ? project.mesh.max.z
        : 0;
    let z = zTop - origin.z - mid.z + 0.2;
    let group = new THREE.Group();
    let maxContours = 200;
    let nDraw = Math.min(project.contours.length, maxContours);
    for (let i = 0; i < nDraw; i++) {
        let c = project.contours[i];
        if (!c.points || c.points.length < 2) continue;
        let pts = [];
        let step = c.points.length > 2000 ? Math.ceil(c.points.length / 2000) : 1;
        for (let j = 0; j < c.points.length; j += step) {
            let p = c.points[j];
            pts.push(new THREE.Vector3(p[0] - origin.x - mid.x, p[1] - origin.y - mid.y, z));
        }
        // keep closed look
        if (c.closed && pts.length > 2) {
            let a = pts[0], b = pts[pts.length - 1];
            if (a.x !== b.x || a.y !== b.y) pts.push(a.clone());
        }
        let geom = new THREE.BufferGeometry().setFromPoints(pts);
        let mat = new THREE.LineBasicMaterial({
            color: c.closed ? 0xffaa00 : 0x88aaff,
            linewidth: 2,
        });
        group.add(new THREE.Line(geom, mat));
    }
    scene.add(group);
    contourGroup = group;
    needsRender = true;
}

function scene_animate() {
    requestAnimationFrame(scene_animate);
    if (!renderer || !scene || !camera) return;
    if (controls && controls.update()) needsRender = true;
    if (needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
    }
}
scene_animate();

function STLViewer(model, origin, resetCamera) {
    (new THREE.STLLoader()).load(model, function (geometry) {
        showScene(geometry, {
            origin: origin,
            subtractOrigin: true,
            resetCamera: !!resetCamera,
        });
    });
}

function fitView() {
    if (!camera || !controls) return;
    camera.position.set(0, 0, sceneLargest * 2);
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.update();
    needsRender = true;
}

window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    if (!renderer || !camera) return;
    renderer.setSize(0,0);
    let rect = container.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
    needsRender = true;
}

function addLine(scene, x1,y1,z1, x2,y2,z2, colour) {
    let points = [
        new THREE.Vector3(x1,y1,z1),
        new THREE.Vector3(x2,y2,z2),
    ];
    let geometry = new THREE.BufferGeometry().setFromPoints(points);
    let material = new THREE.LineBasicMaterial({
        color: colour,
        linewidth: 2,
    });
    let line = new THREE.Line(geometry, material);
    scene.add(line);
}

function addOriginVisualisation(scene, O, D) {
    addLine(scene, O.x,O.y,O.z, O.x+D,O.y,O.z, 0xff0000);
    addLine(scene, O.x,O.y,O.z, O.x,O.y+D,O.z, 0x00ff00);
    addLine(scene, O.x,O.y,O.z, O.x,O.y,O.z+D, 0x0000ff);
    // TODO: show arrows? show "X,Y,Z" ?
}

function maxRadius(geometry) {
    let vertices = geometry.attributes.position.array;
    let max = 0;
    // i already steps by 3 through the interleaved xyz buffer
    for (let i = 0; i < vertices.length; i += 3) {
        let y = vertices[i+1];
        let z = vertices[i+2];
        let r = Math.sqrt(y*y + z*z);
        if (r > max) max = r;
    }
    return max;
}

/* toolpath simulation */

function updateSimButton() {
    if (typeof window.updateSimButton === 'function')
        window.updateSimButton(simPlaying);
}

function simStart() {
    if (!simPoints || simPoints.length < 2)
        return false;

    simIndex = 0;
    simPlaying = true;
    if (simLine) simLine.visible = false;
    if (simProgressLine) {
        simProgressLine.visible = true;
        simProgressLine.geometry.setDrawRange(0, 1);
    }
    if (simTool) {
        simTool.visible = true;
        simTool.position.copy(simPoints[0]);
    }

    let speed = 100;
    let el = document.getElementById('simspeed');
    if (el) speed = parseFloat(el.value) || 100;

    let last = performance.now();
    function tick(now) {
        if (!simPlaying) return;
        let dt = Math.min(0.2, (now-last)/1000);
        last = now;
        simIndex += Math.max(1, Math.round(speed*dt));
        if (simIndex >= simPoints.length-1) {
            simIndex = simPoints.length-1;
            if (simProgressLine) simProgressLine.geometry.setDrawRange(0, simPoints.length);
            if (simTool) simTool.position.copy(simPoints[simIndex]);
            simPlaying = false;
            updateSimButton();
            return;
        }
        if (simProgressLine) simProgressLine.geometry.setDrawRange(0, simIndex+1);
        if (simTool) simTool.position.copy(simPoints[simIndex]);
        needsRender = true;
        requestAnimationFrame(tick);
    }
    needsRender = true;
    requestAnimationFrame(tick);
    updateSimButton();
    return true;
}

function simStop() {
    simPlaying = false;
    if (simLine) simLine.visible = true;
    if (simProgressLine) simProgressLine.visible = false;
    if (simTool) simTool.visible = false;
    needsRender = true;
    updateSimButton();
}
