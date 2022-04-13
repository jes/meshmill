var container;
var camera;
var renderer;
var scene;
var scenemiddle;

function showScene(geometry, recentre) {
    container = document.getElementById('scene');
    while(container.firstChild) container.removeChild(container.firstChild);

    if (!geometry) {
        return;
    }

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
    if (recentre) {
        scenemiddle = new THREE.Vector3();
        geometry.boundingBox.getCenter(scenemiddle);
        mesh.geometry.applyMatrix(new THREE.Matrix4().makeTranslation(-scenemiddle.x, -scenemiddle.y, -scenemiddle.z));
    }

    /* TODO: try to use an orthographic camera (but it seems like
     * lights don't work if they're attached to an orthographic
     * camera?) */
    /* TODO: don't reset the camera every time a new model is drawn */
    camera = new THREE.PerspectiveCamera(70, container.clientWidth/container.clientHeight, 1, 1000);

    scene = new THREE.Scene();
    scene.add(mesh);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    camera.add(new THREE.DirectionalLight(0xffffff, 0.75));
    scene.add(camera);

    var largestDimension = Math.max(geometry.boundingBox.max.x, geometry.boundingBox.max.y, geometry.boundingBox.max.z);
    camera.position.z = largestDimension * 2;

    addOriginVisualisation(scene, largestDimension / 2);

    // TODO: prevent gimbal lock
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.rotateSpeed = 0.25;
    controls.dampingFactor = 0.99;
    controls.enableZoom = true;
    controls.zoomSpeed = 2;
    controls.autoRotate = false;

    var animate = function () {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }; 

    animate();

    onWindowResize();
}

function STLViewer(model) {
    (new THREE.STLLoader()).load(model, function (geometry) {
        showScene(geometry, true);
    });
}

window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    if (!renderer) return;
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

function addOriginVisualisation(scene, D) {
    addLine(scene, 0,0,0, D,0,0, 0xff0000);
    addLine(scene, 0,0,0, 0,D,0, 0x00ff00);
    addLine(scene, 0,0,0, 0,0,D, 0x0000ff);
}
