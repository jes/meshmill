var container;
var camera;
var renderer;
var scene;
var scenemiddle;
var controls;

function showScene(geometry, opts) {
    container = document.getElementById('scene-view');
    while(container.firstChild) container.removeChild(container.firstChild);

    if (!geometry) return;

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
    });
    renderer.setClearColor(0x444444, 1);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    var material = new THREE.MeshPhongMaterial({ 
        color: 0x0cf4c7,
        shininess: 1,
        specular: 1,
    });
    var mesh = new THREE.Mesh(geometry, material);

    geometry.computeBoundingBox();
    var largestDimension = Math.max(geometry.boundingBox.max.x, geometry.boundingBox.max.y, geometry.boundingBox.max.z);
    if (opts.recentre || !scenemiddle) {
        scenemiddle = new THREE.Vector3(0,0,0);
        geometry.boundingBox.getCenter(scenemiddle);
    }
    mesh.geometry.applyMatrix(new THREE.Matrix4().makeTranslation(-scenemiddle.x, -scenemiddle.y, -scenemiddle.z));

    /* TODO: try to use an orthographic camera (but it seems like
     * lights don't work if they're attached to an orthographic
     * camera?) */
    if (opts.recentre || !camera) {
        camera = new THREE.PerspectiveCamera(70, container.clientWidth/container.clientHeight, 1, 10000);
        camera.add(new THREE.DirectionalLight(0xffffff, 0.75));
        camera.position.z = largestDimension * 2;
    }

    scene = new THREE.Scene();
    scene.add(mesh);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    scene.add(camera);

    let origin = {...opts.origin} || { x:0, y:0, z:0 };
    origin.x -= scenemiddle.x;
    origin.y -= scenemiddle.y;
    origin.z -= scenemiddle.z;
    addOriginVisualisation(scene, origin, largestDimension / 2);

    // TODO: prevent gimbal lock
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.rotateSpeed = 0.25;
    controls.dampingFactor = 0.99;
    controls.enableZoom = true;
    controls.zoomSpeed = 2;
    controls.autoRotate = false;

    onWindowResize();
}

function scene_animate() {
    requestAnimationFrame(scene_animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}
scene_animate();

function STLViewer(model, origin) {
    (new THREE.STLLoader()).load(model, function (geometry) {
        showScene(geometry, {
            recentre: true,
            origin: origin,
        });
    });
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
