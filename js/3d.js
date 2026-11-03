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

function showScene(geometry, opts) {
    opts = opts || {};

    if (typeof window.cleanupMaterialSimulation === 'function')
        window.cleanupMaterialSimulation();

    container = document.getElementById('scene-view');

    if (!geometry) return;

    // rebuilding the scene invalidates any running simulation
    simPlaying = false;
    simPoints = [];
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
        });
        renderer.setClearColor(0x12151a, 1);
        renderer.setPixelRatio(1);
        container.appendChild(renderer.domElement);
    }

    var material;
    if (opts.vertexColors) {
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
    var largestDimension = Math.max(geometry.boundingBox.max.x, geometry.boundingBox.max.y, geometry.boundingBox.max.z);
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
    mesh.geometry.applyMatrix(new THREE.Matrix4().makeTranslation(tx, ty, tz));

    let newCamera = false;
    if (!camera) {
        camera = new THREE.PerspectiveCamera(70, container.clientWidth/container.clientHeight, 1, 10000);
        camera.add(new THREE.DirectionalLight(0xffffff, 0.75));
        newCamera = true;
    }
    if (newCamera || opts.resetCamera) {
        camera.position.set(0, 0, sceneLargest * 2);
        camera.lookAt(0, 0, 0);
    }

    scene = new THREE.Scene();
    scene.add(mesh);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    scene.add(camera);

    addOriginVisualisation(scene, {x:-center.x, y:-center.y, z:-center.z}, sceneLargest / 2);

    // TODO: prevent gimbal lock
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.rotateSpeed = 0.25;
    controls.dampingFactor = 0.99;
    controls.enableZoom = true;
    controls.zoomSpeed = 2;
    controls.autoRotate = false;

    onWindowResize();
    updateStockBox();
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
}

function showStockBox(sx, sy, sz) {
    stockDims = { x: sx, y: sy, z: sz };
    updateStockBox();
}

function scene_animate() {
    requestAnimationFrame(scene_animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
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
}

window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    if (!renderer || !camera) return;
    renderer.setSize(0,0);
    let rect = container.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
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
    for (let i = 0; i < vertices.length; i += 3) {
        let x = vertices[3*i];
        let y = vertices[3*i+1];
        let z = vertices[3*i+2];
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
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    updateSimButton();
    return true;
}

function simStop() {
    simPlaying = false;
    if (simLine) simLine.visible = true;
    if (simProgressLine) simProgressLine.visible = false;
    if (simTool) simTool.visible = false;
    updateSimButton();
}
